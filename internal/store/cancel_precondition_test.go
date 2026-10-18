package store

import (
	"errors"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Transport populates the optional precondition; it is not part of a save or
// the portable action JSON. Old clients leave it false.
func unfinishedCancel(t *testing.T, id, requestID string) game.Action {
	t.Helper()
	return game.Action{Kind: "cancel-play", GameID: id, RequestID: requestID, RequireUnfinished: true}
}

func TestUnfinishedCancelCannotDiscardAnotherPagesTerminalResult(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			s, now, r, prefix, step, coins := completedSessionFixture(t, kind)
			before := generationDump(t, s)
			a := unfinishedCancel(t, r.State.Game.ID, "stale-cancel")
			refused, err := s.DoForGeneration(&a, nil, false, now.Add(time.Hour), r.SaveGeneration)
			if err == nil {
				t.Fatal("old unfinished-game confirmation discarded terminal result")
			}
			if !errors.Is(err, game.ErrGameFinished) || refused.SaveGeneration != r.SaveGeneration {
				t.Fatal("not a terminal conflict", err)
			}
			if after := generationDump(t, s); after != before {
				t.Fatal("rejected cancel changed database, time or request cache")
			}
			finish := &game.Action{Kind: prefix + "-finish", GameID: r.State.Game.ID, Step: step, RequestID: "explicit-finish"}
			latest, err := s.DoForGeneration(finish, nil, false, now, r.SaveGeneration)
			if err != nil || latest.State.Game != nil || latest.State.CareCount != 1 || latest.State.Economy.Coins != coins {
				t.Fatal("could not explicitly collect result", err, latest)
			}
		})
	}
}

func TestUnfinishedCancelPreservesOldClientRules(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			s, now, r, _, _, _ := completedSessionFixture(t, kind)
			// An absent transport precondition keeps the old client's deliberate discard behavior.
			a := game.Action{Kind: "cancel-play", GameID: r.State.Game.ID, RequestID: "legacy-cancel"}
			latest, err := s.Do(&a, nil, false, now)
			if err != nil || latest.State.Game != nil || latest.State.CareCount != 0 || latest.State.Economy.Coins != 0 {
				t.Fatal("legacy cancellation changed", err, latest)
			}
		})
	}
}

func TestUnfinishedCancelStillDiscardsUnfinishedGames(t *testing.T) {
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk"} {
		t.Run(start, func(t *testing.T) {
			s, now := generationDB(t)
			if _, err := s.Do(&game.Action{Kind: "hatch"}, nil, false, now); err != nil {
				t.Fatal(err)
			}
			r, err := s.Do(&game.Action{Kind: start}, nil, false, now)
			if err != nil {
				t.Fatal(err)
			}
			a := unfinishedCancel(t, r.State.Game.ID, "unfinished-cancel")
			latest, err := s.DoForGeneration(&a, nil, false, now, r.SaveGeneration)
			if err != nil || latest.State.Game != nil || latest.State.CareCount != 0 || latest.State.Economy.Coins != 0 {
				t.Fatal("unfinished discard failed", err, latest)
			}
			before := generationDump(t, s)
			if _, err := s.DoForGeneration(&a, nil, false, now, r.SaveGeneration); err != nil {
				t.Fatal(err)
			}
			if generationDump(t, s) != before {
				t.Fatal("cached cancel mutated save")
			}
		})
	}
}
