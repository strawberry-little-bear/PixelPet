package game

import (
	"errors"
	"time"
)

// Album is independent of the rolling diary. Each kind (or elapsed-day
// milestone) is recorded once; nothing here awards points or changes a form.
type Album struct {
	DisplayItem string   `json:"displayItem,omitempty"`
	Since       int64    `json:"since"`
	Legacy      bool     `json:"legacy"`
	Entries     []Memory `json:"entries"`
}

type Memory struct {
	Kind     string `json:"kind"`
	At       int64  `json:"at"`
	Source   string `json:"source"` // shared, saved, or elapsed
	Form     string `json:"form,omitempty"`
	Score    int    `json:"score,omitempty"`
	Days     int    `json:"days,omitempty"`
	Item     string `json:"item,omitempty"`
	OutingID string `json:"outingId,omitempty"` // encounter provenance only, never a client weather claim
}

var albumDays = [...]int{1, 7, 30, 100, 365, 1000}

var gameKeepsakes = [...]struct{ game, item string }{
	{game: "stars", item: "star-ribbon"},
	{game: "tiles", item: "tile-basket"},
	{game: "snake", item: "fruit-leaf"},
	{game: "tetris", item: "block-garden"},
	{game: "fishing", item: "pond-shell"},
	{game: "walk", item: "path-button"},
	{game: "treasure", item: "forest-token"},
}

func keepsakeItem(game string) string {
	for _, keepsake := range gameKeepsakes {
		if keepsake.game == game {
			return keepsake.item
		}
	}
	return ""
}

func keepsakeGame(item string) string {
	for _, keepsake := range gameKeepsakes {
		if keepsake.item == item {
			return keepsake.game
		}
	}
	return ""
}

// A keepsake records a qualifying completion after the feature was enabled.
// It has no economy or growth effect and requires schema 21.
func (s *State) rememberGameKeepsake(game string, now time.Time) {
	if s.Schema < 21 || s.Album == nil {
		return
	}
	if item := keepsakeItem(game); item != "" {
		s.remember(Memory{Kind: "keepsake", Item: item, At: now.UnixMilli(), Source: "shared"})
	}
}

const dayMillis = int64(24 * time.Hour / time.Millisecond)

func (s *State) remember(m Memory) {
	if s.Album == nil {
		return
	}
	for _, old := range s.Album.Entries {
		sameMemory := old.Kind == m.Kind && old.Days == m.Days
		if m.Kind == "keepsake" {
			sameMemory = sameMemory && old.Item == m.Item
		}
		if sameMemory {
			return
		}
	}
	s.Album.Entries = append(s.Album.Entries, m)
}

func (s *State) sharedMemory(kind string, now time.Time) {
	s.remember(Memory{Kind: kind, At: now.UnixMilli(), Source: "shared"})
}

// These are elapsed time, not active days, attendance or a streak. Their real
// boundary times remain meaningful even though needs settle at most 12 hours.
func (s *State) rememberDays() {
	if s.Album == nil || s.HatchedAt == 0 {
		return
	}
	for _, days := range albumDays {
		at := s.HatchedAt + int64(days)*dayMillis
		if at <= s.LastTick {
			s.remember(Memory{Kind: "days", At: at, Source: "elapsed", Days: days})
		}
	}
}

func (s *State) openLegacyAlbum(now time.Time) {
	s.Album = &Album{Since: now.UnixMilli(), Legacy: s.HatchedAt > 0, Entries: []Memory{}}
	if s.HatchedAt > 0 {
		s.remember(Memory{Kind: "hatch", At: s.HatchedAt, Source: "saved"})
		if s.Growth.GrowingAt > 0 {
			s.remember(Memory{Kind: "growing", At: s.Growth.GrowingAt, Source: "saved"})
		}
		if s.Growth.AdultAt > 0 {
			s.remember(Memory{Kind: "adult", At: s.Growth.AdultAt, Source: "saved", Form: s.Growth.Form})
		}
		s.rememberDays()
	}
}

func hasGameCompletion(s State, game string) bool {
	if s.Companion == nil || s.Companion.History == nil {
		return false
	}
	for _, completion := range s.Companion.History.Completions {
		if completion.Kind == game {
			return completion.Count > 0
		}
	}
	return false
}

func (s State) validAlbum(now time.Time) bool {
	if s.Schema < 3 {
		return s.Album == nil
	}
	a := s.Album
	limit := 17 + len(albumDays)
	if s.Schema >= 13 {
		limit += 6
	}
	if s.Schema >= 14 {
		limit += 2
	}
	if s.Schema >= 16 {
		limit++
	}
	if s.Schema >= 18 {
		limit++
	}
	if s.Schema >= 21 {
		limit += len(gameKeepsakes)
	}
	if a == nil || a.Since < s.CreatedAt || a.Since > s.LastTick || a.Since > now.UnixMilli() || len(a.Entries) > limit {
		return false
	}
	if (s.Schema < 22 && a.DisplayItem != "") || (a.DisplayItem != "" && keepsakeGame(a.DisplayItem) == "") {
		return false
	}
	if s.HatchedAt == 0 {
		return !a.Legacy && len(a.Entries) == 0 && a.DisplayItem == ""
	}
	if (a.Legacy && a.Since < s.HatchedAt) || (!a.Legacy && a.Since > s.HatchedAt) {
		return false
	}
	seen := map[string]bool{}
	daysSeen := map[int]bool{}
	for _, m := range a.Entries {
		if m.At < s.HatchedAt || m.At > s.LastTick || m.At > now.UnixMilli() {
			return false
		}
		if m.Source == "shared" {
			if m.At < a.Since {
				return false
			}
		} else if m.Source == "saved" {
			if !a.Legacy || m.At > a.Since || (m.Kind != "hatch" && m.Kind != "growing" && m.Kind != "adult") {
				return false
			}
		} else if m.Source != "elapsed" || m.Kind != "days" {
			return false
		}
		if m.OutingID != "" && m.Kind != "encounter-fishing-stars" && m.Kind != "encounter-walk-kite" {
			return false
		}
		if m.Kind != "outfit" && m.Kind != "decoration" && m.Kind != "wallpaper" && m.Kind != "floor" && m.Kind != "keepsake" && m.Item != "" {
			return false
		}
		if (m.Kind != "adult" && m.Form != "") || (m.Kind != "days" && m.Days != 0) || (m.Kind != "stars" && m.Kind != "perfect-stars" && m.Score != 0) {
			return false
		}
		if m.Kind != "days" {
			key := m.Kind
			if m.Kind == "keepsake" {
				key += ":" + m.Item
			}
			if seen[key] {
				return false
			}
			seen[key] = true
		}
		switch m.Kind {
		case "hatch":
			if m.At != s.HatchedAt {
				return false
			}
		case "growing":
			if m.At != s.Growth.GrowingAt || s.Growth.Stage == "baby" {
				return false
			}
		case "adult":
			if s.Growth.Stage != "adult" || m.At != s.Growth.AdultAt || m.Form != s.Growth.Form {
				return false
			}
		case "outfit", "decoration", "wallpaper", "floor":
			item, ok := shopItem(m.Item)
			slot := "accessory"
			if m.Kind == "decoration" {
				slot = "room"
			}
			if m.Kind == "wallpaper" || m.Kind == "floor" {
				if s.Schema < 9 {
					return false
				}
				slot = m.Kind
			}
			if s.Schema < 4 || m.Source != "shared" || !ok || item.Slot != slot || s.Economy == nil || !s.Economy.owns(m.Item) {
				return false
			}
		case "treasure":
			if s.Schema < 16 || m.Source != "shared" {
				return false
			}
		case "walk":
			if s.Schema < 11 || m.Source != "shared" || s.Park == nil || s.Park.Walks == 0 || m.At < s.Park.Since || m.At > s.Park.LastWalkAt {
				return false
			}
		case "fishing":
			if s.Schema < 8 || m.Source != "shared" || s.Pond == nil || len(s.Pond.Fish) == 0 {
				return false
			}
		case "tetris":
			if s.Schema < 7 || m.Source != "shared" {
				return false
			}
		case "snake":
			if s.Schema < 6 || m.Source != "shared" {
				return false
			}
		case "tiles":
			if s.Schema < 5 || m.Source != "shared" {
				return false
			}
		case "rested":
			if s.Schema < 18 || m.Source != "shared" {
				return false
			}
		case "keepsake":
			game := keepsakeGame(m.Item)
			if s.Schema < 21 || m.Source != "shared" || game == "" || !hasGameCompletion(s, game) {
				return false
			}
		case "meal", "bath", "goodnight":
			if m.Source != "shared" {
				return false
			}
		case "stars", "perfect-stars":
			if m.Source != "shared" || m.Score < 0 || m.Score > 5 || (m.Kind == "perfect-stars" && m.Score != 5) {
				return false
			}
		case "days":
			validDay := false
			for _, days := range albumDays {
				validDay = validDay || m.Days == days
			}
			if m.Source != "elapsed" || !validDay || daysSeen[m.Days] || m.At != s.HatchedAt+int64(m.Days)*dayMillis {
				return false
			}
			daysSeen[m.Days] = true
		default:
			if !s.validOutingMemory(m) {
				return false
			}
		}
	}
	for _, keepsake := range gameKeepsakes {
		if !seen["keepsake:"+keepsake.item] {
			continue
		}
		var gameAt, itemAt int64
		for _, m := range a.Entries {
			if m.Kind == keepsake.game {
				gameAt = m.At
			}
			if m.Kind == "keepsake" && m.Item == keepsake.item {
				itemAt = m.At
			}
		}
		if !seen[keepsake.game] || itemAt < gameAt || itemAt < s.Companion.History.Since || s.Companion.Recent == nil || itemAt > s.Companion.Recent.At {
			return false
		}
	}
	return (a.DisplayItem == "" || seen["keepsake:"+a.DisplayItem]) && seen["hatch"] && (s.Growth.GrowingAt == 0 || seen["growing"]) && (s.Growth.AdultAt == 0 || seen["adult"]) && (!seen["perfect-stars"] || seen["stars"])
}

// An explicit set (including empty to put away) is safe to repeat. Placing a
// memento is decoration only: it never fabricates ownership or a diary entry.
func (s *State) displayKeepsake(item string) (string, error) {
	if s.Schema < 22 || s.Album == nil {
		return "", errors.New("请更新服务后再布置纪念角")
	}
	if item != "" {
		owned := false
		for _, m := range s.Album.Entries {
			if m.Kind == "keepsake" && m.Item == item && m.Source == "shared" && keepsakeGame(item) != "" {
				owned = true
				break
			}
		}
		if !owned {
			return "", errors.New("只能摆放已经收好的小游戏纪念物")
		}
	}
	s.Album.DisplayItem = item
	if item == "" {
		return "纪念物已收回纪念册，回忆仍在。", nil
	}
	return "小纪念物摆好了，回小窝就能看到。", nil
}
