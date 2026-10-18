package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// completedSessionFixture uses validated snake/blocks fixtures and actual
// fishing/walking commands with simulated time. It never opens player data.
func completedSessionFixture(t *testing.T, kind string) (*Store, time.Time, Result, string, int, int) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "sessions.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	do := func(a game.Action) Result {
		t.Helper()
		r, err := s.Do(&a, nil, false, now)
		if err != nil {
			t.Fatal(a.Kind, err)
		}
		return r
	}
	do(game.Action{Kind: "hatch"})
	r := do(game.Action{Kind: "play-" + kind})
	id, prefix, step, coins := r.State.Game.ID, kind, 0, 3
	command := func(action string) {
		t.Helper()
		if kind == "fishing" {
			step = r.State.Game.Fishing.Step
		} else {
			step = r.State.Game.Walking.Step
		}
		r = do(game.Action{Kind: action, GameID: id, Step: step})
	}
	switch kind {
	case "snake":
		n := r.State.Game.Snake
		n.Eaten, n.Step, n.End = 3, 4, "wall"
		n.Body = []game.TilePoint{{X: 5, Y: 5}, {X: 4, Y: 5}, {X: 3, Y: 5}, {X: 2, Y: 5}, {X: 1, Y: 5}, {X: 0, Y: 5}}
		n.Food = game.TilePoint{X: 9, Y: 9}
		step = n.Step
	case "tetris":
		n := r.State.Game.Tetris
		n.Active, n.Lines, n.Pieces, n.Step, n.End = nil, 8, 16, 100, "won"
		step, coins = n.Step, 6
	case "fishing":
		prefix, coins = "fish", 6
		for cast := 0; cast < 3; cast++ {
			command("fish-cast")
			for r.State.Game.Fishing.Phase == "wait" {
				now = now.Add(time.Second)
				command("fish-step")
			}
			command("fish-reel")
		}
		step = r.State.Game.Fishing.Step
	case "walk":
		command("walk-resume")
		for r.State.Game.Walking.Beat < game.WalkLength {
			now = now.Add(time.Second)
			command("walk-step")
		}
		step = r.State.Game.Walking.Step
	}
	// Snake/blocks use validated terminal fixtures; fishing/walking reach
	// the terminal state through actual commands and simulated server time.
	if err := r.State.Validate(now); err != nil {
		t.Fatal(err)
	}
	if r.State.CareCount != 0 || r.State.Economy.Coins != 0 {
		t.Fatal("automatic settlement")
	}
	raw, err := json.Marshal(r.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	return s, now, r, prefix, step, coins
}
