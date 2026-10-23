package store

import (
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// Response-only metadata: captured inside the same transaction as settlement
// and cached with its acknowledgement. Never reconstruct it from a later read.
type InterestGameReceipt struct {
	Kind    string `json:"kind"`
	GameID  string `json:"gameId"`
	Before  int    `json:"before"`
	After   int    `json:"after"`
	Reason  string `json:"reason"`
	RetryAt int64  `json:"retryAt,omitempty"`
}

type gameInterestBefore struct {
	gameID string
	value  game.Interest
}

func captureGameInterest(s game.State, a *game.Action) *gameInterestBefore {
	if a == nil || s.Game == nil || s.Companion == nil || s.Game.ID == "" || a.GameID != s.Game.ID {
		return nil
	}
	kind := s.Game.Kind
	if kind == "" { // Legacy stars session.
		kind = "stars"
	}
	finish := map[string]string{"stars": "catch", "tiles": "tile-pick", "snake": "snake-finish", "tetris": "tetris-finish", "fishing": "fish-finish", "walk": "walk-finish", "treasure": "treasure-finish"}[kind]
	if finish == "" || a.Kind != finish {
		return nil
	}
	for _, interest := range s.Companion.Interests {
		if interest.Kind == kind {
			return &gameInterestBefore{gameID: s.Game.ID, value: interest}
		}
	}
	return nil
}

func (before *gameInterestBefore) receipt(s game.State, now time.Time) *InterestGameReceipt {
	if before == nil || s.Game != nil || s.Companion == nil || s.Companion.Recent == nil {
		return nil
	}
	x := s.Companion.Recent
	if x.ID != before.gameID || x.Kind != before.value.Kind || x.At != now.UnixMilli() {
		return nil // Cancelled/unfinished/nonqualifying sessions have no receipt.
	}
	for _, after := range s.Companion.Interests {
		if after.Kind != before.value.Kind {
			continue
		}
		r := &InterestGameReceipt{Kind: after.Kind, GameID: before.gameID, Before: before.value.Points, After: after.Points}
		switch {
		case after.Points == before.value.Points+1 && after.LastAt == now.UnixMilli():
			r.Reason = "credited"
		case after.Points == before.value.Points && after.Points == game.InterestLimit:
			r.Reason = "familiar"
		case after.Points == before.value.Points && after.Points > 0 && after.Points < game.InterestLimit && after.LastAt == before.value.LastAt && now.UnixMilli() < after.LastAt+game.InterestInterval.Milliseconds():
			r.Reason = "cooldown"
			r.RetryAt = after.LastAt + game.InterestInterval.Milliseconds()
		default:
			return nil
		}
		return r
	}
	return nil
}
