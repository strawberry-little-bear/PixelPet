package game

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"math/big"
	"time"
)

// A relaxed turn-based round: searches happen only on explicit saved commands.
const (
	TreasureCells     = 9
	TreasureSearches  = 6
	treasureStepLimit = 1000000
)

// TreasureHunt keeps the actual map and ordered searches, never a client score.
// Layout is local save data, not a cryptographic anti-cheat secret. Presentation
// must use cell(): unsearched items/clues stay hidden until the round ends.
type TreasureHunt struct {
	Layout []int `json:"layout"` // 0 = empty; exactly one each of items 1, 2 and 3
	Opened []int `json:"opened"`
	Step   int   `json:"step"`
	Paused bool  `json:"paused"`
}

type treasureCell struct {
	Opened bool
	Item   int
	Nearby *int
}
type treasureOutcome struct {
	Searches  int
	Found     int
	BaseCoins int // Applied only by the explicit, transactional finish action.
}

func newTreasure() (*TreasureHunt, error) { return newTreasureWithEntropy(rand.Reader) }
func newTreasureWithEntropy(source io.Reader) (*TreasureHunt, error) {
	// Fisher-Yates with rejection-sampled draws, not biased byte % n. Each
	// placement has the same number of permutations; no empirical odds claim.
	order := [TreasureCells]int{0, 1, 2, 3, 4, 5, 6, 7, 8}
	for i := len(order) - 1; i > 0; i-- {
		draw, err := rand.Int(source, big.NewInt(int64(i+1)))
		if err != nil {
			return nil, err
		}
		j := int(draw.Int64())
		order[i], order[j] = order[j], order[i]
	}
	n := &TreasureHunt{Layout: make([]int, TreasureCells), Opened: []int{}, Paused: true}
	for item := 1; item <= 3; item++ {
		n.Layout[order[item-1]] = item
	}
	return n, nil
}

func (n *TreasureHunt) found() int {
	if n == nil {
		return 0
	}
	total := 0
	for _, index := range n.Opened {
		if index >= 0 && index < len(n.Layout) && n.Layout[index] > 0 {
			total++
		}
	}
	return total
}
func (n *TreasureHunt) done() bool {
	return n != nil && (len(n.Opened) >= TreasureSearches || n.found() == 3)
}
func (n *TreasureHunt) valid() bool {
	if n == nil || len(n.Layout) != TreasureCells || n.Opened == nil || len(n.Opened) > TreasureSearches || n.Step < 0 || n.Step > treasureStepLimit {
		return false
	}
	var items [4]int
	for _, item := range n.Layout {
		if item < 0 || item > 3 {
			return false
		}
		items[item]++
	}
	if items[1] != 1 || items[2] != 1 || items[3] != 1 {
		return false
	}
	if (!n.Paused && n.Step == 0) || (len(n.Opened) > 0 && n.Step < len(n.Opened)+1) {
		return false
	}
	var seen [TreasureCells]bool
	found := 0
	for _, index := range n.Opened {
		if index < 0 || index >= TreasureCells || seen[index] || found == 3 {
			return false
		}
		seen[index] = true
		if n.Layout[index] > 0 {
			found++
		}
	}
	return !n.done() || n.Paused
}

func (n *TreasureHunt) cell(index int) treasureCell {
	if !n.valid() || index < 0 || index >= TreasureCells {
		return treasureCell{}
	}
	opened := false
	for _, old := range n.Opened {
		opened = opened || old == index
	}
	view := treasureCell{Opened: opened}
	if !opened && !n.done() {
		return view
	}
	view.Item = n.Layout[index]
	if !opened || view.Item > 0 {
		return view
	}
	// A clue counts all eight neighboring squares, never the whole row/column.
	nearby := 0
	for at, item := range n.Layout {
		dr, dc := at/3-index/3, at%3-index%3
		if item > 0 && dr >= -1 && dr <= 1 && dc >= -1 && dc <= 1 {
			nearby++
		}
	}
	view.Nearby = &nearby
	return view
}

func (n *TreasureHunt) apply(kind string, index, step int) error {
	if !n.valid() {
		return errors.New("寻宝记录无效，请先同步存档")
	}
	if step != n.Step {
		return errors.New("探索进度已变化，请先同步后再试")
	}
	switch kind {
	case "treasure-pause":
		if n.Paused {
			return nil
		}
		// Even a round at the defensive step bound can be paused and discarded.
		n.Paused = true
		n.Step = min(treasureStepLimit, n.Step+1)
		return nil
	case "treasure-resume":
		if n.done() {
			return errors.New("探索已经结束，收好这次经历吧")
		}
		if !n.Paused {
			return nil
		}
		if n.Step >= treasureStepLimit {
			return errors.New("这次停留太久啦，可放弃后重新探索")
		}
		n.Paused = false
		n.Step++
		return nil
	case "treasure-dig":
		if n.done() {
			return errors.New("探索已经结束，收好这次经历吧")
		}
		if n.Paused {
			return errors.New("准备好后继续，再选一格探索吧")
		}
		if n.Step >= treasureStepLimit {
			return errors.New("这次停留太久啦，可暂停后放弃再来")
		}
		if index < 0 || index >= TreasureCells {
			return errors.New("请选择林地中的一格")
		}
		for _, old := range n.Opened {
			if old == index {
				return errors.New("这里已经看过啦，不会消耗探索机会")
			}
		}
		n.Opened = append(n.Opened, index)
		n.Step++
		if n.done() {
			n.Paused = true
		}
		return nil
	default:
		return errors.New("不认识这个寻宝操作")
	}
}
func (n *TreasureHunt) outcome() (treasureOutcome, error) {
	if !n.valid() || !n.done() {
		return treasureOutcome{}, errors.New("完成六次探索或找到三件小物后再收好")
	}
	return treasureOutcome{Searches: len(n.Opened), Found: n.found(), BaseCoins: 3 + n.found()}, nil
}

// validTreasureGame rejects cross-game payloads, including old-schema imports.
func (s State) validTreasureGame() bool {
	g := s.Game
	if g == nil {
		return true
	}
	if g.Kind != "treasure" {
		return g.Treasure == nil
	}
	return s.Schema >= 16 && !s.Sleeping && g.Treasure.valid() &&
		g.Walking == nil && g.Fishing == nil && g.Tetris == nil && g.Snake == nil && g.Tiles == nil &&
		g.Round == 0 && g.Score == 0 && g.LastBeat == -1
}

func (s *State) applyTreasure(a Action, now time.Time) (string, error) {
	if s.Game == nil || s.Game.Kind != "treasure" || s.Game.Treasure == nil {
		return "", errors.New("先一起到森林看看吧")
	}
	n := s.Game.Treasure
	if !n.valid() || a.Step != n.Step {
		return "", errors.New("探索进度已变化，请先同步后再试")
	}
	if a.Kind != "treasure-finish" {
		if err := n.apply(a.Kind, a.Tile, a.Step); err != nil {
			return "", err
		}
		return "", nil
	}
	result, err := n.outcome()
	if err != nil {
		return "", err
	}
	s.recordGameExperience("treasure", now)
	s.sharedMemory("treasure", now)
	s.Game = nil
	s.Needs.Mood = clamp(s.Needs.Mood + 10)
	s.Needs.Energy = clamp(s.Needs.Energy - 3)
	s.Needs.Hunger = clamp(s.Needs.Hunger - 2)
	s.CareCount++
	s.recordCare("play", 0, now)
	coins := s.rewardGame(result.BaseCoins, now)
	msg := fmt.Sprintf("一起探索了 %d 格，找到 %d 件森林小物。不必找齐，慢慢陪伴就好。", result.Searches, result.Found) + coinMessage(coins)
	s.Log(now, msg)
	return msg, nil
}
