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
	if r.GameReceipt == nil || r.GameReceipt.Walk == nil || r.GameReceipt.Walk.Cleared != 0 || r.GameReceipt.Walk.Total != 12 || r.GameReceipt.Walk.RouteCoins != 3 || r.GameReceipt.Walk.PerformanceCoins != 0 || r.GameReceipt.Walk.AwardedCoins != 3 {
		t.Fatal("settlement receipt", r.GameReceipt)
	}
	if x := r.GameReceipt.Interest; x == nil || x.Kind != "walk" || x.GameID != id || x.Reason != "credited" || x.Before != 0 || x.After != 1 {
		t.Fatal("walk and interest receipts must coexist", x)
	}
	same, err := db.Do(finish, nil, false, now)
	if err != nil || same.State.Revision != r.State.Revision || !reflect.DeepEqual(same.GameReceipt, r.GameReceipt) {
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

func TestWalkSettlementReceiptReportsBreakdownAndActualAward(t *testing.T) {
	cases := []struct {
		name       string
		coins      int
		gameCoins  int
		lastGameAt int64
		want       int
	}{
		{name: "daily limit", coins: 100, gameCoins: game.GameDailyLimit - 1, lastGameAt: -1, want: 1},
		{name: "wallet limit", coins: game.MaxCoins - 1, gameCoins: 0, lastGameAt: 0, want: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := Open(filepath.Join(t.TempDir(), "walk-receipt.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			now := time.Now().Truncate(time.Millisecond).Add(3 * time.Minute)
			hatchAt := now.Add(-2 * time.Minute)
			playAt := now.Add(-90 * time.Second)
			if _, err = s.Do(&game.Action{Kind: "hatch", Species: 3}, nil, false, hatchAt); err != nil {
				t.Fatal(err)
			}
			started, err := s.Do(&game.Action{Kind: "play-walk"}, nil, false, playAt)
			if err != nil {
				t.Fatal(err)
			}
			state := started.State
			state.Game.Walking.Beat = game.WalkLength
			state.Game.Walking.Step = game.WalkLength
			state.Game.Walking.Paused = true
			state.Game.Walking.Cleared = 8
			state.Game.Walking.Souvenirs = []string{"leaf", "pinecone", "feather"}
			state.Game.Walking.LastPulseAt = now.UnixMilli()
			state.LastTick = now.UnixMilli()
			state.Park.Finds = []game.FishDiscovery{
				{ID: "leaf", FirstAt: state.HatchedAt, LastAt: now.UnixMilli(), Count: 1},
				{ID: "pinecone", FirstAt: state.HatchedAt, LastAt: now.UnixMilli(), Count: 1},
				{ID: "feather", FirstAt: state.HatchedAt, LastAt: now.UnixMilli(), Count: 1},
			}
			state.Economy.Coins = tc.coins
			state.Economy.GameCoins = tc.gameCoins
			state.Economy.LastGameAt = tc.lastGameAt
			if state.Economy.GameCoins > 0 {
				state.Economy.LastGameAt = now.UnixMilli()
			}
			if err := state.Validate(now); err != nil {
				t.Fatalf("fixture invalid: %v created=%d hatched=%d tick=%d start=%d beat=%d step=%d pulse=%d finds=%+v economy=%+v", err, state.CreatedAt, state.HatchedAt, state.LastTick, state.Game.StartedAt, state.Game.Walking.Beat, state.Game.Walking.Step, state.Game.Walking.LastPulseAt, state.Park.Finds, state.Economy)
			}
			encoded, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(encoded)); err != nil {
				t.Fatal(err)
			}
			finish := &game.Action{Kind: "walk-finish", GameID: state.Game.ID, Step: state.Game.Walking.Step, RequestID: "receipt-" + tc.name}
			result, err := s.Do(finish, nil, false, now)
			if err != nil {
				t.Fatal(err)
			}
			if result.GameReceipt == nil || result.GameReceipt.Walk == nil {
				t.Fatal("missing walk receipt")
			}
			got := result.GameReceipt.Walk
			if got.Cleared != 8 || got.Total != 12 || got.RouteCoins != 3 || got.PerformanceCoins != 2 || got.AwardedCoins != tc.want {
				t.Fatalf("unexpected receipt: %+v", *got)
			}
			if result.State.Economy.Coins != tc.coins+tc.want {
				t.Fatalf("unexpected wallet: got %d want %d", result.State.Economy.Coins, tc.coins+tc.want)
			}
			replayed, err := s.Do(finish, nil, false, now)
			if err != nil || !reflect.DeepEqual(replayed.GameReceipt, result.GameReceipt) {
				t.Fatalf("replay receipt changed: err=%v replay=%+v result=%+v", err, replayed.GameReceipt, result.GameReceipt)
			}
		})
	}
}
