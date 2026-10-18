package store

import (
	"fmt"
	"reflect"
	"sync"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Independent clients use independent request IDs. The session boundary, not
// just a cached response, must prevent double settlement and old-board actions.
func TestGameSessionConcurrentFinishAndObsoleteCommands(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			s, now, r, prefix, step, coins := completedSessionFixture(t, kind)
			id := r.State.Game.ID
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
			r, err := s.Do(&game.Action{Kind: "play-" + kind}, nil, false, now)
			if err != nil {
				t.Fatal(err)
			}
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
