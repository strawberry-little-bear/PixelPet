package store

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestTreasurePersistenceReplayExplicitSettlementAndImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "treasure.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	if _, err = db.Do(&game.Action{Kind: "hatch"}, nil, false, now); err != nil {
		t.Fatal(err)
	}
	r, err := db.Do(&game.Action{Kind: "play-treasure"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	command := func(kind string, tile int) {
		t.Helper()
		r, err = db.Do(&game.Action{Kind: kind, GameID: id, Step: r.State.Game.Treasure.Step, Tile: tile}, nil, false, now)
		if err != nil {
			t.Fatal(kind, err)
		}
	}
	command("treasure-resume", 0)
	dig := &game.Action{Kind: "treasure-dig", GameID: id, Step: r.State.Game.Treasure.Step, Tile: 0, RequestID: "same-dig"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := db.Do(dig, nil, false, now)
			if e != nil || len(v.State.Game.Treasure.Opened) != 1 {
				t.Error("concurrent dig", e)
			}
		}()
	}
	wg.Wait()
	r, err = db.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	mapBefore := append([]int{}, r.State.Game.Treasure.Layout...)
	step := r.State.Game.Treasure.Step
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(24 * time.Hour)
	r, err = db.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(mapBefore, r.State.Game.Treasure.Layout) || len(r.State.Game.Treasure.Opened) != 1 || r.State.Game.Treasure.Step != step || r.State.CareCount != 0 || r.State.Companion.Recent != nil {
		t.Fatal("offline changed exploration", err)
	}
	// Untimed exploration has no automatic commands, even after restart/long absence.
	command("treasure-pause", 0)
	command("treasure-resume", 0)
	for i := 1; !r.State.Game.AwaitingFinish(); i++ {
		command("treasure-dig", i)
	}
	found := 0
	for _, i := range r.State.Game.Treasure.Opened {
		if mapBefore[i] > 0 {
			found++
		}
	}
	if r.State.Economy.Coins != 0 || r.State.CareCount != 0 {
		t.Fatal("automatic award")
	}
	if _, err = db.Do(&game.Action{Kind: "cancel-play", GameID: id, RequireUnfinished: true}, nil, false, now); !errors.Is(err, game.ErrGameFinished) {
		t.Fatal("late abandon", err)
	}
	finish := &game.Action{Kind: "treasure-finish", GameID: id, Step: r.State.Game.Treasure.Step, RequestID: "finish-once"}
	r, err = db.Do(finish, nil, false, now)
	if err != nil || r.State.Game != nil || r.State.Economy.Coins != 3+found || r.State.CareCount != 1 || r.CareFeedback == nil || r.State.Companion.Recent.Kind != "treasure" {
		t.Fatal("settlement", err, r)
	}
	same, err := db.Do(finish, nil, false, now)
	if err != nil || same.State.Revision != r.State.Revision {
		t.Fatal("cached duplicate", err)
	}
	if _, err = db.Do(&game.Action{Kind: finish.Kind, GameID: id, Step: finish.Step}, nil, false, now); err == nil {
		t.Fatal("uncached duplicate")
	}
	history := r.State.Companion
	r, err = db.Do(&game.Action{Kind: "play-treasure"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id = r.State.Game.ID
	command("treasure-resume", 0)
	command("treasure-dig", 0)
	backup := r.State
	generation := r.SaveGeneration
	r, err = db.Do(nil, &backup, false, now)
	if err != nil || r.State.Game != nil || !reflect.DeepEqual(history, r.State.Companion) || r.SaveGeneration == generation {
		t.Fatal("import invented/dropped history", err)
	}
	if _, err = db.DoForGeneration(&game.Action{Kind: "play-treasure"}, nil, false, now, generation); !errors.Is(err, ErrSaveChanged) {
		t.Fatal("old generation", err)
	}
	// Malformed treasure model import is rejected atomically, not silently stripped.
	bad := backup
	bad.Game.Treasure.Opened = []int{0, 0}
	if _, err = db.Do(nil, &bad, false, now); err == nil {
		t.Fatal("malformed import")
	}
	after, err := db.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(after.State, r.State) || after.SaveGeneration != r.SaveGeneration {
		t.Fatal("invalid import changed save", err)
	}
}

func TestTreasureSchema15MigrationSnapshotsExactlyOnce(t *testing.T) {
	db, now := recapStore(t)
	r, err := db.Do(&game.Action{Kind: "play-tiles"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	old := r.State
	old.Schema = 15
	old.Companion.Interests = old.Companion.Interests[:6]
	raw, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	expected := old
	expected.Schema = game.Schema
	expected.Revision++
	expected.Companion = &game.Companion{Since: old.Companion.Since, Interests: append(append([]game.Interest{}, old.Companion.Interests...), game.Interest{Kind: "treasure"}), Recent: old.Companion.Recent}
	for i := 0; i < 3; i++ {
		r, err = db.Do(nil, nil, false, now)
		if err != nil || !reflect.DeepEqual(r.State, expected) {
			t.Fatal("changed prior records/session", err)
		}
	}
	var count int
	var snapshot string
	if err = db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&count, &snapshot); err != nil || count != 1 || snapshot != string(raw) {
		t.Fatal("original snapshot", count, err)
	}
}
