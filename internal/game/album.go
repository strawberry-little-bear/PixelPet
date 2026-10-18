package game

import "time"

// Album is independent of the rolling diary. Each kind (or elapsed-day
// milestone) is recorded once; nothing here awards points or changes a form.
type Album struct {
	Since   int64    `json:"since"`
	Legacy  bool     `json:"legacy"`
	Entries []Memory `json:"entries"`
}

type Memory struct {
	Kind   string `json:"kind"`
	At     int64  `json:"at"`
	Source string `json:"source"` // shared, saved, or elapsed
	Form   string `json:"form,omitempty"`
	Score  int    `json:"score,omitempty"`
	Days   int    `json:"days,omitempty"`
}

var albumDays = [...]int{1, 7, 30, 100, 365, 1000}

const dayMillis = int64(24 * time.Hour / time.Millisecond)

func (s *State) remember(m Memory) {
	if s.Album == nil {
		return
	}
	for _, old := range s.Album.Entries {
		if old.Kind == m.Kind && old.Days == m.Days {
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

func (s State) validAlbum(now time.Time) bool {
	if s.Schema < 3 {
		return s.Album == nil
	}
	a := s.Album
	if a == nil || a.Since < s.CreatedAt || a.Since > s.LastTick || a.Since > now.UnixMilli() || len(a.Entries) > 8+len(albumDays) {
		return false
	}
	if s.HatchedAt == 0 {
		return !a.Legacy && len(a.Entries) == 0
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
		if (m.Kind != "adult" && m.Form != "") || (m.Kind != "days" && m.Days != 0) || (m.Kind != "stars" && m.Kind != "perfect-stars" && m.Score != 0) {
			return false
		}
		if m.Kind != "days" {
			if seen[m.Kind] {
				return false
			}
			seen[m.Kind] = true
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
			return false
		}
	}
	return seen["hatch"] && (s.Growth.GrowingAt == 0 || seen["growing"]) && (s.Growth.AdultAt == 0 || seen["adult"]) && (!seen["perfect-stars"] || seen["stars"])
}
