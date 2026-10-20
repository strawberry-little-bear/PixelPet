package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Controlled server times reproduce the exact millisecond boundary that a
// natural browser action cannot reliably target. Every read uses real SQLite;
// reopening before the action proves residues and outcomes survive persistence.
func TestPersistedCareBoundaryAndReplay(t *testing.T) {
	start := time.Date(2026, 10, 20, 2, 0, 0, 0, time.UTC)
	end := start.Add(30 * time.Minute)
	for _, kind := range []string{"feed", "clean"} {
		for _, full := range []bool{false, true} {
			for _, frequent := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/full=%t/frequent=%t", kind, full, frequent), func(t *testing.T) {
					path := filepath.Join(t.TempDir(), "boundary.db")
					s, err := Open(path)
					if err != nil {
						t.Fatal(err)
					}
					defer func() {
						if s != nil {
							s.Close()
						}
					}()
					initial := game.New(start.Add(-time.Hour))
					if _, err = initial.Apply(game.Action{Kind: "hatch", Species: 2}, start.Add(-time.Hour)); err != nil {
						t.Fatal(err)
					}
					initial.LastTick = start.UnixMilli()
					initial.Needs = game.Needs{Hunger: 80, Mood: 80, Clean: 80, Energy: 80}
					if kind == "feed" {
						initial.Needs.Hunger = 71.5
						if full {
							initial.Needs.Hunger = 97.5
						}
					} else {
						initial.Needs.Clean = 66
						if full {
							initial.Needs.Clean = 100
						}
					}
					if err = initial.Validate(start); err != nil {
						t.Fatal(err)
					}
					body, err := json.Marshal(initial)
					if err != nil {
						t.Fatal(err)
					}
					if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
						t.Fatal(err)
					}
					if frequent {
						for at := start.Add(15 * time.Second); at.Before(end); at = at.Add(15 * time.Second) {
							if _, err = s.Do(nil, nil, false, at); err != nil {
								t.Fatal(err)
							}
						}
					}
					before, err := s.Do(nil, nil, false, end)
					if err != nil {
						t.Fatal(err)
					}
					if err = s.Close(); err != nil {
						t.Fatal(err)
					}
					s, err = Open(path)
					if err != nil {
						t.Fatal(err)
					}
					a := &game.Action{Kind: kind, RequestID: "care-once"}
					r, actionErr := s.Do(a, nil, false, end)
					if full {
						if actionErr == nil {
							t.Fatal("full care accepted after persisted reads")
						}
					} else {
						if actionErr != nil || r.CareFeedback == nil || r.CareFeedback.Reason != "credited" || r.CareFeedback.HabitGain != 1 {
							t.Fatalf("habit lost: %+v %v", r.CareFeedback, actionErr)
						}
						if r.CareRules.NeedTolerance != 1e-9 {
							t.Fatal("comparison capability absent")
						}
						again, err := s.Do(a, nil, false, end)
						if err != nil {
							t.Fatal(err)
						}
						if again.CareFeedback == nil || again.CareFeedback.HabitGain != 1 || again.State.CareCount != r.State.CareCount || again.State.Growth.Points != r.State.Growth.Points {
							t.Fatal("request replay repeated or lost care")
						}
					}
					after, err := s.Do(nil, nil, false, end)
					if err != nil {
						t.Fatal(err)
					}
					if full {
						if after.State.Revision != before.State.Revision || after.State.CareCount != before.State.CareCount || after.State.Needs != before.State.Needs {
							t.Fatal("rejected care changed persisted state")
						}
					} else if after.State.CareCount != before.State.CareCount+1 {
						t.Fatal("care did not persist exactly once")
					}
					if err = after.State.Validate(end); err != nil {
						t.Fatal(err)
					}
					saved, err := json.Marshal(after.State)
					if err != nil {
						t.Fatal(err)
					}
					var fields map[string]any
					if err := json.Unmarshal(saved, &fields); err != nil {
						t.Fatal(err)
					}
					if _, ok := fields["needTolerance"]; ok {
						t.Fatal("response-only tolerance leaked into save")
					}
				})
			}
		}
	}
}
