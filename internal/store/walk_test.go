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

func TestWalkPersistenceConcurrentReplayLeaseImportAndAtomicSettlement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "walk.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	db.Do(&game.Action{Kind: "hatch", Species: 3}, nil, false, now)
	r, err := db.Do(&game.Action{Kind: "play-walk"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	command := func(kind string) {
		t.Helper()
		r, err = db.Do(&game.Action{Kind: kind, GameID: id, Step: r.State.Game.Walking.Step}, nil, false, now)
		if err != nil {
			t.Fatal(kind, err)
		}
	}
	command("walk-resume")
	now = now.Add(time.Second)
	pulse := &game.Action{Kind: "walk-step", GameID: id, Step: r.State.Game.Walking.Step, RequestID: "one-beat"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := db.Do(pulse, nil, false, now)
			if e != nil || v.State.Game.Walking.Beat != 1 {
				t.Error(e, v)
			}
		}()
	}
	wg.Wait()
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(24 * time.Hour)
	r, err = db.Do(nil, nil, false, now)
	if err != nil || !r.State.Game.Walking.Paused || r.State.Game.Walking.Beat != 1 || len(r.State.Park.Finds) != 0 {
		t.Fatal("offline progression", err, r)
	}
	command("walk-resume")
	for r.State.Game.Walking.Beat < 72 {
		now = now.Add(time.Second)
		command("walk-step")
	}
	if r.State.Park.Walks != 0 || r.State.CareCount != 0 {
		t.Fatal("automatic reward")
	}
	finish := &game.Action{Kind: "walk-finish", GameID: id, Step: r.State.Game.Walking.Step, RequestID: "finish"}
	r, err = db.Do(finish, nil, false, now)
	if err != nil || r.State.Economy.Coins != 3 || r.State.CareCount != 1 || r.CareFeedback == nil || r.State.Park.Walks != 1 {
		t.Fatal("settlement", err, r)
	}
	same, err := db.Do(finish, nil, false, now)
	if err != nil || same.State.Revision != r.State.Revision {
		t.Fatal("duplicate reward", err)
	}
	if _, err := db.Do(&game.Action{Kind: "walk-finish", GameID: id, Step: finish.Step}, nil, false, now); err == nil {
		t.Fatal("uncached duplicate")
	}
	r, err = db.Do(&game.Action{Kind: "play-walk"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	backup := r.State
	finds := append([]game.FishDiscovery{}, backup.Park.Finds...)
	r, err = db.Do(nil, &backup, false, now)
	if err != nil || r.State.Game != nil || !reflect.DeepEqual(finds, r.State.Park.Finds) || r.State.Companion.Recent.Kind != "walk" {
		t.Fatal("import", err, r)
	}
	before, _ := json.Marshal(r.State)
	bad := r.State
	p := *bad.Park
	bad.Park = &p
	bad.Park.Walks = -1
	if _, err := db.Do(nil, &bad, false, now); err == nil {
		t.Fatal("invalid import")
	}
	r, err = db.Do(nil, nil, false, now)
	after, _ := json.Marshal(r.State)
	if err != nil || string(before) != string(after) {
		t.Fatal("destructive failed import")
	}
}
func TestSchemaTenParkMigrationKeepsSnapshotAndPriorInterest(t *testing.T) {
	s, now := recapStore(t)
	r, _ := s.Do(nil, nil, false, now)
	r.State.Schema = 10
	r.State.Park = nil
	r.State.Companion.Interests = r.State.Companion.Interests[:5]
	r.State.Companion.Interests[0].Points = 1
	r.State.Companion.Interests[0].LastAt = now.UnixMilli()
	r.State.Companion.Recent = &game.GameExperience{Kind: "stars", ID: "0123456789abcdef0123456789abcdef", At: now.UnixMilli()}
	old := r.State
	raw, _ := json.Marshal(old)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw))
	for i := 0; i < 3; i++ {
		r, err := s.Do(nil, nil, false, now)
		if err != nil || r.State.Schema != game.Schema || r.State.Park.Walks != 0 || len(r.State.Park.Finds) != 0 || !reflect.DeepEqual(old.Companion.Interests, r.State.Companion.Interests[:5]) || !reflect.DeepEqual(old.Companion.Recent, r.State.Companion.Recent) || !reflect.DeepEqual(old.Growth, r.State.Growth) || !reflect.DeepEqual(old.Album, r.State.Album) {
			t.Fatal("migration", err)
		}
	}
	var n int
	var snapshot string
	s.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&n, &snapshot)
	if n != 1 || snapshot != string(raw) {
		t.Fatal("migration snapshot", n)
	}
}
