package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Independent clients use independent request IDs. The session boundary, not
// just a cached response, must prevent double settlement and old-board actions.
func TestGameSessionConcurrentFinishAndObsoleteCommands(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			s, err := Open(filepath.Join(t.TempDir(), "sessions.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
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
			generation := r.SaveGeneration
			type outcome struct {
				result Result
				err    error
				action game.Action
			}
			outcomes := make(chan outcome, 8)
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					a := game.Action{Kind: prefix + "-finish", GameID: id, Step: step, RequestID: fmt.Sprintf("client-%d", i)}
					v, err := s.DoForGeneration(&a, nil, false, now, generation)
					outcomes <- outcome{v, err, a}
				}(i)
			}
			wg.Wait()
			close(outcomes)
			successes := 0
			var winner game.Action
			for outcome := range outcomes {
				if outcome.err != nil {
					continue
				}
				successes++
				winner = outcome.action
				v := outcome.result
				if v.State.Game != nil || v.State.CareCount != 1 || v.State.Economy.Coins != coins || v.CareFeedback == nil {
					t.Fatal("incorrect settlement", v)
				}
			}
			if successes != 1 {
				t.Fatalf("settled %d times", successes)
			}
			r = do(game.Action{Kind: "play-" + kind})
			if r.SaveGeneration != generation {
				t.Fatal("ordinary game changed save generation")
			}
			current := r.State
			if current.Game.ID == id {
				t.Fatal("reused session ID")
			}
			for _, action := range []string{prefix + "-finish", prefix + "-resume", prefix + "-step", "cancel-play"} {
				a := game.Action{Kind: action, GameID: id, Step: step, RequestID: "obsolete-" + action}
				if _, err := s.DoForGeneration(&a, nil, false, now, generation); err == nil {
					t.Fatal("obsolete command accepted", action)
				}
			}
			// A cached acknowledgement is allowed, but cannot mutate the new game.
			if _, err := s.DoForGeneration(&winner, nil, false, now, generation); err != nil {
				t.Fatal(err)
			}
			latest, err := s.Do(nil, nil, false, now)
			if err != nil || !reflect.DeepEqual(latest.State, current) {
				t.Fatal("obsolete command changed new game", err)
			}
			if err := latest.State.Validate(now); err != nil {
				t.Fatal(err)
			}
		})
	}
}
