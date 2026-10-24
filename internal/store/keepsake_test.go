package store

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Fixtures downgraded to a historical schema must omit future memory kinds.
func beforeKeepsakes(entries []game.Memory) []game.Memory {
	out := make([]game.Memory, 0, len(entries))
	for _, m := range entries {
		if m.Kind != "keepsake" {
			out = append(out, m)
		}
	}
	return out
}
func savedKeepsakes(s game.State) []game.Memory {
	var out []game.Memory
	for _, m := range s.Album.Entries {
		if m.Kind == "keepsake" {
			out = append(out, m)
		}
	}
	return out
}
func TestSchema20KeepsakeMigrationSnapshotsOnceAndAwardsOnlyNextSettlement(t *testing.T) {
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
	r, err = db.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id = r.State.Game.ID
	old := r.State
	old.Schema = 20
	old.Album.Entries = beforeKeepsakes(old.Album.Entries)
	raw, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		r, err = db.Do(nil, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
		if r.State.Schema != game.Schema || len(savedKeepsakes(r.State)) != 0 || !reflect.DeepEqual(old.Game, r.State.Game) || !reflect.DeepEqual(old.Album, r.State.Album) || !reflect.DeepEqual(old.Companion, r.State.Companion) {
			t.Fatal("migration rewrote past or active game")
		}
	}
	var n int
	var snapshot string
	if err = db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&n, &snapshot); err != nil || n != 1 || snapshot != string(raw) {
		t.Fatal("missing/duplicate snapshot", n, err)
	}
	for i := 0; i < 5; i++ {
		now = now.Add(time.Second)
		r, err = db.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0, RequestID: "keepsake-catch-" + string(rune('a'+i))}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	first := savedKeepsakes(r.State)
	if len(first) != 1 || first[0].Item != "star-ribbon" || first[0].At != now.UnixMilli() {
		t.Fatal("missing actual keepsake", first)
	}
	for i := 0; i < 3; i++ {
		r, err = db.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0, RequestID: "keepsake-catch-e"}, nil, false, now)
		if err != nil || !reflect.DeepEqual(first, savedKeepsakes(r.State)) {
			t.Fatal("replay changed keepsake", err)
		}
	}
	backup := r.State
	r, err = db.Do(nil, &backup, false, now)
	if err != nil || !reflect.DeepEqual(first, savedKeepsakes(r.State)) {
		t.Fatal("import lost keepsake", err)
	}
	r, err = db.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(first, savedKeepsakes(r.State)) {
		t.Fatal("reread lost keepsake", err)
	}
}
