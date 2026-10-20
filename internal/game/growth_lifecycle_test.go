package game

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"reflect"
	"testing"
	"time"
)

// These are accelerated model journeys, not a claim of natural multi-day play.
// Start with the real egg and issue ordinary care/game actions: never inject
// points, habits, needs, a terminal board, or a preselected adult form.
func TestGrowthLifecycleWithIrregularReadsAndReloads(t *testing.T) {
	profiles := []struct {
		name, form string
		plays      map[int]bool
		cared      bool
	}{
		{"restful", "gentle", nil, true},
		{"balanced", "balanced", map[int]bool{10: true, 18: true}, true},
		{"playful", "lively", map[int]bool{8: true, 10: true, 14: true, 18: true, 20: true}, true},
		{"no-care", "easygoing", nil, false},
	}
	for species := range Species {
		adultAges := make(map[string]int64)
		for _, profile := range profiles {
			t.Run(Species[species]+"/"+profile.name, func(t *testing.T) {
				born := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
				pair := lifecyclePair{t: t, sparse: New(born), polled: New(born), rng: rand.New(rand.NewPCG(uint64(species+1), 41))}
				if pair.sparse.Growth.Stage != "egg" || pair.polled.Growth.Stage != "egg" {
					t.Fatal("journey did not start at egg")
				}
				pair.action(born, Action{Kind: "hatch", Species: species})
				pair.compare()
				seen := map[string]bool{"baby": true}
				var locked [2]*FormRecord
				var adultAt [2]int64
				for hour := 1; hour <= 180; hour++ {
					now := born.Add(time.Duration(hour) * time.Hour)
					pair.advance(now)
					seen[pair.sparse.Growth.Stage] = true
					if profile.cared {
						clockHour := hour % 24
						if (clockHour == 6 && pair.sparse.Sleeping) || (clockHour == 22 && !pair.sparse.Sleeping) {
							pair.action(now, Action{Kind: "sleep"})
						}
						if !pair.sparse.Sleeping {
							if careNeed(pair.sparse.Needs.Hunger, 70) <= 70 {
								pair.action(now, Action{Kind: "feed"})
							}
							if careNeed(pair.sparse.Needs.Clean, 65) <= 65 {
								pair.action(now, Action{Kind: "clean"})
							}
							if profile.plays[clockHour] {
								pair.action(now, Action{Kind: "play"})
								for beat := 1; beat <= 5; beat++ {
									pair.action(now.Add(time.Duration(beat)*900*time.Millisecond), Action{Kind: "catch", Lane: beat % 3})
								}
							}
						}
					}
					pair.compare()
					seen[pair.sparse.Growth.Stage] = true
					for i, state := range []*State{&pair.sparse, &pair.polled} {
						if state.Growth.Stage != "adult" {
							continue
						}
						if state.Growth.Form != profile.form {
							t.Fatalf("at hour %d: wanted %s, got %+v", hour, profile.form, *state.Growth)
						}
						if state.Growth.FormRecord == nil {
							t.Fatal("adult has no frozen evidence")
						}
						if locked[i] == nil {
							snapshot := *state.Growth.FormRecord
							locked[i] = &snapshot
							adultAt[i] = state.Growth.AdultAt
						}
						if !reflect.DeepEqual(state.Growth.FormRecord, locked[i]) || state.Growth.AdultAt != adultAt[i] {
							t.Fatal("later care/read changed adult evidence")
						}
					}
					// A real JSON save/load boundary, without touching SQLite or player files.
					if hour%24 == 0 {
						pair.reload()
					}
				}
				for _, stage := range []string{"baby", "growing", "adult"} {
					if !seen[stage] {
						t.Fatalf("never reached %s", stage)
					}
				}
				for _, state := range []*State{&pair.sparse, &pair.polled} {
					for kind, at := range map[string]int64{"hatch": state.HatchedAt, "growing": state.Growth.GrowingAt, "adult": state.Growth.AdultAt} {
						count := 0
						for _, memory := range state.Album.Entries {
							if memory.Kind != kind {
								continue
							}
							count++
							if memory.At != at || memory.Source != "shared" || (kind == "adult" && memory.Form != profile.form) {
								t.Fatalf("incorrect %s memory: %+v", kind, memory)
							}
						}
						if count != 1 {
							t.Fatalf("wanted exactly one %s memory, got %d", kind, count)
						}
					}
				}
				adultAges[profile.name] = adultAt[0] - born.UnixMilli()
				t.Logf("adult after %.3fh; %s; %d ordinary actions; %d extra reads", float64(adultAt[0]-born.UnixMilli())/3600000, profile.form, pair.actions, pair.reads)
			})
		}
		if len(adultAges) == len(profiles) {
			for _, profile := range profiles {
				if profile.cared && adultAges[profile.name] >= adultAges["no-care"] {
					t.Errorf("%s/%s: care did not improve growth speed", Species[species], profile.name)
				}
			}
		}
	}
}

type lifecyclePair struct {
	t              *testing.T
	sparse, polled State
	rng            *rand.Rand
	actions, reads int
}

func (p *lifecyclePair) advance(now time.Time) {
	p.t.Helper()
	// All sparse gaps are <=1h, below the per-settlement 12h cap. A longer
	// single absence is deliberately NOT equivalent to unbounded polling.
	if gap := now.UnixMilli() - p.sparse.LastTick; gap > int64(time.Hour/time.Millisecond) {
		p.t.Fatalf("unexpected gap %d", gap)
	}
	for {
		next := p.polled.LastTick + int64(1+p.rng.IntN(17*60*1000))
		if next >= now.UnixMilli() {
			break
		}
		p.polled.Advance(time.UnixMilli(next))
		p.reads++
	}
	p.polled.Advance(now)
	p.sparse.Advance(now)
}

func (p *lifecyclePair) action(now time.Time, a Action) {
	p.t.Helper()
	p.advance(now)
	var feedback [2]*CareFeedback
	for i, s := range []*State{&p.sparse, &p.polled} {
		command := a
		if a.Kind == "catch" {
			command.GameID = s.Game.ID
		}
		_, f, err := s.ApplyWithFeedback(command, now)
		if err != nil {
			p.t.Fatalf("%s at %s (%d): %v", a.Kind, now, i, err)
		}
		feedback[i] = f
	}
	p.actions++
	if a.Kind == "catch" {
		for _, state := range []*State{&p.sparse, &p.polled} {
			if state.Game == nil && (state.Companion.Recent == nil || state.Companion.Recent.At != now.UnixMilli()) {
				p.t.Fatal("completed game did not record experience")
			}
		}
	}
	if (feedback[0] == nil) != (feedback[1] == nil) {
		p.t.Fatal("polling changed feedback availability")
	}
	if f, g := feedback[0], feedback[1]; f != nil {
		if f.Kind != g.Kind || f.Reason != g.Reason || f.Habit != g.Habit || f.RetryAt != g.RetryAt || !reflect.DeepEqual(f.Milestone, g.Milestone) {
			p.t.Fatalf("polling changed care outcome: %+v / %+v", f, g)
		}
		p.close("action growth", f.Points, g.Points)
		p.close("action habit", f.HabitGain, g.HabitGain)
		if f.Effect == nil || g.Effect == nil || f.Effect.At != g.Effect.At {
			p.t.Fatal("missing/mismatched action effect")
		}
		p.needs(f.Effect.Before, g.Effect.Before)
		p.needs(f.Effect.After, g.Effect.After)
		if (f.SleepSummary == nil) != (g.SleepSummary == nil) {
			p.t.Fatal("polling lost sleep history")
		}
		if f.SleepSummary != nil {
			p.sleep(f.SleepSummary.SleepSession, g.SleepSummary.SleepSession)
			if f.SleepSummary.WokeAt != g.SleepSummary.WokeAt {
				p.t.Fatal("different wake time")
			}
		}
	}
}

func (p *lifecyclePair) close(label string, a, b float64) {
	p.t.Helper()
	if math.IsNaN(a) || math.IsNaN(b) || math.IsInf(a, 0) || math.IsInf(b, 0) || math.Abs(a-b) > 1e-8 {
		p.t.Fatalf("%s changed with polling: %.16g / %.16g", label, a, b)
	}
}

func (p *lifecyclePair) needs(a, b Needs) {
	p.t.Helper()
	for i, pair := range [][2]float64{{a.Hunger, b.Hunger}, {a.Mood, b.Mood}, {a.Clean, b.Clean}, {a.Energy, b.Energy}} {
		p.close([]string{"hunger", "mood", "clean", "energy"}[i], pair[0], pair[1])
	}
}

func (p *lifecyclePair) sleep(a, b SleepSession) {
	p.t.Helper()
	if a.StartedAt != b.StartedAt {
		p.t.Fatal("different bedtime")
	}
	p.close("settled sleep", a.SettledHours, b.SettledHours)
	p.close("sleep energy", a.EnergyRecovered, b.EnergyRecovered)
	p.close("sleep rest", a.RestGain, b.RestGain)
	p.close("sleep growth", a.GrowthPoints, b.GrowthPoints)
}

func (p *lifecyclePair) compare() {
	p.t.Helper()
	for _, s := range []*State{&p.sparse, &p.polled} {
		if err := s.Validate(time.UnixMilli(s.LastTick)); err != nil {
			p.t.Fatal(err)
		}
	}
	a, b := p.sparse, p.polled
	if a.CareCount != b.CareCount || a.Sleeping != b.Sleeping || a.LastTick != b.LastTick || a.Game != nil || b.Game != nil {
		p.t.Fatal("different lifecycle or unfinished game")
	}
	p.needs(a.Needs, b.Needs)
	g, h := a.Growth, b.Growth
	if g.Stage != h.Stage || g.Form != h.Form {
		p.t.Fatalf("different stages/forms: %+v / %+v", g, h)
	}
	for _, pair := range [][2]int64{{g.GrowingAt, h.GrowingAt}, {g.AdultAt, h.AdultAt}} {
		if math.Abs(float64(pair[0]-pair[1])) > 1 {
			p.t.Fatalf("different milestone dates: %v", pair)
		}
	}
	for i, pair := range [][2]float64{{g.Points, h.Points}, {g.TrackedHours, h.TrackedHours}, {g.Wellbeing, h.Wellbeing}, {g.Care.Nutrition, h.Care.Nutrition}, {g.Care.Play, h.Care.Play}, {g.Care.Clean, h.Care.Clean}, {g.Care.Rest, h.Care.Rest}} {
		p.close([]string{"points", "history hours", "wellbeing", "nutrition", "play", "clean habit", "rest"}[i], pair[0], pair[1])
	}
	if g.Care.LastFeed != h.Care.LastFeed || g.Care.LastPlay != h.Care.LastPlay || g.Care.LastClean != h.Care.LastClean {
		p.t.Fatal("polling changed care cooldown")
	}
	if (g.FormRecord == nil) != (h.FormRecord == nil) {
		p.t.Fatal("missing adult evidence")
	}
	if r, s := g.FormRecord, h.FormRecord; r != nil {
		for i, pair := range [][2]float64{{r.TrackedHours, s.TrackedHours}, {r.Wellbeing, s.Wellbeing}, {r.Nutrition, s.Nutrition}, {r.Play, s.Play}, {r.Clean, s.Clean}, {r.Rest, s.Rest}} {
			p.close([]string{"frozen hours", "frozen wellbeing", "frozen nutrition", "frozen play", "frozen clean", "frozen rest"}[i], pair[0], pair[1])
		}
	}
	if (a.SleepSession == nil) != (b.SleepSession == nil) {
		p.t.Fatal("missing active sleep")
	}
	if a.SleepSession != nil {
		p.sleep(*a.SleepSession, *b.SleepSession)
	}
	if !reflect.DeepEqual(a.Economy, b.Economy) {
		p.t.Fatal("polling changed rewards")
	}
	if a.Companion.Since != b.Companion.Since || !reflect.DeepEqual(a.Companion.Interests, b.Companion.Interests) || (a.Companion.Recent == nil) != (b.Companion.Recent == nil) {
		p.t.Fatal("polling changed shared play")
	}
	// Each run legitimately creates its own random session ID. Validate each
	// state above; compare experience kind/time, not independent random IDs.
	if x, y := a.Companion.Recent, b.Companion.Recent; x != nil && (x.Kind != y.Kind || x.At != y.At) {
		p.t.Fatal("polling changed recent game")
	}
	// Logs can legitimately differ by 1ms at an integrated threshold, but must
	// retain the same story/count/order. Neither reads nor reloads add care.
	if len(a.Logs) != len(b.Logs) {
		p.t.Fatal("polling added/removed diary entries")
	}
	for i, l := range a.Logs {
		if l.Text != b.Logs[i].Text || math.Abs(float64(l.At-b.Logs[i].At)) > 1 {
			p.t.Fatalf("different diary entry %d: %+v / %+v", i, l, b.Logs[i])
		}
	}
}

func (p *lifecyclePair) reload() {
	p.t.Helper()
	for _, s := range []*State{&p.sparse, &p.polled} {
		raw, err := json.Marshal(s)
		if err != nil {
			p.t.Fatal(err)
		}
		var next State
		if err = json.Unmarshal(raw, &next); err != nil {
			p.t.Fatal(err)
		}
		if !reflect.DeepEqual(*s, next) {
			p.t.Fatal("JSON reload altered snapshot")
		}
		*s = next
	}
	p.compare()
}
