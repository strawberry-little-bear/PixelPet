package game

import (
	"crypto/rand"
	"errors"
	"math/big"
	"time"
)

const TilePairs = 8
const TileCoins = 6

type TilePoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}
type TileMatch struct {
	Board    [16]int `json:"board"`
	Pick     int     `json:"pick"` // -1 means no selected tile
	Pairs    int     `json:"pairs"`
	Shuffles int     `json:"shuffles"`
}

// TilePath uses a one-cell empty border and at most two right-angle turns.
// It is the server's rule, not a client-submitted score or path.
func TilePath(board [16]int, a, b int) []TilePoint {
	if a < 0 || a >= 16 || b < 0 || b >= 16 || a == b || board[a] == 0 || board[a] != board[b] {
		return nil
	}
	start, end := TilePoint{a%4 + 1, a/4 + 1}, TilePoint{b%4 + 1, b/4 + 1}
	type node struct {
		p          TilePoint
		dir, turns int
		path       []TilePoint
	}
	directions := [...]TilePoint{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}
	var seen [6][6][4]int
	for y := range seen {
		for x := range seen[y] {
			for d := range seen[y][x] {
				seen[y][x][d] = 3
			}
		}
	}
	queue := []node{{start, -1, 0, []TilePoint{start}}}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		for d, step := range directions {
			p := TilePoint{n.p.X + step.X, n.p.Y + step.Y}
			turns := n.turns
			if n.dir != -1 && n.dir != d {
				turns++
			}
			if p.X < 0 || p.X > 5 || p.Y < 0 || p.Y > 5 || turns > 2 || p == start {
				continue
			}
			if p != end && p.X >= 1 && p.X <= 4 && p.Y >= 1 && p.Y <= 4 && board[(p.Y-1)*4+p.X-1] != 0 {
				continue
			}
			if seen[p.Y][p.X][d] <= turns {
				continue
			}
			seen[p.Y][p.X][d] = turns
			path := append(append([]TilePoint{}, n.path...), p)
			if p == end {
				return tileCorners(path)
			}
			queue = append(queue, node{p, d, turns, path})
		}
	}
	return nil
}
func tileCorners(path []TilePoint) []TilePoint {
	out := []TilePoint{path[0]}
	for i := 1; i < len(path)-1; i++ {
		if path[i].X-path[i-1].X != path[i+1].X-path[i].X || path[i].Y-path[i-1].Y != path[i+1].Y-path[i].Y {
			out = append(out, path[i])
		}
	}
	return append(out, path[len(path)-1])
}
func (t TileMatch) playable() bool {
	for a := 0; a < 16; a++ {
		for b := a + 1; b < 16; b++ {
			if TilePath(t.Board, a, b) != nil {
				return true
			}
		}
	}
	return false
}

// Only called between pairs, never while a player has one tile selected. In a
// dead end it preserves every remaining tile and opens a route without a fee.
func (t *TileMatch) arrange() error {
	values := []int{}
	for _, v := range t.Board {
		if v > 0 {
			values = append(values, v)
		}
	}
	for tries := 0; tries < 32; tries++ {
		for i := len(values) - 1; i > 0; i-- {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
			if err != nil {
				return err
			}
			j := int(n.Int64())
			values[i], values[j] = values[j], values[i]
		}
		t.Board = [16]int{}
		copy(t.Board[:], values)
		if t.playable() {
			return nil
		}
	}
	// A bounded fallback: adjacent equal pairs can always connect. Cleared cells
	// may move, but the inventory of remaining types never changes.
	counts := [9]int{}
	for _, v := range values {
		counts[v]++
	}
	t.Board = [16]int{}
	next := 0
	for v := 1; v <= 8; v++ {
		for i := 0; i < counts[v]; i++ {
			t.Board[next] = v
			next++
		}
	}
	return nil
}
func newTiles() (*TileMatch, error) {
	t := &TileMatch{Pick: -1}
	for i := 0; i < 16; i++ {
		t.Board[i] = i/2 + 1
	}
	return t, t.arrange()
}
func (s State) TileLink(a Action) []TilePoint {
	if a.Kind != "tile-pick" || s.Game == nil || s.Game.Kind != "tiles" || s.Game.ID != a.GameID || s.Game.Tiles == nil {
		return nil
	}
	return TilePath(s.Game.Tiles.Board, s.Game.Tiles.Pick, a.Tile)
}
func (s *State) applyTile(a Action, now time.Time) (string, error) {
	if s.Game == nil || s.Game.Kind != "tiles" || s.Game.Tiles == nil {
		return "", errors.New("连连看还没有开始")
	}
	t := s.Game.Tiles
	if a.Kind == "tile-clear" {
		t.Pick = -1
		return "选牌收好啦。A 找下一张，B 选中。", nil
	}
	if a.Tile < 0 || a.Tile >= 16 || t.Board[a.Tile] == 0 {
		return "", errors.New("请选择棋盘上还在的图案")
	}
	if t.Pick == a.Tile {
		t.Pick = -1
		return "取消选牌啦，慢慢找。", nil
	}
	if t.Pick == -1 {
		t.Pick = a.Tile
		return "找到相同图案，最多拐两次弯。", nil
	}
	if TilePath(t.Board, t.Pick, a.Tile) == nil {
		return "这两张还连不上，换一张或按 C 取消。", nil
	}
	t.Board[t.Pick], t.Board[a.Tile] = 0, 0
	t.Pick = -1
	t.Pairs++
	if t.Pairs == TilePairs {
		s.Game = nil
		s.Needs.Mood = clamp(s.Needs.Mood + 18)
		s.Needs.Energy = clamp(s.Needs.Energy - 6)
		s.Needs.Hunger = clamp(s.Needs.Hunger - 3)
		s.CareCount++
		s.recordCare("play", 0, now)
		s.sharedMemory("tiles", now)
		coins := s.rewardGame(TileCoins, now)
		msg := "一起连好八对图案！" + coinMessage(coins)
		s.Log(now, msg)
		return msg, nil
	}
	if !t.playable() {
		if err := t.arrange(); err != nil {
			return "", err
		}
		t.Shuffles++
		return "这对连好啦！小伙伴把剩下的图案重新摆好了，不扣金币。", nil
	}
	return "这对连好啦！小伙伴把图案收进篮子里。", nil
}
func (s State) validTileGame() bool {
	g := s.Game
	if g == nil {
		return true
	}
	if g.Kind == "fishing" {
		return s.Schema >= 8 && g.Tiles == nil
	}
	if g.Kind == "tetris" {
		return s.Schema >= 7 && g.Tiles == nil
	}
	if g.Kind == "snake" {
		return s.Schema >= 6 && g.Tiles == nil
	}
	if g.Kind == "" {
		return g.Tiles == nil
	}
	if s.Schema < 5 || g.Kind != "tiles" || g.Tiles == nil || g.Round != 0 || g.Score != 0 || g.LastBeat != -1 {
		return false
	}
	t := g.Tiles
	if t.Pairs < 0 || t.Pairs >= TilePairs || t.Pick < -1 || t.Pick >= 16 || t.Shuffles < 0 || t.Shuffles > t.Pairs {
		return false
	}
	if t.Pick >= 0 && t.Board[t.Pick] == 0 {
		return false
	}
	counts := [9]int{}
	for _, v := range t.Board {
		if v < 0 || v > 8 {
			return false
		}
		counts[v]++
	}
	if counts[0] != t.Pairs*2 {
		return false
	}
	for v := 1; v <= 8; v++ {
		if counts[v] != 0 && counts[v] != 2 {
			return false
		}
	}
	return t.playable()
}
