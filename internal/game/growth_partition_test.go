package game

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"reflect"
	"sort"
	"testing"
	"time"
)

// These are valid persisted-state fixtures, not a claim of naturally raising a
// pet for five days. Only subsequent elapsed-time settlement uses the real rules.
func partitionFixture(t *testing.T, now time.Time, points float64, form string, needs Needs, sleeping bool) State {
	t.Helper()
	s := sleepPet(t, now.Add(-120*time.Hour), needs.Energy)
	s.LastTick = now.UnixMilli()
	s.Needs = needs
	g := s.Growth
	g.Points = points
	g.TrackedHours = 30
	g.Wellbeing = 25.5
	switch form {
	case "balanced":
		g.Care.Play, g.Care.Clean = 4, 8
	case "lively":
		g.Care.Play = 12
	case "gentle":
		g.Care.Clean = 8
	case "easygoing":
		g.Wellbeing = 3
	default:
		t.Fatalf("unknown fixture form %q", form)
	}
	s.evolve(now.Add(-time.Hour))
	s.rememberDays()
	if sleeping {
		sleepToggle(t, &s, now)
	}
	return partitionReload(t, s, now)
}

func partitionReload(t *testing.T, s State, now time.Time) State {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var loaded State
	if err := json.Unmarshal(raw, &loaded); err != nil {
		t.Fatal(err)
	}
	if err := loaded.Validate(now); err != nil {
		t.Fatalf("invalid persisted state at %s: %v\ngrowth=%+v session=%+v needs=%+v", now, err, loaded.Growth, loaded.SleepSession, loaded.Needs)
	}
	return loaded
}

func partitionClose(t *testing.T, field string, got, want float64) {
	t.Helper()
	if math.IsNaN(got) || math.IsInf(got, 0) || math.Abs(got-want) > 1e-8 {
		t.Fatalf("%s: got %.16g want %.16g (delta %.16g)", field, got, want, got-want)
	}
}

// Compare all persisted state, not only growth points. The sole timestamp
// allowance is one millisecond for threshold bisection/rounding; no tolerances
// apply to stage/form, history cardinality, care counters or economic state.
func assertPartitionState(t *testing.T, got, want State) {
	t.Helper()
	partitionClose(t, "hunger", got.Needs.Hunger, want.Needs.Hunger)
	partitionClose(t, "mood", got.Needs.Mood, want.Needs.Mood)
	partitionClose(t, "clean", got.Needs.Clean, want.Needs.Clean)
	partitionClose(t, "energy", got.Needs.Energy, want.Needs.Energy)
	compareGrowth := func(a, b Growth) {
		partitionClose(t, "points", a.Points, b.Points)
		partitionClose(t, "tracked hours", a.TrackedHours, b.TrackedHours)
		partitionClose(t, "wellbeing", a.Wellbeing, b.Wellbeing)
		partitionClose(t, "nutrition", a.Care.Nutrition, b.Care.Nutrition)
		partitionClose(t, "play", a.Care.Play, b.Care.Play)
		partitionClose(t, "care clean", a.Care.Clean, b.Care.Clean)
		partitionClose(t, "rest", a.Care.Rest, b.Care.Rest)
		for _, at := range [][2]int64{{a.GrowingAt, b.GrowingAt}, {a.AdultAt, b.AdultAt}} {
			if (at[0] == 0) != (at[1] == 0) || math.Abs(float64(at[0]-at[1])) > 1 {
				t.Fatalf("threshold timestamps differ: %v", at)
			}
		}
		a.Points, a.TrackedHours, a.Wellbeing = b.Points, b.TrackedHours, b.Wellbeing
		a.Care.Nutrition, a.Care.Play, a.Care.Clean, a.Care.Rest = b.Care.Nutrition, b.Care.Play, b.Care.Clean, b.Care.Rest
		a.GrowingAt, a.AdultAt = b.GrowingAt, b.AdultAt
		a.FormRecord, b.FormRecord = nil, nil // compared separately below
		if a != b {
			t.Fatalf("growth metadata differs: got %+v want %+v", a, b)
		}
	}
	compareGrowth(*got.Growth, *want.Growth)
	a, b := got.Growth.FormRecord, want.Growth.FormRecord
	if (a == nil) != (b == nil) {
		t.Fatal("frozen record presence differs")
	}
	if a != nil {
		compareGrowth(a.growth(), b.growth())
	}
	if (got.SleepSession == nil) != (want.SleepSession == nil) {
		t.Fatal("sleep session presence differs")
	}
	if got.SleepSession != nil {
		a, b := *got.SleepSession, *want.SleepSession
		partitionClose(t, "sleep settled hours", a.SettledHours, b.SettledHours)
		partitionClose(t, "sleep recovery", a.EnergyRecovered, b.EnergyRecovered)
		partitionClose(t, "sleep rest", a.RestGain, b.RestGain)
		partitionClose(t, "sleep growth", a.GrowthPoints, b.GrowthPoints)
		if a.StartedAt != b.StartedAt {
			t.Fatal("sleep start changed")
		}
	}
	if len(got.Logs) != len(want.Logs) || len(got.Album.Entries) != len(want.Album.Entries) {
		t.Fatal("log or memory cardinality differs")
	}
	logs := append([]Log(nil), got.Logs...)
	for i, l := range logs {
		if l.Text != want.Logs[i].Text {
			t.Fatalf("log differs at %d", i)
		}
		if l.At != want.Logs[i].At {
			if l.At != got.Growth.GrowingAt && l.At != got.Growth.AdultAt || math.Abs(float64(l.At-want.Logs[i].At)) > 1 {
				t.Fatalf("log time differs at %d", i)
			}
			logs[i].At = want.Logs[i].At
		}
	}
	album := *got.Album
	album.Entries = append([]Memory(nil), got.Album.Entries...)
	for i, m := range album.Entries {
		if m.At != want.Album.Entries[i].At {
			if m.Kind != "growing" && m.Kind != "adult" || math.Abs(float64(m.At-want.Album.Entries[i].At)) > 1 {
				t.Fatalf("memory time differs at %d", i)
			}
			album.Entries[i].At = want.Album.Entries[i].At
		}
	}
	if !reflect.DeepEqual(album, *want.Album) || !reflect.DeepEqual(logs, want.Logs) {
		t.Fatal("history differs")
	}
	got.Needs, got.Growth, got.SleepSession, got.Album, got.Logs = want.Needs, want.Growth, want.SleepSession, want.Album, want.Logs
	if !reflect.DeepEqual(got, want) {
		t.Fatal("settlement changed unrelated state")
	}
}

func checkSettlementPartitions(t *testing.T, initial State, start time.Time, millis int64, seed int64, parts int) State {
	t.Helper()
	end := start.Add(time.Duration(millis) * time.Millisecond)
	want := partitionReload(t, initial, start)
	if !want.Advance(end) {
		t.Fatal("single settlement did not run")
	}
	want = partitionReload(t, want, end)
	got := partitionReload(t, initial, start)
	rng := rand.New(rand.NewSource(seed))
	offsets := []int64{1, millis}
	if millis > 1 {
		offsets = append(offsets, millis-1)
	}
	for i := 0; i < parts; i++ {
		offsets = append(offsets, 1+rng.Int63n(millis))
	}
	sort.Slice(offsets, func(i, j int) bool { return offsets[i] < offsets[j] })
	last := int64(0)
	for _, offset := range offsets {
		if offset == last {
			continue
		}
		last = offset
		at := start.Add(time.Duration(offset) * time.Millisecond)
		if !got.Advance(at) {
			t.Fatalf("partition %dms did not settle", offset)
		}
		got = partitionReload(t, got, at)
		before, _ := json.Marshal(got)
		if got.Advance(at) || got.Advance(at.Add(-time.Millisecond)) {
			t.Fatal("same/past timestamp settled again")
		}
		after, _ := json.Marshal(got)
		if string(before) != string(after) {
			t.Fatal("same/past timestamp mutated state")
		}
	}
	assertPartitionState(t, got, want)
	if initial.Growth.FormRecord != nil && !reflect.DeepEqual(got.Growth.FormRecord, initial.Growth.FormRecord) {
		t.Fatal("existing adult record was rewritten")
	}
	if initial.Sleeping {
		gotSummary := sleepToggle(t, &got, end).SleepSummary
		wantSummary := sleepToggle(t, &want, end).SleepSummary
		if gotSummary == nil || wantSummary == nil || gotSummary.StartedAt != wantSummary.StartedAt || gotSummary.WokeAt != wantSummary.WokeAt {
			t.Fatal("wake summary endpoints differ")
		}
		partitionClose(t, "wake hours", gotSummary.SettledHours, wantSummary.SettledHours)
		partitionClose(t, "wake recovery", gotSummary.EnergyRecovered, wantSummary.EnergyRecovered)
		partitionClose(t, "wake rest", gotSummary.RestGain, wantSummary.RestGain)
		partitionClose(t, "wake growth", gotSummary.GrowthPoints, wantSummary.GrowthPoints)
		got, want = partitionReload(t, got, end), partitionReload(t, want, end)
		assertPartitionState(t, got, want)
	}
	return got
}

func TestGrowthAndSleepIrregularSettlementPartitions(t *testing.T) {
	start := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	forms := []string{"balanced", "lively", "gentle", "easygoing"}
	needs := []Needs{{}, {Hunger: 100, Mood: 100, Clean: 100, Energy: 100}, {Hunger: 1, Mood: 60, Clean: 8, Energy: 40}}
	for stage, points := range []float64{0, 23.9, 24, 71.9, 72} {
		for _, form := range forms {
			for _, sleeping := range []bool{false, true} {
				for ni, n := range needs {
					t.Run(fmt.Sprintf("stage%d/%s/sleep=%t/needs%d", stage, form, sleeping, ni), func(t *testing.T) {
						s := partitionFixture(t, start, points, form, n, sleeping)
						got := checkSettlementPartitions(t, s, start, int64(12*time.Hour/time.Millisecond), int64(stage*10+ni), 127)
						if points >= 71.9 && got.Growth.Form != form {
							t.Fatalf("expected fixture tendency %s, got %s", form, got.Growth.Form)
						}
					})
				}
			}
		}
	}
	// Each numbered case has its own seed, so filtering to a single subtest
	// reproduces the same fixture and partition schedule as the full suite.
	for i := 0; i < 80; i++ {
		t.Run(fmt.Sprintf("seed20261020/case%02d", i), func(t *testing.T) {
			rng := rand.New(rand.NewSource(20261020 + int64(i)))
			points := rng.Float64() * AdultPoints
			n := Needs{Hunger: rng.Float64() * 100, Mood: rng.Float64() * 100, Clean: rng.Float64() * 100, Energy: rng.Float64() * 100}
			s := partitionFixture(t, start, points, forms[i%len(forms)], n, i%2 == 0)
			millis := int64(1) + rng.Int63n(int64(12*time.Hour/time.Millisecond))
			if i%10 == 0 {
				millis = 1 // smallest representable interval, no fictitious sub-ms gain
			}
			checkSettlementPartitions(t, s, start, millis, rng.Int63(), 1+rng.Intn(255))
		})
	}
}

func TestAdultAtExactHistoryBoundaryWithIrregularPartitions(t *testing.T) {
	start := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	for _, duration := range []time.Duration{time.Millisecond, time.Hour, 12 * time.Hour} {
		for _, form := range []string{"balanced", "lively", "gentle", "easygoing"} {
			for _, sleeping := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/sleep=%t", duration, form, sleeping), func(t *testing.T) {
					n := Needs{Hunger: 100, Mood: 100, Clean: 100, Energy: 40}
					quality := .9
					if form == "easygoing" {
						n, quality = Needs{}, .01
					}
					s := partitionFixture(t, start, 71.9, form, n, sleeping)
					// Choose an exact endpoint using the unchanged growth integral.
					// This is a boundary fixture, not an independent formula oracle.
					s.Growth.Points = AdultPoints - s.growthGain(duration.Hours())
					s.Growth.TrackedHours = 12 - duration.Hours()
					s.Growth.Wellbeing = s.Growth.TrackedHours * quality
					s = partitionReload(t, s, start)
					got := checkSettlementPartitions(t, s, start, duration.Milliseconds(), 20261020, 511)
					end := start.Add(duration)
					if got.Growth.Stage != "adult" || got.Growth.Form != form || got.Growth.AdultAt != end.UnixMilli() || got.Growth.FormRecord == nil {
						t.Fatalf("wrong exact-boundary adult: %+v", got.Growth)
					}
					partitionClose(t, "frozen 12h history", got.Growth.FormRecord.TrackedHours, 12)
					frozen := *got.Growth.FormRecord
					// Later comfort/rest must not reselect or rewrite the frozen form.
					got.Advance(end.Add(12 * time.Hour))
					got = partitionReload(t, got, end.Add(12*time.Hour))
					if got.Growth.Form != form || !reflect.DeepEqual(*got.Growth.FormRecord, frozen) {
						t.Fatal("post-adult settlement rewrote frozen form")
					}
				})
			}
		}
	}
}
