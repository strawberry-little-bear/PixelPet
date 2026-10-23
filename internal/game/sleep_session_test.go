package game

import (
	"encoding/json"
	"math"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func sleepPet(t *testing.T, now time.Time, energy float64) State {
	t.Helper()
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch"}, now); err != nil {
		t.Fatal(err)
	}
	s.Needs.Energy = energy
	return s
}
func sleepToggle(t *testing.T, s *State, now time.Time) *CareFeedback {
	t.Helper()
	s.Advance(now)
	_, f, err := s.ApplyWithFeedback(Action{Kind: "sleep"}, now)
	if err != nil || f == nil {
		t.Fatalf("toggle: %v %+v", err, f)
	}
	if f.Points != 0 || f.HabitGain != 0 || f.Effect.Before != f.Effect.After {
		t.Fatalf("toggle invented immediate credit: %+v", f)
	}
	return f
}
func closeSleep(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-8 {
		t.Fatalf("got %.12f want %.12f", got, want)
	}
}
func TestSleepSessionAccumulatesSameActualSettlementsAcrossReloads(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, polls := range []int{1, 6, 60} {
		t.Run(strconv.Itoa(polls)+" polls", func(t *testing.T) {
			s := sleepPet(t, now, 40)
			before := *s.Growth
			if f := sleepToggle(t, &s, now); f.SleepSummary != nil {
				t.Fatal("bedtime claimed a completed sleep")
			}
			for i := 1; i <= polls; i++ {
				s.Advance(now.Add(time.Duration(i) * time.Hour / time.Duration(polls)))
				body, err := json.Marshal(s)
				if err != nil {
					t.Fatal(err)
				}
				var loaded State
				if err = json.Unmarshal(body, &loaded); err != nil {
					t.Fatal(err)
				}
				s = loaded
				if err = s.Validate(now.Add(time.Hour)); err != nil {
					t.Fatal(err)
				}
			}
			f := sleepToggle(t, &s, now.Add(time.Hour))
			r := f.SleepSummary
			if r == nil || r.StartedAt != now.UnixMilli() || r.WokeAt != now.Add(time.Hour).UnixMilli() || s.SleepSession != nil || s.Sleeping {
				t.Fatalf("missing/uncleared session %+v", r)
			}
			closeSleep(t, r.SettledHours, 1)
			closeSleep(t, r.EnergyRecovered, 14)
			closeSleep(t, r.RestGain, .5)
			closeSleep(t, r.GrowthPoints, s.Growth.Points-before.Points)
			closeSleep(t, r.GrowthPoints, 1.1771875) // exact existing integration, not a new reward
			if err := s.Validate(now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestSleepSessionCapsEnergyAndPreservesAdultForm(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, adult := range []bool{false, true} {
		for _, energy := range []float64{95, 100} {
			s := sleepPet(t, now, energy)
			if adult {
				s.Growth.Points = AdultPoints
				s.evolve(now)
			}
			beforeForm := s.Growth.Form
			sleepToggle(t, &s, now)
			f := sleepToggle(t, &s, now.Add(10*time.Hour))
			r := f.SleepSummary
			closeSleep(t, r.EnergyRecovered, 100-energy)
			closeSleep(t, r.RestGain, (100-energy)/28)
			if adult && r.GrowthPoints != 0 {
				t.Fatal("adult growth bonus")
			}
			if s.Growth.Form != beforeForm {
				t.Fatal("locked form changed")
			}
			if err := s.Validate(now.Add(10 * time.Hour)); err != nil {
				t.Fatal(err)
			}
		}
	}
}
func TestSleepSessionReportsSettledHoursNotWallTimeOrOneTick(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, split := range []bool{false, true} {
		s := sleepPet(t, now, 0)
		sleepToggle(t, &s, now)
		want := 12.0
		if split {
			s.Advance(now.Add(12 * time.Hour))
			want = 24
		}
		f := sleepToggle(t, &s, now.Add(24*time.Hour))
		closeSleep(t, f.SleepSummary.SettledHours, want)
		if f.SleepSummary.WokeAt-f.SleepSummary.StartedAt != int64(24*time.Hour/time.Millisecond) {
			t.Fatal("lost wall endpoints")
		}
		closeSleep(t, f.SleepSummary.EnergyRecovered, 100)
	}
}
func TestSleepSessionStartsFreshAfterWakeAndDoesNotCountAwakeHours(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 40)
	sleepToggle(t, &s, now)
	first := *sleepToggle(t, &s, now.Add(time.Hour)).SleepSummary
	sleepToggle(t, &s, now.Add(3*time.Hour))
	if _, _, err := s.ApplyWithFeedback(Action{Kind: "rename", Name: "好梦"}, now.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	second := sleepToggle(t, &s, now.Add(4*time.Hour)).SleepSummary
	closeSleep(t, second.SettledHours, 1)
	closeSleep(t, second.EnergyRecovered, 14)
	if second.StartedAt != now.Add(3*time.Hour).UnixMilli() || first.StartedAt == second.StartedAt {
		t.Fatal("joined separate sleeps")
	}
	sleepToggle(t, &s, now.Add(4*time.Hour))
	zero := sleepToggle(t, &s, now.Add(4*time.Hour)).SleepSummary
	if zero == nil || zero.SettledHours != 0 || zero.EnergyRecovered != 0 || zero.GrowthPoints != 0 {
		t.Fatal("invented immediate recovery")
	}
}
func TestLegacySleepSessionIsUnknownUntilNextExplicitBedtime(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, schema := range []int{1, 15, 16} {
		s := sleepPet(t, now, 40)
		s.Schema = schema
		if s.Companion != nil {
			s.Companion.History = nil
		}
		s.Sleeping = true
		if schema == 1 {
			s.Growth = nil
			s.Album = nil
			s.Pond = nil
			s.Park = nil
			s.Companion = nil
			s.Economy = nil
		}
		if schema == 15 {
			s.Companion.Interests = s.Companion.Interests[:6]
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		s.Upgrade(now)
		if s.SleepSession != nil || s.Schema != Schema || !s.Sleeping {
			t.Fatal("invented legacy sleep")
		}
		if f := sleepToggle(t, &s, now.Add(time.Hour)); f.SleepSummary != nil {
			t.Fatal("fabricated legacy receipt")
		}
		sleepToggle(t, &s, now.Add(time.Hour))
		if f := sleepToggle(t, &s, now.Add(2*time.Hour)); f.SleepSummary == nil {
			t.Fatal("missing new sleep")
		}
	}
}
func TestSleepSessionInvalidFieldsRejected(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	base := sleepPet(t, now, 40)
	sleepToggle(t, &base, now)
	base.Advance(now.Add(time.Hour))
	cases := map[string]func(*State){
		"old schema": func(s *State) { s.Schema = 16 }, "awake": func(s *State) { s.Sleeping = false },
		"before hatch": func(s *State) { s.SleepSession.StartedAt-- }, "future": func(s *State) { s.SleepSession.StartedAt = s.LastTick + 1 },
		"nan": func(s *State) { s.SleepSession.EnergyRecovered = math.NaN() }, "infinity": func(s *State) { s.SleepSession.SettledHours = math.Inf(1) },
		"negative": func(s *State) { s.SleepSession.RestGain = -1 }, "wall hours": func(s *State) { s.SleepSession.SettledHours = 2 },
		"untracked hours": func(s *State) { s.Growth.TrackedHours = .5 }, "too much energy": func(s *State) { s.SleepSession.EnergyRecovered = 100 },
		"rate": func(s *State) { s.SleepSession.SettledHours = .1 }, "unearned rest": func(s *State) { s.SleepSession.RestGain++ },
		"untracked rest": func(s *State) { s.Growth.Care.Rest = 0 }, "unearned growth": func(s *State) { s.SleepSession.GrowthPoints = 72 },
		"untracked growth": func(s *State) { s.Growth.Points = 0 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s := base
			r := *base.SleepSession
			s.SleepSession = &r
			g := *base.Growth
			s.Growth = &g
			mutate(&s)
			if s.Validate(now.Add(time.Hour)) == nil {
				t.Fatal("accepted invalid session")
			}
		})
	}
	if err := base.Validate(now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
}
func TestSleepSessionFailedIntentDoesNotCompleteOrResetSession(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 40)
	sleepToggle(t, &s, now)
	before := *s.SleepSession
	awake := false
	_, f, err := s.ApplyWithFeedback(Action{Kind: "sleep", ExpectedSleeping: &awake}, now)
	if err != ErrSleepChanged || f != nil || !reflect.DeepEqual(before, *s.SleepSession) {
		t.Fatal("stale intent changed sleep")
	}
}

func TestSleepSessionUsesActualGrowthAcrossMilestones(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, points := range []float64{23.9, 71.9} {
		s := sleepPet(t, now, 40)
		s.Growth.Points = points
		s.evolve(now)
		sleepToggle(t, &s, now)
		f := sleepToggle(t, &s, now.Add(time.Hour))
		r := f.SleepSummary
		closeSleep(t, r.GrowthPoints, s.Growth.Points-points)
		if points > 70 {
			closeSleep(t, r.GrowthPoints, .1)
			if s.Growth.Stage != "adult" || s.Growth.FormRecord == nil {
				t.Fatal("lost actual adult threshold")
			}
		}
		if err := s.Validate(now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchemaSixteenUpgradePreservesEveryActiveGameAndOldSleep(t *testing.T) {
	for _, kind := range append(append([]string{}, companionGames[:]...), "sleep") {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			if kind == "sleep" {
				s.Sleeping = true
			} else {
				start := map[string]string{"stars": "play", "tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing", "walk": "play-walk", "treasure": "play-treasure"}[kind]
				if _, err := s.Apply(Action{Kind: start}, now); err != nil {
					t.Fatal(err)
				}
			}
			s.Schema = 16
			if s.Companion != nil {
				s.Companion.History = nil
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(s)
			if !s.Upgrade(now) || s.Upgrade(now) || s.Schema != Schema || s.SleepSession != nil {
				t.Fatal("migration invented session or repeated")
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			s.Schema = 16
			if s.Companion != nil {
				s.Companion.History = nil
			}
			after, _ := json.Marshal(s)
			if string(before) != string(after) {
				t.Fatal("migration changed needs, game, or history")
			}
		})
	}
}
