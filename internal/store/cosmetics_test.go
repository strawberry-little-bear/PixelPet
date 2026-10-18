package store

import (
	"encoding/json"
	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewCosmeticsConcurrentRetriesPersistAllSlotsAndFirstPatterns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shop.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Add(time.Second).Truncate(time.Millisecond)
	r, err := s.Do(&game.Action{Kind: "hatch", Species: 2}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	r.State.Economy.Coins = 200
	if _, err = s.Do(nil, &r.State, false, now); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"sky-bow", "clover-pot", "meadow-wall", "mint-floor"} {
		for _, kind := range []string{"buy", "equip"} {
			var wg sync.WaitGroup
			for i := 0; i < 16; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if _, err := s.Do(&game.Action{Kind: kind, Item: id, RequestID: kind + "-" + id}, nil, false, now); err != nil {
						t.Error(err)
					}
				}()
			}
			wg.Wait()
		}
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	want := game.Equipment{Accessory: "sky-bow", Room: "clover-pot", Wallpaper: "meadow-wall", Floor: "mint-floor"}
	if r.State.Economy.Coins != 122 || len(r.State.Economy.Owned) != 4 || r.State.Economy.Equipped != want {
		t.Fatal("duplicate charge or toggle", r.State.Economy)
	}
	before, _ := json.Marshal(r.State)
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(&game.Action{Kind: "equip", Item: "mint-floor", RequestID: "equip-mint-floor"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(r.State)
	if string(before) != string(after) {
		t.Fatal("restart retry toggled equipment")
	}
	backup := r.State
	r, err = s.Do(nil, &backup, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Economy.Equipped != want || !reflect.DeepEqual(r.State.Album, backup.Album) {
		t.Fatal("import lost independent slots/history")
	}
	if err = r.State.Validate(now); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaEightShopUpgradeSnapshotsAndPreservesOldGear(t *testing.T) {
	s, now := recapStore(t)
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	r.State.Schema = 8
	r.State.Economy.Owned = []string{"berry-scarf", "patchwork-rug"}
	r.State.Economy.Equipped = game.Equipment{Accessory: "berry-scarf", Room: "patchwork-rug"}
	raw, _ := json.Marshal(r.State)
	// Real version-8 wire saves do not contain either new slot field.
	raw = []byte(strings.Replace(string(raw), `,"wallpaper":"","floor":""`, "", 1))
	if strings.Contains(string(raw), `"wallpaper"`) || strings.Contains(string(raw), `"floor"`) {
		t.Fatal("not a legacy wire fixture")
	}
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		upgraded, err := s.Do(nil, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
		if upgraded.State.Schema != game.Schema || !reflect.DeepEqual(upgraded.State.Economy, r.State.Economy) || !reflect.DeepEqual(upgraded.State.Pond, r.State.Pond) || !reflect.DeepEqual(upgraded.State.Album, r.State.Album) {
			t.Fatal("legacy save changed", upgraded.State)
		}
	}
	var count int
	var snapshot string
	s.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&count, &snapshot)
	if count != 1 || snapshot != string(raw) {
		t.Fatal("missing or repeated old snapshot", count)
	}
}
