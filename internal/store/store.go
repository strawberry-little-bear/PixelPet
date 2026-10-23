package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	_ "modernc.org/sqlite"
)

// ErrInvalidSave identifies an unreadable saved state, not a transport failure.
// The database remains intact until an explicit, validated import or reset.
var ErrInvalidSave = errors.New("现有存档校验失败")

// ErrClockAhead means the stored state is internally valid at its last tick,
// but the service clock is behind it. Never migrate, settle, replace or reset
// such a save until the service clock catches up.
var ErrClockAhead = errors.New("服务时间早于存档时间，请校准运行 Go 服务的电脑时间后按 B 重新检查；不要重置存档")

type Store struct {
	db *sql.DB
	mu sync.Mutex
}
type WalkGameReceipt struct {
	Cleared          int `json:"cleared"`
	Total            int `json:"total"`
	RouteCoins       int `json:"routeCoins"`
	PerformanceCoins int `json:"performanceCoins"`
	AwardedCoins     int `json:"awardedCoins"`
}

type GameReceipt struct {
	Walk *WalkGameReceipt `json:"walk,omitempty"`
}

type Result struct {
	CareRules      game.CareRules     `json:"careRules"`
	SaveGeneration string             `json:"saveGeneration"`
	TileLink       []game.TilePoint   `json:"tileLink,omitempty"`
	TileHint       []game.TilePoint   `json:"tileHint,omitempty"`
	Shop           game.Shop          `json:"shop"`
	State          game.State         `json:"state"`
	Message        string             `json:"message"`
	ServerTime     int64              `json:"serverTime"`
	CareFeedback   *game.CareFeedback `json:"careFeedback,omitempty"`
	GameReceipt    *GameReceipt       `json:"gameReceipt,omitempty"`
	ReturnRecap    *ReturnRecap       `json:"returnRecap,omitempty"`
	RecapPending   bool               `json:"recapPending"`
	RecapClaimed   bool               `json:"recapClaimed,omitempty"`
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
	CREATE TABLE IF NOT EXISTS save_generation (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS saves (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, created_at INTEGER NOT NULL);
	CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY CHECK(id=1), last_seen INTEGER NOT NULL, baseline TEXT NOT NULL, recap TEXT NOT NULL, pending INTEGER NOT NULL);`); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db}
	initial, _ := json.Marshal(game.New(time.Now()))
	if _, err = db.Exec("INSERT OR IGNORE INTO saves(id,body) VALUES(1,?)", string(initial)); err != nil {
		db.Close()
		return nil, err
	}
	generation, err := newSaveGeneration()
	if err == nil {
		_, err = db.Exec("INSERT OR IGNORE INTO save_generation(id,token) VALUES(1,?)", generation)
	}
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Do(a *game.Action, imported *game.State, reset bool, now time.Time) (Result, error) {
	return s.DoForGeneration(a, imported, reset, now, "")
}
func (s *Store) do(a *game.Action, imported *game.State, reset bool, now time.Time, visit bool, readID, expectedGeneration string) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback()
	var generation string
	if err = tx.QueryRow("SELECT token FROM save_generation WHERE id=1").Scan(&generation); err != nil {
		return Result{}, err
	}
	metadata := Result{SaveGeneration: generation}
	if expectedGeneration != "" && expectedGeneration != generation {
		return metadata, ErrSaveChanged
	}
	var body string
	if err = tx.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&body); err != nil {
		return Result{}, err
	}
	var state game.State
	readErr := json.Unmarshal([]byte(body), &state)
	if readErr == nil {
		readErr = state.Validate(now)
		if readErr != nil && state.LastTick > now.UnixMilli() && state.Validate(time.UnixMilli(state.LastTick)) == nil {
			// This alternative validation is diagnostic only. It is never used
			// to accept an import or to advance the pet using a future clock.
			return metadata, ErrClockAhead
		}
	}
	// Cached actions must not bypass current-save clock/corruption checks.
	if readErr == nil && a != nil && a.RequestID != "" {
		var cached string
		err = tx.QueryRow("SELECT body FROM requests WHERE id=?", a.RequestID).Scan(&cached)
		if err == nil {
			var r Result
			if err = json.Unmarshal([]byte(cached), &r); err != nil {
				return r, err
			}
			r.SaveGeneration = generation
			r.State.Upgrade(now)
			r.Shop = game.ShopRules()
			r.CareRules = game.CareRuleBook()
			r.ServerTime = now.UnixMilli()
			r.ReturnRecap, r.RecapPending, r.RecapClaimed = nil, false, false
			return r, nil
		}
		if err != sql.ErrNoRows {
			return Result{}, err
		}
	}
	migrated := false
	if readErr == nil {
		migrated = state.Upgrade(now)
	}
	if readErr != nil {
		if imported == nil && !reset {
			return metadata, fmt.Errorf("%w，可从存档盒导入备份恢复：%v", ErrInvalidSave, readErr)
		}
		// Keep the damaged bytes as a snapshot, while allowing explicit recovery.
		revision := state.Revision
		if revision < 0 || revision > 1_000_000_000 {
			revision = 0
		}
		// Never run game/clock rules on unvalidated fields during recovery.
		// The original bytes are preserved separately in body for the snapshot.
		state = game.State{Revision: revision}
	}
	changed := migrated
	// A late pulse handles its own expiry, returning a persisted pause instead
	// of an error that would roll back the transaction.
	if a == nil || a.Kind != "snake-step" {
		changed = state.ExpireSnake(now) || changed
	}
	if a == nil || !strings.HasPrefix(a.Kind, "tetris-") {
		changed = state.ExpireTetris(now) || changed
	}
	if a == nil || !strings.HasPrefix(a.Kind, "walk-") {
		changed = state.ExpireWalking(now) || changed
	}
	if a == nil || !strings.HasPrefix(a.Kind, "fish-") {
		changed = state.ExpireFishing(now) || changed
	}
	if migrated {
		if _, err = tx.Exec("INSERT INTO snapshots(body,created_at) VALUES(?,?)", body, now.UnixMilli()); err != nil {
			return Result{}, err
		}
		if _, err = tx.Exec("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 10)"); err != nil {
			return Result{}, err
		}
	}
	if now.UnixMilli()-state.LastTick >= 60000 || a != nil || visit {
		changed = state.Advance(now) || changed
	}
	settledSnapshot := returnSnapshot(state)
	message := ""
	var feedback *game.CareFeedback
	var tileLink []game.TilePoint
	var tileHint []game.TilePoint
	var walkReceipt *WalkGameReceipt
	var walkBeforeCoins int
	var walkFinishing bool
	if a != nil && a.Kind == "walk-finish" && state.Game != nil && state.Game.Kind == "walk" && state.Game.Walking != nil {
		walkFinishing = true
		walkReceipt = &WalkGameReceipt{Cleared: state.Game.Walking.Cleared, Total: 12, RouteCoins: 3, PerformanceCoins: state.Game.Walking.Cleared / 4}
		if state.Economy != nil {
			walkBeforeCoins = state.Economy.Coins
		}
	}
	if a != nil {
		tileLink = state.TileLink(*a)
		tileHint = state.TileHint(*a)
		message, feedback, err = state.ApplyWithFeedback(*a, now)
		if err != nil {
			if errors.Is(err, game.ErrGameFinished) {
				return metadata, err
			}
			return Result{}, err
		}
		changed = true
		if walkFinishing && state.Game == nil && walkReceipt != nil && state.Economy != nil {
			walkReceipt.AwardedCoins = max(0, state.Economy.Coins-walkBeforeCoins)
		}
	}
	if imported != nil || reset {
		if imported != nil {
			if err = imported.Validate(now); err != nil {
				return Result{}, err
			}
		}
		if _, err = tx.Exec("INSERT INTO snapshots(body,created_at) VALUES(?,?)", body, now.UnixMilli()); err != nil {
			return Result{}, err
		}
		rev := state.Revision
		if reset {
			state = game.New(now)
			message = "一颗新的蛋，新的相遇。"
		} else {
			state = *imported
			if imported.Growth != nil {
				growth := *imported.Growth
				if growth.FormRecord != nil {
					record := *growth.FormRecord
					growth.FormRecord = &record
				}
				state.Growth = &growth
			}
			if imported.Album != nil {
				album := *imported.Album
				album.Entries = append([]game.Memory{}, imported.Album.Entries...)
				state.Album = &album
			}
			if imported.Economy != nil {
				economy := *imported.Economy
				economy.Owned = append([]string{}, imported.Economy.Owned...)
				state.Economy = &economy
			}
			if imported.Park != nil {
				park := *imported.Park
				park.Finds = append([]game.FishDiscovery{}, imported.Park.Finds...)
				state.Park = &park
			}
			if imported.Pond != nil {
				pond := *imported.Pond
				pond.Fish = append([]game.FishDiscovery{}, imported.Pond.Fish...)
				state.Pond = &pond
			}
			if imported.Companion != nil {
				companion := *imported.Companion
				companion.Interests = append([]game.Interest{}, imported.Companion.Interests...)
				if companion.Recent != nil {
					recent := *companion.Recent
					companion.Recent = &recent
				}
				state.Companion = &companion
			}
			state.Logs = append([]game.Log{}, imported.Logs...)
			// A restored sleeping flag is not continuity with this live sleep.
			// Keep sleeping, but do not attach a wake receipt to imported history.
			state.SleepSession = nil
			state.Game = nil
			state.Upgrade(now)
			state.Advance(now)
			message = "备份已恢复，欢迎回来。"
		}
		state.Revision = rev
		generation, err = newSaveGeneration()
		if err != nil {
			return Result{}, err
		}
		if _, err = tx.Exec("UPDATE save_generation SET token=? WHERE id=1", generation); err != nil {
			return Result{}, err
		}
		changed = true
		if _, err = tx.Exec("DELETE FROM requests"); err != nil {
			return Result{}, err
		}
		if _, err = tx.Exec("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 10)"); err != nil {
			return Result{}, err
		}
	}
	if changed {
		state.Revision++
		encoded, e := json.Marshal(state)
		if e != nil {
			return Result{}, e
		}
		if _, err = tx.Exec("UPDATE saves SET body=? WHERE id=1", string(encoded)); err != nil {
			return Result{}, err
		}
	}
	var recap *ReturnRecap
	var pending, claimed bool
	if imported != nil || reset {
		if _, err = tx.Exec("DELETE FROM visits"); err != nil {
			return Result{}, err
		}
	} else {
		recap, pending, claimed, err = updateVisit(tx, settledSnapshot, state, visit || a != nil, readID, now)
		if err != nil {
			return Result{}, err
		}
	}
	var receipt *GameReceipt
	if walkReceipt != nil {
		receipt = &GameReceipt{Walk: walkReceipt}
	}
	result := Result{CareRules: game.CareRuleBook(), SaveGeneration: generation, TileLink: tileLink, TileHint: tileHint, Shop: game.ShopRules(), State: state, Message: message, ServerTime: now.UnixMilli(), CareFeedback: feedback, GameReceipt: receipt, ReturnRecap: recap, RecapPending: pending, RecapClaimed: claimed}
	if a != nil && a.RequestID != "" {
		encoded, _ := json.Marshal(result)
		if _, err = tx.Exec("INSERT INTO requests(id,body) VALUES(?,?)", a.RequestID, string(encoded)); err != nil {
			return Result{}, err
		}
		if _, err = tx.Exec("DELETE FROM requests WHERE rowid NOT IN (SELECT rowid FROM requests ORDER BY rowid DESC LIMIT 128)"); err != nil {
			return Result{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Result{}, err
	}
	return result, nil
}
