package game

import (
	"encoding/json"
	"math/rand/v2"
	"reflect"
	"testing"
	"time"
)

func tilePair(t *testing.T, s *State, now time.Time) (int, int) {
	t.Helper()
	for a := 0; a < 16; a++ {
		for b := a + 1; b < 16; b++ {
			if TilePath(s.Game.Tiles.Board, a, b) != nil {
				return a, b
			}
		}
	}
	t.Fatal("unplayable board")
	return 0, 0
}
func finishTiles(t *testing.T, s *State, now time.Time) {
	t.Helper()
	for s.Game != nil {
		a, b := tilePair(t, s, now)
		for _, cell := range []int{a, b} {
			if _, err := s.Apply(Action{Kind: "tile-pick", GameID: s.Game.ID, Tile: cell}, now); err != nil {
				t.Fatal(err)
			}
		}
	}
}
func TestTilePathStraightBentOutsideAndBlocked(t *testing.T) {
	for _, tc := range []struct {
		name    string
		board   [16]int
		a, b    int
		yes     bool
		corners int
	}{
		{"straight", [16]int{1, 0, 0, 1}, 0, 3, true, 2},
		{"one bend", [16]int{1, 0, 2, 0, 0, 1}, 0, 5, true, 3},
		{"outside border", [16]int{1, 2, 2, 1}, 0, 3, true, 4},
		{"blocked interior", [16]int{2, 3, 4, 5, 6, 1, 7, 2, 3, 8, 1, 4, 5, 6, 7, 8}, 5, 10, false, 0},
		{"mismatch", [16]int{1, 2}, 0, 1, false, 0},
		{"same tile", [16]int{1}, 0, 0, false, 0},
		{"empty", [16]int{}, 0, 1, false, 0},
		{"negative", [16]int{}, -1, 0, false, 0},
		{"out of bounds", [16]int{}, 0, 16, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := TilePath(tc.board, tc.a, tc.b)
			if (p != nil) != tc.yes || len(p) != tc.corners {
				t.Fatal(p)
			}
		})
	}
}

// An independent route enumerator compares all possible two-turn corridors,
// rather than duplicating the production directional BFS.
func referenceTileRoute(board [16]int, a, b int) bool {
	if a == b || board[a] == 0 || board[a] != board[b] {
		return false
	}
	start, end := TilePoint{a%4 + 1, a/4 + 1}, TilePoint{b%4 + 1, b/4 + 1}
	clear := func(points []TilePoint) bool {
		for i := 0; i < len(points)-1; i++ {
			p, q := points[i], points[i+1]
			dx, dy := 0, 0
			if p.X < q.X {
				dx = 1
			}
			if p.X > q.X {
				dx = -1
			}
			if p.Y < q.Y {
				dy = 1
			}
			if p.Y > q.Y {
				dy = -1
			}
			for p != q {
				if p != start && p != end && p.X >= 1 && p.X <= 4 && p.Y >= 1 && p.Y <= 4 && board[(p.Y-1)*4+p.X-1] != 0 {
					return false
				}
				p = TilePoint{p.X + dx, p.Y + dy}
			}
		}
		return true
	}
	for x := 0; x <= 5; x++ {
		if clear([]TilePoint{start, {x, start.Y}, {x, end.Y}, end}) {
			return true
		}
	}
	for y := 0; y <= 5; y++ {
		if clear([]TilePoint{start, {start.X, y}, {end.X, y}, end}) {
			return true
		}
	}
	return false
}
func TestTilePathAgainstIndependentCorridorEnumeration(t *testing.T) {
	r := rand.New(rand.NewPCG(27, 91))
	for i := 0; i < 100; i++ {
		var b [16]int
		for j := range b {
			b[j] = r.IntN(5)
		}
		for a := 0; a < 16; a++ {
			for c := a + 1; c < 16; c++ {
				path := TilePath(b, a, c)
				if (path != nil) != referenceTileRoute(b, a, c) {
					t.Fatalf("board=%v a=%d b=%d path=%v", b, a, c, path)
				}
				if len(path) > 4 {
					t.Fatal("more than two turns", path)
				}
			}
		}
	}
}
func TestTileGamesAlwaysFinishAndOnlyCompletePays(t *testing.T) {
	for i := 0; i < 60; i++ {
		s, now := economyPet(t)
		s.Economy.Equipped = Equipment{Accessory: "leaf-pin", Room: "moon-lamp"}
		s.Economy.Owned = []string{"leaf-pin", "moon-lamp"}
		if _, err := s.Apply(Action{Kind: "play-tiles"}, now); err != nil {
			t.Fatal(err)
		}
		if s.Economy.Coins != 0 || s.CareCount != 0 {
			t.Fatal("start paid")
		}
		gameID := s.Game.ID
		for s.Game != nil {
			if err := s.Validate(now); err != nil {
				t.Fatal("invalid running board", err)
			}
			a, b := tilePair(t, &s, now)
			for _, cell := range []int{a, b} {
				if _, err := s.Apply(Action{Kind: "tile-pick", GameID: gameID, Tile: cell}, now); err != nil {
					t.Fatal(err)
				}
			}
			if s.Game != nil && (s.Economy.Coins != 0 || s.CareCount != 0) {
				t.Fatal("partial board paid")
			}
		}
		if s.Economy.Coins != TileCoins || s.Economy.GameCoins != TileCoins || s.CareCount != 1 || s.Growth.Care.Play != 1 {
			t.Fatal("completion", s)
		}
		if s.Economy.Equipped.Accessory != "leaf-pin" || s.Economy.Equipped.Room != "moon-lamp" {
			t.Fatal("equipment lost")
		}
		if len(s.Album.Entries) != 2 || s.Album.Entries[1].Kind != "tiles" {
			t.Fatal("missing memory", s.Album)
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Apply(Action{Kind: "tile-pick", GameID: gameID, Tile: 0}, now); err == nil {
			t.Fatal("ended session replay")
		}
	}
}
func TestTileSelectClearMismatchCancelAndCrossGameGuards(t *testing.T) {
	s, now := economyPet(t)
	s.Apply(Action{Kind: "play-tiles"}, now)
	id := s.Game.ID
	before, _ := json.Marshal(s)
	for _, a := range []Action{{Kind: "catch", GameID: id}, {Kind: "feed"}, {Kind: "play"}, {Kind: "play-tiles"}, {Kind: "daily"}, {Kind: "sleep"}, {Kind: "tile-pick", Tile: 0}, {Kind: "tile-clear", GameID: "stale"}, {Kind: "tile-pick", GameID: id, Tile: 16}} {
		if _, err := s.Apply(a, now); err == nil {
			t.Fatalf("accepted %+v", a)
		}
		after, _ := json.Marshal(s)
		if string(before) != string(after) {
			t.Fatal("error mutated state")
		}
	}
	a, b := tilePair(t, &s, now)
	s.Apply(Action{Kind: "tile-pick", GameID: id, Tile: a}, now)
	if s.Game.Tiles.Pick != a {
		t.Fatal("not selected")
	}
	// A different type is not a match and does not remove the first choice.
	wrong := -1
	for i, v := range s.Game.Tiles.Board {
		if v != s.Game.Tiles.Board[a] {
			wrong = i
			break
		}
	}
	s.Apply(Action{Kind: "tile-pick", GameID: id, Tile: wrong}, now)
	if s.Game.Tiles.Pick != a || s.Game.Tiles.Pairs != 0 {
		t.Fatal("mismatch removed tiles")
	}
	s.Apply(Action{Kind: "tile-clear", GameID: id}, now)
	if s.Game.Tiles.Pick != -1 {
		t.Fatal("clear failed")
	}
	s.Apply(Action{Kind: "tile-pick", GameID: id, Tile: a}, now)
	s.Apply(Action{Kind: "tile-pick", GameID: id, Tile: b}, now)
	if s.Game.Tiles.Pairs != 1 {
		t.Fatal("pair not removed")
	}
	s.Apply(Action{Kind: "cancel-play", GameID: id}, now)
	if s.Game != nil || s.Economy.Coins != 0 || s.CareCount != 0 || len(s.Album.Entries) != 1 {
		t.Fatal("cancel rewarded")
	}
	s.Apply(Action{Kind: "play"}, now)
	if _, err := s.Apply(Action{Kind: "tile-pick", GameID: s.Game.ID, Tile: 0}, now); err == nil {
		t.Fatal("tiles operated star game")
	}
	s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now)
	s.Sleeping = true
	if _, err := s.Apply(Action{Kind: "play-tiles"}, now); err == nil {
		t.Fatal("sleep interrupted")
	}
}
func TestTileSharedCoinCapGrowthCooldownAndFirstMemory(t *testing.T) {
	s, now := economyPet(t)
	s.Apply(Action{Kind: "play-tiles"}, now)
	finishTiles(t, &s, now)
	first := s.Album.Entries[1]
	end := completeStars(t, &s, now, 5)
	if s.Economy.GameCoins != 14 {
		t.Fatal("games do not share budget")
	}
	for i := 0; i < 3; i++ {
		s.Apply(Action{Kind: "play-tiles"}, end)
		finishTiles(t, &s, end)
	}
	if s.Economy.Coins != 30 || s.Economy.GameCoins != 30 || s.Growth.Care.Play != 1 || s.CareCount != 5 {
		t.Fatal(s.Economy, s.Growth, s.CareCount)
	}
	if len(s.Album.Entries) != 4 || !reflect.DeepEqual(first, s.Album.Entries[1]) {
		t.Fatal("first shared memory overwritten")
	}
	for i := 0; i < 40; i++ {
		s.Log(end, "小日常")
	}
	if !reflect.DeepEqual(first, s.Album.Entries[1]) {
		t.Fatal("diary evicted game memory")
	}
	next := end.Add(24 * time.Hour)
	s.Advance(next)
	s.Needs.Energy = 80
	s.Apply(Action{Kind: "play-tiles"}, next)
	finishTiles(t, &s, next)
	if s.Economy.GameCoins != 6 || s.Economy.Coins != 36 {
		t.Fatal("new day", s.Economy)
	}
}
func TestTileSaveValidationAndSchemaFourMigration(t *testing.T) {
	s, now := economyPet(t)
	s.Apply(Action{Kind: "play-tiles"}, now)
	raw, _ := json.Marshal(s)
	for _, mutate := range []func(*State){
		func(s *State) { s.Schema = 4 }, func(s *State) { s.Game.Kind = "fake" }, func(s *State) { s.Game.Tiles = nil }, func(s *State) { s.Game.Score = 1 },
		func(s *State) { s.Game.Round = 1 }, func(s *State) { s.Game.LastBeat = 0 }, func(s *State) { s.Game.Tiles.Pick = 16 }, func(s *State) { s.Game.Tiles.Pairs = 8 },
		func(s *State) { s.Game.Tiles.Board[0] = 9 }, func(s *State) { s.Game.Tiles.Board[0] = 0 }, func(s *State) { s.Game.Tiles.Shuffles = 1 },
	} {
		var bad State
		json.Unmarshal(raw, &bad)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("invalid tile save accepted", bad)
		}
	}
	legacy, _ := economyPet(t)
	legacy.Schema = 4
	legacy.Companion = nil
	legacy.Pond = nil
	legacy.Economy.Coins = 18
	legacy.Apply(Action{Kind: "play"}, now)
	before := *legacy.Game
	oldGrowth := *legacy.Growth
	oldAlbum := *legacy.Album
	oldEconomy := *legacy.Economy
	if !legacy.Upgrade(now) || legacy.Schema != Schema || *legacy.Game != before || *legacy.Growth != oldGrowth || !reflect.DeepEqual(*legacy.Album, oldAlbum) || !reflect.DeepEqual(*legacy.Economy, oldEconomy) {
		t.Fatal("schema four migration lost state")
	}
	if legacy.Validate(now) != nil || legacy.Upgrade(now) {
		t.Fatal("migration not stable")
	}
}
func TestTileDeadEndReshufflePreservesInventory(t *testing.T) {
	tm := TileMatch{Board: [16]int{1, 2, 3, 4, 5, 1, 2, 6, 7, 5, 8, 3, 4, 7, 6, 8}, Pick: -1}
	// Even if this arrangement has an outside route, arrange's contract must
	// preserve exactly two copies of each type and yield a legal move.
	if err := tm.arrange(); err != nil {
		t.Fatal(err)
	}
	counts := [9]int{}
	for _, v := range tm.Board {
		counts[v]++
	}
	for v := 1; v <= 8; v++ {
		if counts[v] != 2 {
			t.Fatal("lost tiles", tm)
		}
	}
	if !tm.playable() {
		t.Fatal("reshuffle still blocked")
	}
}

// This fixture has a legal outside route for 4, but no remaining legal move
// after that pair is collected. Exercise the actual automatic-shuffle branch.
func TestTilePairAutomaticallyReshufflesARealDeadEnd(t *testing.T) {
	s, now := economyPet(t)
	if _, err := s.Apply(Action{Kind: "play-tiles"}, now); err != nil {
		t.Fatal(err)
	}
	board := [16]int{3, 5, 8, 7, 1, 6, 2, 1, 7, 8, 5, 3, 6, 4, 2, 4}
	s.Game.Tiles.Board = board
	after := board
	after[13], after[15] = 0, 0
	if (TileMatch{Board: after}).playable() {
		t.Fatal("fixture is not a dead end")
	}
	id := s.Game.ID
	for _, cell := range []int{13, 15} {
		if _, err := s.Apply(Action{Kind: "tile-pick", GameID: id, Tile: cell}, now); err != nil {
			t.Fatal(err)
		}
	}
	tiles := s.Game.Tiles
	if tiles.Shuffles != 1 || tiles.Pairs != 1 || tiles.Pick != -1 || !tiles.playable() {
		t.Fatal("did not rescue dead end", tiles)
	}
	var want, got [9]int
	for _, v := range after {
		want[v]++
	}
	for _, v := range tiles.Board {
		got[v]++
	}
	if got != want || s.Economy.Coins != 0 || s.CareCount != 0 {
		t.Fatal("reshuffle changed inventory or paid", got, want)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	finishTiles(t, &s, now)
	if s.Economy.Coins != TileCoins || s.CareCount != 1 {
		t.Fatal("rescued game did not finish")
	}
}
