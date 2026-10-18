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

func TestCompanionSettlementConcurrentRetriesRestartAndImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "companion.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	s.Do(&game.Action{Kind: "hatch"}, nil, false, now)
	r, err := s.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	for i := 0; i < 4; i++ {
		now = now.Add(time.Second)
		_, err = s.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	now = now.Add(time.Second)
	a := &game.Action{Kind: "catch", GameID: id, Lane: 0, RequestID: "settle-true-session"}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Do(a, nil, false, now)
			if e != nil || r.State.Companion.Recent == nil || r.State.Companion.Interests[0].Points != 1 {
				t.Error("retry lost experience", e)
			}
		}()
	}
	wg.Wait()
	r, err = s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	before := r.State
	if before.CareCount != 1 || before.Companion.Recent.ID != id || before.Game != nil {
		t.Fatal("duplicate settlement")
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(a, nil, false, now)
	if err != nil || !reflect.DeepEqual(before.Companion, r.State.Companion) || r.State.CareCount != 1 {
		t.Fatal("restart replay", err)
	}
	if _, err = s.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0, RequestID: "expired-cache-like-new-key"}, nil, false, now); err == nil {
		t.Fatal("removed session replayed")
	}
	r, err = s.Do(nil, &before, false, now)
	if err != nil || !reflect.DeepEqual(before.Companion, r.State.Companion) {
		t.Fatal("import lost history", err)
	}
	var invalid game.State
	raw, _ := json.Marshal(before)
	json.Unmarshal(raw, &invalid)
	invalid.Companion.Interests[0].Points = 6
	if _, err = s.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("corrupt import accepted")
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(before.Companion, r.State.Companion) || r.State.Economy.Coins != before.Economy.Coins {
		t.Fatal("bad import damaged save", err)
	}
}
func TestSchemaNineCompanionMigrationSnapshotsOnceWithoutBackfill(t *testing.T) {
	s, now := recapStore(t)
	r, _ := s.Do(nil, nil, false, now)
	r.State.Schema = 9
	r.State.Companion = nil
	r.State.Park = nil
	r.State.Economy.Owned = []string{"sky-bow", "starlit-wall", "mint-floor"}
	r.State.Economy.Equipped = game.Equipment{Accessory: "sky-bow", Wallpaper: "starlit-wall", Floor: "mint-floor"}
	old := r.State
	raw, _ := json.Marshal(old)
	if _, err := s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		r, err := s.Do(nil, nil, false, now)
		if err != nil || r.State.Schema != game.Schema || r.State.Companion.Recent != nil || !reflect.DeepEqual(old.Economy, r.State.Economy) || !reflect.DeepEqual(old.Growth, r.State.Growth) || !reflect.DeepEqual(old.Album, r.State.Album) {
			t.Fatal("migration changed history", err)
		}
		for _, p := range r.State.Companion.Interests {
			if p.Points != 0 || p.LastAt != 0 {
				t.Fatal("invented interest")
			}
		}
	}
	var n int
	var snapshot string
	s.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&n, &snapshot)
	if n != 1 || snapshot != string(raw) {
		t.Fatal("missing/duplicate snapshot", n)
	}
}
