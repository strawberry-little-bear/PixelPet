package store

import (
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestCareEffectExcludesElapsedTimeAndSurvivesIdempotentReplay(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "effect.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond)
	born := now.Add(-2 * time.Hour)
	initial := game.New(born)
	initial.Apply(game.Action{Kind: "hatch", Species: 2}, born)
	initial.Needs = game.Needs{Hunger: 60, Mood: 98, Clean: 2, Energy: 90}
	body, _ := json.Marshal(initial)
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	a := &game.Action{Kind: "feed", RequestID: "effect-once"}
	first, err := s.Do(a, nil, false, now)
	if err != nil || first.CareFeedback == nil || first.CareFeedback.Effect == nil {
		t.Fatalf("no effect: %+v %v", first.CareFeedback, err)
	}
	e := first.CareFeedback.Effect
	wantBefore := game.Needs{Hunger: 54, Mood: 93, Clean: 0, Energy: 86}
	wantAfter := game.Needs{Hunger: 74, Mood: 96, Clean: 0, Energy: 86}
	if e.At != now.UnixMilli() || e.Before != wantBefore || e.After != wantAfter || first.CareFeedback.Points != .25 {
		t.Fatalf("elapsed time attributed to action: %+v", first.CareFeedback)
	}
	// A later duplicate uses the original receipt time even though ServerTime
	// describes this replay. It must not replay care or manufacture a new effect.
	replay, err := s.Do(a, nil, false, now.Add(time.Hour))
	if err != nil || replay.CareFeedback == nil || replay.CareFeedback.Effect == nil || *replay.CareFeedback.Effect != *e {
		t.Fatalf("replay changed receipt: %+v %v", replay.CareFeedback, err)
	}
	read, err := s.Do(nil, nil, false, now.Add(time.Hour))
	if err != nil || read.State.CareCount != 1 || read.CareFeedback != nil || math.Abs(read.State.Needs.Hunger-71) > 1e-9 {
		t.Fatalf("care replayed on read: %+v %v", read, err)
	}
	var saved string
	if err = s.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&saved); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(saved, "\"effect\"") || read.State.Schema != 11 {
		t.Fatal("response receipt leaked into portable save/schema")
	}
}

func TestOlderCachedCareAcknowledgementDoesNotInventEffect(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "old-receipt.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond)
	if _, err = s.Do(&game.Action{Kind: "hatch", Species: 2, RequestID: "hatch"}, nil, false, now); err != nil {
		t.Fatal(err)
	}
	a := &game.Action{Kind: "feed", RequestID: "old-feed"}
	first, err := s.Do(a, nil, false, now)
	if err != nil || first.CareFeedback == nil {
		t.Fatal(err)
	}
	// Emulate a request cache written before this optional response field existed.
	first.CareFeedback.Effect = nil
	old, _ := json.Marshal(first)
	if _, err = s.db.Exec("UPDATE requests SET body=? WHERE id=?", string(old), a.RequestID); err != nil {
		t.Fatal(err)
	}
	replay, err := s.Do(a, nil, false, now.Add(time.Second))
	if err != nil || replay.CareFeedback == nil || replay.CareFeedback.Effect != nil || replay.State.CareCount != 1 {
		t.Fatalf("old receipt fabricated or care replayed: %+v %v", replay, err)
	}
}
