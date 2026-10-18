package game

import (
	"testing"
	"time"
)

func TestOfflineSettlementAndSleep(t *testing.T) {
	now := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch", Species: 6}, now); err != nil {
		t.Fatal(err)
	}
	s.Advance(now.Add(48 * time.Hour))
	if s.Needs.Hunger != 44 || s.Needs.Energy != 61 {
		t.Fatalf("offline cap failed: %+v", s.Needs)
	}
	if s.Advance(now.Add(48 * time.Hour)) {
		t.Fatal("same elapsed time settled twice")
	}
	if _, err := s.Apply(Action{Kind: "sleep"}, now.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	s.Advance(now.Add(49 * time.Hour))
	if s.Needs.Energy != 75 {
		t.Fatalf("sleep did not restore energy: %v", s.Needs.Energy)
	}
	if _, err := s.Apply(Action{Kind: "feed"}, now.Add(49*time.Hour)); err == nil {
		t.Fatal("sleeping pet accepted food")
	}
	if err := s.Validate(now.Add(49 * time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestActionRulesAndMiniGame(t *testing.T) {
	now := time.Now()
	s := New(now)
	if _, err := s.Apply(Action{Kind: "feed"}, now); err == nil {
		t.Fatal("unhatched pet ate")
	}
	if _, err := s.Apply(Action{Kind: "hatch", Species: 10}, now); err == nil {
		t.Fatal("invalid species accepted")
	}
	s.Apply(Action{Kind: "hatch", Species: 2}, now)
	s.Apply(Action{Kind: "feed"}, now)
	if s.Needs.Hunger != 100 {
		t.Fatal("food failed to clamp")
	}
	if _, err := s.Apply(Action{Kind: "feed"}, now); err == nil {
		t.Fatal("overfeeding accepted")
	}
	s.Apply(Action{Kind: "play"}, now)
	for i := 0; i < 5; i++ {
		at := now.Add(time.Duration(i) * 900 * time.Millisecond)
		if _, err := s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: i % 3}, at); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if _, err := s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: 0}, at); err == nil {
				t.Fatal("double catch accepted")
			}
		}
	}
	if s.Game != nil || s.CareCount != 2 || s.Needs.Energy != 77 || s.Needs.Mood != 100 {
		t.Fatalf("game reward incorrect: %+v", s)
	}
}

func TestImportValidation(t *testing.T) {
	now := time.Now()
	s := New(now)
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*State){
		func(s *State) { s.Schema = 42 }, func(s *State) { s.Species = -1 }, func(s *State) { s.Needs.Hunger = 101 },
		func(s *State) { s.LastTick = now.Add(time.Hour).UnixMilli() }, func(s *State) { s.CreatedAt = 0 },
		func(s *State) { s.Sleeping = true }, func(s *State) { s.Name = "" },
	} {
		candidate := s
		mutate(&candidate)
		if candidate.Validate(now) == nil {
			t.Fatalf("invalid save accepted: %+v", candidate)
		}
	}
}
