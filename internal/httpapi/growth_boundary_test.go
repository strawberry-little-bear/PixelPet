package httpapi

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

// Reuse the real HTTP/temp-SQLite transport, not its natural-journey accept
// assertions: these tests explicitly import legal legacy boundary fixtures.
func boundaryHTTP(t *testing.T, age time.Duration) (*httpGrowthJourney, store.Result) {
	t.Helper()
	j := &httpGrowthJourney{t: t, start: time.Now().Add(time.Hour).Truncate(time.Millisecond)}
	j.clock.Store(j.start.UnixMilli())
	j.open(filepath.Join(t.TempDir(), "boundary.db"))
	t.Cleanup(j.close)
	initial := j.resultRequest("GET", "/api/state", nil, "", "")
	born := j.start.Add(-age).UnixMilli()
	legacy := game.State{Schema: 1, Species: 2, Name: game.Species[2], CreatedAt: born,
		HatchedAt: born, LastTick: born, Needs: game.Needs{}, Logs: []game.Log{}}
	r := j.resultRequest("POST", "/api/import", legacy, initial.SaveGeneration, "")
	if r.State.Schema != game.Schema || r.State.Growth.Points != age.Hours() || r.State.Growth.TrackedHours != 0 {
		t.Fatalf("HTTP legacy migration changed starting history: %+v", r.State.Growth)
	}
	return j, r
}

func assertBoundaryPersistence(t *testing.T, j *httpGrowthJourney, r store.Result) {
	t.Helper()
	backup := j.request("GET", "/api/backup", nil, "", "", http.StatusOK)
	var saved game.State
	if err := json.Unmarshal(backup, &saved); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(saved, r.State) {
		t.Fatal("backup changed boundary evidence")
	}
	path := j.path
	j.close()
	j.open(path)
	loaded := j.resultRequest("GET", "/api/state", nil, "", "")
	if !reflect.DeepEqual(loaded.State, r.State) || loaded.SaveGeneration != r.SaveGeneration {
		t.Fatal("restart changed boundary evidence/generation")
	}
	restored := j.resultRequest("POST", "/api/import", json.RawMessage(backup), loaded.SaveGeneration, "")
	saved.Revision = restored.State.Revision
	if !reflect.DeepEqual(saved, restored.State) || restored.SaveGeneration == loaded.SaveGeneration {
		t.Fatal("restore changed boundary evidence or did not rotate generation")
	}
	// Repeated reads at this millisecond must neither evolve again nor duplicate
	// the milestone receipt, including after importing a frozen historical form.
	again := j.resultRequest("GET", "/api/state", nil, "", "")
	if !reflect.DeepEqual(again.State, restored.State) {
		t.Fatal("repeat read changed restored state")
	}
}

func TestHTTPExactGrowthBoundaryPersistsAcrossPartitions(t *testing.T) {
	for _, age := range []time.Duration{18 * time.Hour, 66 * time.Hour} {
		for _, parts := range []int{1, 10, 60} {
			t.Run(fmt.Sprintf("age=%dh/parts=%d", int(age.Hours()), parts), func(t *testing.T) {
				j, r := boundaryHTTP(t, age)
				for i := 1; i <= parts; i++ {
					j.clock.Store(j.start.Add(time.Duration(i) * 12 * time.Hour / time.Duration(parts)).UnixMilli())
					r = j.resultRequest("GET", "/api/state", nil, "", "")
				}
				g := r.State.Growth
				kind, at := "growing", g.GrowingAt
				if age == 18*time.Hour {
					if g.Stage != "growing" || math.Abs(g.Points-game.GrowingPoints) > 1e-9 {
						t.Fatalf("missed growing boundary: %+v", g)
					}
				} else {
					kind, at = "adult", g.AdultAt
					if g.Stage != "adult" || g.Points != game.AdultPoints || g.Form != "easygoing" || g.FormRecord == nil || g.FormRecord.TrackedHours != 12 {
						t.Fatalf("missed adult boundary/form history: %+v", g)
					}
				}
				if at != j.start.Add(12*time.Hour).UnixMilli() {
					t.Fatalf("wrong %s date: %d", kind, at)
				}
				count := 0
				for _, m := range r.State.Album.Entries {
					if m.Kind == kind {
						count++
						if m.At != at || m.Source != "shared" {
							t.Fatal("wrong threshold memory")
						}
					}
				}
				if count != 1 || r.State.CareCount != 0 || g.Care != (game.CareHistory{}) || r.State.Needs != (game.Needs{}) {
					t.Fatal("missing/duplicate milestone or invented care")
				}
				assertBoundaryPersistence(t, j, r)
			})
		}
	}
}

func TestHTTPGrowthBoundaryKeepsRealMillisecond(t *testing.T) {
	for _, age := range []time.Duration{18 * time.Hour, 66 * time.Hour} {
		t.Run(fmt.Sprintf("age=%dh", int(age.Hours())), func(t *testing.T) {
			j, r := boundaryHTTP(t, age)
			stage := r.State.Growth.Stage
			end := j.start.Add(12 * time.Hour)
			j.clock.Store(end.Add(-time.Millisecond).UnixMilli())
			r = j.resultRequest("GET", "/api/state", nil, "", "")
			if r.State.Growth.Stage != stage || r.State.Growth.TrackedHours >= 12 {
				t.Fatal("evolved/rounded history one millisecond early")
			}
			j.clock.Store(end.UnixMilli())
			// Normal state polling intentionally batches sub-minute ticks. An explicit
			// visit settles this final real millisecond without adding active care.
			r = j.resultRequest("POST", "/api/visit", struct{}{}, r.SaveGeneration, "")
			if r.State.Growth.Stage == stage || (age == 66*time.Hour && r.State.Growth.Form != "easygoing") {
				t.Fatalf("missed exact boundary: %+v", r.State.Growth)
			}
			assertBoundaryPersistence(t, j, r)
		})
	}
}

func TestHTTPPreFixGrowthBoundarySavesRemainCompatible(t *testing.T) {
	for _, kind := range []string{"adult", "feed", "clean"} {
		t.Run(kind, func(t *testing.T) {
			j, r := boundaryHTTP(t, 66*time.Hour)
			j.clock.Store(j.start.Add(12 * time.Hour).UnixMilli())
			s := r.State
			s.LastTick = j.clock.Load()
			s.Growth.Points = 71.99999999999994
			s.Growth.TrackedHours = 11.999999999999998
			if kind == "adult" {
				s.Growth.Stage = "adult"
				s.Growth.Points = game.AdultPoints
				s.Growth.TrackedHours = 12
				s.Growth.AdultAt = j.clock.Load()
				s.Growth.Form = "balanced"
				s.Growth.FormRecord = &game.FormRecord{TrackedHours: 11.999999999999986}
				s.Album.Entries = append(s.Album.Entries, game.Memory{Kind: "adult", At: j.clock.Load(), Source: "shared", Form: "balanced"})
			}
			r = j.resultRequest("POST", "/api/import", s, r.SaveGeneration, "")
			if kind == "adult" {
				if !reflect.DeepEqual(r.State.Growth, s.Growth) {
					t.Fatal("reinterpreted old frozen adult on import")
				}
			} else {
				r = j.resultRequest("POST", "/api/action", game.Action{Kind: kind, RequestID: "boundary-care-" + kind}, r.SaveGeneration, "")
				if r.CareFeedback == nil || r.CareFeedback.HabitGain != 1 || r.State.Growth.Form != "easygoing" || r.State.Growth.FormRecord == nil || r.State.Growth.FormRecord.TrackedHours != 12 {
					t.Fatalf("care froze a rounding artifact: %+v", r.State.Growth)
				}
			}
			assertBoundaryPersistence(t, j, r)
		})
	}
}
