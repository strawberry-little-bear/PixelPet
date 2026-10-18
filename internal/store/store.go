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
	State      game.State `json:"state"`
	Message    string     `json:"message"`
	ServerTime int64      `json:"serverTime"`
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
	CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, body TEXT NOT NULL);`); err != nil {
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
	if err = json.Unmarshal([]byte(body), &state); err != nil {
		return Result{}, fmt.Errorf("读取存档失败：%w", err)
	}
	if err = state.Validate(now); err != nil {
		return Result{}, fmt.Errorf("现有存档校验失败：%w", err)
	}
	changed := false
	if now.UnixMilli()-state.LastTick >= 60000 || a != nil {
		changed = state.Advance(now)
	}
	message := ""
	if a != nil {
		message, err = state.Apply(*a, now)
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
			state.Game = nil
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
	result := Result{state, message, now.UnixMilli()}
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
