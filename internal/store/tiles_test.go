package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func storeTilePair(t *testing.T, r Result) (int, int) {
	t.Helper()
	for a := 0; a < 16; a++ {
		for b := a + 1; b < 16; b++ {
			if game.TilePath(r.State.Game.Tiles.Board, a, b) != nil {
				return a, b
			}
		}
	}
	t.Fatal("no playable pair")
	return 0, 0
}
func TestTileSessionPersistsSelectionAndPaysExactlyOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tiles.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	s.Do(&game.Action{Kind: "hatch", Species: 7}, nil, false, now)
	r, err := s.Do(&game.Action{Kind: "play-tiles", RequestID: "start"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	a, b := storeTilePair(t, r)
	pick := &game.Action{Kind: "tile-pick", GameID: id, Tile: a, RequestID: "pick"}
	for i := 0; i < 2; i++ {
		r, err = s.Do(pick, nil, false, now)
		if err != nil || r.State.Game.Tiles.Pick != a {
			t.Fatal("selection retry toggled", err)
		}
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.Game.ID != id || r.State.Game.Tiles.Pick != a || r.State.Game.Tiles.Board[b] == 0 || r.State.Economy.Coins != 0 {
		t.Fatal("lost session on restart", r, err)
	}
	if len(r.TileLink) != 0 {
		t.Fatal("reload replayed a link")
	}
	pair := &game.Action{Kind: "tile-pick", GameID: id, Tile: b, RequestID: "pair"}
	r, err = s.Do(pair, nil, false, now)
	if err != nil || r.State.Game.Tiles.Pairs != 1 || len(r.TileLink) < 2 {
		t.Fatal("pair feedback", err, r)
	}
	original := r
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			retry, e := s.Do(pair, nil, false, now)
			if e != nil || !reflect.DeepEqual(retry.State, original.State) || !reflect.DeepEqual(retry.TileLink, original.TileLink) {
				t.Error("pair replay mismatch", e)
			}
		}()
	}
	wg.Wait()
	var final *game.Action
	for r.State.Game != nil {
		a, b = storeTilePair(t, r)
		r, err = s.Do(&game.Action{Kind: "tile-pick", GameID: id, Tile: a}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
		final = &game.Action{Kind: "tile-pick", GameID: id, Tile: b, RequestID: "pair-" + strconv.Itoa(r.State.Game.Tiles.Pairs)}
		r, err = s.Do(final, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	if r.State.Economy.Coins != game.TileCoins || r.State.CareCount != 1 || r.CareFeedback == nil || len(r.TileLink) < 2 {
		t.Fatal("completion", r)
	}
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := s.Do(final, nil, false, now); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	s.db.Exec("DELETE FROM requests")
	if _, err = s.Do(final, nil, false, now); err == nil {
		t.Fatal("finished game replayed after eviction")
	}
	r, _ = s.Do(nil, nil, false, now)
	if r.State.Economy.Coins != game.TileCoins || r.State.CareCount != 1 || len(r.State.Album.Entries) != 2 {
		t.Fatal("double award", r)
	}
	r, _ = s.Do(&game.Action{Kind: "play-tiles"}, nil, false, now)
	before, _ := json.Marshal(r.State)
	for _, stale := range []*game.Action{final, {Kind: "cancel-play", GameID: id}, {Kind: "tile-clear", GameID: id}} {
		if _, err = s.Do(stale, nil, false, now); err == nil {
			t.Fatal("old operation affected new game")
		}
	}
	r, _ = s.Do(nil, nil, false, now)
	after, _ := json.Marshal(r.State)
	if string(before) != string(after) {
		t.Fatal("stale request changed state")
	}
}
func TestSchemaFourTileUpgradeAndInvalidImportAreNonDestructive(t *testing.T) {
	s, now := recapStore(t)
	r, _ := s.Do(nil, nil, false, now)
	legacy := r.State
	legacy.Schema = 4
	legacy.Pond = nil
	legacy.Economy.Coins = 19
	bytes, _ := json.Marshal(legacy)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(bytes))
	r, err := s.Do(nil, nil, false, now)
	if err != nil || r.State.Schema != game.Schema || r.State.Economy.Coins != 19 || !reflect.DeepEqual(r.State.Album, legacy.Album) || !reflect.DeepEqual(r.State.Growth, legacy.Growth) {
		t.Fatal("migration", r, err)
	}
	var snapshot string
	s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&snapshot)
	if snapshot != string(bytes) {
		t.Fatal("legacy snapshot missing")
	}
	r, err = s.Do(&game.Action{Kind: "play-tiles"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(r.State)
	invalid := r.State
	copyGame := *invalid.Game
	invalid.Game = &copyGame
	copyTiles := *invalid.Game.Tiles
	invalid.Game.Tiles = &copyTiles
	invalid.Game.Tiles.Board[0] = 99
	if _, err = s.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("invalid tile import accepted")
	}
	current, _ := s.Do(nil, nil, false, now)
	after, _ := json.Marshal(current.State)
	if string(before) != string(after) {
		t.Fatal("rejected import overwrote save")
	}
	source, _ := json.Marshal(current.State)
	imported, err := s.Do(nil, &current.State, false, now)
	if err != nil || imported.State.Game != nil || imported.State.Economy.Coins != 19 {
		t.Fatal("backup import did not safely close active game", err)
	}
	sourceAfter, _ := json.Marshal(current.State)
	if string(source) != string(sourceAfter) {
		t.Fatal("import changed caller")
	}
}
