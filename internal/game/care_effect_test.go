package game

import (
	"testing"
	"time"
)

func TestCareEffectUsesActualNeedsAndClamps(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name, kind    string
		before, after Needs
	}{
		{"meal", "feed", Needs{60, 80, 60, 80}, Needs{80, 83, 57, 80}},
		{"meal capped", "feed", Needs{95, 99, 1, 80}, Needs{100, 100, 0, 80}},
		{"bath", "clean", Needs{60, 80, 60, 80}, Needs{60, 84, 95, 80}},
		{"bath capped", "clean", Needs{60, 99, 98, 80}, Needs{60, 100, 100, 80}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := babyAt(now)
			s.Needs = tc.before
			_, f, err := s.ApplyWithFeedback(Action{Kind: tc.kind}, now)
			if err != nil || f == nil || f.Effect == nil {
				t.Fatalf("missing effect: %+v %v", f, err)
			}
			if f.Effect.At != now.UnixMilli() || f.Effect.Before != tc.before || f.Effect.After != tc.after || s.Needs != tc.after {
				t.Fatalf("effect does not match actual mutation: %+v", f.Effect)
			}
			// Response metadata must be value snapshots, not aliases to later state.
			s.Needs.Hunger = 0
			if f.Effect.After != tc.after {
				t.Fatal("effect changed after later mutation")
			}
		})
	}
}

func TestCareEffectDoesNotDependOnHabitCreditOrAdultForm(t *testing.T) {
	now := time.Now()
	for _, stage := range []string{"baby", "growing", "adult"} {
		for _, reason := range []string{"credited", "not-needed", "cooldown"} {
			t.Run(stage+"/"+reason, func(t *testing.T) {
				s := babyAt(now)
				s.Growth.Stage = stage
				if stage == "growing" {
					s.Growth.Points = 24
					s.Growth.GrowingAt = now.UnixMilli()
				}
				if stage == "adult" {
					s.Growth.Points = 72
					s.Growth.Form = "gentle"
					s.Growth.AdultAt = now.UnixMilli()
				}
				s.Needs.Hunger = 60
				if reason == "not-needed" {
					s.Needs.Hunger = 80
				}
				if reason == "cooldown" {
					s.Growth.Care.LastFeed = now.Add(-time.Minute).UnixMilli()
				}
				before := s.Needs
				_, f, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now)
				if err != nil || f == nil || f.Effect == nil || f.Reason != reason {
					t.Fatalf("wrong feedback: %+v %v", f, err)
				}
				if f.Effect.Before != before || f.Effect.After != s.Needs {
					t.Fatal("habit eligibility changed the need comparison")
				}
				if stage == "adult" && (s.Growth.Form != "gentle" || f.Points != 0) {
					t.Fatal("adult form or growth changed")
				}
			})
		}
	}
}

func TestSleepEffectDoesNotClaimPassiveRecovery(t *testing.T) {
	now := time.Now()
	s := babyAt(now)
	s.Needs.Energy = 30
	_, f, err := s.ApplyWithFeedback(Action{Kind: "sleep"}, now)
	if err != nil || f == nil || f.Effect == nil || f.Effect.Before != f.Effect.After || f.Reason != "resting" {
		t.Fatalf("sleep invented recovery: %+v %v", f, err)
	}
	s.Advance(now.Add(time.Hour))
	settled := s.Needs
	_, f, err = s.ApplyWithFeedback(Action{Kind: "sleep"}, now.Add(time.Hour))
	if err != nil || f == nil || f.Effect == nil || f.Effect.Before != settled || f.Effect.After != settled || f.Reason != "awake" || settled.Energy != 44 {
		t.Fatalf("wake claimed earlier recovery: %+v %v", f, err)
	}
}

func TestCareEffectOnlyAppearsOnSuccessfulCompletedCare(t *testing.T) {
	now := time.Now()
	s := babyAt(now)
	s.Needs.Hunger = 100
	if _, f, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now); err == nil || f != nil {
		t.Fatal("rejected care returned effect")
	}
	s.Needs.Hunger = 60
	if _, f, err := s.ApplyWithFeedback(Action{Kind: "play"}, now); err != nil || f != nil {
		t.Fatalf("game start: %+v %v", f, err)
	}
	for i := 0; i < 5; i++ {
		at := now.Add(time.Duration(i) * time.Second)
		before := s.Needs
		lane := int((at.UnixMilli()-s.Game.StartedAt)/900) % 3
		_, f, err := s.ApplyWithFeedback(Action{Kind: "catch", Lane: lane, GameID: s.Game.ID}, at)
		if err != nil {
			t.Fatal(err)
		}
		if i < 4 && f != nil {
			t.Fatal("unfinished game returned effect")
		}
		if i == 4 && (f == nil || f.Effect == nil || f.Effect.Before != before || f.Effect.After != s.Needs) {
			t.Fatalf("completion effect missing: %+v", f)
		}
	}
	if _, f, err := s.ApplyWithFeedback(Action{Kind: "cancel-play"}, now); err != nil || f != nil {
		t.Fatalf("cancel invented care: %+v %v", f, err)
	}
}

func TestEveryGameCareEffectMatchesOnlyItsSettlement(t *testing.T) {
	for _, kind := range []string{"tiles", "snake", "tetris", "fishing", "walk", "treasure"} {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			starts := map[string]string{"tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing", "walk": "play-walk", "treasure": "play-treasure"}
			if _, f, err := s.ApplyWithFeedback(Action{Kind: starts[kind]}, now); err != nil || f != nil {
				t.Fatalf("start invented receipt: %+v %v", f, err)
			}
			id := s.Game.ID
			var a Action
			switch kind {
			case "tiles":
				for s.Game.Tiles.Pairs < 7 {
					x, y := tilePair(t, &s, now)
					for _, cell := range []int{x, y} {
						if _, f, err := s.ApplyWithFeedback(Action{Kind: "tile-pick", GameID: id, Tile: cell}, now); err != nil || f != nil {
							t.Fatalf("unfinished tiles: %+v %v", f, err)
						}
					}
				}
				x, y := tilePair(t, &s, now)
				s.Apply(Action{Kind: "tile-pick", GameID: id, Tile: x}, now)
				a = Action{Kind: "tile-pick", GameID: id, Tile: y}
			case "snake":
				// Same terminal-board fixture used by existing settlement tests, not a
				// claim that this test has played all movement steps in a browser.
				s.Game.Snake.End = "wall"
				s.Game.Snake.Eaten = 3
				a = snakeAction(&s, "snake-finish")
			case "tetris":
				s.Game.Tetris.End = "stacked"
				s.Game.Tetris.Active = nil
				s.Game.Tetris.Lines = 2
				a = blockAction(&s, "tetris-finish")
			case "fishing":
				for i := 0; i < 3; i++ {
					bite(t, &s, &now)
					fishDo(t, &s, now, "fish-reel")
				}
				a = fishAction(&s, "fish-finish")
			case "treasure":
				// Traverse real map cells; no care effect until explicit collection.
				for !s.Game.AwaitingFinish() {
					kind, tile := "treasure-resume", 0
					if !s.Game.Treasure.Paused {
						kind, tile = "treasure-dig", len(s.Game.Treasure.Opened)
					}
					if _, f, err := s.ApplyWithFeedback(Action{Kind: kind, GameID: id, Step: s.Game.Treasure.Step, Tile: tile}, now); err != nil || f != nil {
						t.Fatalf("unfinished treasure: %+v %v", f, err)
					}
				}
				a = Action{Kind: "treasure-finish", GameID: id, Step: s.Game.Treasure.Step}
			case "walk":
				walkDo(t, &s, now, "walk-resume")
				walkBeats(t, &s, &now, 72, true)
				a = Action{Kind: "walk-finish", GameID: id, Step: s.Game.Walking.Step}
			}
			// Passive settlement is explicitly outside the receipt's before snapshot.
			s.Advance(now)
			before := s.Needs
			_, f, err := s.ApplyWithFeedback(a, now)
			if err != nil || f == nil || f.Effect == nil || s.Game != nil || f.Effect.Before != before || f.Effect.After != s.Needs || f.Effect.At != now.UnixMilli() {
				t.Fatalf("wrong %s effect: %+v %v", kind, f, err)
			}
			if _, f, err = s.ApplyWithFeedback(a, now); err == nil || f != nil {
				t.Fatal("duplicate finish produced receipt")
			}
		})
	}
}
