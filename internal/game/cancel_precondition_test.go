package game

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestAwaitingFinishMatchesExplicitCollectionGames(t *testing.T) {
	for _, tc := range []struct {
		name string
		game *MiniGame
		want bool
	}{
		{"none", nil, false}, {"stars", &MiniGame{}, false}, {"tiles", &MiniGame{Kind: "tiles"}, false},
		{"snake-missing", &MiniGame{Kind: "snake"}, false}, {"snake-playing", &MiniGame{Kind: "snake", Snake: &Snake{}}, false},
		{"snake-ended", &MiniGame{Kind: "snake", Snake: &Snake{End: "wall"}}, true},
		{"tetris-missing", &MiniGame{Kind: "tetris"}, false}, {"tetris-playing", &MiniGame{Kind: "tetris", Tetris: &Tetris{}}, false},
		{"tetris-ended", &MiniGame{Kind: "tetris", Tetris: &Tetris{End: "won"}}, true},
		{"fishing-missing", &MiniGame{Kind: "fishing"}, false}, {"fishing-result", &MiniGame{Kind: "fishing", Fishing: &Fishing{Phase: "result"}}, false},
		{"fishing-done", &MiniGame{Kind: "fishing", Fishing: &Fishing{Phase: "done"}}, true},
		{"walk-missing", &MiniGame{Kind: "walk"}, false}, {"walk-playing", &MiniGame{Kind: "walk", Walking: &Walking{Beat: 71}}, false},
		{"walk-done", &MiniGame{Kind: "walk", Walking: &Walking{Beat: WalkLength}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.game.AwaitingFinish(); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestGuardedDiscardDoesNotChangeTerminalState(t *testing.T) {
	now := time.Now()
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch"}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(Action{Kind: "play-snake"}, now); err != nil {
		t.Fatal(err)
	}
	s.Game.Snake.End = "wall"
	before, err := json.Marshal(s.Game)
	if err != nil {
		t.Fatal(err)
	}
	a := Action{Kind: "cancel-play", GameID: s.Game.ID, RequireUnfinished: true}
	_, feedback, err := s.ApplyWithFeedback(a, now)
	after, marshalErr := json.Marshal(s.Game)
	if !errors.Is(err, ErrGameFinished) || feedback != nil || s.Game == nil || marshalErr != nil || string(after) != string(before) || s.CareCount != 0 || s.Economy.Coins != 0 {
		t.Fatal("guard changed terminal state", err, feedback)
	}
	// Stale session protection must still win over the optional same-ID guard.
	a.GameID = "old-session"
	if _, err := s.Apply(a, now); err == nil || errors.Is(err, ErrGameFinished) {
		t.Fatal("lost game ID boundary", err)
	}
}
