package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestRainFishMigrationSnapshotPersistenceRetryAndImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rain.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	s := game.New(now)
	s.Apply(game.Action{Kind: "hatch", Species: 2}, now)
	s.Apply(game.Action{Kind: "play-fishing"}, now)
	s.Game.ID = "00000200000000000000000000000000"
	// Model an actual old-schema cast. Downgrading after a schema-15 cast
	// randomly made 1/8 of fixtures invalid by retaining a rare candidate.
	s.Schema = 14
	if s.Companion != nil {
		s.Companion.History = nil
	}
	s.Companion.Interests = s.Companion.Interests[:6]
	s.Apply(game.Action{Kind: "fish-cast", GameID: s.Game.ID}, now)
	s.Game.Fishing.Paused = true
	raw, _ := json.Marshal(s)
	if err = s.Validate(now); err != nil {
		t.Fatal(err)
	}
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	r, err := db.Do(nil, nil, false, now)
	if err != nil || r.State.Schema != game.Schema || !reflect.DeepEqual(r.State.Game, s.Game) || len(r.State.Pond.Fish) != 0 {
		t.Fatal("migration rerolled/backfilled", err)
	}
	var count int
	var snapshot string
	db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&count, &snapshot)
	if count != 1 || snapshot != string(raw) {
		t.Fatal("missing exact pre-upgrade snapshot", count)
	}
	// Controlled rare bite fixture, not a probabilistic claim about actual casts.
	s = r.State
	s.Game.Fishing.Candidate = "rain-koi"
	s.Game.Fishing.Phase = "bite"
	s.Game.Fishing.Paused = false
	raw, _ = json.Marshal(s)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	a := &game.Action{Kind: "fish-reel", GameID: s.Game.ID, Step: s.Game.Fishing.Step, RequestID: "rain-reel-once"}
	r, err = db.Do(a, nil, false, now)
	if err != nil || len(r.State.Pond.Fish) != 1 || r.State.Pond.Fish[0].ID != "rain-koi" || r.State.Pond.Fish[0].Count != 1 {
		t.Fatal("real reel", r, err)
	}
	retry, err := db.Do(a, nil, false, now)
	if err != nil || !reflect.DeepEqual(r.State.Pond, retry.State.Pond) || r.State.Revision != retry.State.Revision {
		t.Fatal("retry duplicated discovery", err)
	}
	if r.State.CareCount != 0 || r.State.Economy.Coins != 0 {
		t.Fatal("extra reward")
	}
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := db.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(loaded.State.Pond, r.State.Pond) {
		t.Fatal("reload lost discovery", err)
	}
	backup := loaded.State
	restored, err := db.Do(nil, &backup, false, now)
	if err != nil || restored.State.Game != nil || !reflect.DeepEqual(restored.State.Pond, backup.Pond) {
		t.Fatal("import lost discovery", err)
	}
	invalid := restored.State
	invalid.Schema = 14
	if invalid.Companion != nil {
		invalid.Companion.History = nil
	}
	invalid.Companion = &game.Companion{Since: invalid.Companion.Since, Interests: append([]game.Interest{}, invalid.Companion.Interests[:6]...), Recent: invalid.Companion.Recent}
	if _, err = db.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("old schema accepted rare fish")
	}
	after, err := db.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(after.State.Pond, restored.State.Pond) {
		t.Fatal("invalid import changed discoveries", err)
	}
}
