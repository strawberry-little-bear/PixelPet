package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func snakeState(t *testing.T) (State, time.Time) {
	t.Helper()
	now := time.Now().Truncate(time.Millisecond)
	s := New(now)
	s.Apply(Action{Kind: "hatch", Species: 2}, now)
	if _, err := s.Apply(Action{Kind: "play-snake"}, now); err != nil {
		t.Fatal(err)
	}
	return s, now
}
func snakeAction(s *State, kind string) Action {
	return Action{Kind: kind, GameID: s.Game.ID, Step: s.Game.Snake.Step}
}
func TestSnakeClockTurnsAndSessionGuards(t *testing.T) {
	s, now := snakeState(t)
	if err := s.Validate(now); err != nil || !s.Game.Snake.Paused {
		t.Fatal(err)
	}
	for _, a := range []Action{{Kind: "snake-resume", GameID: "stale"}, {Kind: "feed"}, {Kind: "snake-finish", GameID: s.Game.ID}, {Kind: "snake-step", GameID: s.Game.ID}} {
		if _, err := s.Apply(a, now); err == nil {
			t.Fatal("accepted", a)
		}
	}
	s.Apply(snakeAction(&s, "snake-resume"), now)
	if _, err := s.Apply(snakeAction(&s, "snake-step"), now.Add(599*time.Millisecond)); err == nil {
		t.Fatal("too fast")
	}
	for _, turn := range []int{-2, 2} {
		a := snakeAction(&s, "snake-step")
		a.Turn = turn
		if _, err := s.Apply(a, now.Add(time.Second)); err == nil {
			t.Fatal("bad turn")
		}
	}
	a := snakeAction(&s, "snake-step")
	a.Turn = -1
	now = now.Add(650 * time.Millisecond)
	s.Advance(now)
	if _, err := s.Apply(a, now); err != nil {
		t.Fatal(err)
	}
	n := s.Game.Snake
	if n.Direction != 3 || n.Step != 1 || n.Body[0] != (TilePoint{4, 4}) {
		t.Fatal(n)
	}
	if _, err := s.Apply(a, now.Add(time.Second)); err == nil {
		t.Fatal("replayed step")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
}
func TestSnakeAwayPausesWithoutCatchup(t *testing.T) {
	s, now := snakeState(t)
	s.Apply(snakeAction(&s, "snake-resume"), now)
	body := append([]TilePoint{}, s.Game.Snake.Body...)
	now = now.Add(12 * time.Hour)
	s.Advance(now)
	if _, err := s.Apply(snakeAction(&s, "snake-step"), now); err != nil || !s.Game.Snake.Paused || s.Game.Snake.Step != 0 || !reflect.DeepEqual(body, s.Game.Snake.Body) {
		t.Fatal("away moved", err)
	}
	s.Apply(snakeAction(&s, "snake-resume"), now)
	if !s.ExpireSnake(now.Add(3*time.Second)) || s.ExpireSnake(now.Add(4*time.Second)) {
		t.Fatal("lease")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
}
func TestSnakeEatingTailWallsAndBody(t *testing.T) {
	for _, kind := range []string{"eat", "tail", "wall", "body"} {
		t.Run(kind, func(t *testing.T) {
			s, now := snakeState(t)
			n := s.Game.Snake
			n.Paused = false
			n.Food = TilePoint{9, 9}
			switch kind {
			case "eat":
				n.Food = TilePoint{5, 5}
			case "tail":
				n.Body = []TilePoint{{1, 1}, {1, 2}, {0, 2}, {0, 1}}
				n.Direction = 2
				n.Eaten = 1
				n.Step = 1
			case "wall":
				n.Body = []TilePoint{{11, 5}, {10, 5}, {9, 5}}
			case "body":
				n.Body = []TilePoint{{1, 1}, {2, 1}, {2, 2}, {1, 2}, {0, 2}}
				n.Eaten = 2
				n.Step = 2
			}
			now = now.Add(650 * time.Millisecond)
			s.Advance(now)
			_, err := s.Apply(snakeAction(&s, "snake-step"), now)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "eat" && (n.Eaten != 1 || len(n.Body) != 4 || n.Food == n.Body[0]) {
				t.Fatal(n)
			}
			if kind == "tail" && (n.End != "" || n.Body[0] != (TilePoint{0, 1})) {
				t.Fatal(n)
			}
			if (kind == "wall" || kind == "body") && n.End != kind {
				t.Fatal(n)
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestSnakeWinRewardCooldownDailyCapAndMemory(t *testing.T) {
	s, now := snakeState(t)
	n := s.Game.Snake
	n.Body = nil
	for x := 10; x >= 1; x-- {
		n.Body = append(n.Body, TilePoint{x, 5})
	}
	n.Eaten = 7
	n.Step = 7
	n.Food = TilePoint{11, 5}
	n.Paused = false
	now = now.Add(650 * time.Millisecond)
	s.Advance(now)
	if _, err := s.Apply(snakeAction(&s, "snake-step"), now); err != nil || n.End != "won" || n.Eaten != 8 {
		t.Fatal(err, n)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	finish := snakeAction(&s, "snake-finish")
	_, f, err := s.ApplyWithFeedback(finish, now)
	if err != nil || f == nil || f.Habit != "play" || f.HabitGain <= 0 || s.Economy.Coins != 6 || s.CareCount != 1 {
		t.Fatal(f, err, s)
	}
	if _, err = s.Apply(finish, now); err == nil {
		t.Fatal("paid twice")
	}
	// New completed rounds share the stars/tiles cap, without bypassing play cooldown.
	for i := 0; i < 7; i++ {
		s.Apply(Action{Kind: "play-snake"}, now)
		n = s.Game.Snake
		n.Eaten = 3
		n.Step = 4
		n.End = "wall"
		n.Body = []TilePoint{{5, 5}, {4, 5}, {3, 5}, {2, 5}, {1, 5}, {0, 5}}
		n.Food = TilePoint{9, 9}
		_, f, err = s.ApplyWithFeedback(snakeAction(&s, "snake-finish"), now)
		if err != nil || f.Reason != "cooldown" {
			t.Fatal(err, f)
		}
	}
	if s.Economy.Coins != 27 || s.rewardStars(5, now) != 3 || s.rewardGame(TileCoins, now) != 0 {
		t.Fatal(s.Economy)
	}
	memories := 0
	for _, m := range s.Album.Entries {
		if m.Kind == "snake" {
			memories++
		}
	}
	if memories != 1 {
		t.Fatal("memory replay")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
}
func TestSnakeNoRewardForShortRoundOrCancel(t *testing.T) {
	for _, kind := range []string{"snake-finish", "cancel-play"} {
		s, now := snakeState(t)
		n := s.Game.Snake
		n.End = "wall"
		_, f, err := s.ApplyWithFeedback(snakeAction(&s, kind), now)
		if err != nil || f != nil || s.CareCount != 0 || s.Economy.Coins != 0 || len(s.Album.Entries) != 1 {
			t.Fatal(kind, err, f)
		}
	}
}
func TestSnakeValidationAndSchemaFivePreservation(t *testing.T) {
	s, now := snakeState(t)
	for _, mutate := range []func(*State){
		func(s *State) { s.Schema = 5 }, func(s *State) { s.Game.Snake = nil }, func(s *State) { s.Game.Kind = "tiles" },
		func(s *State) { s.Game.Snake.Direction = 4 }, func(s *State) { s.Game.Snake.Step = -1 }, func(s *State) { s.Game.Snake.Eaten = 9 },
		func(s *State) { s.Game.Snake.Body[1] = s.Game.Snake.Body[0] }, func(s *State) { s.Game.Snake.Body[1] = TilePoint{10, 10} },
		func(s *State) { s.Game.Snake.Food = s.Game.Snake.Body[0] }, func(s *State) { s.Game.Snake.End = "won" },
		func(s *State) { s.Game.Snake.End = "cheat" }, func(s *State) { s.Game.Snake.LastMoveAt++ }, func(s *State) { s.Sleeping = true },
	} {
		raw, _ := json.Marshal(s)
		var bad State
		json.Unmarshal(raw, &bad)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("invalid accepted", bad.Game)
		}
	}
	s.Game = nil
	s.Schema = 5
	raw, _ := json.Marshal(s)
	if !s.Upgrade(now) || s.Schema != 6 {
		t.Fatal("upgrade")
	}
	s.Schema = 5
	after, _ := json.Marshal(s)
	if string(raw) != string(after) {
		t.Fatal("upgrade modified player data")
	}
}
