package store

import (
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// The browser can start its acknowledgement before another client opens a
// game, but reach the transaction afterwards. Its reply must contain that
// current game, retain the pending recap and award nothing.
func TestReturnAcknowledgementObservesNewGames(t *testing.T) {
	for _, kind := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk"} {
		t.Run(kind, func(t *testing.T) {
			s, now := recapStore(t)
			now = now.Add(time.Hour)
			visit, err := s.Visit(now)
			if err != nil || visit.ReturnRecap == nil || !visit.RecapPending {
				t.Fatal("missing pending recap", err)
			}
			id, generation := visit.ReturnRecap.ID, visit.SaveGeneration
			started, err := s.DoForGeneration(&game.Action{Kind: kind, RequestID: "new-game"}, nil, false, now, generation)
			if err != nil || started.State.Game == nil {
				t.Fatal("failed to start", err)
			}
			before := generationDump(t, s)
			type outcome struct {
				result Result
				err    error
			}
			readAll := func() []outcome {
				out := make(chan outcome, 8)
				var wg sync.WaitGroup
				for i := 0; i < 8; i++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						r, err := s.ReadRecapForGeneration(id, now, generation)
						out <- outcome{r, err}
					}()
				}
				wg.Wait()
				close(out)
				var all []outcome
				for r := range out {
					all = append(all, r)
				}
				return all
			}
			for _, out := range readAll() {
				r := out.result
				if out.err != nil || r.RecapClaimed || !r.RecapPending || r.ReturnRecap == nil || r.ReturnRecap.ID != id || r.SaveGeneration != generation || !reflect.DeepEqual(r.State, started.State) {
					t.Fatal("ack hid game/consumed recap/changed state", out.err)
				}
				if err := r.State.Validate(now); err != nil {
					t.Fatal(err)
				}
			}
			if generationDump(t, s) != before {
				t.Fatal("guarded acknowledgements changed business tables")
			}
			// A real cancel explicitly ends the unfinished game, without a play
			// reward; only then may exactly one client claim the original notice.
			canceled, err := s.DoForGeneration(&game.Action{Kind: "cancel-play", GameID: started.State.Game.ID, RequestID: "cancel", RequireUnfinished: true}, nil, false, now, generation)
			if err != nil || canceled.State.Game != nil || canceled.State.CareCount != started.State.CareCount || canceled.State.Economy.Coins != started.State.Economy.Coins {
				t.Fatal("cancel changed rewards", err)
			}
			claimed := 0
			for _, out := range readAll() {
				if out.err != nil || out.result.RecapPending || !reflect.DeepEqual(out.result.State, canceled.State) {
					t.Fatal("bad post-cancel acknowledgement", out.err)
				}
				if out.result.RecapClaimed {
					claimed++
				}
			}
			if claimed != 1 {
				t.Fatalf("claimed %d times", claimed)
			}
		})
	}
}
