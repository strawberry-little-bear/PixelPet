package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestEconomyConcurrentClaimsAndPurchasesAreAtomic(t *testing.T) {
	s, now := recapStore(t)
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Do(&game.Action{Kind: "daily"}, nil, false, now); err == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	r, err := s.Do(nil, nil, false, now)
	if err != nil || successes.Load() != 1 || r.State.Economy.Coins != game.DailyCoins {
		t.Fatal("duplicate daily", successes.Load(), r, err)
	}
	r, err = s.Do(&game.Action{Kind: "daily"}, nil, false, now.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	successes.Store(0)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Do(&game.Action{Kind: "buy", Item: "leaf-pin"}, nil, false, now.Add(24*time.Hour)); err == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	r, err = s.Do(nil, nil, false, now.Add(24*time.Hour))
	if err != nil || successes.Load() != 1 || r.State.Economy.Coins != 8 || !reflect.DeepEqual(r.State.Economy.Owned, []string{"leaf-pin"}) {
		t.Fatal("double charged", r, err)
	}
	// Two different purchases competing for the same finite balance cannot overdraw.
	r.State.Economy.Coins = 20
	body, _ := json.Marshal(r.State)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body))
	successes.Store(0)
	for _, id := range []string{"berry-scarf", "clover-pot"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			if _, err := s.Do(&game.Action{Kind: "buy", Item: id}, nil, false, now.Add(24*time.Hour)); err == nil {
				successes.Add(1)
			}
		}(id)
	}
	wg.Wait()
	r, err = s.Do(nil, nil, false, now.Add(24*time.Hour))
	if err != nil || successes.Load() != 1 || r.State.Economy.Coins < 0 || len(r.State.Economy.Owned) != 2 {
		t.Fatal("overdraw", r, err)
	}
}
func TestEconomyRestartRetriesBackupAndReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "coins.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	defer func() { s.Close() }()
	s.Do(&game.Action{Kind: "hatch", Species: 7}, nil, false, now)
	a := &game.Action{Kind: "daily", RequestID: "daily-once"}
	if _, err = s.Do(a, nil, false, now); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Do(a, nil, false, now); err != nil {
		t.Fatal("retry after restart", err)
	}
	s.Do(&game.Action{Kind: "daily"}, nil, false, now.Add(24*time.Hour))
	buy := &game.Action{Kind: "buy", Item: "leaf-pin", RequestID: "purchase"}
	for i := 0; i < 2; i++ {
		if _, err = s.Do(buy, nil, false, now.Add(24*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	equip := &game.Action{Kind: "equip", Item: "leaf-pin", RequestID: "equip"}
	for i := 0; i < 2; i++ {
		if _, err = s.Do(equip, nil, false, now.Add(24*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	r, err := s.Do(nil, nil, false, now.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Economy.Coins != 8 || r.State.Economy.Equipped.Accessory != "leaf-pin" {
		t.Fatal("retry mutated economy", r)
	}
	backup := r.State
	before, _ := json.Marshal(backup)
	if _, err = s.Do(nil, &backup, false, now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(backup)
	if string(before) != string(after) {
		t.Fatal("import mutated source")
	}
	// No caller-owned nested slice leaks into the persisted or returned state.
	r, err = s.Do(nil, &backup, false, now.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	r.State.Economy.Owned[0] = "not-real"
	r.State.Album.Entries[0].Kind = "not-real"
	after, _ = json.Marshal(backup)
	if string(before) != string(after) {
		t.Fatal("import aliases nested collections")
	}
	r, err = s.Do(nil, nil, false, now.Add(24*time.Hour))
	if err != nil || r.State.Economy.Owned[0] != "leaf-pin" {
		t.Fatal("external mutation leaked", err)
	}
	invalid := r.State
	copyEconomy := *invalid.Economy
	invalid.Economy = &copyEconomy
	invalid.Economy.Coins = -1
	if _, err = s.Do(nil, &invalid, false, now.Add(24*time.Hour)); err == nil {
		t.Fatal("invalid import accepted")
	}
	current, _ := s.Do(nil, nil, false, now.Add(24*time.Hour))
	if current.State.Revision != r.State.Revision || current.State.Economy.Coins != 8 {
		t.Fatal("failed import changed save")
	}
	reset, err := s.Do(nil, nil, true, now.Add(24*time.Hour))
	if err != nil || reset.State.Economy.Coins != 0 || len(reset.State.Economy.Owned) != 0 || reset.State.Economy.Equipped.Accessory != "" {
		t.Fatal("reset kept economy", err)
	}
}
func TestCompletedGameRewardRetriesWithAndWithoutCache(t *testing.T) {
	s, now := recapStore(t)
	now = now.Add(time.Minute)
	started, startErr := s.Do(&game.Action{Kind: "play"}, nil, false, now)
	if startErr != nil {
		t.Fatal(startErr)
	}
	gameID := started.State.Game.ID
	var last *game.Action
	var end time.Time
	for i := 0; i < 5; i++ {
		a := &game.Action{Kind: "catch", GameID: gameID, Lane: i % 3, RequestID: "round-" + string(rune('0'+i))}
		end = now.Add(time.Duration(i) * 900 * time.Millisecond)
		r, err := s.Do(a, nil, false, end)
		if err != nil {
			t.Fatal(err)
		}
		if i < 4 && r.State.Economy.Coins != 0 {
			t.Fatal("paid before game ended")
		}
		last = a
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Do(last, nil, false, end); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	r, err := s.Do(nil, nil, false, end)
	if err != nil || r.State.Economy.Coins != 8 || r.State.Economy.GameCoins != 8 {
		t.Fatal("duplicate reward", r, err)
	}
	s.db.Exec("DELETE FROM requests")
	if _, err = s.Do(last, nil, false, end); err == nil {
		t.Fatal("ended session replayed without cache")
	}
	r, _ = s.Do(nil, nil, false, end)
	if r.State.Economy.Coins != 8 {
		t.Fatal("cache eviction replayed coins")
	}
	if len(r.Shop.Catalog) != len(game.ShopRules().Catalog) || r.Shop.DailyCoins != game.DailyCoins {
		t.Fatal("missing server catalog")
	}
}

func TestOldOperationsCannotAffectNewSessionAfterCacheEviction(t *testing.T) {
	s, now := recapStore(t)
	now = now.Add(time.Minute)
	first, err := s.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	oldID := first.State.Game.ID
	cancel := &game.Action{Kind: "cancel-play", GameID: oldID, RequestID: "old-cancel"}
	if _, err = s.Do(cancel, nil, false, now); err != nil {
		t.Fatal(err)
	}
	second, err := s.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil || second.State.Game.ID == oldID {
		t.Fatal("new game needs a distinct identity, even at the same timestamp", err)
	}
	if _, err = s.db.Exec("DELETE FROM requests"); err != nil {
		t.Fatal(err)
	}
	for _, action := range []*game.Action{
		cancel,
		{Kind: "catch", GameID: oldID, Lane: 0, RequestID: "old-catch"},
		{Kind: "catch", Lane: 0, RequestID: "missing-game-id"},
	} {
		if _, err = s.Do(action, nil, false, now); err == nil {
			t.Fatalf("stale operation accepted: %+v", action)
		}
	}
	current, err := s.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(current.State, second.State) {
		t.Fatal("rejected operations changed the new session or wallet", err)
	}
}

func TestSchemaThreeStoreUpgradeKeepsSnapshotAndPast(t *testing.T) {
	s, now := recapStore(t)
	r, _ := s.Do(nil, nil, false, now)
	legacy := r.State
	legacy.Schema = 3
	legacy.Pond = nil
	legacy.Economy = nil
	before, _ := json.Marshal(legacy)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(before))
	r, err := s.Do(nil, nil, false, now)
	if err != nil || r.State.Schema != game.Schema || r.State.Economy.Coins != 0 || r.State.Economy.LastDailyAt != 0 || len(r.State.Economy.Owned) != 0 {
		t.Fatal("migration", r, err)
	}
	if !reflect.DeepEqual(r.State.Growth, legacy.Growth) || !reflect.DeepEqual(r.State.Album, legacy.Album) {
		t.Fatal("migration invented history")
	}
	var snapshot string
	s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&snapshot)
	if snapshot != string(before) {
		t.Fatal("missing recoverable old bytes")
	}
	revision := r.State.Revision
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.Revision != revision {
		t.Fatal("migration replayed", err)
	}
}
