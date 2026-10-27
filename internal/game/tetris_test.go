package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func blocksState(t *testing.T) (State, time.Time) {
	t.Helper()
	now := time.Now().Truncate(time.Millisecond)
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch", Species: 9}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(Action{Kind: "play-tetris"}, now); err != nil {
		t.Fatal(err)
	}
	return s, now
}
func blockAction(s *State, kind string) Action {
	return Action{Kind: kind, GameID: s.Game.ID, Step: s.Game.Tetris.Step}
}
func doBlock(t *testing.T, s *State, kind string, now time.Time) {
	t.Helper()
	s.Advance(now)
	if _, err := s.Apply(blockAction(s, kind), now); err != nil {
		t.Fatal(kind, err)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal("invalid after", kind, err, s.Game.Tetris)
	}
}
func TestTetrisShapesAndBag(t *testing.T) {
	for kind := 1; kind <= 7; kind++ {
		for r := 0; r < 4; r++ {
			seen := map[TilePoint]bool{}
			mx, my := 4, 4
			for _, p := range TetrisCells(kind, r) {
				if p.X < 0 || p.X > 3 || p.Y < 0 || p.Y > 3 || seen[p] {
					t.Fatal(kind, r, p)
				}
				seen[p] = true
				mx = min(mx, p.X)
				my = min(my, p.Y)
			}
			if mx != 0 || my != 0 {
				t.Fatal("unnormalized", kind, r)
			}
		}
		if TetrisCells(kind, 0) != TetrisCells(kind, 4) {
			t.Fatal("rotation cycle")
		}
	}
	n := &Tetris{}
	for bag := 0; bag < 100; bag++ {
		seen := map[int]bool{}
		for i := 0; i < 7; i++ {
			k, e := n.draw()
			if e != nil || k < 1 || k > 7 || seen[k] {
				t.Fatal(k, e)
			}
			seen[k] = true
		}
	}
}
func TestTetrisGravityPauseLeaseAndVersion(t *testing.T) {
	if TetrisInterval != 1800 {
		t.Fatalf("beginner gravity interval = %dms, want 1800ms", TetrisInterval)
	}
	s, now := blocksState(t)
	n := s.Game.Tetris
	if !n.Paused || n.Active.Y != 0 {
		t.Fatal(n)
	}
	if _, err := s.Apply(blockAction(&s, "tetris-step"), now); err == nil {
		t.Fatal("paused moved")
	}
	doBlock(t, &s, "tetris-resume", now)
	if _, err := s.Apply(blockAction(&s, "tetris-step"), now.Add(time.Duration(TetrisInterval-1)*time.Millisecond)); err == nil {
		t.Fatal("fast gravity")
	}
	// Rapid movement must not postpone gravity, and obsolete commands fail.
	old := blockAction(&s, "tetris-move")
	old.Turn = -1
	s.Apply(old, now.Add(200*time.Millisecond))
	if n.LastFallAt != now.UnixMilli() {
		t.Fatal("movement reset gravity")
	}
	if _, err := s.Apply(old, now); err == nil {
		t.Fatal("stale accepted")
	}
	now = now.Add(time.Duration(TetrisInterval) * time.Millisecond)
	doBlock(t, &s, "tetris-step", now)
	if n.Active.Y != 1 {
		t.Fatal("no gravity")
	}
	doBlock(t, &s, "tetris-pause", now)
	before := *n.Active
	now = now.Add(time.Hour)
	s.Advance(now)
	if s.ExpireTetris(now) || !reflect.DeepEqual(before, *n.Active) {
		t.Fatal("pause catchup")
	}
	doBlock(t, &s, "tetris-resume", now)
	now = now.Add(time.Hour)
	doBlock(t, &s, "tetris-step", now)
	if !n.Paused || *n.Active != before {
		t.Fatal("late pulse moved")
	}
	doBlock(t, &s, "tetris-resume", now)
	now = now.Add(4 * time.Second)
	s.Advance(now)
	if !s.ExpireTetris(now) || !n.Paused || *n.Active != before {
		t.Fatal("read catchup")
	}
	if s.Validate(now) != nil {
		t.Fatal("expired invalid")
	}
}
func TestTetrisWallKickAndHardDrop(t *testing.T) {
	s, now := blocksState(t)
	n := s.Game.Tetris
	n.Active = &Falling{Kind: 1, Rotation: 1, X: 7, Y: 3}
	doBlock(t, &s, "tetris-rotate", now)
	if n.Active.Rotation != 1 || n.Active.X != 7 {
		t.Fatal("impossible kick moved piece", n.Active)
	}
	doBlock(t, &s, "tetris-pause", now)
	n.Active.X = 6
	doBlock(t, &s, "tetris-rotate", now)
	if n.Active.Rotation != 2 || n.Active.X != 4 {
		t.Fatal("wall kick", n.Active)
	}
	doBlock(t, &s, "tetris-pause", now)
	doBlock(t, &s, "tetris-drop", now)
	if n.Pieces != 1 || n.Active.Y != 0 || n.Paused {
		t.Fatal(n)
	}
	count := 0
	for _, v := range n.Board {
		if v > 0 {
			count++
		}
	}
	if count != 4 {
		t.Fatal(count)
	}
	if _, err := s.Apply(blockAction(&s, "tetris-drop"), now); err == nil {
		t.Fatal("drop outside menu")
	}
}

// A legal deterministic stack: two separated I gaps per pair of rows. A
// vertical I fills four rows, testing simultaneous clears and win overshoot.
func prepareFourRows(n *Tetris, priorLines int) {
	n.Board = make([]int, 96)
	for y := 8; y < 12; y++ {
		for x := 0; x < 8; x++ {
			if x != 3 {
				n.Board[y*8+x] = 2
			}
		}
	}
	n.Lines = priorLines
	n.Pieces = 7 + priorLines*2
	n.Step = 100
	n.Active = &Falling{Kind: 1, Rotation: 1, X: 3, Y: 0}
	n.Paused = true
}
func TestTetrisClearRewardMemoryAndLimits(t *testing.T) {
	for _, prior := range []int{0, 4, 7} {
		s, now := blocksState(t)
		n := s.Game.Tetris
		prepareFourRows(n, prior)
		if s.Validate(now) != nil {
			t.Fatal("fixture invalid")
		}
		doBlock(t, &s, "tetris-drop", now)
		if n.Lines != prior+4 {
			t.Fatal(n.Lines)
		}
		for _, v := range n.Board {
			if v != 0 {
				t.Fatal("uncleared")
			}
		}
		if prior == 0 {
			if n.End != "" {
				t.Fatal(n.End)
			}
			continue
		}
		if n.End != "won" || n.Active != nil {
			t.Fatal(n.End)
		}
		_, feedback, err := s.ApplyWithFeedback(blockAction(&s, "tetris-finish"), now)
		if err != nil || feedback == nil || feedback.Habit != "play" || s.Game != nil || s.CareCount != 1 || s.Economy.Coins != 6 || s.Growth.Care.Play != 1 {
			t.Fatal(err, feedback, s)
		}
		found := 0
		for _, m := range s.Album.Entries {
			if m.Kind == "tetris" {
				found++
			}
		}
		if found != 1 || s.Validate(now) != nil {
			t.Fatal("memory or invalid")
		}
		if _, err = s.Apply(Action{Kind: "tetris-finish"}, now); err == nil {
			t.Fatal("double finish")
		}
	}
	for _, coins := range []int{28, 30} {
		s, now := blocksState(t)
		n := s.Game.Tetris
		prepareFourRows(n, 4)
		s.Economy.LastGameAt = now.UnixMilli()
		s.Economy.GameCoins = coins
		doBlock(t, &s, "tetris-drop", now)
		doBlock(t, &s, "tetris-finish", now)
		if s.Economy.Coins != 30-coins || s.CareCount != 1 {
			t.Fatal(s.Economy)
		}
	}
}
func TestTetrisStackAndNoFreeReward(t *testing.T) {
	s, now := blocksState(t)
	n := s.Game.Tetris
	// Put a single O at spawn, then lock a second O at the right edge.
	n.Board[2] = 2
	n.Board[3] = 2
	n.Board[10] = 2
	n.Board[11] = 2
	n.Pieces = 1
	n.Step = 1
	n.Next = 2
	n.Active = &Falling{Kind: 2, X: 6}
	doBlock(t, &s, "tetris-drop", now)
	if n.End != "stacked" || s.Validate(now) != nil {
		t.Fatal(n)
	}
	_, f, e := s.ApplyWithFeedback(blockAction(&s, "tetris-finish"), now)
	if e != nil || f != nil || s.Economy.Coins != 0 || s.CareCount != 0 {
		t.Fatal(e, f)
	}
	s, now = blocksState(t)
	prepareFourRows(s.Game.Tetris, 0)
	doBlock(t, &s, "tetris-drop", now)
	doBlock(t, &s, "cancel-play", now)
	if s.Economy.Coins != 0 || s.CareCount != 0 || len(s.Album.Entries) != 1 {
		t.Fatal("cancel paid")
	}
}
func TestTetrisStepLimitAndValidation(t *testing.T) {
	s, now := blocksState(t)
	for _, mutate := range []func(*State){
		func(s *State) { s.Schema = 6 }, func(s *State) { s.Game.Tetris = nil }, func(s *State) { s.Game.Kind = "snake" },
		func(s *State) { s.Game.Tetris.Board = nil }, func(s *State) { s.Game.Tetris.Board[0] = 8 }, func(s *State) { s.Game.Tetris.Board[0] = 1 },
		func(s *State) { s.Game.Tetris.Active.X = -1 }, func(s *State) { s.Game.Tetris.Active.Y = 12 }, func(s *State) { s.Game.Tetris.Active.Kind = 0 }, func(s *State) { s.Game.Tetris.Active.Rotation = 4 },
		func(s *State) { s.Game.Tetris.Next = 8 }, func(s *State) { s.Game.Tetris.Bag = []int{1, 1} }, func(s *State) { s.Game.Tetris.Lines = 8 },
		func(s *State) { s.Game.Tetris.Pieces = -1 }, func(s *State) { s.Game.Tetris.End = "won" }, func(s *State) { s.Game.Tetris.End = "stacked"; s.Game.Tetris.Active = nil },
		func(s *State) { s.Game.Tetris.End = "limit"; s.Game.Tetris.Active = nil }, func(s *State) { s.Game.Tetris.Step = -1 }, func(s *State) { s.Game.Tetris.LastFallAt++ }, func(s *State) { s.Sleeping = true },
	} {
		raw, _ := json.Marshal(s)
		var bad State
		json.Unmarshal(raw, &bad)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("invalid accepted", bad.Game)
		}
	}
	n := s.Game.Tetris
	n.Step = tetrisStepLimit - 1
	doBlock(t, &s, "tetris-resume", now)
	if n.End != "limit" || n.Active != nil {
		t.Fatal("step limit")
	}
}
func TestTetrisThousandsOfLegalTransitions(t *testing.T) {
	for trial := 0; trial < 100; trial++ {
		s, now := blocksState(t)
		n := s.Game.Tetris
		for n.End == "" {
			if !n.Paused {
				doBlock(t, &s, "tetris-pause", now)
			}
			if n.Pieces%3 == 0 {
				doBlock(t, &s, "tetris-rotate", now)
				doBlock(t, &s, "tetris-pause", now)
			}
			doBlock(t, &s, "tetris-resume", now)
			for k := 0; k < n.Pieces%5; k++ {
				a := blockAction(&s, "tetris-move")
				a.Turn = 1
				if _, e := s.Apply(a, now); e != nil {
					t.Fatal(e)
				}
			}
			doBlock(t, &s, "tetris-pause", now)
			doBlock(t, &s, "tetris-drop", now)
		}
	}
}

func TestTetrisPartialStackRewardAndCareGuards(t *testing.T) {
	s, now := blocksState(t)
	n := s.Game.Tetris
	prepareFourRows(n, 0)
	doBlock(t, &s, "tetris-drop", now)
	n.Board[2] = 2
	n.Board[3] = 2
	n.Board[10] = 2
	n.Board[11] = 2
	n.Pieces++
	n.Step++
	n.Next = 2
	n.Active = &Falling{Kind: 2, X: 6}
	n.Paused = true
	doBlock(t, &s, "tetris-drop", now)
	if n.End != "stacked" || n.Lines != 4 {
		t.Fatal(n)
	}
	doBlock(t, &s, "tetris-finish", now)
	if s.Economy.Coins != 4 || s.CareCount != 1 {
		t.Fatal(s.Economy)
	}
	s, now = blocksState(t)
	for _, a := range []Action{{Kind: "feed"}, {Kind: "sleep"}, {Kind: "daily"}, {Kind: "play"}, {Kind: "play-tiles"}, {Kind: "play-snake"}, {Kind: "play-tetris"}, {Kind: "tile-pick", GameID: s.Game.ID}, {Kind: "snake-resume", GameID: s.Game.ID}, {Kind: "catch", GameID: s.Game.ID}, {Kind: "tetris-move", GameID: "stale", Turn: 1}} {
		if _, err := s.Apply(a, now); err == nil {
			t.Fatal("accepted incompatible action", a)
		}
	}
	s.Game = nil
	s.Sleeping = true
	if _, err := s.Apply(Action{Kind: "play-tetris"}, now); err == nil || !s.Sleeping {
		t.Fatal("sleep interrupted")
	}
	s.Sleeping = false
	s.Needs.Energy = 9
	if _, err := s.Apply(Action{Kind: "play-tetris"}, now); err == nil {
		t.Fatal("tired pet forced to play")
	}
}
