package game

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"
)

const fishingLease = int64(3500)
const FishingInterval = int64(1000)
const FishingWindow = 10000
const fishCountLimit = 9999
const fishingStepLimit = 1000000

// Each spot has three equally likely species. No bait purchases, real-time
// rarity, client-reported catches, or offline simulation.
var spotFish = [3][3]string{{"reed-minnow", "sun-carp", "ribbon-loach"}, {"sun-carp", "lotus-fish", "moon-perch"}, {"reed-minnow", "moon-perch", "pebble-goby"}}
var fishIDs = [...]string{"reed-minnow", "sun-carp", "ribbon-loach", "lotus-fish", "moon-perch", "pebble-goby"}

type FishDiscovery struct {
	ID      string `json:"id"`
	FirstAt int64  `json:"firstAt"`
	LastAt  int64  `json:"lastAt"`
	Count   int    `json:"count"`
}
type Pond struct {
	Since int64           `json:"since"`
	Fish  []FishDiscovery `json:"fish"`
}
type Fishing struct {
	Spot        int      `json:"spot"`
	Casts       int      `json:"casts"`
	Catches     []string `json:"catches"`
	Phase       string   `json:"phase"` // ready, wait, bite, result, done
	Step        int      `json:"step"`
	WaitMS      int      `json:"waitMs"`
	ElapsedMS   int      `json:"elapsedMs"`
	Candidate   string   `json:"candidate"`
	LastPulseAt int64    `json:"lastPulseAt"`
	Paused      bool     `json:"paused"`
	Outcome     string   `json:"outcome,omitempty"` // caught, early, missed
	LastFish    string   `json:"lastFish,omitempty"`
}

func newPond(now time.Time) *Pond { return &Pond{Since: now.UnixMilli(), Fish: []FishDiscovery{}} }
func newFishing(now time.Time) *Fishing {
	return &Fishing{Phase: "ready", Catches: []string{}, LastPulseAt: now.UnixMilli()}
}
func (s *State) discoverFish(id string, now time.Time) {
	for i := range s.Pond.Fish {
		d := &s.Pond.Fish[i]
		if d.ID == id {
			d.Count = min(fishCountLimit, d.Count+1)
			d.LastAt = now.UnixMilli()
			return
		}
	}
	s.Pond.Fish = append(s.Pond.Fish, FishDiscovery{ID: id, FirstAt: now.UnixMilli(), LastAt: now.UnixMilli(), Count: 1})
}
func (s *State) ExpireFishing(now time.Time) bool {
	if s.Game == nil || s.Game.Fishing == nil {
		return false
	}
	n := s.Game.Fishing
	if !n.Paused && (n.Phase == "wait" || n.Phase == "bite") && now.UnixMilli()-n.LastPulseAt > fishingLease {
		n.Paused = true
		n.Step = min(fishingStepLimit, n.Step+1)
		return true
	}
	return false
}
func (n *Fishing) resolve(outcome string) {
	n.Outcome = outcome
	n.LastFish = ""
	if outcome == "caught" {
		n.LastFish = n.Candidate
		n.Catches = append(n.Catches, n.Candidate)
	}
	n.Phase = "result"
	if n.Casts == 3 {
		n.Phase = "done"
	}
	n.Paused = false
	n.ElapsedMS = 0
}
func (s *State) applyFishing(a Action, now time.Time) (string, error) {
	if s.Game == nil || s.Game.Kind != "fishing" || s.Game.Fishing == nil {
		return "", errors.New("还没来到池塘呢")
	}
	n := s.Game.Fishing
	if a.Step != n.Step {
		return "", errors.New("鱼漂已经变化，请同步后再试")
	}
	// A late command persists a pause instead of rolling the safety state back.
	if s.ExpireFishing(now) {
		return "离开了一会儿，池塘已暂停，没有消耗机会。", nil
	}
	// Bound pathological pause/resume loops without freezing the saved session:
	// pause, finish and cancellation remain available for safe recovery.
	if n.Step >= fishingStepLimit && a.Kind != "fish-pause" && a.Kind != "fish-finish" {
		return "", errors.New("这次池塘停留太久啦，可暂停后放弃，再来一局")
	}
	switch a.Kind {
	case "fish-finish":
		if n.Phase != "done" {
			return "", errors.New("还有抛竿机会，先慢慢玩完吧")
		}
		caught := len(n.Catches)
		if caught > 0 {
			s.recordGameExperience("fishing", now)
		}
		s.Game = nil
		coins := 0
		if caught > 0 {
			s.Needs.Mood = clamp(s.Needs.Mood + 12)
			s.Needs.Energy = clamp(s.Needs.Energy - 4)
			s.Needs.Hunger = clamp(s.Needs.Hunger - 2)
			s.CareCount++
			s.recordCare("play", 0, now)
			s.sharedMemory("fishing", now)
			coins = s.rewardGame(max(3, 2*caught), now)
		}
		msg := fmt.Sprintf("一起在池塘发现 %d 条鱼！", caught)
		if caught > 0 {
			msg += coinMessage(coins)
		} else {
			msg += "这次没钓到也没关系，下次再来。钓到至少一条并完成三竿才计陪伴与金币。"
		}
		s.Log(now, msg)
		return msg, nil
	case "fish-pause":
		n.Paused = true
	case "fish-resume":
		if n.Phase == "done" {
			return "", errors.New("三竿已完成，先收好这次发现吧")
		}
		n.Paused = false
		n.LastPulseAt = now.UnixMilli()
	case "fish-spot":
		if n.Paused || (n.Phase != "ready" && n.Phase != "result") {
			return "", errors.New("收好这一竿后再换钓点吧")
		}
		n.Spot = (n.Spot + 1) % 3
	case "fish-cast":
		if n.Paused || (n.Phase != "ready" && n.Phase != "result") {
			return "", errors.New("这一竿还在水里呢")
		}
		r, err := rand.Int(rand.Reader, big.NewInt(3))
		if err != nil {
			return "", err
		}
		wait, err := rand.Int(rand.Reader, big.NewInt(9))
		if err != nil {
			return "", err
		}
		n.Candidate = spotFish[n.Spot][r.Int64()]
		n.WaitMS = 32000 + int(wait.Int64())*1000
		n.Casts++
		n.ElapsedMS = 0
		n.Phase = "wait"
		n.Outcome = ""
		n.LastFish = ""
		n.LastPulseAt = now.UnixMilli()
	case "fish-reel":
		if n.Paused || (n.Phase != "wait" && n.Phase != "bite") {
			return "", errors.New("先抛出鱼竿吧")
		}
		if n.Phase == "bite" {
			s.discoverFish(n.Candidate, now)
			s.rememberOuting(now)
			n.resolve("caught")
		} else {
			n.resolve("early")
		}
	case "fish-step":
		if n.Paused || (n.Phase != "wait" && n.Phase != "bite") {
			return "", errors.New("等准备好后再继续吧")
		}
		elapsed := now.UnixMilli() - n.LastPulseAt
		if elapsed < FishingInterval {
			return "", errors.New("鱼漂还在轻轻晃呢")
		}
		// Only foreground, acknowledged beats count. Never replay a missed interval.
		n.ElapsedMS += int(min(elapsed, 1500))
		n.LastPulseAt = now.UnixMilli()
		if n.Phase == "wait" && n.ElapsedMS >= n.WaitMS {
			n.Phase = "bite"
			n.ElapsedMS = 0
		} else if n.Phase == "bite" && n.ElapsedMS >= FishingWindow {
			n.resolve("missed")
		}
	default:
		return "", errors.New("不认识这个钓鱼操作")
	}
	n.Step = min(fishingStepLimit, n.Step+1)
	return "", nil
}
func knownFish(id string) bool {
	for _, v := range fishIDs {
		if v == id {
			return true
		}
	}
	return false
}
func (s State) validPond() bool {
	if s.Schema < 8 {
		return s.Pond == nil
	}
	p := s.Pond
	if p == nil || p.Since < s.CreatedAt || p.Since > s.LastTick || len(p.Fish) > len(fishIDs) {
		return false
	}
	seen := map[string]bool{}
	for _, d := range p.Fish {
		if !knownFish(d.ID) || seen[d.ID] || s.HatchedAt == 0 || d.FirstAt < max(p.Since, s.HatchedAt) || d.LastAt < d.FirstAt || d.LastAt > s.LastTick || d.Count < 1 || d.Count > fishCountLimit {
			return false
		}
		seen[d.ID] = true
	}
	return true
}
func (s State) validFishingGame() bool {
	g := s.Game
	if g == nil {
		return true
	}
	if g.Kind != "fishing" {
		return g.Fishing == nil
	}
	n := g.Fishing
	if s.Schema < 8 || n == nil || g.Tiles != nil || g.Snake != nil || g.Tetris != nil || s.Sleeping || g.Round != 0 || g.Score != 0 || g.LastBeat != -1 {
		return false
	}
	if n.Spot < 0 || n.Spot > 2 || n.Casts < 0 || n.Casts > 3 || len(n.Catches) > n.Casts || n.Step < 0 || n.Step > fishingStepLimit || n.LastPulseAt < g.StartedAt || n.LastPulseAt > s.LastTick || n.ElapsedMS < 0 {
		return false
	}
	counts := map[string]int{}
	for _, id := range n.Catches {
		if !knownFish(id) {
			return false
		}
		counts[id]++
	}
	for id, count := range counts {
		found := false
		for _, d := range s.Pond.Fish {
			if d.ID == id && d.Count >= count {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	if n.Phase == "ready" {
		return n.Casts == 0 && len(n.Catches) == 0 && n.Candidate == "" && n.WaitMS == 0 && n.ElapsedMS == 0 && n.Outcome == "" && n.LastFish == ""
	}
	if !knownFish(n.Candidate) || n.WaitMS < 32000 || n.WaitMS > 40000 || n.WaitMS%1000 != 0 || n.Casts < 1 {
		return false
	}
	switch n.Phase {
	case "wait", "bite":
		candidateOK := false
		for _, id := range spotFish[n.Spot] {
			candidateOK = candidateOK || id == n.Candidate
		}
		limit := n.WaitMS
		if n.Phase == "bite" {
			limit = FishingWindow
		}
		return candidateOK && len(n.Catches) < n.Casts && n.ElapsedMS < limit && n.Outcome == "" && n.LastFish == ""
	case "result", "done":
		if (n.Phase == "done") != (n.Casts == 3) || n.ElapsedMS != 0 {
			return false
		}
		if n.Outcome == "caught" {
			return len(n.Catches) > 0 && n.LastFish == n.Candidate && n.Catches[len(n.Catches)-1] == n.LastFish
		}
		return (n.Outcome == "early" || n.Outcome == "missed") && n.LastFish == "" && len(n.Catches) < n.Casts
	}
	return false
}
