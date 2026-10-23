package game

import (
	"reflect"
	"testing"
	"time"
)

func TestRestedMemoryRequiresRecoveredFullEnergyAndExplicitWake(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, tc := range []struct {
		name   string
		energy float64
		hours  float64
		want   bool
	}{
		{"recovered to full", 86, 1, true}, {"long capped sleep", 0, 24, true},
		{"partly rested", 40, 1, false}, {"already full", 100, 3, false},
		{"immediate wake", 86, 0, false}, {"almost full", 85.9999, 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := sleepPet(t, now, tc.energy)
			sleepToggle(t, &s, now)
			wakeAt := now.Add(time.Duration(tc.hours * float64(time.Hour)))
			s.Advance(wakeAt)
			if hasMemory(s, "rested") {
				t.Fatal("reading or sleeping earned a wake memory")
			}
			before := copyState(s)
			f := sleepToggle(t, &s, wakeAt)
			if got := hasMemory(s, "rested"); got != tc.want {
				t.Fatalf("memory=%v want %v", got, tc.want)
			}
			if tc.want {
				if m := memoryOf(t, s, "rested"); m.At != wakeAt.UnixMilli() || m.Source != "shared" {
					t.Fatal(m)
				}
			}
			if !reflect.DeepEqual(before.Growth, s.Growth) || !reflect.DeepEqual(before.Economy, s.Economy) || before.Needs != s.Needs || before.CareCount != s.CareCount || f.Points != 0 || f.HabitGain != 0 {
				t.Fatal("wake memory changed growth, needs or resources")
			}
			if err := s.Validate(wakeAt); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRestedMemoryKeepsFirstWakeBeyondDiaryAndSeparateSleeps(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 86)
	sleepToggle(t, &s, now)
	sleepToggle(t, &s, now.Add(time.Hour))
	first := memoryOf(t, s, "rested")
	for i := 0; i < 40; i++ {
		s.Log(now.Add(time.Hour), "新的小日常")
	}
	// Begin another real sleep after awake time has spent some energy.
	sleepToggle(t, &s, now.Add(2*time.Hour))
	sleepToggle(t, &s, now.Add(3*time.Hour))
	if memoryOf(t, s, "rested") != first {
		t.Fatal("rewrote the first wake")
	}
	count := 0
	for _, m := range s.Album.Entries {
		if m.Kind == "rested" {
			count++
		}
	}
	if count != 1 || len(s.Logs) != 30 {
		t.Fatal("duplicate or lost memory")
	}
	if err := s.Validate(now.Add(3 * time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestRestedMemoryMigrationDoesNotInventPastWake(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, known := range []bool{false, true} {
		s := sleepPet(t, now, 86)
		sleepToggle(t, &s, now)
		s.Schema = 17
		if s.Companion != nil {
			s.Companion.History = nil
		}
		if !known {
			s.SleepSession = nil
		}
		s.Advance(now.Add(time.Hour))
		before := copyState(s)
		if !s.Upgrade(now.Add(time.Hour)) || s.Schema != Schema {
			t.Fatal("missing migration")
		}
		expected := copyState(before)
		expected.Schema = Schema
		expected.Companion.History = newGameHistory(now.Add(time.Hour))
		if !reflect.DeepEqual(expected, s) || hasMemory(s, "rested") {
			t.Fatal("migration rewrote history")
		}
		sleepToggle(t, &s, now.Add(time.Hour))
		if hasMemory(s, "rested") != known {
			t.Fatal("unknown legacy sleep earned a memory or known session was lost")
		}
	}
}

func TestRestedMemoryRejectsInvalidSavedCards(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 86)
	sleepToggle(t, &s, now)
	sleepToggle(t, &s, now.Add(time.Hour))
	memoryOf(t, s, "rested")
	for name, mutate := range map[string]func(*State, *Memory){
		"old schema":     func(s *State, m *Memory) { s.Schema = 17 },
		"saved source":   func(s *State, m *Memory) { m.Source = "saved" },
		"elapsed source": func(s *State, m *Memory) { m.Source = "elapsed" },
		"future":         func(s *State, m *Memory) { m.At++ },
		"form":           func(s *State, m *Memory) { m.Form = "gentle" },
		"score":          func(s *State, m *Memory) { m.Score = 1 },
		"days":           func(s *State, m *Memory) { m.Days = 1 },
		"item":           func(s *State, m *Memory) { m.Item = "ribbon" },
		"outing":         func(s *State, m *Memory) { m.OutingID = "fishing" },
		"duplicate":      func(s *State, m *Memory) { s.Album.Entries = append(s.Album.Entries, *m) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyState(s)
			for i := range bad.Album.Entries {
				if bad.Album.Entries[i].Kind == "rested" {
					mutate(&bad, &bad.Album.Entries[i])
					break
				}
			}
			if bad.Validate(now.Add(time.Hour)) == nil {
				t.Fatal("accepted invalid rested memory")
			}
		})
	}
	// A permanent card does not require today's pet to remain rested or asleep.
	s.Advance(now.Add(10 * time.Hour))
	if err := s.Validate(now.Add(10 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if !hasMemory(s, "rested") {
		t.Fatal("tiredness removed a permanent memory")
	}
}

// Synthetic album-only capacity fixture, not evidence of naturally played
// history. Exercise the complete finite vocabulary so one new card cannot make
// a fully collected old album fail its size bound.
func TestRestedMemoryAllowsAll33AlbumCardsAndKeepsOldLimit(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 86)
	s.LastTick = now.Add(1000 * 24 * time.Hour).UnixMilli()
	s.Growth.Stage = "adult"
	s.Growth.Form = "balanced"
	s.Growth.GrowingAt = now.UnixMilli()
	s.Growth.AdultAt = now.UnixMilli()
	s.Pond.Fish = []FishDiscovery{{ID: "reed-minnow", FirstAt: now.UnixMilli(), LastAt: now.UnixMilli(), Count: 1}}
	s.Park.Finds = []FishDiscovery{{ID: "leaf", FirstAt: now.UnixMilli(), LastAt: now.UnixMilli(), Count: 1}}
	s.Park.Walks = 1
	s.Park.LastWalkAt = now.UnixMilli()
	s.Album.Entries = nil
	for _, kind := range []string{"hatch", "growing", "adult", "meal", "bath", "goodnight", "rested", "stars", "perfect-stars", "tiles", "snake", "tetris", "fishing", "walk", "treasure",
		"scenery-fishing-clear", "scenery-fishing-cloud", "scenery-fishing-rain", "scenery-walk-clear", "scenery-walk-cloud", "scenery-walk-rain", "encounter-fishing-stars", "encounter-walk-kite"} {
		m := Memory{Kind: kind, At: now.UnixMilli(), Source: "shared"}
		if kind == "adult" {
			m.Form = "balanced"
		}
		if kind == "perfect-stars" {
			m.Score = 5
		}
		if kind == "encounter-fishing-stars" {
			m.OutingID = "00002400000000000000000000000001"
		}
		if kind == "encounter-walk-kite" {
			m.OutingID = "00001800000000000000000000000001"
		}
		s.remember(m)
	}
	for _, tc := range []struct{ kind, item string }{{"outfit", "leaf-pin"}, {"decoration", "clover-pot"}, {"wallpaper", "meadow-wall"}, {"floor", "honey-floor"}} {
		s.Economy.Owned = append(s.Economy.Owned, tc.item)
		s.remember(Memory{Kind: tc.kind, Item: tc.item, At: now.UnixMilli(), Source: "shared"})
	}
	s.rememberDays()
	end := time.UnixMilli(s.LastTick)
	if len(s.Album.Entries) != 33 || !s.validAlbum(end) {
		t.Fatalf("full album rejected: %d cards", len(s.Album.Entries))
	}
	s.Schema = 17
	if s.Companion != nil {
		s.Companion.History = nil
	}
	if s.validAlbum(end) {
		t.Fatal("old schema accepted new memory")
	}
	for i, m := range s.Album.Entries {
		if m.Kind == "rested" {
			s.Album.Entries = append(s.Album.Entries[:i], s.Album.Entries[i+1:]...)
			break
		}
	}
	if len(s.Album.Entries) != 32 || !s.validAlbum(end) {
		t.Fatal("old full album stopped validating")
	}
}

func TestRestedMemorySchema17MigrationPreservesActiveGamesAndEgg(t *testing.T) {
	for _, kind := range append(append([]string{}, companionGames[:]...), "egg") {
		t.Run(kind, func(t *testing.T) {
			now := time.Now().Truncate(time.Millisecond)
			s := New(now)
			if kind != "egg" {
				s = sleepPet(t, now, 86)
				start := map[string]string{"stars": "play", "tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing", "walk": "play-walk", "treasure": "play-treasure"}[kind]
				if _, err := s.Apply(Action{Kind: start}, now); err != nil {
					t.Fatal(err)
				}
			}
			s.Schema = 17
			if s.Companion != nil {
				s.Companion.History = nil
			}
			before := copyState(s)
			before.Schema = Schema
			before.Companion.History = newGameHistory(now)
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			if !s.Upgrade(now) || s.Upgrade(now) || !reflect.DeepEqual(before, s) {
				t.Fatal("migration changed existing state or repeated")
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
		})
	}
}
