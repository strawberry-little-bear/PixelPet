package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func memoryOf(t *testing.T, s State, kind string) Memory {
	t.Helper()
	for _, m := range s.Album.Entries {
		if m.Kind == kind {
			return m
		}
	}
	t.Fatalf("missing memory %s: %+v", kind, s.Album)
	return Memory{}
}
func hasMemory(s State, kind string) bool {
	for _, m := range s.Album.Entries {
		if m.Kind == kind {
			return true
		}
	}
	return false
}
func copyState(s State) State {
	b, _ := json.Marshal(s)
	var out State
	json.Unmarshal(b, &out)
	return out
}
func applyAt(t *testing.T, s *State, kind string, now time.Time) {
	t.Helper()
	s.Advance(now)
	a := Action{Kind: kind}
	if s.Game != nil {
		a.GameID = s.Game.ID
	}
	if _, err := s.Apply(a, now); err != nil {
		t.Fatal(err)
	}
}
func completeStars(t *testing.T, s *State, now time.Time, score int) time.Time {
	t.Helper()
	applyAt(t, s, "play", now)
	for i := 0; i < 5; i++ {
		at := now.Add(time.Duration(i) * 900 * time.Millisecond)
		lane := i % 3
		if i >= score {
			lane = (lane + 1) % 3
		}
		s.Advance(at)
		if _, err := s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: lane}, at); err != nil {
			t.Fatal(err)
		}
	}
	return now.Add(3600 * time.Millisecond)
}

func TestAlbumKeepsFirstSharedExperiencesBeyondDiary(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := babyAt(now)
	if m := memoryOf(t, s, "hatch"); m.At != s.HatchedAt || m.Source != "shared" {
		t.Fatal(m)
	}
	applyAt(t, &s, "feed", now)
	first := memoryOf(t, s, "meal")
	before := copyState(s)
	if _, err := s.Apply(Action{Kind: "feed"}, now); err == nil {
		t.Fatal("full pet accepted meal")
	}
	if !reflect.DeepEqual(before, s) {
		t.Fatal("failed care mutated album/state")
	}
	applyAt(t, &s, "clean", now)
	applyAt(t, &s, "sleep", now)
	for i := 0; i < 80; i++ {
		s.Log(now, "这些日常片段会翻篇，但回忆不会。")
	}
	later := now.Add(2 * time.Hour)
	applyAt(t, &s, "sleep", later)
	applyAt(t, &s, "feed", later)
	if memoryOf(t, s, "meal") != first || len(s.Logs) != 30 || len(s.Album.Entries) != 4 {
		t.Fatal("first memories were lost or duplicated", s.Album)
	}
	encoded, _ := json.Marshal(s)
	var restored State
	json.Unmarshal(encoded, &restored)
	if !reflect.DeepEqual(restored.Album, s.Album) {
		t.Fatal("backup lost memories")
	}
	if err := restored.Validate(later); err != nil {
		t.Fatal(err)
	}
}

func TestAlbumOnlyCompleteGamesRememberAndKeepFirstScore(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := babyAt(now)
	applyAt(t, &s, "play", now)
	if hasMemory(s, "stars") {
		t.Fatal("start became memory")
	}
	s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: 0}, now)
	if _, err := s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: 0}, now); err == nil {
		t.Fatal("duplicate beat accepted")
	}
	applyAt(t, &s, "cancel-play", now)
	if hasMemory(s, "stars") {
		t.Fatal("cancel became memory")
	}
	at := completeStars(t, &s, now, 0)
	first := memoryOf(t, s, "stars")
	if first.Score != 0 || first.At != at.UnixMilli() || hasMemory(s, "perfect-stars") {
		t.Fatal(s.Album)
	}
	at = completeStars(t, &s, at.Add(time.Second), 5)
	if memoryOf(t, s, "stars") != first || memoryOf(t, s, "perfect-stars").At != at.UnixMilli() {
		t.Fatal("first game was overwritten")
	}
	at = completeStars(t, &s, at.Add(time.Second), 5)
	if len(s.Album.Entries) != 3 {
		t.Fatal("perfect reward repeated")
	}
	if err := s.Validate(at); err != nil {
		t.Fatal(err)
	}
}

func TestAlbumExactEvolutionTimesAndLockedForm(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := babyAt(now)
	s.Needs.Hunger = 60
	s.Growth.Points = 23.9
	applyAt(t, &s, "feed", now)
	if memoryOf(t, s, "growing").At != s.Growth.GrowingAt {
		t.Fatal("growing time differed")
	}
	s.Growth.Points = 71.9
	s.Needs.Clean = 60
	applyAt(t, &s, "clean", now)
	adult := memoryOf(t, s, "adult")
	g := *s.Growth
	s.Growth.Care.Play = 999
	s.Advance(now.Add(48 * time.Hour))
	if memoryOf(t, s, "adult") != adult || s.Growth.Form != g.Form || adult.Form != g.Form {
		t.Fatal("adult memory/form rewritten")
	}
	if err := s.Validate(now.Add(48 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	// Compare independent offline/frequent settlements near the live threshold.
	one, many := babyAt(now), babyAt(now)
	one.Growth.Points = 23.9
	many.Growth.Points = 23.9
	end := now.Add(time.Hour)
	one.Advance(end)
	for i := 1; i <= 60; i++ {
		many.Advance(now.Add(time.Duration(i) * time.Minute))
	}
	a, b := memoryOf(t, one, "growing"), memoryOf(t, many, "growing")
	if a.Source != "shared" || a.At != one.Growth.GrowingAt || a.At != b.At || a.At >= end.UnixMilli() {
		t.Fatal("offline timestamp not exact", a, b)
	}
}

func TestAlbumElapsedDaysNotAttendanceAndNoRewards(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := babyAt(now)
	s.Advance(now.Add(1001 * 24 * time.Hour))
	count := 0
	for _, m := range s.Album.Entries {
		if m.Kind == "days" {
			count++
			if m.Source != "elapsed" || m.At != s.HatchedAt+int64(m.Days)*dayMillis {
				t.Fatal("invented shared time", m)
			}
		}
	}
	if count != len(albumDays) || s.Growth.TrackedHours != 12 || s.CareCount != 0 {
		t.Fatal("milestones rewarded/capped like care", s)
	}
	n := len(s.Album.Entries)
	for i := 0; i < 5; i++ {
		s.Advance(now.Add(1001 * 24 * time.Hour))
	}
	if len(s.Album.Entries) != n {
		t.Fatal("day cards repeated")
	}
	if err := s.Validate(now.Add(1001 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestAlbumMigrationDoesNotInventOldExperiences(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, schema := range []int{1, 2} {
		s := babyAt(now.Add(-80 * time.Hour))
		s.Schema = schema
		s.Pond = nil
		s.Economy = nil
		s.Album = nil
		s.CareCount = 100
		if schema == 1 {
			s.Growth = nil
		} else {
			s.LastTick = now.Add(-12 * time.Hour).UnixMilli()
			s.Growth.Points = 71.9
			s.Growth.Stage = "growing"
			s.Growth.GrowingAt = s.HatchedAt + dayMillis
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		if !s.Upgrade(now) || s.Schema != Schema || !s.Album.Legacy || s.Album.Since != now.UnixMilli() {
			t.Fatal("not migrated")
		}
		for _, m := range s.Album.Entries {
			if m.Kind != "days" && m.Source != "saved" {
				t.Fatal("invented history", m)
			}
		}
		if hasMemory(s, "meal") || hasMemory(s, "stars") || hasMemory(s, "goodnight") {
			t.Fatal("invented care")
		}
		before := copyState(s)
		if s.Upgrade(now) || !reflect.DeepEqual(before, s) {
			t.Fatal("migration replayed")
		}
		s.Needs.Hunger = 60
		applyAt(t, &s, "feed", now)
		if memoryOf(t, s, "meal").Source != "shared" {
			t.Fatal("new experience not shared")
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
	}
	egg := New(now.Add(-time.Hour))
	egg.Schema = 2
	egg.Pond = nil
	egg.Economy = nil
	egg.Album = nil
	egg.Upgrade(now)
	if egg.Album.Legacy || len(egg.Album.Entries) != 0 {
		t.Fatal("egg invented memories")
	}
	applyAt(t, &egg, "hatch", now)
	if memoryOf(t, egg, "hatch").Source != "shared" {
		t.Fatal("new hatch not shared")
	}
}

func TestAlbumRejectsInvalidImports(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	base := babyAt(now.Add(-48 * time.Hour))
	base.Advance(now)
	for name, change := range map[string]func(*State){
		"missing":         func(s *State) { s.Album = nil },
		"future opening":  func(s *State) { s.Album.Since = now.Add(time.Hour).UnixMilli() },
		"before creation": func(s *State) { s.Album.Since = s.CreatedAt - 1 },
		"deleted hatch":   func(s *State) { s.Album.Entries = s.Album.Entries[1:] },
		"duplicate":       func(s *State) { s.Album.Entries = append(s.Album.Entries, s.Album.Entries[0]) },
		"unknown":         func(s *State) { s.Album.Entries[0].Kind = "coins" },
		"source":          func(s *State) { s.Album.Entries[0].Source = "imagined" },
		"fake old":        func(s *State) { s.Album.Entries[0].Source = "saved" },
		"wrong time":      func(s *State) { s.Album.Entries[0].At++ },
		"future experience": func(s *State) {
			s.Album.Entries = append(s.Album.Entries, Memory{Kind: "meal", Source: "shared", At: now.Add(time.Hour).UnixMilli()})
		},
		"score": func(s *State) {
			s.Album.Entries = append(s.Album.Entries, Memory{Kind: "stars", Source: "shared", At: s.LastTick, Score: 6})
		},
		"false perfect": func(s *State) {
			s.Album.Entries = append(s.Album.Entries, Memory{Kind: "perfect-stars", Source: "shared", At: s.LastTick, Score: 4})
		},
		"orphan perfect": func(s *State) {
			s.Album.Entries = append(s.Album.Entries, Memory{Kind: "perfect-stars", Source: "shared", At: s.LastTick, Score: 5})
		},
		"bad days": func(s *State) {
			s.Album.Entries = append(s.Album.Entries, Memory{Kind: "days", Source: "elapsed", At: s.LastTick, Days: 2})
		},
		"wrong day boundary": func(s *State) { s.Album.Entries[1].At++ },
		"extra form":         func(s *State) { s.Album.Entries[0].Form = "lively" },
		"extra score":        func(s *State) { s.Album.Entries[0].Score = 1 },
		"extra days":         func(s *State) { s.Album.Entries[0].Days = 1 },
		"future adult": func(s *State) {
			s.Album.Entries = append(s.Album.Entries, Memory{Kind: "adult", Source: "shared", At: s.LastTick, Form: "balanced"})
		},
		"old schema album": func(s *State) { s.Schema = 2 },
	} {
		t.Run(name, func(t *testing.T) {
			s := copyState(base)
			change(&s)
			if s.Validate(now) == nil {
				t.Fatal("invalid album accepted", s.Album)
			}
		})
	}
}
