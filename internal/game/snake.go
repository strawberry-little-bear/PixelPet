package game

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"
)

const SnakeWidth = 12
const SnakeHeight = 10
const SnakeGoal = 8
const SnakeInterval = int64(600)
const snakeLease = int64(2200)

// Each request advances at most one cell. Time away never becomes catch-up
// movement. Step is an optimistic lock shared by every tab, not a client score.
type Snake struct {
	Body       []TilePoint `json:"body"`
	Food       TilePoint   `json:"food"`
	Direction  int         `json:"direction"` // clockwise: right, down, left, up
	Eaten      int         `json:"eaten"`
	Step       int         `json:"step"`
	LastMoveAt int64       `json:"lastMoveAt"`
	Paused     bool        `json:"paused"`
	End        string      `json:"end,omitempty"` // wall, body, won, limit
}

var snakeDirections = [...]TilePoint{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}

func snakeInside(p TilePoint) bool {
	return p.X >= 0 && p.X < SnakeWidth && p.Y >= 0 && p.Y < SnakeHeight
}
func (n *Snake) placeFood() error {
	free := []TilePoint{}
	for y := 0; y < SnakeHeight; y++ {
		for x := 0; x < SnakeWidth; x++ {
			p := TilePoint{x, y}
			occupied := false
			for _, b := range n.Body {
				occupied = occupied || b == p
			}
			if !occupied {
				free = append(free, p)
			}
		}
	}
	i, err := rand.Int(rand.Reader, big.NewInt(int64(len(free))))
	if err != nil {
		return err
	}
	n.Food = free[i.Int64()]
	return nil
}
func newSnake(now time.Time) (*Snake, error) {
	// Give the first round a readable opening: moving straight reaches the
	// first fruit before the player has to make a difficult turn. Subsequent
	// fruits remain random, so the game still becomes a navigation challenge
	// after the player has learned the two steering keys.
	return &Snake{
		Body:       []TilePoint{{4, 5}, {3, 5}, {2, 5}},
		Food:       TilePoint{7, 5},
		Paused:     true,
		LastMoveAt: now.UnixMilli(),
	}, nil
}

// ExpireSnake persists a safe pause on reads without advancing any cells.
func (s *State) ExpireSnake(now time.Time) bool {
	if s.Game == nil || s.Game.Snake == nil {
		return false
	}
	n := s.Game.Snake
	if !n.Paused && n.End == "" && now.UnixMilli()-n.LastMoveAt > snakeLease {
		n.Paused = true
		return true
	}
	return false
}
func (s *State) applySnake(a Action, now time.Time) (string, error) {
	if s.Game == nil || s.Game.Kind != "snake" || s.Game.Snake == nil {
		return "", errors.New("贪吃蛇还没有开始")
	}
	n := s.Game.Snake
	if a.Step != n.Step {
		return "", errors.New("棋盘已经变化，请同步后再试")
	}
	switch a.Kind {
	case "snake-finish":
		if n.End == "" {
			return "", errors.New("还没结束，可以按 C 暂停")
		}
		eaten := n.Eaten
		if eaten >= 3 {
			s.recordGameExperience("snake", now)
		}
		s.Game = nil
		coins := 0
		if eaten >= 3 {
			s.Needs.Mood = clamp(s.Needs.Mood + 12)
			s.Needs.Energy = clamp(s.Needs.Energy - 6)
			s.Needs.Hunger = clamp(s.Needs.Hunger - 3)
			s.CareCount++
			s.recordCare("play", 0, now)
			s.sharedMemory("snake", now)
			s.rememberGameKeepsake("snake", now)
			coins = s.rewardGame(min(eaten, 6), now)
		}
		msg := fmt.Sprintf("一起吃到 %d 颗果子！", eaten)
		if eaten >= 3 {
			msg += coinMessage(coins)
		} else {
			msg += "吃到 3 颗后完成才计入陪伴与金币，下次再试！"
		}
		s.Log(now, msg)
		return msg, nil
	case "snake-pause":
		n.Paused = true
		return "慢慢来，小伙伴替你看着果子。", nil
	case "snake-resume":
		if n.End != "" {
			return "", errors.New("这局已结束，请先收好成绩")
		}
		n.Paused = false
		n.LastMoveAt = now.UnixMilli()
		return "A 左转 · B 右转 · C 暂停", nil
	case "snake-step":
		if a.Turn < -1 || a.Turn > 1 {
			return "", errors.New("只能左转、直行或右转")
		}
		if n.Paused || n.End != "" {
			return "", errors.New("先继续游戏吧")
		}
		elapsed := now.UnixMilli() - n.LastMoveAt
		if elapsed > snakeLease {
			n.Paused = true
			return "离开了一会儿，已暂停。", nil
		}
		if elapsed < SnakeInterval {
			return "", errors.New("下一步还没到哦")
		}
		n.Direction = (n.Direction + a.Turn + 4) % 4
		n.Step++
		n.LastMoveAt = now.UnixMilli()
		d := snakeDirections[n.Direction]
		head := TilePoint{n.Body[0].X + d.X, n.Body[0].Y + d.Y}
		if !snakeInside(head) {
			n.End = "wall"
			return "碰到围栏啦，按 B 收好成绩。", nil
		}
		eating := head == n.Food
		body := n.Body
		if !eating {
			body = body[:len(body)-1]
		}
		for _, p := range body {
			if p == head {
				n.End = "body"
				return "绕到尾巴啦，按 B 收好成绩。", nil
			}
		}
		n.Body = append([]TilePoint{head}, body...)
		if eating {
			n.Eaten++
			if n.Eaten == SnakeGoal {
				n.End = "won"
				return "八颗果子收齐！按 B 和小伙伴庆祝。", nil
			}
			if err := n.placeFood(); err != nil {
				return "", err
			}
		}
		if n.Step >= 10000 {
			n.End = "limit"
			return "运动时间到啦，按 B 收好成绩。", nil
		}
		return "", nil
	}
	return "", errors.New("不认识这个操作")
}
func (s State) validSnakeGame() bool {
	g := s.Game
	if g == nil {
		return true
	}
	if g.Kind != "snake" {
		return g.Snake == nil
	}
	n := g.Snake
	if s.Schema < 6 || n == nil || g.Tiles != nil || s.Sleeping || g.Round != 0 || g.Score != 0 || g.LastBeat != -1 {
		return false
	}
	if n.Eaten < 0 || n.Eaten > SnakeGoal || len(n.Body) != 3+n.Eaten || n.Step < n.Eaten || n.Step > 10000 || n.Direction < 0 || n.Direction > 3 || n.LastMoveAt < g.StartedAt || n.LastMoveAt > s.LastTick || !snakeInside(n.Food) {
		return false
	}
	if n.End != "" && n.End != "wall" && n.End != "body" && n.End != "won" && n.End != "limit" {
		return false
	}
	if (n.End == "won") != (n.Eaten == SnakeGoal) || (n.End == "limit" && n.Step != 10000) || (n.End == "" && n.Step == 10000) {
		return false
	}
	seen := map[TilePoint]bool{}
	for i, p := range n.Body {
		if !snakeInside(p) || seen[p] || (p == n.Food && n.End != "won") {
			return false
		}
		if i > 0 {
			q := n.Body[i-1]
			dx, dy := p.X-q.X, p.Y-q.Y
			if dx*dx+dy*dy != 1 {
				return false
			}
		}
		seen[p] = true
	}
	return true
}
