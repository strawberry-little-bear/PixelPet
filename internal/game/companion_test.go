package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func finishExperience(t *testing.T, s *State, now *time.Time, kind string, qualifies bool) string {
	t.Helper()
	start := map[string]string{"stars": "play", "tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing"}[kind]
	s.Needs.Energy = 90
	s.Advance(*now)
	if _, err := s.Apply(Action{Kind: start}, *now); err != nil {
		t.Fatal(err)
	}
	id := s.Game.ID
	switch kind {
	case "stars":
		for i := 0; i < 5; i++ {
			*now = now.Add(time.Second)
			s.Advance(*now)
			if _, err := s.Apply(Action{Kind: "catch", GameID: id, Lane: 0}, *now); err != nil {
				t.Fatal(err)
			}
		}
	case "tiles":
		finishTiles(t, s, *now)
	case "snake":
		s.Game.Snake.End = "wall"
		if qualifies {
			s.Game.Snake.Eaten = 3
		}
		if _, err := s.Apply(snakeAction(s, "snake-finish"), *now); err != nil {
			t.Fatal(err)
		}
	case "tetris":
		s.Game.Tetris.End = "stacked"
		s.Game.Tetris.Active = nil
		if qualifies {
			s.Game.Tetris.Lines = 2
		}
		if _, err := s.Apply(blockAction(s, "tetris-finish"), *now); err != nil {
			t.Fatal(err)
		}
	case "fishing":
		for i := 0; i < 3; i++ {
			if qualifies {
				bite(t, s, now)
				fishDo(t, s, *now, "fish-reel")
			} else {
				fishDo(t, s, *now, "fish-cast")
				fishDo(t, s, *now, "fish-reel")
			}
		}
		fishDo(t, s, *now, "fish-finish")
	}
	if s.Game != nil || s.Validate(*now) != nil {
		t.Fatal("invalid final state", kind, s.Validate(*now))
	}
	return id
}
func TestEveryQualifyingSettlementRecordsOnlyItsActualGame(t *testing.T) {
	for _, kind := range companionGames {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			s.Economy.Coins = MaxCoins
			s.Economy.LastGameAt = now.UnixMilli()
			s.Economy.GameCoins = GameDailyLimit
			id := finishExperience(t, &s, &now, kind, true)
			if s.Companion.Recent == nil || *s.Companion.Recent != (GameExperience{kind, id, now.UnixMilli()}) {
				t.Fatal("missing true session", s.Companion)
			}
			for _, r := range s.Companion.Interests {
				want := 0
				if r.Kind == kind {
					want = 1
				}
				if r.Points != want {
					t.Fatal(r)
				}
			}
			if s.Economy.Coins != MaxCoins {
				t.Fatal("interest bypassed wallet")
			}
			before, _ := json.Marshal(s.Companion)
			s.Advance(now.Add(24 * time.Hour))
			after, _ := json.Marshal(s.Companion)
			if string(before) != string(after) {
				t.Fatal("offline invented games")
			}
		})
	}
}
func TestShortGamesStartsCancelsAndInvalidCommandsDoNotInventExperience(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing"} {
		s, now := economyPet(t)
		finishExperience(t, &s, &now, kind, false)
		if s.Companion.Recent != nil {
			t.Fatal("short game credited", kind)
		}
	}
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing"} {
		s, now := economyPet(t)
		before, _ := json.Marshal(s.Companion)
		s.Apply(Action{Kind: start}, now)
		if _, err := s.Apply(Action{Kind: "cancel-play", GameID: "stale"}, now); err == nil {
			t.Fatal("stale accepted")
		}
		s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now)
		after, _ := json.Marshal(s.Companion)
		if string(before) != string(after) {
			t.Fatal("start/cancel credited", start)
		}
	}
}
func TestInterestCooldownBoundarySaturationAndAdultFormsStayIndependent(t *testing.T) {
	for _, form := range []string{"balanced", "lively", "gentle", "easygoing"} {
		s, now := economyPet(t)
		s.Growth.Stage = "adult"
		s.Growth.Points = AdultPoints
		s.Growth.GrowingAt = now.UnixMilli()
		s.Growth.AdultAt = now.UnixMilli()
		s.Growth.Form = form
		s.sharedMemory("growing", now)
		s.remember(Memory{Kind: "adult", At: now.UnixMilli(), Source: "shared", Form: form})
		finishExperience(t, &s, &now, "tiles", true)
		at := s.Companion.Interests[1].LastAt
		now = time.UnixMilli(at).Add(InterestInterval - time.Millisecond)
		finishExperience(t, &s, &now, "tiles", true)
		if s.Companion.Interests[1].Points != 1 || s.Companion.Recent.At != now.UnixMilli() {
			t.Fatal("cooldown/echo", s.Companion)
		}
		now = now.Add(time.Millisecond)
		finishExperience(t, &s, &now, "tiles", true)
		if s.Companion.Interests[1].Points != 2 {
			t.Fatal("exact interval not credited")
		}
		for i := 0; i < 10; i++ {
			now = now.Add(InterestInterval)
			finishExperience(t, &s, &now, "tiles", true)
		}
		if s.Companion.Interests[1].Points != InterestLimit || s.Growth.Form != form || s.Growth.Points != AdultPoints {
			t.Fatal("limit/adult changed")
		}
		points := s.Companion.Interests[1]
		finishExperience(t, &s, &now, "snake", true)
		if points != s.Companion.Interests[1] || s.Companion.Interests[2].Points != 1 {
			t.Fatal("cross-game coupling")
		}
	}
}
func TestCompanionValidationRejectsMalformedHistory(t *testing.T) {
	s, now := economyPet(t)
	finishExperience(t, &s, &now, "tiles", true)
	raw, _ := json.Marshal(s)
	for _, mutate := range []func(*State){
		func(s *State) { s.Companion = nil }, func(s *State) { s.Schema = 9 }, func(s *State) { s.Companion.Since = s.LastTick + 1 }, func(s *State) { s.Companion.Since = s.CreatedAt - 1 },
		func(s *State) { s.Companion.Interests = s.Companion.Interests[:4] }, func(s *State) { s.Companion.Interests[0].Kind = "tiles" }, func(s *State) { s.Companion.Interests[1].Points = -1 }, func(s *State) { s.Companion.Interests[1].Points = 6 },
		func(s *State) { s.Companion.Interests[1].Points = 2 }, func(s *State) { s.Companion.Interests[0].LastAt = s.LastTick }, func(s *State) { s.Companion.Recent = nil }, func(s *State) { s.Companion.Recent.Kind = "unknown" }, func(s *State) { s.Companion.Recent.Kind = "stars" }, func(s *State) { s.Companion.Recent.ID = "invalid" }, func(s *State) { s.Companion.Recent.At++ }, func(s *State) { s.Companion.Recent.At = s.CreatedAt - 1 },
	} {
		var bad State
		json.Unmarshal(raw, &bad)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("bad history accepted", bad.Companion)
		}
	}
}
func TestSchemaNineMigrationDoesNotBackfillGamesOrChangeLockedForm(t *testing.T) {
	s, now := economyPet(t)
	finishExperience(t, &s, &now, "tiles", true)
	s.Schema = 9
	s.Companion = nil
	s.Economy.Owned = []string{"sky-bow", "starlit-wall", "mint-floor"}
	s.Economy.Equipped = Equipment{Accessory: "sky-bow", Wallpaper: "starlit-wall", Floor: "mint-floor"}
	s.Apply(Action{Kind: "play-fishing"}, now)
	old := s
	raw, _ := json.Marshal(s)
	if s.Validate(now) != nil || !s.Upgrade(now) || s.Companion.Since != now.UnixMilli() || s.Companion.Recent != nil || s.Upgrade(now) {
		t.Fatal("migration failed")
	}
	for _, r := range s.Companion.Interests {
		if r.Points != 0 || r.LastAt != 0 {
			t.Fatal("invented past")
		}
	}
	if !reflect.DeepEqual(old.Game, s.Game) {
		t.Fatal("lost session")
	}
	s.Companion = nil
	s.Schema = 9
	after, _ := json.Marshal(s)
	if string(raw) != string(after) {
		t.Fatal("migration rewrote past")
	}
}
