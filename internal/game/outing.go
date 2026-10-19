package game

import (
	"strconv"
	"strings"
	"time"
)

var outingWeather = [...]string{"clear", "cloud", "rain"}

// Match the fictional sky in web/src/outing.ts. Session IDs, not client weather
// or the real clock, select it. Only a real discovery calls this recorder.
// Return a notification only for a newly saved encounter, never a read/repeat.
func (s *State) rememberOuting(now time.Time) string {
	if s.Schema < 13 || s.Album == nil || s.Game == nil || (s.Game.Kind != "fishing" && s.Game.Kind != "walk") {
		return ""
	}
	id := s.Game.ID
	if !validGameID(id) || id != strings.ToLower(id) {
		return ""
	}
	prefix, err := strconv.ParseUint(id[:6], 16, 32)
	if err != nil {
		return ""
	}
	s.sharedMemory("scenery-"+s.Game.Kind+"-"+outingWeather[prefix%48%3], now)
	if s.Schema >= 14 {
		if kind := outingEncounter(s.Game.Kind, id); kind != "" {
			before := len(s.Album.Entries)
			s.remember(Memory{Kind: kind, At: now.UnixMilli(), Source: "shared", OutingID: id})
			if len(s.Album.Entries) > before {
				s.Log(now, "你们遇见了一处特别风景，已收进风景手记。")
				title := "星光涟漪"
				if kind == "encounter-walk-kite" {
					title = "晚霞纸鸢"
				}
				return "偶遇 · " + title + "，已收进风景手记。"
			}
		}
	}
	return ""
}

// One in four sessions of the matching fictional light can carry an encounter.
// Independent ID bytes select it without rolling again per catch or step.
// Nothing here consults the real clock, RNG, rewards or player preferences.
func outingEncounter(kind, id string) string {
	if !validGameID(id) || id != strings.ToLower(id) {
		return ""
	}
	prefix, _ := strconv.ParseUint(id[:6], 16, 32)
	token, _ := strconv.ParseUint(id[6:8], 16, 8)
	if token%4 != 0 {
		return ""
	}
	light := (prefix % 48) / 12
	if kind == "fishing" && light == 3 {
		return "encounter-fishing-stars"
	}
	if kind == "walk" && light == 2 {
		return "encounter-walk-kite"
	}
	return ""
}

func (s State) validOutingMemory(m Memory) bool {
	if s.Schema < 13 || m.Source != "shared" {
		return false
	}
	if strings.HasPrefix(m.Kind, "encounter-") {
		kind := "fishing"
		if m.Kind == "encounter-walk-kite" {
			kind = "walk"
		}
		if s.Schema < 14 || outingEncounter(kind, m.OutingID) != m.Kind {
			return false
		}
	}
	// Require saved discovery evidence as well as the normal album chronology.
	// Abandoning a session keeps discoveries, so completion is not a prerequisite.
	switch m.Kind {
	case "scenery-fishing-clear", "scenery-fishing-cloud", "scenery-fishing-rain", "encounter-fishing-stars":
		if s.Pond == nil || m.At < s.Pond.Since {
			return false
		}
		for _, d := range s.Pond.Fish {
			if d.FirstAt <= m.At && m.At <= d.LastAt {
				return true
			}
		}
	case "scenery-walk-clear", "scenery-walk-cloud", "scenery-walk-rain", "encounter-walk-kite":
		if s.Park == nil || m.At < s.Park.Since {
			return false
		}
		for _, d := range s.Park.Finds {
			if d.FirstAt <= m.At && m.At <= d.LastAt {
				return true
			}
		}
	}
	return false
}
