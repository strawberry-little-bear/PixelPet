package game

import "time"

const InterestLimit = 5
const InterestInterval = 30 * time.Minute

var companionGames = [...]string{"stars", "tiles", "snake", "tetris", "fishing", "walk"}

type Interest struct {
	Kind   string `json:"kind"`
	Points int    `json:"points"`
	LastAt int64  `json:"lastAt"`
}
type GameExperience struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	At   int64  `json:"at"`
}
type Companion struct {
	Since     int64           `json:"since"`
	Interests []Interest      `json:"interests"`
	Recent    *GameExperience `json:"recent,omitempty"`
}

func newCompanion(now time.Time) *Companion {
	c := &Companion{Since: now.UnixMilli(), Interests: make([]Interest, len(companionGames))}
	for i, kind := range companionGames {
		c.Interests[i].Kind = kind
	}
	return c
}

// Only qualifying server-scored settlements call this, before removing their
// session. Independent of coins/score/growth; never infer old or offline play.
func (s *State) recordGameExperience(kind string, now time.Time) {
	c := s.Companion
	if c == nil || s.Game == nil || !validGameID(s.Game.ID) {
		return
	}
	for i := range c.Interests {
		r := &c.Interests[i]
		if r.Kind != kind {
			continue
		}
		c.Recent = &GameExperience{Kind: kind, ID: s.Game.ID, At: now.UnixMilli()}
		if r.Points < InterestLimit && (r.LastAt == 0 || now.UnixMilli()-r.LastAt >= InterestInterval.Milliseconds()) {
			r.Points++
			r.LastAt = now.UnixMilli()
		}
		return
	}
}
func (s State) validCompanion() bool {
	if s.Schema < 10 {
		return s.Companion == nil
	}
	c := s.Companion
	count := len(companionGames)
	if s.Schema == 10 {
		count--
	}
	if c == nil || c.Since < s.CreatedAt || c.Since > s.LastTick || len(c.Interests) != count {
		return false
	}
	total, latest := 0, int64(0)
	for i, r := range c.Interests {
		if r.Kind != companionGames[i] || r.Points < 0 || r.Points > InterestLimit {
			return false
		}
		if r.Points == 0 {
			if r.LastAt != 0 {
				return false
			}
		} else {
			if s.HatchedAt == 0 || r.LastAt < max(c.Since, s.HatchedAt) || r.LastAt > s.LastTick || r.LastAt-max(c.Since, s.HatchedAt) < int64(r.Points-1)*InterestInterval.Milliseconds() {
				return false
			}
		}
		total += r.Points
		latest = max(latest, r.LastAt)
	}
	if c.Recent == nil {
		return total == 0
	}
	x := c.Recent
	if total == 0 || !validGameID(x.ID) || x.At < latest || x.At > s.LastTick || (s.Game != nil && x.ID == s.Game.ID) {
		return false
	}
	for _, r := range c.Interests {
		if r.Kind == x.Kind {
			return r.Points > 0 && x.At >= r.LastAt
		}
	}
	return false
}
