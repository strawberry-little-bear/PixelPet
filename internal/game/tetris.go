package game

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"
)

const TetrisWidth = 8
const TetrisHeight = 12
const TetrisGoal = 8

// Give new players more time to choose a lane on the compact 8x12 board.
// Hard drops remain available for experienced players.
const TetrisInterval = int64(1800)
const tetrisLease = int64(3000)
const tetrisPieceLimit = 120
const tetrisStepLimit = 20000

type Falling struct {
	Kind     int `json:"kind"`
	Rotation int `json:"rotation"`
	X        int `json:"x"`
	Y        int `json:"y"`
}

// Step is a version for every accepted command, not a client-reported score.
// LastFallAt only changes on gravity, resume or lock; moving never delays gravity.
type Tetris struct {
	Board      []int    `json:"board"`
	Active     *Falling `json:"active,omitempty"`
	Next       int      `json:"next"`
	Bag        []int    `json:"bag"`
	Lines      int      `json:"lines"`
	Pieces     int      `json:"pieces"`
	Step       int      `json:"step"`
	LastFallAt int64    `json:"lastFallAt"`
	Paused     bool     `json:"paused"`
	End        string   `json:"end,omitempty"`
}

var tetrominoes = [7][4]TilePoint{
	{{0, 0}, {1, 0}, {2, 0}, {3, 0}}, // I
	{{0, 0}, {1, 0}, {0, 1}, {1, 1}}, // O
	{{1, 0}, {0, 1}, {1, 1}, {2, 1}}, // T
	{{1, 0}, {2, 0}, {0, 1}, {1, 1}}, // S
	{{0, 0}, {1, 0}, {1, 1}, {2, 1}}, // Z
	{{0, 0}, {0, 1}, {1, 1}, {2, 1}}, // J
	{{2, 0}, {0, 1}, {1, 1}, {2, 1}}, // L
}

// Compact clockwise rotations, with small wall kicks; not a full SRS simulator.
func TetrisCells(kind, rotation int) [4]TilePoint {
	if kind < 1 || kind > 7 {
		return [4]TilePoint{}
	}
	cells := tetrominoes[kind-1]
	if kind == 2 {
		return cells
	}
	for r := 0; r < rotation%4; r++ {
		minX, minY := 4, 4
		for i, p := range cells {
			cells[i] = TilePoint{3 - p.Y, p.X}
			minX = min(minX, cells[i].X)
			minY = min(minY, cells[i].Y)
		}
		for i := range cells {
			cells[i].X -= minX
			cells[i].Y -= minY
		}
	}
	return cells
}
func (n *Tetris) fits(p Falling) bool {
	for _, c := range TetrisCells(p.Kind, p.Rotation) {
		x, y := p.X+c.X, p.Y+c.Y
		if x < 0 || x >= TetrisWidth || y < 0 || y >= TetrisHeight || n.Board[y*TetrisWidth+x] != 0 {
			return false
		}
	}
	return true
}
func (n *Tetris) draw() (int, error) {
	if len(n.Bag) == 0 {
		n.Bag = []int{1, 2, 3, 4, 5, 6, 7}
		for i := 6; i > 0; i-- {
			j, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
			if err != nil {
				return 0, err
			}
			n.Bag[i], n.Bag[j.Int64()] = n.Bag[j.Int64()], n.Bag[i]
		}
	}
	k := n.Bag[0]
	n.Bag = n.Bag[1:]
	return k, nil
}
func (n *Tetris) spawn() error {
	kind := n.Next
	p := Falling{Kind: kind, X: 2}
	if !n.fits(p) {
		n.Active = nil
		n.End = "stacked"
		return nil
	}
	next, err := n.draw()
	if err != nil {
		return err
	}
	n.Next = next
	n.Active = &p
	return nil
}
func newTetris(now time.Time) (*Tetris, error) {
	n := &Tetris{Board: make([]int, TetrisWidth*TetrisHeight), Paused: true, LastFallAt: now.UnixMilli()}
	k, err := n.draw()
	if err != nil {
		return nil, err
	}
	n.Next = k
	return n, n.spawn()
}
func (n *Tetris) lock(now time.Time) error {
	for _, c := range TetrisCells(n.Active.Kind, n.Active.Rotation) {
		n.Board[(n.Active.Y+c.Y)*TetrisWidth+n.Active.X+c.X] = n.Active.Kind
	}
	n.Pieces++
	rows := make([]int, 0, len(n.Board))
	for y := 0; y < TetrisHeight; y++ {
		full := true
		for x := 0; x < TetrisWidth; x++ {
			full = full && n.Board[y*TetrisWidth+x] != 0
		}
		if full {
			n.Lines++
		} else {
			rows = append(rows, n.Board[y*TetrisWidth:(y+1)*TetrisWidth]...)
		}
	}
	n.Board = append(make([]int, TetrisWidth*TetrisHeight-len(rows)), rows...)
	n.Active = nil
	n.LastFallAt = now.UnixMilli()
	if n.Lines >= TetrisGoal {
		n.End = "won"
		return nil
	}
	if n.Pieces >= tetrisPieceLimit {
		n.End = "limit"
		return nil
	}
	return n.spawn()
}
func (n *Tetris) bump() {
	n.Step++
	if n.Step >= tetrisStepLimit && n.End == "" {
		n.End = "limit"
		n.Active = nil
	}
}
func (s *State) ExpireTetris(now time.Time) bool {
	if s.Game == nil || s.Game.Tetris == nil {
		return false
	}
	n := s.Game.Tetris
	if !n.Paused && n.End == "" && now.UnixMilli()-n.LastFallAt > tetrisLease {
		n.Paused = true
		n.bump()
		return true
	}
	return false
}
func (s *State) applyTetris(a Action, now time.Time) (string, error) {
	if s.Game == nil || s.Game.Kind != "tetris" || s.Game.Tetris == nil {
		return "", errors.New("俄罗斯方块还没有开始")
	}
	n := s.Game.Tetris
	if a.Step != n.Step {
		return "", errors.New("棋盘已经变化，请同步后再试")
	}
	if a.Kind == "tetris-finish" {
		if n.End == "" {
			return "", errors.New("这局还没有结束")
		}
		lines := n.Lines
		if lines >= 2 {
			s.recordGameExperience("tetris", now)
		}
		s.Game = nil
		coins := 0
		if lines >= 2 {
			s.Needs.Mood = clamp(s.Needs.Mood + 12)
			s.Needs.Energy = clamp(s.Needs.Energy - 6)
			s.Needs.Hunger = clamp(s.Needs.Hunger - 3)
			s.CareCount++
			s.recordCare("play", 0, now)
			s.sharedMemory("tetris", now)
			s.rememberGameKeepsake("tetris", now)
			coins = s.rewardGame(min(lines, 6), now)
		}
		msg := fmt.Sprintf("一起拼好了 %d 行积木！", lines)
		if lines >= 2 {
			msg += coinMessage(coins)
		} else {
			msg += "消除 2 行后完成才计入陪伴与金币，下次再试！"
		}
		s.Log(now, msg)
		return msg, nil
	}
	if n.End != "" {
		return "", errors.New("这局已结束，请先收好成绩")
	}
	// Late commands pause rather than advancing the pet's unattended game.
	if !n.Paused && now.UnixMilli()-n.LastFallAt > tetrisLease {
		n.Paused = true
		n.bump()
		return "离开了一会儿，积木已暂停。", nil
	}
	switch a.Kind {
	case "tetris-pause":
		n.Paused = true
		n.bump()
		return "先想一想，小伙伴替你看着积木。", nil
	case "tetris-resume":
		n.Paused = false
		n.LastFallAt = now.UnixMilli()
		n.bump()
		return "A 左移 · B 右移 · C 操作 / 暂停", nil
	case "tetris-move":
		if n.Paused {
			return "", errors.New("先继续游戏吧")
		}
		if a.Turn != -1 && a.Turn != 1 {
			return "", errors.New("只能向左或向右移动一格")
		}
		p := *n.Active
		p.X += a.Turn
		if n.fits(p) {
			n.Active = &p
		}
		n.bump()
	case "tetris-rotate", "tetris-drop":
		if !n.Paused {
			return "", errors.New("先按 C 打开积木操作")
		}
		if a.Kind == "tetris-rotate" {
			p := *n.Active
			p.Rotation = (p.Rotation + 1) % 4
			for _, dx := range []int{0, -1, 1, -2, 2} {
				q := p
				q.X += dx
				if n.fits(q) {
					n.Active = &q
					break
				}
			}
		} else {
			for {
				p := *n.Active
				p.Y++
				if !n.fits(p) {
					break
				}
				n.Active = &p
			}
			if err := n.lock(now); err != nil {
				return "", err
			}
		}
		n.Paused = false
		n.LastFallAt = now.UnixMilli()
		n.bump()
	case "tetris-step":
		if n.Paused {
			return "", errors.New("先继续游戏吧")
		}
		if now.UnixMilli()-n.LastFallAt < TetrisInterval {
			return "", errors.New("下一格还没到哦")
		}
		p := *n.Active
		p.Y++
		n.LastFallAt = now.UnixMilli()
		if n.fits(p) {
			n.Active = &p
		} else if err := n.lock(now); err != nil {
			return "", err
		}
		n.bump()
	default:
		return "", errors.New("不认识这个积木操作")
	}
	return "", nil
}
func (s State) validTetrisGame() bool {
	g := s.Game
	if g == nil {
		return true
	}
	if g.Kind != "tetris" {
		return g.Tetris == nil
	}
	n := g.Tetris
	if s.Schema < 7 || n == nil || g.Tiles != nil || g.Snake != nil || s.Sleeping || g.Round != 0 || g.Score != 0 || g.LastBeat != -1 {
		return false
	}
	if len(n.Board) != TetrisWidth*TetrisHeight || n.Next < 1 || n.Next > 7 || len(n.Bag) > 6 || n.Lines < 0 || n.Lines > TetrisGoal+3 || n.Pieces < 0 || n.Pieces > tetrisPieceLimit || n.Step < n.Pieces || n.Step > tetrisStepLimit || n.LastFallAt < g.StartedAt || n.LastFallAt > s.LastTick {
		return false
	}
	seen := map[int]bool{}
	for _, v := range n.Bag {
		if v < 1 || v > 7 || seen[v] {
			return false
		}
		seen[v] = true
	}
	occupied := 0
	for y := 0; y < TetrisHeight; y++ {
		full := true
		for _, v := range n.Board[y*TetrisWidth : (y+1)*TetrisWidth] {
			if v < 0 || v > 7 {
				return false
			}
			if v > 0 {
				occupied++
			} else {
				full = false
			}
		}
		if full {
			return false
		}
	}
	if occupied != 4*n.Pieces-TetrisWidth*n.Lines {
		return false
	}
	switch n.End {
	case "":
		if n.Active == nil || n.Lines >= TetrisGoal || n.Pieces >= tetrisPieceLimit || n.Step >= tetrisStepLimit {
			return false
		}
	case "won":
		if n.Active != nil || n.Lines < TetrisGoal {
			return false
		}
	case "stacked":
		if n.Active != nil || n.Lines >= TetrisGoal || n.Pieces >= tetrisPieceLimit {
			return false
		}
		if n.fits(Falling{Kind: n.Next, X: 2}) {
			return false
		}
	case "limit":
		if n.Active != nil || (n.Pieces != tetrisPieceLimit && n.Step < tetrisStepLimit) || n.Lines >= TetrisGoal {
			return false
		}
	default:
		return false
	}
	if n.Active != nil {
		p := *n.Active
		if p.Kind < 1 || p.Kind > 7 || p.Rotation < 0 || p.Rotation > 3 || p.X < 0 || p.X >= TetrisWidth || p.Y < 0 || p.Y >= TetrisHeight || !n.fits(p) {
			return false
		}
	}
	return true
}
