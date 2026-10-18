package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
	mu sync.Mutex
}
type Result struct {
	Shop         game.Shop          `json:"shop"`
	State        game.State         `json:"state"`
	Message      string             `json:"message"`
	ServerTime   int64              `json:"serverTime"`
	CareFeedback *game.CareFeedback `json:"careFeedback,omitempty"`
	ReturnRecap  *ReturnRecap       `json:"returnRecap,omitempty"`
	RecapPending bool               `json:"recapPending"`
	RecapClaimed bool               `json:"recapClaimed,omitempty"`
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
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Do(a *game.Action, imported *game.State, reset bool, now time.Time) (Result, error) {
	return s.do(a, imported, reset, now, false, "")
}
func (s *Store) do(a *game.Action, imported *game.State, reset bool, now time.Time, visit bool, readID string) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback()
	if a != nil && a.RequestID != "" {
		var cached string
		err = tx.QueryRow("SELECT body FROM requests WHERE id=?", a.RequestID).Scan(&cached)
		if err == nil {
			var r Result
			if err = json.Unmarshal([]byte(cached), &r); err != nil {
				return r, err
			}
			r.State.Upgrade(now)
			r.Shop = game.ShopRules()
			r.ServerTime = now.UnixMilli()
			r.ReturnRecap, r.RecapPending, r.RecapClaimed = nil, false, false
			return r, nil
		}
		if err != sql.ErrNoRows {
			return Result{}, err
		}
	}
	var body string
	if err = tx.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&body); err != nil {
		return Result{}, err
	}
	var state game.State
	readErr := json.Unmarshal([]byte(body), &state)
	if readErr == nil {
		readErr = state.Validate(now)
	}
	migrated := false
	if readErr == nil {
		migrated = state.Upgrade(now)
	}
	if readErr != nil {
		if imported == nil && !reset {
			return Result{}, fmt.Errorf("现有存档校验失败，可从存档盒导入备份恢复：%w", readErr)
		}
		// Keep the damaged bytes as a snapshot, while allowing explicit recovery.
		if state.Revision < 0 || state.Revision > 1_000_000_000 {
			state.Revision = 0
		}
	}
	changed := migrated
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
	if a != nil {
		message, feedback, err = state.ApplyWithFeedback(*a, now)
		if err != nil {
			return Result{}, err
		}
		changed = true
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
			state.Logs = append([]game.Log{}, imported.Logs...)
			state.Game = nil
			state.Upgrade(now)
			state.Advance(now)
			message = "备份已恢复，欢迎回来。"
		}
		state.Revision = rev
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
	result := Result{Shop: game.ShopRules(), State: state, Message: message, ServerTime: now.UnixMilli(), CareFeedback: feedback, ReturnRecap: recap, RecapPending: pending, RecapClaimed: claimed}
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
