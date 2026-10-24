package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// These are explicitly imported legacy boundary fixtures, not evidence of a
// natural multi-day journey. The transport and SQLite are real and isolated.
func TestHTTPCareMilestoneSurvivesIdempotentReplayNotStateReads(t *testing.T) {
	for _, age := range []time.Duration{23*time.Hour + 54*time.Minute, 71*time.Hour + 54*time.Minute} {
		for _, kind := range []string{"feed", "clean"} {
			t.Run(fmt.Sprintf("%s/%s", age, kind), func(t *testing.T) {
				j, initial := boundaryHTTP(t, age)
				action := game.Action{Kind: kind, RequestID: "milestone-action"}
				r := j.resultRequest("POST", "/api/action", action, initial.SaveGeneration, "")
				f := r.CareFeedback
				if f == nil || f.Milestone == nil || f.Effect == nil || f.Reason != "credited" || f.Points <= 0 || f.Points > .25 || (age > 24*time.Hour && f.Points >= .25) || f.HabitGain != 1 || f.GrowthComplete {
					t.Fatalf("missing action receipt: %+v", f)
				}
				want := game.CareMilestone{Stage: r.State.Growth.Stage, At: j.clock.Load()}
				if age > 24*time.Hour {
					want.Form = r.State.Growth.Form
				}
				if !reflect.DeepEqual(*f.Milestone, want) || f.Effect.At != want.At || (want.Stage == "adult" && want.Form == "") {
					t.Fatalf("wrong stage receipt: %+v, want %+v", f.Milestone, want)
				}
				// The request cache preserves the original timestamp and result even after
				// passive settlement and process restart, without crediting the care twice.
				for i := 0; i < 3; i++ {
					if i == 1 {
						j.clock.Store(j.start.Add(time.Hour).UnixMilli())
					}
					if i == 2 {
						path := j.path
						j.close()
						j.open(path)
					}
					current := j.resultRequest("GET", "/api/state", nil, "", "")
					if current.CareFeedback != nil || current.State.CareCount != 1 {
						t.Fatal("state read invented/repeated care")
					}
					replay := j.resultRequest("POST", "/api/action", action, initial.SaveGeneration, "")
					if !reflect.DeepEqual(replay.CareFeedback, f) || replay.State.CareCount != 1 {
						t.Fatal("replay changed original care receipt/count")
					}
				}
				backup := j.request("GET", "/api/backup", nil, "", "", http.StatusOK)
				if bytes.Contains(backup, []byte(`"milestone"`)) || bytes.Contains(backup, []byte(`"careFeedback"`)) {
					t.Fatal("response metadata leaked into portable save")
				}
				var state game.State
				if err := json.Unmarshal(backup, &state); err != nil {
					t.Fatal(err)
				}
				restored := j.resultRequest("POST", "/api/import", state, initial.SaveGeneration, "")
				if restored.CareFeedback != nil || restored.SaveGeneration == initial.SaveGeneration || restored.State.Growth.Stage != want.Stage {
					t.Fatal("restore reconstructed a care receipt")
				}
			})
		}
	}
}

func TestHTTPCareMilestoneDoesNotClaimPassiveGrowthOrAdultHabits(t *testing.T) {
	for _, age := range []time.Duration{23*time.Hour + 54*time.Minute, 71*time.Hour + 54*time.Minute, 72 * time.Hour} {
		for _, kind := range []string{"feed", "clean"} {
			t.Run(fmt.Sprintf("%s/%s", age, kind), func(t *testing.T) {
				j, r := boundaryHTTP(t, age)
				stage := r.State.Growth.Stage
				j.clock.Store(j.start.Add(time.Hour).UnixMilli())
				r = j.resultRequest("POST", "/api/visit", struct{}{}, r.SaveGeneration, "")
				if age < 72*time.Hour && r.State.Growth.Stage == stage {
					t.Fatal("passive boundary fixture did not cross")
				}
				if r.CareFeedback != nil {
					t.Fatal("visit invented care")
				}
				before := r.State.Growth
				r = j.resultRequest("POST", "/api/action", game.Action{Kind: kind, RequestID: "after-passive"}, r.SaveGeneration, "")
				if r.CareFeedback == nil || r.CareFeedback.Reason != "credited" || r.CareFeedback.HabitGain != 1 || r.CareFeedback.Milestone != nil {
					t.Fatalf("care claimed passive milestone: %+v", r.CareFeedback)
				}
				if r.State.Growth.Stage != before.Stage || r.State.Growth.AdultAt != before.AdultAt || r.State.Growth.Form != before.Form || !reflect.DeepEqual(r.State.Growth.FormRecord, before.FormRecord) {
					t.Fatal("care rewrote an existing milestone")
				}
				if before.Stage == "adult" && (r.CareFeedback.Points != 0 || !r.CareFeedback.GrowthComplete) {
					t.Fatal("adult habit changed growth or omitted its explanation")
				}
			})
		}
	}
}
