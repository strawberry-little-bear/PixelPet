package store

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestStaleSleepIntentRollsBackAllTables(t *testing.T) {
	for _, sleeping := range []bool{false, true} {
		t.Run(fmt.Sprint(sleeping), func(t *testing.T) {
			s, now := recapStore(t)
			if sleeping {
				if _, err := s.Do(&game.Action{Kind: "sleep"}, nil, false, now); err != nil {
					t.Fatal(err)
				}
			}
			before := generationDump(t, s)
			expected := !sleeping
			_, err := s.Do(&game.Action{Kind: "sleep", RequestID: "stale", ExpectedSleeping: &expected}, nil, false, now.Add(time.Hour))
			if !errors.Is(err, game.ErrSleepChanged) || generationDump(t, s) != before {
				t.Fatal("refusal changed save, time, presence, recap, or request cache", err)
			}
			// Refusal did not reserve the ID. An explicit new selection can succeed.
			expected = sleeping
			r, err := s.Do(&game.Action{Kind: "sleep", RequestID: "stale", ExpectedSleeping: &expected}, nil, false, now)
			if err != nil || r.State.Sleeping == sleeping {
				t.Fatal("new selection failed", err)
			}
		})
	}
}

func TestConcurrentSleepIntentsNeverReverseAnotherPagesCare(t *testing.T) {
	for _, sleeping := range []bool{false, true} {
		t.Run(fmt.Sprint(sleeping), func(t *testing.T) {
			s, now := recapStore(t)
			if sleeping {
				if _, err := s.Do(&game.Action{Kind: "sleep"}, nil, false, now); err != nil {
					t.Fatal(err)
				}
			}
			errs := make(chan error, 8)
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					_, err := s.Do(&game.Action{Kind: "sleep", RequestID: fmt.Sprint("intent-", i), ExpectedSleeping: &sleeping}, nil, false, now)
					errs <- err
				}(i)
			}
			wg.Wait()
			close(errs)
			successes := 0
			for err := range errs {
				if err == nil {
					successes++
				} else if !errors.Is(err, game.ErrSleepChanged) {
					t.Fatal(err)
				}
			}
			r, err := s.Do(nil, nil, false, now)
			if err != nil || successes != 1 || r.State.Sleeping == sleeping {
				t.Fatal("concurrent stale intents toggled sleep back", successes, err)
			}
		})
	}
}

func TestSleepIntentIdempotentReplayDoesNotReapplyAfterLaterWake(t *testing.T) {
	s, now := recapStore(t)
	awake := false
	sleeping := true
	a := &game.Action{Kind: "sleep", RequestID: "bedtime", ExpectedSleeping: &awake}
	first, err := s.Do(a, nil, false, now)
	if err != nil || !first.State.Sleeping {
		t.Fatal(err)
	}
	wake, err := s.Do(&game.Action{Kind: "sleep", RequestID: "wake", ExpectedSleeping: &sleeping}, nil, false, now)
	if err != nil || wake.State.Sleeping {
		t.Fatal(err)
	}
	before := generationDump(t, s)
	replay, err := s.Do(a, nil, false, now)
	if err != nil || !replay.State.Sleeping || replay.State.Revision != first.State.Revision || generationDump(t, s) != before {
		t.Fatal("cached acknowledgement changed current care", err)
	}
	current, err := s.Do(nil, nil, false, now)
	if err != nil || current.State.Sleeping {
		t.Fatal("replay put pet back to sleep", err)
	}
}
