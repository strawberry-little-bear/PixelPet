package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Empty and nil histories are valid old-save states. Reading/reopening must not
// invent an event merely to fill the diary UI; only actual actions append logs.
func TestEmptyJournalSurvivesReadsAndReopenUntilActualCare(t *testing.T) {
	for _, name := range []string{"empty-array", "nil-history"} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "journal.db")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if s != nil {
					s.Close()
				}
			}()
			now := time.Now().Truncate(time.Millisecond)
			born := now.Add(-time.Hour)
			seed := game.New(born)
			if _, err = seed.Apply(game.Action{Kind: "hatch", Species: 2}, born); err != nil {
				t.Fatal(err)
			}
			seed.LastTick = now.UnixMilli()
			seed.Needs.Hunger = 60
			seed.Logs = []game.Log{}
			if name == "nil-history" {
				seed.Logs = nil
			}
			if err = seed.Validate(now); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(seed)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				r, err := s.Do(nil, nil, false, now)
				if err != nil || len(r.State.Logs) != 0 || r.State.Growth.Stage != "baby" || r.State.CareCount != 0 {
					t.Fatal("read invented history or changed care", err, r.State)
				}
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			s, err = Open(path)
			if err != nil {
				t.Fatal(err)
			}
			r, err := s.Visit(now.Add(time.Minute))
			if err != nil || len(r.State.Logs) != 0 || r.State.CareCount != 0 {
				t.Fatal("visit/restart invented diary", err, r.State)
			}
			action := &game.Action{Kind: "feed", RequestID: "first-real-care"}
			for i := 0; i < 2; i++ {
				r, err = s.Do(action, nil, false, now.Add(time.Minute))
				if err != nil || len(r.State.Logs) != 1 || r.State.CareCount != 1 || r.State.Growth.Care.Nutrition != 1 {
					t.Fatal("real care missing or duplicated", err, r.State)
				}
			}
		})
	}
}
