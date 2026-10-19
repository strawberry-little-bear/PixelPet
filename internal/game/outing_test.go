package game

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func outingMemories(s State) []Memory {
	out := []Memory{}
	for _, m := range s.Album.Entries {
		if strings.HasPrefix(m.Kind, "scenery-") {
			out = append(out, m)
		}
	}
	return out
}

func TestOutingMemoriesRequireRealDiscoveryAndSurviveAbandon(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		for weather, sky := range []string{"clear", "cloud", "rain"} {
			t.Run(kind+"/"+sky, func(t *testing.T) {
				var s State
				var now time.Time
				if kind == "fishing" {
					s, now = fishingState(t)
				} else {
					s, now = walkingState(t)
				}
				s.Game.ID = fmt.Sprintf("%06x%026x", weather, 1)
				if len(outingMemories(s)) != 0 {
					t.Fatal("start invented memory")
				}
				beforeCare, beforeCoins := s.CareCount, s.Economy.Coins
				if kind == "fishing" {
					fishDo(t, &s, now, "fish-cast")
					fishDo(t, &s, now, "fish-reel")
					if len(outingMemories(s)) != 0 {
						t.Fatal("early reel invented memory")
					}
					bite(t, &s, &now)
					fishDo(t, &s, now, "fish-reel")
				} else {
					walkDo(t, &s, now, "walk-resume")
					walkBeats(t, &s, &now, 23, false)
					if len(outingMemories(s)) != 0 {
						t.Fatal("walking before discovery invented memory")
					}
					walkBeats(t, &s, &now, 24, false)
				}
				entries := outingMemories(s)
				want := Memory{Kind: "scenery-" + kind + "-" + sky, At: now.UnixMilli(), Source: "shared"}
				if !reflect.DeepEqual(entries, []Memory{want}) {
					t.Fatalf("got %+v, want %+v", entries, want)
				}
				if kind == "fishing" {
					bite(t, &s, &now)
					fishDo(t, &s, now, "fish-reel")
				} else {
					walkBeats(t, &s, &now, 48, false)
				}
				if !reflect.DeepEqual(entries, outingMemories(s)) {
					t.Fatal("repeat discovery changed first memory")
				}
				if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
					t.Fatal(err)
				}
				if s.Game != nil || !reflect.DeepEqual(entries, outingMemories(s)) || s.CareCount != beforeCare || s.Economy.Coins != beforeCoins {
					t.Fatal("abandon lost memory or added reward")
				}
				if err := s.Validate(now); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestOutingUpgradeDoesNotBackfill(t *testing.T) {
	s, now := fishingState(t)
	bite(t, &s, &now)
	fishDo(t, &s, now, "fish-reel")
	entries := s.Album.Entries[:0]
	for _, m := range s.Album.Entries {
		if !strings.HasPrefix(m.Kind, "scenery-") {
			entries = append(entries, m)
		}
	}
	s.Album.Entries = entries
	s.Schema = 12
	before := copyState(s)
	if !s.Upgrade(now) || s.Schema != 13 {
		t.Fatal("missing schema upgrade")
	}
	before.Schema = 13
	if !reflect.DeepEqual(before, s) || len(outingMemories(s)) != 0 || s.Upgrade(now) {
		t.Fatal("migration fabricated or changed history")
	}
}

func TestOutingSelectionMatchesAll48FictionalSkies(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		for i := 0; i < 48; i++ {
			s, now := fishingState(t)
			s.Game.Kind = kind
			s.Game.ID = fmt.Sprintf("%06x%026x", i, 0)
			s.rememberOuting(now)
			got := outingMemories(s)
			want := "scenery-" + kind + "-" + []string{"clear", "cloud", "rain"}[i%3]
			if len(got) != 1 || got[0].Kind != want {
				t.Fatalf("%s sky %d: %+v", kind, i, got)
			}
		}
	}
}

func TestOutingRecorderRejectsUnknownOrUnrenderableSessions(t *testing.T) {
	for _, id := range []string{"", "a", strings.Repeat("g", 32), strings.Repeat("A", 32), strings.Repeat("a", 32) + "\n"} {
		s, now := fishingState(t)
		s.Game.ID = id
		s.rememberOuting(now)
		if len(outingMemories(s)) != 0 {
			t.Fatal("invalid id recorded", id)
		}
	}
	for _, kind := range []string{"stars", "tiles", "snake", "tetris", "unknown"} {
		s, now := fishingState(t)
		s.Game.Kind = kind
		s.rememberOuting(now)
		if len(outingMemories(s)) != 0 {
			t.Fatal("unrelated game recorded", kind)
		}
	}
	s, now := fishingState(t)
	s.Game = nil
	s.rememberOuting(now)
	if len(outingMemories(s)) != 0 {
		t.Fatal("no game recorded")
	}
}

func TestOutingValidationRejectsCorruption(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		var s State
		var now time.Time
		if kind == "fishing" {
			s, now = fishingState(t)
			bite(t, &s, &now)
			fishDo(t, &s, now, "fish-reel")
		} else {
			s, now = walkingState(t)
			walkDo(t, &s, now, "walk-resume")
			walkBeats(t, &s, &now, 24, false)
		}
		index := len(s.Album.Entries) - 1
		tests := map[string]func(*State){
			"old schema":         func(v *State) { v.Schema = 12 },
			"duplicate":          func(v *State) { v.Album.Entries = append(v.Album.Entries, v.Album.Entries[index]) },
			"invented sky":       func(v *State) { v.Album.Entries[index].Kind = "scenery-" + kind + "-snow" },
			"saved provenance":   func(v *State) { v.Album.Entries[index].Source = "saved" },
			"elapsed provenance": func(v *State) { v.Album.Entries[index].Source = "elapsed" },
			"before discovery":   func(v *State) { v.Album.Entries[index].At-- },
			"after discovery":    func(v *State) { v.LastTick++; v.Album.Entries[index].At++ },
			"extra item":         func(v *State) { v.Album.Entries[index].Item = "rain" },
			"extra days":         func(v *State) { v.Album.Entries[index].Days = 1 },
			"extra score":        func(v *State) { v.Album.Entries[index].Score = 1 },
			"extra form":         func(v *State) { v.Album.Entries[index].Form = "gentle" },
			"no discoveries": func(v *State) {
				if kind == "fishing" {
					v.Pond.Fish = nil
				} else {
					v.Park.Finds = nil
				}
			},
		}
		for name, edit := range tests {
			t.Run(kind+"/"+name, func(t *testing.T) {
				v := copyState(s)
				edit(&v)
				if v.Validate(now.Add(time.Millisecond)) == nil {
					t.Fatal("accepted damaged story", v.Album)
				}
			})
		}
	}
}

func TestOutingAcrossSessionsKeepsFirstTimesAndOnlySixCards(t *testing.T) {
	s, now := fishingState(t)
	// Start fresh; exercise real catches/discoveries, changing only server session
	// IDs to cover the six fictional sky variants deterministically.
	if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
		t.Fatal(err)
	}
	first := []Memory{}
	for round := 0; round < 2; round++ {
		for _, kind := range []string{"fishing", "walk"} {
			for i := 0; i < 3; i++ {
				if _, err := s.Apply(Action{Kind: "play-" + kind}, now); err != nil {
					t.Fatal(err)
				}
				s.Game.ID = fmt.Sprintf("%06x%026x", i, round+1)
				if kind == "fishing" {
					bite(t, &s, &now)
					fishDo(t, &s, now, "fish-reel")
				} else {
					walkDo(t, &s, now, "walk-resume")
					walkBeats(t, &s, &now, 24, false)
				}
				if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
					t.Fatal(err)
				}
			}
		}
		if round == 0 {
			first = outingMemories(s)
		} else if !reflect.DeepEqual(first, outingMemories(s)) {
			t.Fatal("new sessions replaced first discovery dates")
		}
	}
	if len(first) != 6 || s.CareCount != 0 || s.Economy.Coins != 0 {
		t.Fatal("unbounded or rewarded collection", first)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
}
