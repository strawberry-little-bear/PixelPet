package game

import "time"

// Keep JSON integers exact in browsers. At this unreachable practical bound,
// counters saturate; the UI displays ≥ rather than claiming an exact total.
const MaxGameCompletions int64 = 1<<53 - 1

type GameCompletion struct {
	Kind  string `json:"kind"`
	Count int64  `json:"count"`
}

type GameHistory struct {
	Since       int64            `json:"since"`
	Completions []GameCompletion `json:"completions"`
}

func newGameHistory(now time.Time) *GameHistory {
	h := &GameHistory{Since: now.UnixMilli(), Completions: make([]GameCompletion, len(companionGames))}
	for i, kind := range companionGames {
		h.Completions[i].Kind = kind
	}
	return h
}

func (c *Companion) recordCompletion(kind string) {
	if c.History == nil {
		return
	}
	for i := range c.History.Completions {
		r := &c.History.Completions[i]
		if r.Kind == kind {
			if r.Count < MaxGameCompletions {
				r.Count++
			}
			return
		}
	}
}

func (s State) validGameHistory() bool {
	h := s.Companion.History
	if s.Schema < 19 {
		return h == nil
	}
	if h == nil || h.Since < s.Companion.Since || h.Since > s.LastTick || len(h.Completions) != len(companionGames) {
		return false
	}
	any := false
	for i, r := range h.Completions {
		if r.Kind != companionGames[i] || r.Count < 0 || r.Count > MaxGameCompletions {
			return false
		}
		if r.Count > 0 {
			if s.HatchedAt == 0 || s.Companion.Recent == nil || s.Companion.Recent.At < h.Since {
				return false
			}
			any = true
		}
	}
	// An old recent experience may precede tracking. New settlements must have
	// a counter, but a migration at the same millisecond must not invent one.
	if any || (s.Companion.Recent != nil && s.Companion.Recent.At > h.Since) {
		for _, r := range h.Completions {
			if r.Kind == s.Companion.Recent.Kind {
				return r.Count > 0
			}
		}
	}
	return true
}
