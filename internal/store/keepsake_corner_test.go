package store

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestKeepsakeCornerPersistenceRetryImportAndMigration(t *testing.T) {
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
	old := r.State
	old.Schema = 21
	raw, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		r, err = db.Do(nil, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
		expected := old
		expected.Schema = game.Schema
		expected.Revision = r.State.Revision
		if !reflect.DeepEqual(expected, r.State) {
			t.Fatal("migration changed anything beyond schema/revision")
		}
	}
	var n int
	var snapshot string
	if err = db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&n, &snapshot); err != nil || n != 1 || snapshot != string(raw) {
		t.Fatal("upgrade snapshot mismatch", err)
	}
	action := &game.Action{Kind: "display-keepsake", Item: "star-ribbon", RequestID: "place-once"}
	before := r.State
	r, err = db.Do(action, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Album.DisplayItem != "star-ribbon" || r.CareFeedback != nil || !reflect.DeepEqual(before.Logs, r.State.Logs) || !reflect.DeepEqual(before.Companion, r.State.Companion) || !reflect.DeepEqual(before.Growth, r.State.Growth) || !reflect.DeepEqual(before.Economy, r.State.Economy) {
		t.Fatal("placement changed more than decoration")
	}
	revision := r.State.Revision
	r, err = db.Do(action, nil, false, now)
	if err != nil || r.State.Revision != revision {
		t.Fatal("duplicate action applied twice", err)
	}
	backup := r.State
	r, err = db.Do(&game.Action{Kind: "display-keepsake", Item: "", RequestID: "put-away"}, nil, false, now)
	if err != nil || r.State.Album.DisplayItem != "" {
		t.Fatal("put away failed", err)
	}
	// Retrying a past request must never overwrite a newer choice in the database.
	if _, err = db.Do(action, nil, false, now); err != nil {
		t.Fatal(err)
	}
	r, err = db.Do(nil, nil, false, now)
	if err != nil || r.State.Album.DisplayItem != "" {
		t.Fatal("retry reversed the newer choice", err)
	}
	r, err = db.Do(nil, &backup, false, now)
	if err != nil || r.State.Album.DisplayItem != "star-ribbon" {
		t.Fatal("backup did not restore corner", err)
	}
	r, err = db.Do(nil, nil, false, now.Add(time.Minute))
	if err != nil || r.State.Album.DisplayItem != "star-ribbon" {
		t.Fatal("reread lost corner", err)
	}
	invalid := r.State
	album := *invalid.Album
	invalid.Album = &album
	invalid.Album.DisplayItem = "pond-shell"
	if _, err = db.Do(nil, &invalid, false, now.Add(time.Minute)); err == nil {
		t.Fatal("import accepted an unowned decoration")
	}
	r, err = db.Do(nil, nil, false, now.Add(time.Minute))
	if err != nil || r.State.Album.DisplayItem != "star-ribbon" {
		t.Fatal("invalid import changed saved corner", err)
	}
}
