package game

import (
	"strconv"
	"strings"
	"time"
)

var outingWeather = [...]string{"clear", "cloud", "rain"}

// Match the fictional sky in web/src/outing.ts. Session IDs, not client weather
// or the real clock, select it. Only a real discovery calls this recorder.
func (s *State) rememberOuting(now time.Time) {
	if s.Schema < 13 || s.Game == nil || (s.Game.Kind != "fishing" && s.Game.Kind != "walk") {
		return
	}
	id := s.Game.ID
	if !validGameID(id) || id != strings.ToLower(id) {
		return
	}
	prefix, err := strconv.ParseUint(id[:6], 16, 32)
	if err != nil {
		return
	}
	s.sharedMemory("scenery-"+s.Game.Kind+"-"+outingWeather[prefix%48%3], now)
}

func (s State) validOutingMemory(m Memory) bool {
	if s.Schema < 13 || m.Source != "shared" {
		return false
	}
	// Require saved discovery evidence as well as the normal album chronology.
	// Abandoning a session keeps discoveries, so completion is not a prerequisite.
	switch m.Kind {
	case "scenery-fishing-clear", "scenery-fishing-cloud", "scenery-fishing-rain":
		if s.Pond == nil || m.At < s.Pond.Since {
			return false
		}
		for _, d := range s.Pond.Fish {
			if d.FirstAt <= m.At && m.At <= d.LastAt {
				return true
			}
		}
	case "scenery-walk-clear", "scenery-walk-cloud", "scenery-walk-rain":
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
