package game

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"
)

const WalkLength = 72
const walkStepLimit = 1000000

var parkIDs = [...]string{"leaf", "pinecone", "feather", "flower", "shell", "pebble"}

type Park struct {
	Since      int64           `json:"since"`
	Finds      []FishDiscovery `json:"finds"`
	Walks      int             `json:"walks"`
	LastWalkAt int64           `json:"lastWalkAt"`
}
type Walking struct {
	Route       []string `json:"route"`
	Souvenirs   []string `json:"souvenirs"`
	Beat        int      `json:"beat"`
	Step        int      `json:"step"`
	Cleared     int      `json:"cleared"`
	Pose        string   `json:"pose"`
	PoseUntil   int      `json:"poseUntil"`
	LastPulseAt int64    `json:"lastPulseAt"`
	LastInputAt int64    `json:"lastInputAt"`
	Paused      bool     `json:"paused"`
}

func newPark(now time.Time) *Park { return &Park{Since: now.UnixMilli(), Finds: []FishDiscovery{}} }
func newWalking(now time.Time) (*Walking, error) {
	var seed [12]byte
	if _, err := rand.Read(seed[:]); err != nil {
		return nil, err
	}
	n := &Walking{Route: make([]string, 12), Souvenirs: make([]string, 3), Paused: true, LastPulseAt: now.UnixMilli()}
	for i := range n.Route {
		n.Route[i] = "rock"
		if seed[i]%2 == 1 {
			n.Route[i] = "branch"
		}
	}
	for i := range n.Souvenirs {
		r, err := rand.Int(rand.Reader, big.NewInt(int64(len(parkIDs))))
		if err != nil {
			return nil, err
		}
		n.Souvenirs[i] = parkIDs[int(r.Int64())]
	}
	return n, nil
}
func knownPark(id string) bool {
	for _, v := range parkIDs {
		if v == id {
			return true
		}
	}
	return false
}
func (s *State) discoverPark(id string, now time.Time) {
	for i := range s.Park.Finds {
		d := &s.Park.Finds[i]
		if d.ID == id {
			d.Count = min(9999, d.Count+1)
			d.LastAt = now.UnixMilli()
			return
		}
	}
	s.Park.Finds = append(s.Park.Finds, FishDiscovery{ID: id, FirstAt: now.UnixMilli(), LastAt: now.UnixMilli(), Count: 1})
}
func (s *State) ExpireWalking(now time.Time) bool {
	if s.Game == nil || s.Game.Walking == nil {
		return false
	}
	n := s.Game.Walking
	if !n.Paused && n.Beat < WalkLength && now.UnixMilli()-n.LastPulseAt > 3500 {
		n.Paused = true
		n.Step = min(walkStepLimit, n.Step+1)
		return true
	}
	return false
}
func (s *State) applyWalking(a Action, now time.Time) (string, error) {
	if s.Game == nil || s.Game.Kind != "walk" || s.Game.Walking == nil {
		return "", errors.New("先一起到公园吧")
	}
	n := s.Game.Walking
	if a.Step != n.Step {
		return "", errors.New("路线已变化，请同步后再试")
	}
	if s.ExpireWalking(now) {
		return "离开了一会儿，散步已暂停，没有补跑路线。", nil
	}
	if n.Step >= walkStepLimit && a.Kind != "walk-pause" && a.Kind != "walk-finish" {
		return "", errors.New("这次停留太久啦，可暂停后放弃再来")
	}
	message := ""
	switch a.Kind {
	case "walk-finish":
		if n.Beat != WalkLength {
			return "", errors.New("还没到终点，可继续散步或暂停后放弃")
		}
		s.Park.Walks = min(9999, s.Park.Walks+1)
		s.Park.LastWalkAt = now.UnixMilli()
		s.recordGameExperience("walk", now)
		s.sharedMemory("walk", now)
		s.rememberGameKeepsake("walk", now)
		cleared := n.Cleared
		s.Game = nil
		s.Needs.Mood = clamp(s.Needs.Mood + 12)
		s.Needs.Energy = clamp(s.Needs.Energy - 4)
		s.Needs.Hunger = clamp(s.Needs.Hunger - 2)
		s.CareCount++
		s.recordCare("play", 0, now)
		coins := s.rewardGame(3+cleared/4, now)
		msg := fmt.Sprintf("一起走完公园！避开 %d / 12 处障碍，带回三次沿途发现。", cleared) + coinMessage(coins)
		s.Log(now, msg)
		return msg, nil
	case "walk-pause":
		n.Paused = true
	case "walk-resume":
		if n.Beat == WalkLength {
			return "", errors.New("已经到终点，收好发现吧")
		}
		n.Paused = false
		n.LastPulseAt = now.UnixMilli()
	case "walk-jump", "walk-duck":
		if n.Paused || n.Beat == WalkLength {
			return "", errors.New("继续散步后再行动吧")
		}
		if n.LastInputAt != 0 && now.UnixMilli()-n.LastInputAt < 200 {
			return "", errors.New("慢慢来，不必连按")
		}
		n.Pose = "jump"
		if a.Kind == "walk-duck" {
			n.Pose = "duck"
		}
		n.PoseUntil = min(WalkLength, n.Beat+3)
		n.LastInputAt = now.UnixMilli()
	case "walk-step":
		if n.Paused || n.Beat == WalkLength {
			return "", errors.New("等准备好后再继续吧")
		}
		if now.UnixMilli()-n.LastPulseAt < 1000 {
			return "", errors.New("风景还在慢慢前进呢")
		}
		// One acknowledged foreground beat, never catch up a missed interval.
		n.Beat++
		n.LastPulseAt = now.UnixMilli()
		if n.PoseUntil < n.Beat {
			n.Pose = ""
			n.PoseUntil = 0
		}
		if n.Beat%6 == 0 {
			obstacle := n.Route[n.Beat/6-1]
			if (obstacle == "rock" && n.Pose == "jump") || (obstacle == "branch" && n.Pose == "duck") {
				n.Cleared++
			}
		}
		if n.Beat%24 == 0 {
			s.discoverPark(n.Souvenirs[n.Beat/24-1], now)
			message = s.rememberOuting(now)
		}
	default:
		return "", errors.New("不认识这个散步操作")
	}
	n.Step = min(walkStepLimit, n.Step+1)
	return message, nil
}
func (s State) validPark() bool {
	if s.Schema < 11 {
		return s.Park == nil
	}
	p := s.Park
	if p == nil || p.Since < s.CreatedAt || p.Since > s.LastTick || len(p.Finds) > len(parkIDs) || p.Walks < 0 || p.Walks > 9999 {
		return false
	}
	if p.Walks == 0 {
		if p.LastWalkAt != 0 {
			return false
		}
	} else if s.HatchedAt == 0 || p.LastWalkAt < max(p.Since, s.HatchedAt) || p.LastWalkAt > s.LastTick || len(p.Finds) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, d := range p.Finds {
		if !knownPark(d.ID) || seen[d.ID] || s.HatchedAt == 0 || d.FirstAt < max(p.Since, s.HatchedAt) || d.LastAt < d.FirstAt || d.LastAt > s.LastTick || d.Count < 1 || d.Count > 9999 {
			return false
		}
		seen[d.ID] = true
	}
	return true
}
func (s State) validWalkingGame() bool {
	g := s.Game
	if g == nil {
		return true
	}
	if g.Kind != "walk" {
		return g.Walking == nil
	}
	n := g.Walking
	if s.Schema < 11 || n == nil || s.Sleeping || g.Fishing != nil || g.Tetris != nil || g.Snake != nil || g.Tiles != nil || g.Round != 0 || g.Score != 0 || g.LastBeat != -1 {
		return false
	}
	if len(n.Route) != 12 || len(n.Souvenirs) != 3 || n.Beat < 0 || n.Beat > WalkLength || n.Step < n.Beat || n.Step > walkStepLimit || n.Cleared < 0 || n.Cleared > n.Beat/6 || n.LastPulseAt < g.StartedAt || n.LastPulseAt > s.LastTick || (n.LastInputAt != 0 && (n.LastInputAt < g.StartedAt || n.LastInputAt > s.LastTick)) || int64(n.Beat)*1000 > s.LastTick-g.StartedAt {
		return false
	}
	if n.Pose == "" {
		if n.PoseUntil != 0 {
			return false
		}
	} else if (n.Pose != "jump" && n.Pose != "duck") || n.LastInputAt == 0 || n.PoseUntil < n.Beat || n.PoseUntil > min(WalkLength, n.Beat+3) {
		return false
	}
	for _, o := range n.Route {
		if o != "rock" && o != "branch" {
			return false
		}
	}
	counts := map[string]int{}
	for i, id := range n.Souvenirs {
		if !knownPark(id) {
			return false
		}
		if n.Beat >= (i+1)*24 {
			counts[id]++
		}
	}
	for id, count := range counts {
		ok := false
		for _, d := range s.Park.Finds {
			if d.ID == id && d.Count >= count {
				ok = true
			}
		}
		if !ok {
			return false
		}
	}
	return true
}
