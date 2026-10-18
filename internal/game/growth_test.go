package game

import (
	"math"
	"testing"
	"time"
)

func babyAt(now time.Time) State {
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch", Species: 2}, now); err != nil {
		panic(err)
	}
	return s
}

func TestGrowthDependsOnCareAndSettlementIsPartitionIndependent(t *testing.T) {
	now := time.Now().Add(-24 * time.Hour)
	healthy, neglected := babyAt(now), babyAt(now)
	healthy.Needs = Needs{100, 100, 100, 100}
	neglected.Needs = Needs{10, 10, 10, 10}
	healthy.Advance(now.Add(12 * time.Hour))
	neglected.Advance(now.Add(12 * time.Hour))
	if healthy.Growth.Points <= neglected.Growth.Points+5 {
		t.Fatal("condition did not meaningfully affect growth")
	}
	one, many := babyAt(now), babyAt(now)
	one.Needs.Energy = 40
	many.Needs.Energy = 40
	one.Sleeping = true
	many.Sleeping = true
	one.Advance(now.Add(12 * time.Hour))
	for i := 1; i <= 720; i++ {
		many.Advance(now.Add(time.Duration(i) * time.Minute))
	}
	for _, pair := range [][2]float64{{one.Growth.Points, many.Growth.Points}, {one.Growth.Wellbeing, many.Growth.Wellbeing}, {one.Growth.Care.Rest, many.Growth.Care.Rest}} {
		if math.Abs(pair[0]-pair[1]) > 1e-8 {
			t.Fatalf("refresh frequency changed growth: %v", pair)
		}
	}
	before := one.Growth.Care.Rest
	one.Advance(now.Add(24 * time.Hour))
	if one.Growth.Care.Rest != before {
		t.Fatal("full energy sleep farmed rest credit")
	}
	if err := one.Validate(now.Add(24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestMeaningfulCareBonusesAndEvolutionOnlyOnce(t *testing.T) {
	now := time.Now().Add(-time.Hour)
	s := babyAt(now)
	s.Growth.Points = 23.9
	s.Needs.Hunger = 60
	s.Apply(Action{Kind: "feed"}, now)
	if s.Growth.Stage != "growing" || s.Growth.Care.Nutrition != 1 {
		t.Fatal("eligible meal did not unlock growing stage")
	}
	count := len(s.Logs)
	later := now.Add(5 * time.Minute)
	s.Advance(later)
	s.Needs.Hunger = 60
	s.Apply(Action{Kind: "feed"}, later)
	if s.Growth.Care.Nutrition != 1 {
		t.Fatal("repeated feeding bypassed cooldown")
	}
	s.Needs.Clean = 98
	s.Apply(Action{Kind: "clean"}, later)
	if s.Growth.Care.Clean != 0 {
		t.Fatal("unnecessary bath earned habit credit")
	}
	if len(s.Logs) != count+2 {
		t.Fatal("evolution was logged again")
	}
	if err := s.Validate(later); err != nil {
		t.Fatal(err)
	}
}

func TestAdultFormsReflectHistoryAndStayLocked(t *testing.T) {
	now := time.Now()
	born := now.Add(-80 * time.Hour)
	cases := []struct {
		name    string
		care    CareHistory
		quality float64
		want    string
	}{
		{"play", CareHistory{Play: 10}, .8, "lively"},
		{"quiet care", CareHistory{Clean: 4, Rest: 4}, .8, "gentle"},
		{"balanced", CareHistory{Nutrition: 2, Play: 2, Clean: 2, Rest: 2}, .8, "balanced"},
		{"low condition", CareHistory{Play: 10}, .2, "easygoing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := babyAt(born)
			s.LastTick = now.UnixMilli()
			s.Needs.Clean = 60
			s.Growth = &Growth{Stage: "growing", Points: 71.9, GrowingAt: born.Add(24 * time.Hour).UnixMilli(), TrackedHours: 12, Wellbeing: 12 * tc.quality, Care: tc.care}
			s.sharedMemory("growing", time.UnixMilli(s.Growth.GrowingAt))
			s.Apply(Action{Kind: "clean"}, now)
			if s.Growth.Stage != "adult" || s.Growth.Form != tc.want {
				t.Fatalf("wrong adult: %+v", s.Growth)
			}
			s.Growth.Care.Play = 500
			s.Advance(now.Add(time.Hour))
			if s.Growth.Form != tc.want {
				t.Fatal("adult form changed after it was chosen")
			}
			if err := s.Validate(now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestLegacyMigrationKeepsAgeAndDoesNotInventCare(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		age   time.Duration
		stage string
	}{{8 * time.Hour, "baby"}, {30 * time.Hour, "growing"}, {80 * time.Hour, "adult"}} {
		born := now.Add(-tc.age)
		s := babyAt(born)
		s.Schema = 1
		s.Companion = nil
		s.Pond = nil
		s.Economy = nil
		s.Growth = nil
		s.Album = nil
		s.CareCount = 17
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		if !s.Upgrade(now) || s.Growth.Stage != tc.stage || s.Growth.Care != (CareHistory{}) || s.Growth.TrackedHours != 0 {
			t.Fatal("legacy history changed incorrectly", s.Growth)
		}
		points, logs := s.Growth.Points, len(s.Logs)
		if s.Upgrade(now) || s.Growth.Points != points || len(s.Logs) != logs {
			t.Fatal("migration replayed")
		}
		if s.Species != 2 || s.Name != "草莓兔" || s.CareCount != 17 {
			t.Fatal("existing pet identity was changed")
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
	}
}

func TestGrowthImportValidation(t *testing.T) {
	now := time.Now()
	for _, change := range []func(*State){
		func(s *State) { s.Growth = nil }, func(s *State) { s.Growth.Points = 72 },
		func(s *State) { s.Growth.Care.Play = -1 }, func(s *State) { s.Growth.Wellbeing = 1 },
		func(s *State) { s.Growth.TrackedHours = 24 }, func(s *State) { s.Growth.Care.LastFeed = now.Add(time.Hour).UnixMilli() },
	} {
		s := babyAt(now)
		change(&s)
		if s.Validate(now) == nil {
			t.Fatal("invalid growth was accepted")
		}
	}
}

func TestOnlyCompletedGamesEarnCreditWithCooldown(t *testing.T) {
	now := time.Now().Add(-2 * time.Hour)
	s := babyAt(now)
	s.Apply(Action{Kind: "play"}, now)
	s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now)
	if s.Growth.Care.Play != 0 {
		t.Fatal("cancelled game earned care credit")
	}
	finish := func(at time.Time) time.Time {
		s.Advance(at)
		if _, err := s.Apply(Action{Kind: "play"}, at); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 5; i++ {
			tick := at.Add(time.Duration(i) * 900 * time.Millisecond)
			s.Advance(tick)
			if _, err := s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: i % 3}, tick); err != nil {
				t.Fatal(err)
			}
		}
		return at.Add(3600 * time.Millisecond)
	}
	end := finish(now)
	if s.Growth.Care.Play != 1 {
		t.Fatal("completed game did not earn credit")
	}
	finish(end)
	if s.Growth.Care.Play != 1 {
		t.Fatal("rapid games farmed care credit")
	}
	finish(end.Add(31 * time.Minute))
	if s.Growth.Care.Play != 2 {
		t.Fatal("cooldown never expired")
	}
}

func TestOfflineEvolutionLocksFormAtThresholdNotEndOfSettlement(t *testing.T) {
	start := time.Now().Add(-24 * time.Hour).Truncate(time.Millisecond)
	one, many := babyAt(start.Add(-24*time.Hour)), babyAt(start.Add(-24*time.Hour))
	for _, s := range []*State{&one, &many} {
		s.LastTick = start.UnixMilli()
		s.Needs = Needs{10, 10, 10, 10}
		s.Growth = &Growth{Stage: "growing", Points: 71.95,
			GrowingAt: start.Add(-time.Hour).UnixMilli(), TrackedHours: 11.8, Wellbeing: 1.18}
		s.sharedMemory("growing", time.UnixMilli(s.Growth.GrowingAt))
	}
	end := start.Add(12 * time.Hour)
	one.Advance(end)
	for i := 1; i <= 720; i++ {
		many.Advance(start.Add(time.Duration(i) * time.Minute))
	}
	if one.Growth.Form != "balanced" || one.Growth.Form != many.Growth.Form {
		t.Fatalf("refresh frequency changed adult form: one=%s many=%s", one.Growth.Form, many.Growth.Form)
	}
	if math.Abs(float64(one.Growth.AdultAt-many.Growth.AdultAt)) > 1 {
		t.Fatalf("evolution time depends on refresh: one=%d many=%d", one.Growth.AdultAt, many.Growth.AdultAt)
	}
	for _, s := range []*State{&one, &many} {
		if err := s.Validate(end); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMilestonesAndSleepHabitsArePartitionIndependent(t *testing.T) {
	start := time.Now().Add(-48 * time.Hour).Truncate(time.Millisecond)
	for _, points := range []float64{23.9, 71.9} {
		for _, sleeping := range []bool{false, true} {
			one, many := babyAt(start), babyAt(start)
			for _, s := range []*State{&one, &many} {
				s.Sleeping = sleeping
				s.Needs = Needs{1, 60, 8, 40}
				s.Growth.Points = points
				if points > GrowingPoints {
					s.Growth.Stage = "growing"
					s.Growth.GrowingAt = start.UnixMilli()
					s.sharedMemory("growing", start)
					s.Growth.Care.Clean = 3.95
				}
			}
			end := start.Add(12 * time.Hour)
			one.Advance(end)
			for i := 1; i <= 720; i++ {
				many.Advance(start.Add(time.Duration(i) * time.Minute))
			}
			if one.Growth.Stage != many.Growth.Stage || one.Growth.Form != many.Growth.Form {
				t.Fatalf("different evolution for points=%g sleeping=%t: one=%+v many=%+v", points, sleeping, one.Growth, many.Growth)
			}
			for _, pair := range [][2]float64{
				{one.Growth.Points, many.Growth.Points},
				{one.Growth.Wellbeing, many.Growth.Wellbeing},
				{one.Growth.Care.Rest, many.Growth.Care.Rest},
			} {
				if math.Abs(pair[0]-pair[1]) > 1e-8 {
					t.Fatalf("different settlement: %v", pair)
				}
			}
			for _, pair := range [][2]int64{
				{one.Growth.GrowingAt, many.Growth.GrowingAt},
				{one.Growth.AdultAt, many.Growth.AdultAt},
			} {
				if math.Abs(float64(pair[0]-pair[1])) > 1 {
					t.Fatalf("different milestone timestamps: %v", pair)
				}
			}
			if err := one.Validate(end); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestGrowthOfflineCapAndCareCooldownBoundary(t *testing.T) {
	now := time.Now().Add(-72 * time.Hour)
	short, long := babyAt(now), babyAt(now)
	short.Advance(now.Add(12 * time.Hour))
	long.Advance(now.Add(72 * time.Hour))
	if short.Needs != long.Needs || *short.Growth != *long.Growth {
		t.Fatal("offline settlement exceeded 12 hour cap")
	}
	for _, kind := range []string{"feed", "clean"} {
		s := babyAt(now)
		s.Needs.Hunger, s.Needs.Clean = 60, 60
		if _, err := s.Apply(Action{Kind: kind}, now); err != nil {
			t.Fatal(err)
		}
		if s.Growth.Points != .25 {
			t.Fatal("meaningful care did not earn exactly .25 points")
		}
		s.Needs.Hunger, s.Needs.Clean = 60, 60
		s.Apply(Action{Kind: kind}, now.Add(30*time.Minute-time.Millisecond))
		if s.Growth.Points != .25 {
			t.Fatal("reward unlocked before cooldown")
		}
		s.Needs.Hunger, s.Needs.Clean = 60, 60
		s.Apply(Action{Kind: kind}, now.Add(30*time.Minute))
		if s.Growth.Points != .5 {
			t.Fatal("reward did not unlock at cooldown boundary")
		}
	}
}
