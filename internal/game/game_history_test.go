package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestGameHistoryCountsSevenGamesIncludingRepeatedCappedAndUnrewardedPlay(t *testing.T) {
	for _, kind := range companionGames {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			s.Economy.Coins = MaxCoins
			s.Economy.LastGameAt = now.UnixMilli()
			s.Economy.GameCoins = GameDailyLimit
			for round := int64(1); round <= 3; round++ {
				finishExperience(t, &s, &now, kind, true)
				for _, entry := range s.Companion.History.Completions {
					want := int64(0)
					if entry.Kind == kind {
						want = round
					}
					if entry.Count != want {
						t.Fatalf("%s: got %d want %d", entry.Kind, entry.Count, want)
					}
				}
			}
			// Reach the familiarity cap using the real settlement hook, then keep playing.
			for i := 1; i < InterestLimit; i++ {
				now = now.Add(InterestInterval)
				finishExperience(t, &s, &now, kind, true)
			}
			finishExperience(t, &s, &now, kind, true)
			for _, entry := range s.Companion.History.Completions {
				if entry.Kind == kind && entry.Count != 8 {
					t.Fatal("cap stopped counting", entry)
				}
			}
			if s.Economy.Coins != MaxCoins {
				t.Fatal("new reward invented")
			}
			before, _ := json.Marshal(s.Companion.History)
			s.Advance(now.Add(24 * time.Hour))
			after, _ := json.Marshal(s.Companion.History)
			if string(before) != string(after) {
				t.Fatal("offline invented completions")
			}
		})
	}
}

func TestGameHistoryDoesNotCountShortGamesStartsCancelsOrStaleFinishes(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing"} {
		s, now := economyPet(t)
		finishExperience(t, &s, &now, kind, false)
		for _, entry := range s.Companion.History.Completions {
			if entry.Count != 0 {
				t.Fatal(kind, entry)
			}
		}
	}
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk", "play-treasure"} {
		s, now := economyPet(t)
		before, _ := json.Marshal(s.Companion.History)
		if _, err := s.Apply(Action{Kind: start}, now); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
			t.Fatal(err)
		}
		after, _ := json.Marshal(s.Companion.History)
		if string(before) != string(after) {
			t.Fatal("start/cancel counted", start)
		}
	}
	s, now := economyPet(t)
	id := finishExperience(t, &s, &now, "stars", true)
	if _, err := s.Apply(Action{Kind: "catch", GameID: id}, now); err == nil {
		t.Fatal("stale settlement accepted")
	}
	if s.Companion.History.Completions[0].Count != 1 {
		t.Fatal("duplicate count")
	}
}

func TestSchema18GameHistoryStartsEmptyAndPreservesActualPastAndActiveGame(t *testing.T) {
	for _, kind := range companionGames {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			finishExperience(t, &s, &now, "tiles", true)
			start := map[string]string{"stars": "play", "tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing", "walk": "play-walk", "treasure": "play-treasure"}[kind]
			s.Needs.Energy = 90
			if _, err := s.Apply(Action{Kind: start}, now); err != nil {
				t.Fatal(err)
			}
			s.Schema = 18
			s.Companion.History = nil
			before := copyState(s)
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			if !s.Upgrade(now) || s.Upgrade(now) {
				t.Fatal("migration count")
			}
			h := s.Companion.History
			if h == nil || h.Since != now.UnixMilli() {
				t.Fatal("missing tracking start")
			}
			for _, entry := range h.Completions {
				if entry.Count != 0 {
					t.Fatal("invented past", entry)
				}
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			s.Schema = 18
			s.Companion.History = nil
			if !reflect.DeepEqual(before, s) {
				t.Fatal("changed past, session, growth or rewards")
			}
		})
	}
}

func TestGameHistoryValidationAndExactJSONCountLimit(t *testing.T) {
	s, now := economyPet(t)
	finishExperience(t, &s, &now, "tiles", true)
	raw, _ := json.Marshal(s)
	for name, mutate := range map[string]func(*State){
		"missing":         func(s *State) { s.Companion.History = nil },
		"old schema":      func(s *State) { s.Schema = 18 },
		"before tracking": func(s *State) { s.Companion.History.Since = s.Companion.Since - 1 },
		"future":          func(s *State) { s.Companion.History.Since = s.LastTick + 1 },
		"missing kind":    func(s *State) { s.Companion.History.Completions = s.Companion.History.Completions[:6] },
		"duplicate kind":  func(s *State) { s.Companion.History.Completions[0].Kind = "tiles" },
		"negative":        func(s *State) { s.Companion.History.Completions[1].Count = -1 },
		"unsafe integer":  func(s *State) { s.Companion.History.Completions[1].Count = MaxGameCompletions + 1 },
		"no recent":       func(s *State) { s.Companion.Recent = nil },
		"recent not counted": func(s *State) {
			s.Companion.History.Completions[1].Count = 0
			s.Companion.History.Completions[0].Count = 1
		},
		"before history": func(s *State) { s.Companion.History.Since++; s.LastTick++ },
	} {
		t.Run(name, func(t *testing.T) {
			var bad State
			json.Unmarshal(raw, &bad)
			mutate(&bad)
			if bad.Validate(now.Add(time.Millisecond)) == nil {
				t.Fatal("accepted invalid counters")
			}
		})
	}
	s.Companion.History.Completions[1].Count = MaxGameCompletions
	finishExperience(t, &s, &now, "tiles", true)
	if s.Companion.History.Completions[1].Count != MaxGameCompletions {
		t.Fatal("overflow")
	}
}
