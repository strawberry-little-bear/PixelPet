package store

import (
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// A foreground absence is not necessarily one Advance call: state/backup reads
// settle time without updating presence. The recap must retain their total,
// rather than clamp it again or imply that the whole absence is capped at 12h.
func TestReturnSettlementAccumulatesPassiveReads(t *testing.T) {
	for _, sleeping := range []bool{false, true} {
		for _, tc := range []struct {
			name  string
			polls []int
			back  int
			hours float64
		}{
			{"single-capped-read", nil, 24, 12},
			{"three-uncapped-segments", []int{8, 16}, 24, 24},
			{"mixed-capped-segments", []int{8}, 48, 20},
		} {
			t.Run(tc.name+map[bool]string{false: "/awake", true: "/sleeping"}[sleeping], func(t *testing.T) {
				s, now := recapStore(t)
				before, err := s.Do(nil, nil, false, now)
				if err != nil {
					t.Fatal(err)
				}
				if sleeping {
					before, err = s.Do(&game.Action{Kind: "sleep"}, nil, false, now)
				}
				if err != nil {
					t.Fatal(err)
				}
				for _, hour := range tc.polls {
					poll, err := s.Do(nil, nil, false, now.Add(time.Duration(hour)*time.Hour))
					if err != nil || poll.ReturnRecap != nil {
						t.Fatal("passive read invented a return", err)
					}
				}
				at := now.Add(time.Duration(tc.back) * time.Hour)
				r, err := s.Visit(at)
				if err != nil || r.ReturnRecap == nil || !r.RecapPending {
					t.Fatal("missing return", err)
				}
				recap := r.ReturnRecap
				if recap.From != now.UnixMilli() || recap.To != at.UnixMilli() {
					t.Fatal("passive read moved absence period")
				}
				closeTo(t, recap.After.TrackedHours-recap.Before.TrackedHours, tc.hours)
				closeTo(t, recap.After.Needs.Hunger, math.Max(0, before.State.Needs.Hunger-3*tc.hours))
				closeTo(t, recap.After.Needs.Clean, math.Max(0, before.State.Needs.Clean-2*tc.hours))
				energy, rest := math.Max(0, before.State.Needs.Energy-2*tc.hours), 0.0
				if sleeping {
					energy = math.Min(100, before.State.Needs.Energy+14*tc.hours)
					rest = (energy - before.State.Needs.Energy) / 28
				}
				closeTo(t, recap.After.Needs.Energy, energy)
				closeTo(t, recap.After.Rest-recap.Before.Rest, rest)
				if r.State.CareCount != before.State.CareCount || r.State.Economy.Coins != before.State.Economy.Coins {
					t.Fatal("return awarded extra care or coins")
				}
				if recap.Before.Sleeping == nil || *recap.Before.Sleeping != sleeping || recap.After.Sleeping == nil || *recap.After.Sleeping != sleeping {
					t.Fatal("lost historical sleep context")
				}
				var seq int
				var name, path string
				if err := s.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
					t.Fatal(err)
				}
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
				reopened, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				defer reopened.Close()
				loaded, err := reopened.Do(nil, nil, false, at)
				if err != nil || !reflect.DeepEqual(loaded.ReturnRecap, recap) || !loaded.RecapPending {
					t.Fatal("restart rewrote cumulative history", err)
				}
			})
		}
	}
}
