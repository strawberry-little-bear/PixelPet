package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

var ErrSnapshotMissing = errors.New("恢复点已不存在，请重新打开存档盒查看")
var ErrSnapshotUnavailable = errors.New("这份恢复点暂不能用于恢复，原始内容仍保留在本地")

const snapshotSizeLimit = 64 * 1024

type SnapshotPet struct {
	Name     string `json:"name"`
	Species  int    `json:"species"`
	Stage    string `json:"stage"`
	LastTick int64  `json:"lastTick"`
}
type Snapshot struct {
	// Keep SQLite identifiers exact in JavaScript, including long-lived databases.
	ID        string       `json:"id"`
	CreatedAt int64        `json:"createdAt"`
	Status    string       `json:"status"`
	Pet       *SnapshotPet `json:"pet,omitempty"`
}

func snapshotInfo(id int64, at int64, body string, now time.Time) Snapshot {
	info := Snapshot{ID: strconv.FormatInt(id, 10), CreatedAt: at, Status: "unreadable"}
	if len(body) > snapshotSizeLimit {
		info.Status = "too-large"
		return info
	}
	var state game.State
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&state) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return info
	}
	if state.Validate(now) != nil {
		if state.LastTick > now.UnixMilli() && state.Validate(time.UnixMilli(state.LastTick)) == nil {
			info.Status = "clock-ahead"
		}
		return info
	}
	stage := "unknown"
	if state.HatchedAt == 0 {
		stage = "egg"
	} else if state.Growth != nil {
		stage = state.Growth.Stage
	}
	info.Status = "available"
	info.Pet = &SnapshotPet{Name: state.Name, Species: state.Species, Stage: stage, LastTick: state.LastTick}
	return info
}

// Recovery browsing must work even when the current save is damaged. It never
// calls Do, upgrades a snapshot, advances time, claims a recap or writes a row.
func (s *Store) Snapshots(now time.Time) ([]Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query("SELECT id,created_at,body FROM snapshots ORDER BY id DESC LIMIT 10")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]Snapshot, 0, 10)
	for rows.Next() {
		var id, at int64
		var body string
		if err := rows.Scan(&id, &at, &body); err != nil {
			return nil, err
		}
		list = append(list, snapshotInfo(id, at, body, now))
	}
	return list, rows.Err()
}

// Return the selected immutable bytes, never "the latest" after a list race.
// Confirmation uses the ordinary generation-protected import, which validates
// again and preserves the current save before replacing it.
func (s *Store) SnapshotBody(id int64, now time.Time) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var body string
	var at int64
	if err := s.db.QueryRow("SELECT created_at,body FROM snapshots WHERE id=?", id).Scan(&at, &body); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrSnapshotMissing
		}
		return nil, err
	}
	if snapshotInfo(id, at, body, now).Status != "available" {
		return nil, ErrSnapshotUnavailable
	}
	return json.RawMessage(body), nil
}
