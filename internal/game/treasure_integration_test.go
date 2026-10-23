package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func treasureCommand(t *testing.T, s *State, now time.Time, kind string, tile int) string {
	t.Helper()
	msg, err := s.Apply(Action{Kind: kind, GameID: s.Game.ID, Step: s.Game.Treasure.Step, Tile: tile}, now)
	if err != nil {
		t.Fatal(kind, err)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(kind, "invalid state", err)
	}
	return msg
}

func TestTreasureSettlementRequiresActualSearchAndExplicitFinish(t *testing.T) {
	for _, finds := range []int{0, 1, 2, 3} {
		t.Run(string(rune('0'+finds)), func(t *testing.T) {
			s, now := economyPet(t)
			if _, err := s.Apply(Action{Kind: "play-treasure"}, now); err != nil {
				t.Fatal(err)
			}
			n := s.Game.Treasure
			if !n.Paused || len(n.Opened) != 0 || s.Validate(now) != nil {
				t.Fatal("bad start")
			}
			before := copyState(s)
			if _, err := s.Apply(Action{Kind: "treasure-dig", GameID: s.Game.ID, Tile: 0}, now); err == nil || !reflect.DeepEqual(s, before) {
				t.Fatal("paused dig changed save")
			}
			treasureCommand(t, &s, now, "treasure-resume", 0)
			// Choose real actions based on a known legal map; reveal-only items never count.
			n.Layout = []int{1, 2, 3, 0, 0, 0, 0, 0, 0}
			order := []int{}
			for i := 0; i < finds; i++ {
				order = append(order, i)
			}
			for i := 3; len(order) < 6 && finds < 3; i++ {
				order = append(order, i)
			}
			for _, i := range order {
				treasureCommand(t, &s, now, "treasure-dig", i)
				if s.CareCount != 0 || s.Economy.Coins != 0 || s.Companion.Recent != nil {
					t.Fatal("premature reward")
				}
			}
			if !s.Game.AwaitingFinish() || n.found() != finds {
				t.Fatal("not ready", n)
			}
			before = copyState(s)
			if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID, RequireUnfinished: true}, now); err == nil || !reflect.DeepEqual(s, before) {
				t.Fatal("stale abandon ate result")
			}
			id := s.Game.ID
			treasureCommand(t, &s, now, "treasure-finish", 0)
			if s.Game != nil || s.CareCount != 1 || s.Economy.Coins != 3+finds || s.Companion.Recent.Kind != "treasure" || s.Companion.Recent.ID != id || s.Companion.Interests[6].Points != 1 {
				t.Fatal("bad settlement", s)
			}
			if len(s.Album.Entries) == 0 || s.Album.Entries[len(s.Album.Entries)-1].Kind != "treasure" {
				t.Fatal("missing shared memory")
			}
		})
	}
}

func TestTreasureErrorsAtomicAndSharedLimits(t *testing.T) {
	s, now := economyPet(t)
	s.Needs.Energy = 9
	if _, err := s.Apply(Action{Kind: "play-treasure"}, now); err == nil {
		t.Fatal("low energy")
	}
	s.Needs.Energy = 90
	s.Sleeping = true
	if _, err := s.Apply(Action{Kind: "play-treasure"}, now); err == nil {
		t.Fatal("sleep")
	}
	s.Sleeping = false
	if _, err := s.Apply(Action{Kind: "play-treasure"}, now); err != nil {
		t.Fatal(err)
	}
	treasureCommand(t, &s, now, "treasure-resume", 0)
	treasureCommand(t, &s, now, "treasure-dig", 0)
	for _, a := range []Action{
		{Kind: "play-walk"}, {Kind: "feed"}, {Kind: "treasure-finish", Step: s.Game.Treasure.Step},
		{Kind: "treasure-dig", Tile: 0, Step: s.Game.Treasure.Step},
		{Kind: "treasure-dig", Tile: 9, Step: s.Game.Treasure.Step},
		{Kind: "treasure-dig", Tile: 1, Step: s.Game.Treasure.Step - 1},
		{Kind: "treasure-pause", Step: s.Game.Treasure.Step + 1},
		{Kind: "treasure-dig", GameID: "0123456789abcdef0123456789abcdef", Step: s.Game.Treasure.Step},
	} {
		if a.GameID == "" && a.Kind != "play-walk" && a.Kind != "feed" {
			a.GameID = s.Game.ID
		}
		before := copyState(s)
		if _, err := s.Apply(a, now); err == nil || !reflect.DeepEqual(before, s) {
			t.Fatal("non atomic error", a)
		}
	}
	// Shared allowance/cooldown cannot be bypassed by selecting the new game.
	s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now)
	s.Economy.GameCoins = GameDailyLimit
	s.Economy.LastGameAt = now.UnixMilli()
	finishExperience(t, &s, &now, "treasure", true)
	if s.Economy.Coins != 0 || s.CareCount != 1 || s.Companion.Recent.Kind != "treasure" {
		t.Fatal("quota stopped companionship or paid", s.Economy)
	}
}

func TestSchemaFifteenUpgradePreservesEveryActiveGame(t *testing.T) {
	for _, kind := range companionGames[:6] {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			finishExperience(t, &s, &now, "tiles", true)
			s.Needs.Energy = 90
			start := map[string]string{"stars": "play", "tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing", "walk": "play-walk"}[kind]
			if _, err := s.Apply(Action{Kind: start}, now); err != nil {
				t.Fatal(err)
			}
			s.Schema = 15
			if s.Companion != nil {
				s.Companion.History = nil
			}
			s.Companion.Interests = append([]Interest{}, s.Companion.Interests[:6]...)
			if err := s.Validate(now); err != nil {
				t.Fatal("legacy fixture", err)
			}
			raw, _ := json.Marshal(s)
			if !s.Upgrade(now) || s.Validate(now) != nil || s.Upgrade(now) {
				t.Fatal("migration")
			}
			if s.Companion.Interests[6] != (Interest{Kind: "treasure"}) {
				t.Fatal("fabricated history")
			}
			s.Schema = 15
			if s.Companion != nil {
				s.Companion.History = nil
			}
			s.Companion.Interests = s.Companion.Interests[:6]
			after, _ := json.Marshal(s)
			if string(raw) != string(after) {
				t.Fatal("changed existing session/history")
			}
		})
	}
}

func TestTreasureSaveRejectsCrossPayloadAndOldSchema(t *testing.T) {
	s, now := economyPet(t)
	s.Apply(Action{Kind: "play-treasure"}, now)
	for _, mutate := range []func(*State){
		func(s *State) { s.Schema = 15; s.Companion.Interests = s.Companion.Interests[:6] },
		func(s *State) { s.Game.Kind = "tiles" }, func(s *State) { s.Game.Score = 1 },
		func(s *State) { s.Game.Tiles = &TileMatch{} }, func(s *State) { s.Sleeping = true },
		func(s *State) { s.Game.Treasure.Opened = []int{0, 0} },
	} {
		bad := copyState(s)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("invalid payload accepted", bad.Game)
		}
	}
}
