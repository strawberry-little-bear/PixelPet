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

func TestFishingTransactionsPersistenceAndNoOfflineCatches(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pond.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	db.Do(&game.Action{Kind: "hatch"}, nil, false, now)
	r, err := db.Do(&game.Action{Kind: "play-fishing"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	command := func(kind string) {
		t.Helper()
		var e error
		r, e = db.Do(&game.Action{Kind: kind, GameID: id, Step: r.State.Game.Fishing.Step}, nil, false, now)
		if e != nil {
			t.Fatal(kind, e)
		}
	}
	command("fish-cast")
	now = now.Add(time.Second)
	a := &game.Action{Kind: "fish-step", GameID: id, Step: r.State.Game.Fishing.Step, RequestID: "one-beat"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := db.Do(a, nil, false, now)
			if e != nil || v.State.Game.Fishing.ElapsedMS != 1000 {
				t.Error(e, v)
			}
		}()
	}
	wg.Wait()
	r, err = db.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(24 * time.Hour)
	r, err = db.Do(nil, nil, false, now)
	if err != nil || !r.State.Game.Fishing.Paused || r.State.Game.Fishing.ElapsedMS != 1000 || r.State.Game.Fishing.Casts != 1 || len(r.State.Pond.Fish) != 0 {
		t.Fatal("offline changed cast", r, err)
	}
	command("fish-resume")
	for cast := 0; cast < 3; cast++ {
		if cast > 0 {
			command("fish-cast")
		}
		for r.State.Game.Fishing.Phase == "wait" {
			now = now.Add(time.Second)
			command("fish-step")
		}
		command("fish-reel")
	}
	finish := &game.Action{Kind: "fish-finish", GameID: id, Step: r.State.Game.Fishing.Step, RequestID: "finish"}
	r, err = db.Do(finish, nil, false, now)
	if err != nil || r.State.Economy.Coins != 6 || r.State.CareCount != 1 {
		t.Fatal(r, err)
	}
	same, err := db.Do(finish, nil, false, now)
	if err != nil || same.State.Revision != r.State.Revision {
		t.Fatal("retry duplicated", err)
	}
	if _, err = db.Do(&game.Action{Kind: "fish-finish", GameID: id, Step: finish.Step}, nil, false, now); err == nil {
		t.Fatal("uncached replay")
	}
	if err = r.State.Validate(now); err != nil {
		t.Fatal(err)
	}
	// Import preserves real discoveries, but never resumes an imported session.
	r, err = db.Do(&game.Action{Kind: "play-fishing"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	backup := r.State
	before := append([]game.FishDiscovery{}, backup.Pond.Fish...)
	r, err = db.Do(nil, &backup, false, now)
	if err != nil || r.State.Game != nil || !reflect.DeepEqual(before, r.State.Pond.Fish) {
		t.Fatal("import discoveries", r, err)
	}
	invalid := r.State
	invalid.Pond = &game.Pond{Since: now.UnixMilli(), Fish: []game.FishDiscovery{{ID: "invented", Count: 1, FirstAt: now.UnixMilli(), LastAt: now.UnixMilli()}}}
	if _, err = db.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("bad import")
	}
	current, err := db.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(before, current.State.Pond.Fish) {
		t.Fatal("bad import changed fish", err)
	}
}
func TestSchemaSevenPondMigrationSnapshotsOnceWithoutInventedDiscoveries(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "old.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	old := game.New(now)
	old.Apply(game.Action{Kind: "hatch", Species: 1}, now)
	old.Apply(game.Action{Kind: "play-tetris"}, now)
	old.Schema = 7
	old.Pond = nil
	raw, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	r, err := db.Do(nil, nil, false, now)
	if err != nil || r.State.Schema != game.Schema || len(r.State.Pond.Fish) != 0 || r.State.Pond.Since != now.UnixMilli() || !reflect.DeepEqual(old.Game, r.State.Game) {
		t.Fatal(r, err)
	}
	if err = r.State.Validate(now); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err = db.Do(nil, nil, false, now); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var snapshot string
	db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&count, &snapshot)
	if count != 1 || snapshot != string(raw) {
		t.Fatal("migration snapshot", count, snapshot)
	}
}
