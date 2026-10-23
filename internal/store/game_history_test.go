package store

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestSchema18HistoryMigrationSnapshotsOnceAndCountsOnlyFutureSettlements(t *testing.T) {
	db, now := recapStore(t)
	// The old save has an actual game memory, one familiarity point, and a
	// four-round game in progress. None of these proves a lifetime play total.
	r, err := db.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	for i := 0; i < 5; i++ {
		now = now.Add(time.Second)
		r, err = db.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	r, err = db.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id = r.State.Game.ID
	for i := 0; i < 4; i++ {
		now = now.Add(time.Second)
		r, err = db.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	old := r.State
	old.Schema = 18
	old.Companion.History = nil
	raw, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		r, err = db.Do(nil, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
		if r.State.Schema != 19 || r.State.Companion.History.Since != now.UnixMilli() || !reflect.DeepEqual(r.State.Game, old.Game) || !reflect.DeepEqual(r.State.Companion.Interests, old.Companion.Interests) || !reflect.DeepEqual(r.State.Album, old.Album) {
			t.Fatal("migration changed past")
		}
		for _, entry := range r.State.Companion.History.Completions {
			if entry.Count != 0 {
				t.Fatal("backfilled old games")
			}
		}
	}
	var n int
	var snapshot string
	if err = db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&n, &snapshot); err != nil || n != 1 || snapshot != string(raw) {
		t.Fatal("missing/duplicate migration snapshot", n, err)
	}
	now = now.Add(time.Second)
	finish := &game.Action{Kind: "catch", GameID: id, Lane: 0, RequestID: "history-after-migration"}
	for i := 0; i < 3; i++ {
		r, err = db.Do(finish, nil, false, now)
		if err != nil || r.State.Companion.History.Completions[0].Count != 1 || r.State.Companion.Interests[0].Points != 1 {
			t.Fatal("future or duplicate settlement", err)
		}
	}
}

func TestImportPreservesHistoryWithoutAliasingOrGrantingAnUnfinishedGame(t *testing.T) {
	db, now := recapStore(t)
	r, err := db.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	for i := 0; i < 5; i++ {
		now = now.Add(time.Second)
		r, err = db.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	r, err = db.Do(&game.Action{Kind: "play-tiles"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	backup := r.State
	before, _ := json.Marshal(backup)
	imported, err := db.Do(nil, &backup, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if imported.State.Game != nil || !reflect.DeepEqual(imported.State.Companion.History, backup.Companion.History) || imported.State.Companion.History.Completions[1].Count != 0 {
		t.Fatal("import invented/lost completion")
	}
	imported.State.Companion.History.Completions[0].Count = 99
	after, _ := json.Marshal(backup)
	if string(before) != string(after) {
		t.Fatal("returned import aliases caller backup history")
	}
	r, err = db.Do(nil, nil, false, now)
	if err != nil || r.State.Companion.History.Completions[0].Count != 1 {
		t.Fatal("read mutated stored count", err)
	}
	invalid := backup
	c := *backup.Companion
	h := *c.History
	h.Completions = append([]game.GameCompletion{}, h.Completions...)
	h.Completions[0].Count = -1
	c.History = &h
	invalid.Companion = &c
	if _, err = db.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("bad history import accepted")
	}
	r, err = db.Do(nil, nil, false, now)
	if err != nil || r.State.Companion.History.Completions[0].Count != 1 {
		t.Fatal("bad import damaged count", err)
	}
}
