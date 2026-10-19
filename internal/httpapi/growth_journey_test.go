package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

// A controlled SERVER clock, not a client timestamp or a production endpoint.
// All state is created by HTTP commands; no SQL, threshold or history fixtures.
type httpGrowthJourney struct {
	t                  *testing.T
	clock              atomic.Int64
	start              time.Time
	path               string
	db                 *store.Store
	server             *httptest.Server
	result             store.Result
	sequence           int
	requests           int
	growingAt, adultAt int64
	adultForm          string
	adultRecord        *game.FormRecord
}

func (j *httpGrowthJourney) open(path string) {
	j.t.Helper()
	var err error
	j.db, err = store.Open(path)
	if err != nil {
		j.t.Fatal(err)
	}
	j.path = path
	j.server = httptest.NewServer(handlerWithClock(j.db, j.t.TempDir(), func() time.Time {
		return time.UnixMilli(j.clock.Load())
	}))
}

func (j *httpGrowthJourney) close() {
	if j.server != nil {
		j.server.Client().CloseIdleConnections()
		j.server.Close()
		j.server = nil
	}
	if j.db != nil {
		if err := j.db.Close(); err != nil {
			j.t.Error(err)
		}
		j.db = nil
	}
}

func (j *httpGrowthJourney) request(method, path string, body any, generation, sleepIf string, status int) []byte {
	j.t.Helper()
	j.requests++
	var input []byte
	var err error
	if body != nil {
		input, err = json.Marshal(body)
		if err != nil {
			j.t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, j.server.URL+path, bytes.NewReader(input))
	if err != nil {
		j.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", j.server.URL)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("X-PixelPet-Generation", generation)
	req.Header.Set("X-PixelPet-Sleep-If", sleepIf)
	res, err := j.server.Client().Do(req)
	if err != nil {
		j.t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		j.t.Fatal(err)
	}
	if res.StatusCode != status {
		j.t.Fatalf("%s %s at hour %.4f: status %d, want %d: %s", method, path, float64(j.clock.Load()-j.start.UnixMilli())/3600000, res.StatusCode, status, data)
	}
	if status == http.StatusOK && res.Header.Get("Cache-Control") != "no-store" {
		j.t.Fatal("state/backup lost no-store header")
	}
	if path == "/api/backup" && res.Header.Get("Content-Disposition") != `attachment; filename="pixelpet-backup.json"` {
		j.t.Fatal("backup is not an attachment")
	}
	return data
}

func (j *httpGrowthJourney) resultRequest(method, path string, body any, generation, sleepIf string) store.Result {
	j.t.Helper()
	var r store.Result
	if err := json.Unmarshal(j.request(method, path, body, generation, sleepIf, http.StatusOK), &r); err != nil {
		j.t.Fatal(err)
	}
	if r.ServerTime != j.clock.Load() || len(r.SaveGeneration) != 32 {
		j.t.Fatal("response did not use authoritative clock/generation")
	}
	if err := r.State.Validate(time.UnixMilli(j.clock.Load())); err != nil {
		j.t.Fatalf("invalid HTTP state: %v", err)
	}
	return r
}

func (j *httpGrowthJourney) accept(r store.Result) {
	j.t.Helper()
	p, old := r.State, j.result.State
	if old.HatchedAt != 0 {
		if p.HatchedAt != old.HatchedAt || p.Species != old.Species || p.Name != old.Name || p.CareCount < old.CareCount {
			j.t.Fatal("identity/care changed across HTTP journey")
		}
		g, previous := p.Growth, old.Growth
		for _, pair := range [][2]float64{{g.Points, previous.Points}, {g.TrackedHours, previous.TrackedHours}, {g.Wellbeing, previous.Wellbeing}, {g.Care.Nutrition, previous.Care.Nutrition}, {g.Care.Play, previous.Care.Play}, {g.Care.Clean, previous.Care.Clean}, {g.Care.Rest, previous.Care.Rest}} {
			if pair[0]+1e-8 < pair[1] {
				j.t.Fatal("growth/history moved backwards")
			}
		}
		if j.growingAt != 0 && g.GrowingAt != j.growingAt {
			j.t.Fatal("growing date changed")
		}
		if g.GrowingAt != 0 {
			j.growingAt = g.GrowingAt
		}
		if j.adultAt != 0 && (g.AdultAt != j.adultAt || g.Form != j.adultForm || !reflect.DeepEqual(g.FormRecord, j.adultRecord)) {
			j.t.Fatal("adult threshold evidence changed")
		}
		if g.Stage == "adult" && j.adultAt == 0 {
			// Only the opening 48h absence discarded time (36h). The record must
			// describe the threshold instant, not the next hourly HTTP request.
			tracked := float64(g.AdultAt-p.HatchedAt)/3600000 - 36
			if g.FormRecord == nil || g.Points != game.AdultPoints || g.AdultAt < g.GrowingAt || g.AdultAt < old.LastTick || g.AdultAt > p.LastTick || math.Abs(g.FormRecord.TrackedHours-tracked) > 1e-6 {
				j.t.Fatal("invalid natural adult threshold evidence")
			}
			j.adultAt, j.adultForm = g.AdultAt, g.Form
			record := *g.FormRecord
			j.adultRecord = &record
		}
	}
	j.result = r
}

func (j *httpGrowthJourney) call(method, path string, body any) {
	j.t.Helper()
	j.accept(j.resultRequest(method, path, body, j.result.SaveGeneration, ""))
}

func (j *httpGrowthJourney) visit(at time.Time) {
	j.t.Helper()
	if at.UnixMilli() < j.clock.Load() {
		j.t.Fatal("journey clock moved backwards")
	}
	j.clock.Store(at.UnixMilli())
	count := j.result.State.CareCount
	j.call("POST", "/api/visit", struct{}{})
	if j.result.State.CareCount != count || j.result.CareFeedback != nil {
		j.t.Fatal("visit invented active care")
	}
	if j.result.RecapPending {
		id := j.result.ReturnRecap.ID
		canClaim := !j.result.State.Sleeping && j.result.State.Game == nil
		before := j.result.State
		j.call("POST", "/api/recap/read", map[string]string{"id": id})
		if j.result.RecapClaimed != canClaim || j.result.RecapPending == canClaim || !reflect.DeepEqual(before, j.result.State) {
			j.t.Fatal("recap claim changed pet or ignored sleeping/game guard")
		}
		j.call("POST", "/api/recap/read", map[string]string{"id": id})
		if j.result.RecapClaimed {
			j.t.Fatal("recap claimed twice")
		}
	}
}

func (j *httpGrowthJourney) action(kind string, lane int) {
	j.t.Helper()
	j.sequence++
	a := game.Action{Kind: kind, Lane: lane, RequestID: fmt.Sprintf("http-growth-%d", j.sequence)}
	if j.result.State.Game != nil {
		a.GameID = j.result.State.Game.ID
	}
	sleepIf := ""
	if kind == "sleep" {
		sleepIf = "awake"
		if j.result.State.Sleeping {
			sleepIf = "sleeping"
		}
		wrong := map[string]string{"awake": "sleeping", "sleeping": "awake"}[sleepIf]
		var failure map[string]string
		if err := json.Unmarshal(j.request("POST", "/api/action", a, j.result.SaveGeneration, wrong, http.StatusConflict), &failure); err != nil || failure["code"] != "sleep_changed" {
			j.t.Fatal("stale sleep intention not rejected")
		}
		before := j.result.State
		j.call("GET", "/api/state", nil)
		if !reflect.DeepEqual(before, j.result.State) {
			j.t.Fatal("rejected sleep changed saved state")
		}
	}
	j.accept(j.resultRequest("POST", "/api/action", a, j.result.SaveGeneration, sleepIf))
	if kind == "feed" || kind == "sleep" {
		before := j.result
		j.accept(j.resultRequest("POST", "/api/action", a, j.result.SaveGeneration, sleepIf))
		if !reflect.DeepEqual(before.State, j.result.State) || !reflect.DeepEqual(before.CareFeedback, j.result.CareFeedback) {
			j.t.Fatal("retry repeated meal or reversed sleep intention")
		}
	}
}

func (j *httpGrowthJourney) care(policy string, hour int) {
	j.t.Helper()
	if j.result.State.Sleeping {
		if j.result.State.Needs.Energy < 99 {
			return
		}
		j.action("sleep", 0)
	}
	if j.result.State.Needs.Hunger <= 70 {
		j.action("feed", 0)
	}
	if j.result.State.Needs.Clean <= 65 {
		j.action("clean", 0)
	}
	g := j.result.State.Growth
	play := policy == "playful" && hour%2 == 0 || policy == "balanced" && g.Care.Play < (g.Care.Clean+g.Care.Rest)/2
	if play && j.result.State.Needs.Energy >= 10 {
		j.action("play", 0)
		for beat := int64(0); beat < 5; beat++ {
			j.clock.Store(j.result.State.Game.StartedAt + beat*900)
			j.action("catch", int(beat%3))
		}
		if j.result.State.Game != nil || j.result.CareFeedback == nil || j.result.CareFeedback.Habit != "play" {
			j.t.Fatal("real five-action game did not finish with play receipt")
		}
	}
	if j.result.State.Needs.Energy <= 45 {
		j.action("sleep", 0)
	}
}

func (j *httpGrowthJourney) restart() {
	j.t.Helper()
	before := j.result
	path := j.path
	j.close()
	j.open(path)
	j.call("GET", "/api/state", nil)
	if !reflect.DeepEqual(before.State, j.result.State) || before.SaveGeneration != j.result.SaveGeneration {
		j.t.Fatal("restart changed persisted pet or generation")
	}
}

func (j *httpGrowthJourney) restore() {
	j.t.Helper()
	backup := j.request("GET", "/api/backup", nil, "", "", http.StatusOK)
	var expected game.State
	if err := json.Unmarshal(backup, &expected); err != nil {
		j.t.Fatal(err)
	}
	if !reflect.DeepEqual(expected, j.result.State) {
		j.t.Fatal("HTTP backup changed pet/history")
	}
	sourceGeneration := j.result.SaveGeneration
	j.close()
	j.open(filepath.Join(j.t.TempDir(), "restored.db"))
	target := j.resultRequest("GET", "/api/state", nil, "", "")
	var failure map[string]string
	if err := json.Unmarshal(j.request("POST", "/api/import", json.RawMessage(backup), sourceGeneration, "", http.StatusConflict), &failure); err != nil || failure["code"] != "save_changed" {
		j.t.Fatal("source installation could overwrite destination generation")
	}
	unchanged := j.resultRequest("GET", "/api/state", nil, "", "")
	if !reflect.DeepEqual(target.State, unchanged.State) || target.SaveGeneration != unchanged.SaveGeneration {
		j.t.Fatal("rejected import changed destination")
	}
	restored := j.resultRequest("POST", "/api/import", json.RawMessage(backup), target.SaveGeneration, "")
	expected.Revision = restored.State.Revision
	expected.SleepSession = nil // restored totals are not proof of a live sleep
	if !reflect.DeepEqual(expected, restored.State) || restored.SaveGeneration == sourceGeneration || restored.SaveGeneration == target.SaveGeneration {
		j.t.Fatal("backup restore changed history or failed to rotate generation")
	}
	j.accept(restored)
	j.restart()
	// Imports clear installation-local presence. Establish a new baseline so the
	// next absence measures this same pet from the restored state.
	j.visit(time.UnixMilli(j.clock.Load()))
}

func TestHTTPGrowthJourneyFromEggThroughAdult(t *testing.T) {
	adultAfter := map[string]time.Duration{}
	for _, policy := range []string{"unattended", "quiet", "playful", "balanced"} {
		t.Run(policy, func(t *testing.T) {
			j := &httpGrowthJourney{t: t, start: time.Now().Add(time.Hour).Truncate(time.Millisecond)}
			j.clock.Store(j.start.UnixMilli())
			j.open(filepath.Join(t.TempDir(), "journey.db"))
			t.Cleanup(j.close)
			j.call("GET", "/api/state", nil)
			j.call("POST", "/api/reset", map[string]bool{"confirm": true})
			if j.result.State.LastTick != j.clock.Load() || j.result.State.Growth.Stage != "egg" {
				t.Fatal("reset did not use server clock")
			}
			j.sequence++
			j.call("POST", "/api/action", game.Action{Kind: "hatch", Species: 0, RequestID: fmt.Sprintf("http-growth-%d", j.sequence)})
			if j.result.State.Growth.Stage != "baby" || j.result.State.Growth.Points != 0 || j.result.State.HatchedAt != j.clock.Load() {
				t.Fatal("not a freshly hatched baby")
			}
			j.visit(j.start.Add(48 * time.Hour))
			p := j.result.State
			if p.Needs != (game.Needs{Hunger: 44, Mood: 50, Clean: 66, Energy: 61}) || p.CareCount != 0 || p.Growth.TrackedHours != 12 || math.Abs(p.Growth.Points-12.255) > 1e-8 {
				t.Fatal("48h absence did not settle exactly 12h")
			}
			if j.result.ReturnRecap == nil || j.result.ReturnRecap.To-j.result.ReturnRecap.From != (48*time.Hour).Milliseconds() {
				t.Fatal("recap confused elapsed time with settlement cap")
			}
			j.restore() // continue this same baby, never a threshold fixture
			growingRestored := false
			for hour := 49; hour <= 216; hour++ {
				if policy == "unattended" && hour%12 != 0 {
					continue
				}
				j.visit(j.start.Add(time.Duration(hour) * time.Hour))
				if !growingRestored && j.result.State.Growth.Stage == "growing" {
					j.restore()
					growingRestored = true
				}
				if hour == 120 {
					j.restart()
				}
				if policy != "unattended" {
					j.care(policy, hour)
				}
			}
			want := map[string]string{"unattended": "easygoing", "quiet": "gentle", "playful": "lively", "balanced": "balanced"}[policy]
			if !growingRestored || j.growingAt == 0 || j.adultAt == 0 || j.adultForm != want {
				t.Fatalf("policy failed natural three-stage journey: %+v", j.result.State.Growth)
			}
			counts := map[string]int{}
			for _, m := range j.result.State.Album.Entries {
				counts[fmt.Sprintf("%s/%d", m.Kind, m.Days)]++
			}
			for _, key := range []string{"hatch/0", "growing/0", "adult/0", "days/1", "days/7"} {
				if counts[key] != 1 {
					t.Fatalf("missing/duplicate actual milestone %s: %v", key, counts)
				}
			}
			j.restore()
			if j.result.State.Sleeping {
				j.action("sleep", 0)
			}
			careBefore := j.result.State.Growth.Care
			j.action("sleep", 0)
			trackedBefore := j.result.State.Growth.TrackedHours
			j.visit(time.UnixMilli(j.clock.Load()).Add(48 * time.Hour))
			if j.result.State.Growth.TrackedHours-trackedBefore != 12 || j.result.State.Needs.Energy != 100 || j.result.State.Growth.Care.Rest <= careBefore.Rest {
				t.Fatal("adult sleep did not retain cap and effective rest")
			}
			j.visit(time.UnixMilli(j.clock.Load()).Add(time.Hour))
			restAtFull := j.result.State.Growth.Care.Rest
			j.visit(time.UnixMilli(j.clock.Load()).Add(time.Hour))
			if j.result.State.Growth.Care.Rest != restAtFull {
				t.Fatal("full energy sleep invented effective rest")
			}
			j.restart()
			j.restore()
			adultAfter[policy] = time.Duration(j.adultAt-j.start.UnixMilli()) * time.Millisecond
			t.Logf("simulated growing %v; adult %v; form %s; real HTTP requests %d", time.Duration(j.growingAt-j.start.UnixMilli())*time.Millisecond, adultAfter[policy], j.adultForm, j.requests)
		})
	}
	for _, policy := range []string{"quiet", "playful", "balanced"} {
		if duration, selected := adultAfter[policy]; selected && adultAfter["unattended"] > 0 && (duration <= 0 || duration >= adultAfter["unattended"]) {
			t.Errorf("care did not accelerate HTTP journey: %s %v vs %v", policy, adultAfter[policy], adultAfter["unattended"])
		}
	}
}
