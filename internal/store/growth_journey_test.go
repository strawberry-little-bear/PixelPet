package store

import (
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Unlike threshold fixtures, these journeys never assign needs, growth points,
// habits, stage, form, or milestone dates. Only the clock and real commands drive
// a newly hatched pet. Simulated time is not a real multi-day soak test.
type growthJourney struct {
	t          *testing.T
	s          *Store
	path       string
	start, now time.Time
	result     Result
	sequence   int
	growingAt  int64
	adultAt    int64
	form       string
	record     *game.FormRecord
}

func (j *growthJourney) accept(r Result, err error) {
	j.t.Helper()
	if err != nil {
		j.t.Fatalf("hour %.4f: %v", j.now.Sub(j.start).Hours(), err)
	}
	p, old := r.State, j.result.State
	if err = p.Validate(j.now); err != nil {
		j.t.Fatalf("hour %.4f: persisted invalid state: %v", j.now.Sub(j.start).Hours(), err)
	}
	if p.Species != old.Species || p.HatchedAt != old.HatchedAt || p.Name != old.Name || p.CareCount < old.CareCount {
		j.t.Fatal("journey changed identity or lost care")
	}
	g := p.Growth
	if g.Points+1e-8 < old.Growth.Points || g.TrackedHours+1e-8 < old.Growth.TrackedHours || g.Wellbeing+1e-8 < old.Growth.Wellbeing {
		j.t.Fatal("growth moved backwards")
	}
	for _, pair := range [][2]float64{{g.Care.Nutrition, old.Growth.Care.Nutrition}, {g.Care.Clean, old.Growth.Care.Clean}, {g.Care.Play, old.Growth.Care.Play}, {g.Care.Rest, old.Growth.Care.Rest}} {
		if pair[0]+1e-8 < pair[1] {
			j.t.Fatal("persisted care history moved backwards")
		}
	}
	if j.growingAt != 0 && g.GrowingAt != j.growingAt {
		j.t.Fatal("growing date was rewritten")
	}
	if g.GrowingAt != 0 {
		j.growingAt = g.GrowingAt
	}
	if j.adultAt != 0 && (g.AdultAt != j.adultAt || g.Form != j.form || !reflect.DeepEqual(g.FormRecord, j.record)) {
		j.t.Fatal("adult date, form or threshold evidence was rewritten")
	}
	if g.Stage == "adult" {
		if g.FormRecord == nil || g.Points != game.AdultPoints || g.AdultAt < g.GrowingAt {
			j.t.Fatal("adult journey lacks its actual threshold evidence")
		}
		if j.adultAt == 0 {
			// The only discarded interval before adulthood is 36h of the
			// opening 48h absence. A threshold record must describe the actual
			// threshold, not the end of a later visit.
			trackedAtThreshold := float64(g.AdultAt-p.HatchedAt)/3600000 - 36
			if math.Abs(g.FormRecord.TrackedHours-trackedAtThreshold) > 1e-6 || g.AdultAt < old.LastTick || g.AdultAt > p.LastTick {
				j.t.Fatal("adult evidence belongs to a different instant")
			}
			j.adultAt, j.form = g.AdultAt, g.Form
			copy := *g.FormRecord
			j.record = &copy
		}
	}
	j.result = r
}

func (j *growthJourney) visit(at time.Time) {
	j.t.Helper()
	j.now = at
	before := j.result.State.CareCount
	r, err := j.s.Visit(at)
	j.accept(r, err)
	if r.State.CareCount != before || r.CareFeedback != nil {
		j.t.Fatal("return/read invented an explicit care action")
	}
}

func (j *growthJourney) action(kind string, lane int) game.Action {
	j.t.Helper()
	j.sequence++
	a := game.Action{Kind: kind, Lane: lane, RequestID: fmt.Sprintf("journey-%d", j.sequence)}
	if j.result.State.Game != nil {
		a.GameID = j.result.State.Game.ID
	}
	r, err := j.s.DoForGeneration(&a, nil, false, j.now, j.result.SaveGeneration)
	j.accept(r, err)
	return a
}

func (j *growthJourney) play() {
	j.t.Helper()
	j.action("play", 0)
	for beat := int64(0); beat < 5; beat++ {
		j.now = time.UnixMilli(j.result.State.Game.StartedAt + beat*900)
		j.action("catch", int(beat%3))
	}
	if j.result.State.Game != nil || j.result.CareFeedback == nil || j.result.CareFeedback.Habit != "play" {
		j.t.Fatal("real game did not finish with a care receipt")
	}
}

func (j *growthJourney) care(policy string, hour int) {
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
		j.play()
	}
	if j.result.State.Needs.Energy <= 45 {
		j.action("sleep", 0)
	}
}

func (j *growthJourney) restart() {
	j.t.Helper()
	before := j.result.State
	generation := j.result.SaveGeneration
	if err := j.s.Close(); err != nil {
		j.t.Fatal(err)
	}
	var err error
	j.s, err = Open(j.path)
	if err != nil {
		j.t.Fatal(err)
	}
	r, err := j.s.Do(nil, nil, false, j.now)
	j.accept(r, err)
	if !reflect.DeepEqual(before, r.State) || generation != r.SaveGeneration {
		j.t.Fatal("restart changed saved growth, needs, history or installation identity")
	}
}

func (j *growthJourney) restore() {
	j.t.Helper()
	// Marshal/unmarshal as an actual portable JSON, then restore to a separate
	// installation. No SQL fixtures or direct changes to the player's database.
	encoded, err := json.Marshal(j.result.State)
	if err != nil {
		j.t.Fatal(err)
	}
	var backup game.State
	if err = json.Unmarshal(encoded, &backup); err != nil {
		j.t.Fatal(err)
	}
	targetPath := filepath.Join(j.t.TempDir(), "restored.db")
	target, err := Open(targetPath)
	if err != nil {
		j.t.Fatal(err)
	}
	defer func() {
		if target != nil {
			target.Close()
		}
	}()
	r, err := target.Do(nil, &backup, false, j.now)
	if err != nil {
		j.t.Fatal(err)
	}
	expected := backup
	expected.Revision = r.State.Revision // revisions belong to the destination
	if !reflect.DeepEqual(expected, r.State) || r.SaveGeneration == j.result.SaveGeneration {
		j.t.Fatal("portable restore lost actual growth/history or reused the installation identity")
	}
	if err = target.Close(); err != nil {
		j.t.Fatal(err)
	}
	target, err = Open(targetPath)
	if err != nil {
		j.t.Fatal(err)
	}
	read, err := target.Do(nil, nil, false, j.now)
	if err != nil || !reflect.DeepEqual(r.State, read.State) || r.SaveGeneration != read.SaveGeneration {
		j.t.Fatalf("restored installation changed after reopening: %v", err)
	}
	// Continue the SAME journey in the restored installation. Equality alone
	// would not prove a restored baby/growing pet can subsequently evolve.
	if err = j.s.Close(); err != nil {
		j.t.Fatal(err)
	}
	j.s, j.path = target, targetPath
	target = nil // ownership moves to the journey's cleanup
	j.accept(read, nil)
}

func runGrowthJourney(t *testing.T, species int, policy string) time.Duration {
	t.Helper()
	path := filepath.Join(t.TempDir(), "journey.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	j := &growthJourney{t: t, s: s, path: path, start: time.Now().Add(time.Hour).Truncate(time.Millisecond)}
	t.Cleanup(func() {
		if j.s != nil {
			j.s.Close()
		}
	})
	j.now = j.start
	j.result, err = s.Do(&game.Action{Kind: "hatch", Species: species, RequestID: "hatch"}, nil, false, j.now)
	if err != nil || j.result.State.Species != species || j.result.State.Name != game.Species[species] || j.result.State.Growth.Stage != "baby" || j.result.State.Growth.Points != 0 {
		t.Fatalf("new hatch failed: %v", err)
	}
	j.visit(j.start.Add(48 * time.Hour))
	p := j.result.State
	// Independent literal oracle for the existing awake 12h cap, not an Advance
	// call copied from the implementation. Elapsed days still use all 48h.
	if p.Needs != (game.Needs{Hunger: 44, Mood: 50, Clean: 66, Energy: 61}) || p.CareCount != 0 || p.Growth.TrackedHours != 12 || math.Abs(p.Growth.Points-12.255) > 1e-8 {
		t.Fatalf("48h absence did not settle exactly 12h: %+v / %+v", p.Needs, p.Growth)
	}
	if j.result.ReturnRecap == nil || j.result.ReturnRecap.To-j.result.ReturnRecap.From != (48*time.Hour).Milliseconds() {
		t.Fatal("real absence interval was confused with the settlement cap")
	}
	j.restore() // baby: continue real care from the imported JSON
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
	if j.growingAt == 0 || j.adultAt == 0 || !growingRestored {
		t.Fatal("real operations never completed all three growth stages")
	}
	wantForm := map[string]string{"unattended": "easygoing", "quiet": "gentle", "playful": "lively", "balanced": "balanced"}[policy]
	if j.form != wantForm {
		t.Fatalf("policy %s naturally chose %s, want %s; threshold %+v", policy, j.form, wantForm, j.record)
	}
	counts := map[string]int{}
	for _, m := range j.result.State.Album.Entries {
		counts[fmt.Sprintf("%s/%d", m.Kind, m.Days)]++
	}
	for _, key := range []string{"hatch/0", "growing/0", "adult/0", "days/1", "days/7"} {
		if counts[key] != 1 {
			t.Fatalf("missing or duplicated natural milestone %s: %v", key, counts)
		}
	}
	j.restore()
	// Change care after adulthood using actual feeding, games and long sleep.
	if j.result.State.Sleeping {
		j.action("sleep", 0)
	}
	if j.result.State.Needs.Hunger >= 96 {
		j.visit(j.now.Add(2 * time.Hour))
	}
	a := j.action("feed", 0)
	before := j.result.State
	for i := 0; i < 2; i++ {
		if _, err := j.s.Do(&a, nil, false, j.now); err != nil {
			t.Fatal(err)
		}
	}
	r, err := j.s.Do(nil, nil, false, j.now)
	j.accept(r, err)
	if !reflect.DeepEqual(before, r.State) {
		t.Fatal("replaying a meal repeated care or changed grown state")
	}
	careBefore := j.result.State.Growth.Care
	if j.result.State.Needs.Energy >= 10 {
		j.play()
	}
	j.action("sleep", 0)
	j.visit(j.now.Add(48 * time.Hour))
	if reflect.DeepEqual(careBefore, j.result.State.Growth.Care) {
		t.Fatal("adult care did not remain active")
	}
	j.restart()
	j.restore()
	adultAfter := time.Duration(j.adultAt-j.start.UnixMilli()) * time.Millisecond
	t.Logf("simulated growing after %v; adult after %v (%s); final tracked %.3fh / care %d", time.Duration(j.growingAt-j.start.UnixMilli())*time.Millisecond, adultAfter, j.form, j.result.State.Growth.TrackedHours, j.result.State.CareCount)
	return adultAfter
}

func TestGrowthJourneysFromHatchThroughCareAbsenceAndRestore(t *testing.T) {
	for species, name := range game.Species {
		t.Run(name, func(t *testing.T) {
			adultAfter := map[string]time.Duration{}
			for _, policy := range []string{"unattended", "quiet", "playful", "balanced"} {
				t.Run(policy, func(t *testing.T) { adultAfter[policy] = runGrowthJourney(t, species, policy) })
			}
			for _, policy := range []string{"quiet", "playful", "balanced"} {
				if adultAfter[policy] <= 0 || adultAfter[policy] >= adultAfter["unattended"] {
					t.Errorf("care did not accelerate growth: %s=%v, unattended=%v", policy, adultAfter[policy], adultAfter["unattended"])
				}
			}
		})
	}
}
