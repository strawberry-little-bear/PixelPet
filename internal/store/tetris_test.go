package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestTetrisPersistConcurrencyAndNoOfflineGravity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "blocks.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	s.Do(&game.Action{Kind: "hatch"}, nil, false, now)
	r, e := s.Do(&game.Action{Kind: "play-tetris"}, nil, false, now)
	if e != nil {
		t.Fatal(e)
	}
	id := r.State.Game.ID
	r, e = s.Do(&game.Action{Kind: "tetris-resume", GameID: id, Step: 0}, nil, false, now)
	if e != nil {
		t.Fatal(e)
	}
	now = now.Add(time.Duration(game.TetrisInterval+50) * time.Millisecond)
	a := &game.Action{Kind: "tetris-step", GameID: id, Step: 1, RequestID: "same-pulse"}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Do(a, nil, false, now)
			if e != nil || r.State.Game.Tetris.Step != 2 || r.State.Game.Tetris.Active.Y != 1 {
				t.Error(e, r)
			}
		}()
	}
	wg.Wait()
	if _, e = s.Do(&game.Action{Kind: "tetris-move", GameID: id, Step: 1, Turn: -1}, nil, false, now); e == nil {
		t.Fatal("stale version accepted")
	}
	if _, e = s.Do(&game.Action{Kind: "tetris-move", GameID: "old", Step: 2, Turn: -1}, nil, false, now); e == nil {
		t.Fatal("old game accepted")
	}
	s.Close()
	s, e = Open(path)
	if e != nil {
		t.Fatal(e)
	}
	now = now.Add(time.Hour)
	r, e = s.Do(nil, nil, false, now)
	if e != nil || !r.State.Game.Tetris.Paused || r.State.Game.Tetris.Active.Y != 1 || r.State.Game.Tetris.Step != 3 {
		t.Fatal("offline movement", e, r)
	}
	a = &game.Action{Kind: "tetris-resume", GameID: id, Step: 3}
	r, e = s.Do(a, nil, false, now)
	if e != nil {
		t.Fatal(e)
	}
	now = now.Add(time.Hour)
	r, e = s.Do(&game.Action{Kind: "tetris-step", GameID: id, Step: 4}, nil, false, now)
	if e != nil || !r.State.Game.Tetris.Paused || r.State.Game.Tetris.Active.Y != 1 {
		t.Fatal("late pulse moved", e, r)
	}
	r, e = s.Do(&game.Action{Kind: "cancel-play", GameID: id}, nil, false, now)
	if e != nil || r.State.Economy.Coins != 0 || r.State.CareCount != 0 {
		t.Fatal("cancel paid", e, r)
	}
}
func TestTetrisFinishExactlyOnceImportAndCacheEviction(t *testing.T) {
	s, e := Open(filepath.Join(t.TempDir(), "blocks.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	s.Do(&game.Action{Kind: "hatch"}, nil, false, now)
	r, _ := s.Do(&game.Action{Kind: "play-tetris"}, nil, false, now)
	state := r.State
	id := state.Game.ID
	n := state.Game.Tetris
	n.Active = nil
	n.Lines = 8
	n.Pieces = 16
	n.Step = 100
	n.End = "won"
	if e = state.Validate(now); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(state)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw))
	a := &game.Action{Kind: "tetris-finish", GameID: id, Step: 100, RequestID: "finish"}
	for i := 0; i < 10; i++ {
		r, e = s.Do(a, nil, false, now)
		if e != nil || r.State.CareCount != 1 || r.State.Economy.Coins != 6 || r.CareFeedback == nil {
			t.Fatal(e, r)
		}
	}
	if r.State.Validate(now) != nil {
		t.Fatal("finished invalid")
	}
	for i := 0; i < 130; i++ {
		_, e = s.Do(&game.Action{Kind: "rename", Name: "积木伙伴", RequestID: time.Unix(int64(i), 0).String()}, nil, false, now)
		if e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.Do(a, nil, false, now); e == nil {
		t.Fatal("evicted finish paid twice")
	}
	r, e = s.Do(nil, &state, false, now)
	if e != nil || r.State.Game != nil || r.State.Economy.Coins != 0 || r.State.CareCount != 0 {
		t.Fatal("import claimed", e, r)
	}
	// A rejected import must not overwrite state, requests, snapshots or wallet.
	before, _ := json.Marshal(r.State)
	snapshots := 0
	s.db.QueryRow("SELECT count(*) FROM snapshots").Scan(&snapshots)
	state.Game.Tetris.Board[0] = 99
	if _, e = s.Do(nil, &state, false, now); e == nil {
		t.Fatal("bad import accepted")
	}
	r, e = s.Do(nil, nil, false, now)
	after, _ := json.Marshal(r.State)
	count := 0
	s.db.QueryRow("SELECT count(*) FROM snapshots").Scan(&count)
	if e != nil || string(before) != string(after) || count != snapshots {
		t.Fatal("bad import destructive", e)
	}
}
func TestSchemaSixTetrisUpgradePreservesEveryOldGame(t *testing.T) {
	for _, kind := range []string{"play", "play-tiles", "play-snake"} {
		t.Run(kind, func(t *testing.T) {
			s, e := Open(filepath.Join(t.TempDir(), "legacy.db"))
			if e != nil {
				t.Fatal(e)
			}
			defer s.Close()
			now := time.Now().Truncate(time.Millisecond).Add(time.Second)
			legacy := game.New(now)
			legacy.Apply(game.Action{Kind: "hatch", Species: 2}, now)
			legacy.Apply(game.Action{Kind: kind}, now)
			legacy.Schema = 6
			legacy.Companion = nil
			legacy.Park = nil
			legacy.Pond = nil
			legacy.Economy.Coins = 19
			raw, _ := json.Marshal(legacy)
			s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw))
			r, e := s.Do(nil, nil, false, now)
			if e != nil || r.State.Schema != game.Schema || r.State.Economy.Coins != 19 || !reflect.DeepEqual(r.State.Game, legacy.Game) || !reflect.DeepEqual(r.State.Growth, legacy.Growth) || !reflect.DeepEqual(r.State.Album, legacy.Album) {
				t.Fatal("migration changed history", e, r)
			}
			var snapshot string
			s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&snapshot)
			if snapshot != string(raw) {
				t.Fatal("original snapshot missing")
			}
		})
	}
}
