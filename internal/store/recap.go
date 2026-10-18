package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Presence is separate from the portable pet save: restoring a backup must not
// resurrect a consumed notification or invent a visit in this installation.
const returnAfter = 15 * time.Minute

type ReturnSnapshot struct {
	Needs        game.Needs `json:"needs"`
	Stage        string     `json:"stage"`
	Form         string     `json:"form"`
	Points       float64    `json:"points"`
	Rest         float64    `json:"rest"`
	TrackedHours float64    `json:"trackedHours"`
}
type ReturnRecap struct {
	ID     string         `json:"id"`
	From   int64          `json:"from"`
	To     int64          `json:"to"`
	Before ReturnSnapshot `json:"before"`
	After  ReturnSnapshot `json:"after"`
}

func returnSnapshot(s game.State) ReturnSnapshot {
	r := ReturnSnapshot{Needs: s.Needs}
	if s.Growth != nil {
		r.Stage, r.Form, r.Points = s.Growth.Stage, s.Growth.Form, s.Growth.Points
		r.Rest, r.TrackedHours = s.Growth.Care.Rest, s.Growth.TrackedHours
	}
	return r
}

// Visit is a foreground heartbeat. Ordinary GET state/backup calls settle time
// but do not count as the player returning. Actions also count as presence.
func (s *Store) Visit(now time.Time) (Result, error) {
	return s.do(nil, nil, false, now, true, "", "")
}
func (s *Store) ReadRecap(id string, now time.Time) (Result, error) {
	return s.ReadRecapForGeneration(id, now, "")
}

// updateVisit compares the last active snapshot to the already-settled state
// BEFORE an action, then remembers the state AFTER the action. Thus a return
// followed immediately by a meal cannot misreport that meal as offline growth.
func updateVisit(tx *sql.Tx, settled ReturnSnapshot, current game.State, active bool, readID string, now time.Time) (*ReturnRecap, bool, bool, error) {
	var lastSeen int64
	var baseline, body string
	var pending bool
	err := tx.QueryRow("SELECT last_seen, baseline, recap, pending FROM visits WHERE id=1").Scan(&lastSeen, &baseline, &body, &pending)
	if err != nil && err != sql.ErrNoRows {
		return nil, false, false, err
	}
	exists := err == nil
	var recap *ReturnRecap
	if body != "" {
		recap = &ReturnRecap{}
		if err = json.Unmarshal([]byte(body), recap); err != nil {
			return nil, false, false, err
		}
	}
	if active && exists && now.UnixMilli()-lastSeen >= returnAfter.Milliseconds() && current.HatchedAt > 0 {
		var before ReturnSnapshot
		if err = json.Unmarshal([]byte(baseline), &before); err != nil {
			return nil, false, false, err
		}
		if before.Stage != "egg" {
			var nonce [16]byte
			if _, err = rand.Read(nonce[:]); err != nil {
				return nil, false, false, err
			}
			recap = &ReturnRecap{ID: hex.EncodeToString(nonce[:]), From: lastSeen, To: now.UnixMilli(), Before: before, After: settled}
			pending = true
		}
	}
	// Claim at presentation time, once globally, not on every poll or page load.
	// Server-side guards also protect against another tab starting sleep/a game.
	claimed := recap != nil && pending && recap.ID == readID && !current.Sleeping && current.Game == nil
	if claimed {
		pending = false
	}
	if active && (!exists || now.UnixMilli() >= lastSeen) {
		encoded, err := json.Marshal(returnSnapshot(current))
		if err != nil {
			return nil, false, false, err
		}
		recapBody := ""
		if recap != nil {
			b, err := json.Marshal(recap)
			if err != nil {
				return nil, false, false, err
			}
			recapBody = string(b)
		}
		if _, err = tx.Exec(`INSERT INTO visits(id,last_seen,baseline,recap,pending) VALUES(1,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,baseline=excluded.baseline,recap=excluded.recap,pending=excluded.pending`, now.UnixMilli(), string(encoded), recapBody, pending); err != nil {
			return nil, false, false, err
		}
	}
	return recap, pending, claimed, nil
}
