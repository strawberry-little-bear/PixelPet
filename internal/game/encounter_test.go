package game

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func encounterMemories(s State) []Memory {
	out := []Memory{}
	for _, m := range s.Album.Entries {
		if strings.HasPrefix(m.Kind, "encounter-") {
			out = append(out, m)
		}
	}
	return out
}
func encounterState(t *testing.T, kind string) (State, time.Time) {
	t.Helper()
	var s State
	var now time.Time
	if kind == "fishing" {
		s, now = fishingState(t)
	} else {
		s, now = walkingState(t)
	}
	prefix := 36 // fictional moonlight; not the real clock
	if kind == "walk" {
		prefix = 24
	} // fictional dusk
	s.Game.ID = fmt.Sprintf("%06x00%024x", prefix, 1)
	return s, now
}
func discoverEncounter(t *testing.T, s *State, now *time.Time) {
	t.Helper()
	if s.Game.Kind == "fishing" {
		bite(t, s, now)
		fishDo(t, s, *now, "fish-reel")
	} else {
		if s.Game.Walking.Paused {
			walkDo(t, s, *now, "walk-resume")
		}
		walkBeats(t, s, now, ((s.Game.Walking.Beat/24)+1)*24, false)
	}
}
func TestEncountersRequireDiscoveryKeepFirstDateAndNoExtraReward(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			s, now := encounterState(t, kind)
			if len(encounterMemories(s)) != 0 {
				t.Fatal("start fabricated encounter")
			}
			if kind == "fishing" {
				fishDo(t, &s, now, "fish-cast")
				fishDo(t, &s, now, "fish-reel")
			} else {
				walkDo(t, &s, now, "walk-resume")
				walkBeats(t, &s, &now, 23, false)
			}
			if len(encounterMemories(s)) != 0 {
				t.Fatal("early action fabricated encounter")
			}
			discoverEncounter(t, &s, &now)
			memories := encounterMemories(s)
			if len(memories) != 1 || memories[0].At != now.UnixMilli() {
				t.Fatal("missing encounter", memories)
			}
			if s.CareCount != 0 || s.Economy.Coins != 0 {
				t.Fatal("encounter rewarded outside normal settlement")
			}
			discoverEncounter(t, &s, &now)
			if !reflect.DeepEqual(memories, encounterMemories(s)) {
				t.Fatal("repeat changed first memory")
			}
			if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(memories, encounterMemories(s)) || s.CareCount != 0 || s.Economy.Coins != 0 {
				t.Fatal("abandon lost/rewarded encounter")
			}
			// A later eligible outing must not replace the original date or ID.
			if _, err := s.Apply(Action{Kind: "play-" + kind}, now); err != nil {
				t.Fatal(err)
			}
			s.Game.ID = memories[0].OutingID[:31] + "2"
			discoverEncounter(t, &s, &now)
			if !reflect.DeepEqual(memories, encounterMemories(s)) {
				t.Fatal("new session replaced original provenance")
			}
			if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
				t.Fatal(err)
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestEncountersUpgradeDoesNotBackfill(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			s, now := encounterState(t, kind)
			s.Schema = 13
			discoverEncounter(t, &s, &now)
			if len(encounterMemories(s)) != 0 {
				t.Fatal("legacy session recorded encounter")
			}
			before := copyState(s)
			before.Schema = 14
			if !s.Upgrade(now) || !reflect.DeepEqual(before, s) || s.Upgrade(now) {
				t.Fatal("upgrade changed history")
			}
			discoverEncounter(t, &s, &now)
			if len(encounterMemories(s)) != 1 {
				t.Fatal("upgraded active session could not record future event")
			}
		})
	}
}

func TestEncounterSelectionUsesStableSessionAndFictionalLight(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		count := 0
		for scene := 0; scene < 48; scene++ {
			for token := 0; token < 256; token++ {
				id := fmt.Sprintf("%06x%02x%024x", scene, token, 1)
				want := ""
				if token%4 == 0 {
					if kind == "fishing" && scene/12 == 3 {
						want = "encounter-fishing-stars"
					}
					if kind == "walk" && scene/12 == 2 {
						want = "encounter-walk-kite"
					}
				}
				if got := outingEncounter(kind, id); got != want {
					t.Fatalf("%s/%s: %s != %s", kind, id, got, want)
				}
				if want != "" {
					count++
				}
				// Later entropy affects neither fictional light nor encounter selection.
				if outingEncounter(kind, id[:8]+strings.Repeat("f", 24)) != want {
					t.Fatal("unrelated ID suffix rerolled event")
				}
			}
		}
		if count != 48*256/16 {
			t.Fatal("unexpected selection share", count)
		}
	}
	for _, id := range []string{"", "a", strings.Repeat("g", 32), strings.Repeat("A", 32), strings.Repeat("f", 32) + "\n"} {
		for _, kind := range []string{"fishing", "walk"} {
			if outingEncounter(kind, id) != "" {
				t.Fatal("invalid ID accepted", id)
			}
		}
	}
	for _, kind := range []string{"stars", "tiles", "snake", "tetris", "other"} {
		if outingEncounter(kind, "00002400000000000000000000000001") != "" {
			t.Fatal("wrong game", kind)
		}
	}
}

func TestEncounterValidationRejectsCorruptProvenance(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		s, now := encounterState(t, kind)
		discoverEncounter(t, &s, &now)
		index := len(s.Album.Entries) - 1
		tests := map[string]func(*State){
			"old schema":         func(v *State) { v.Schema = 13 },
			"missing ID":         func(v *State) { v.Album.Entries[index].OutingID = "" },
			"invalid ID":         func(v *State) { v.Album.Entries[index].OutingID = strings.Repeat("g", 32) },
			"wrong light":        func(v *State) { v.Album.Entries[index].OutingID = "00000000000000000000000000000001" },
			"ordinary selection": func(v *State) { m := &v.Album.Entries[index]; m.OutingID = m.OutingID[:6] + "01" + m.OutingID[8:] },
			"wrong game": func(v *State) {
				if kind == "fishing" {
					v.Album.Entries[index].Kind = "encounter-walk-kite"
				} else {
					v.Album.Entries[index].Kind = "encounter-fishing-stars"
				}
			},
			"duplicate":         func(v *State) { v.Album.Entries = append(v.Album.Entries, v.Album.Entries[index]) },
			"unknown encounter": func(v *State) { v.Album.Entries[index].Kind = "encounter-walk-dragon" },
			"saved source":      func(v *State) { v.Album.Entries[index].Source = "saved" },
			"before discovery":  func(v *State) { v.Album.Entries[index].At-- },
			"after discovery":   func(v *State) { v.LastTick++; v.Album.Entries[index].At++ },
			"extra item":        func(v *State) { v.Album.Entries[index].Item = "leaf-pin" },
			"extra form":        func(v *State) { v.Album.Entries[index].Form = "balanced" },
			"extra score":       func(v *State) { v.Album.Entries[index].Score = 1 },
			"extra days":        func(v *State) { v.Album.Entries[index].Days = 1 },
			"no discovery": func(v *State) {
				if kind == "fishing" {
					v.Pond.Fish = nil
				} else {
					v.Park.Finds = nil
				}
			},
			"ID on ordinary memory": func(v *State) { v.Album.Entries[0].OutingID = v.Album.Entries[index].OutingID },
		}
		for name, edit := range tests {
			t.Run(kind+"/"+name, func(t *testing.T) {
				v := copyState(s)
				edit(&v)
				if v.Validate(now.Add(time.Millisecond)) == nil {
					t.Fatal("accepted corrupt encounter", v.Album)
				}
			})
		}
	}
}

func TestEncounterDoesNotAlterDiscoveryOrSettlement(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		t.Run(kind, func(t *testing.T) {
			rare, now := encounterState(t, kind)
			ordinary := copyState(rare)
			ordinary.Schema = 13
			// Equal cast fixtures compare the same fish/wait draw, not independent RNG.
			if kind == "fishing" {
				for i := 0; i < 3; i++ {
					fishDo(t, &rare, now, "fish-cast")
					fishDo(t, &ordinary, now, "fish-cast")
					ordinary.Game.Fishing.Candidate = rare.Game.Fishing.Candidate
					ordinary.Game.Fishing.WaitMS = rare.Game.Fishing.WaitMS
					for rare.Game.Fishing.Phase == "wait" {
						now = now.Add(time.Second)
						fishDo(t, &rare, now, "fish-step")
						fishDo(t, &ordinary, now, "fish-step")
					}
					fishDo(t, &rare, now, "fish-reel")
					fishDo(t, &ordinary, now, "fish-reel")
				}
				fishDo(t, &rare, now, "fish-finish")
				fishDo(t, &ordinary, now, "fish-finish")
			} else {
				otherTime := now
				walkDo(t, &rare, now, "walk-resume")
				walkDo(t, &ordinary, now, "walk-resume")
				walkBeats(t, &rare, &now, 72, false)
				walkBeats(t, &ordinary, &otherTime, 72, false)
				walkDo(t, &rare, now, "walk-finish")
				walkDo(t, &ordinary, now, "walk-finish")
			}
			if rare.CareCount != ordinary.CareCount || !reflect.DeepEqual(rare.Companion, ordinary.Companion) {
				t.Fatal("encounter changed care/companion settlement")
			}
			if !reflect.DeepEqual(rare.Growth, ordinary.Growth) || !reflect.DeepEqual(rare.Needs, ordinary.Needs) || !reflect.DeepEqual(rare.Economy, ordinary.Economy) || !reflect.DeepEqual(rare.Pond, ordinary.Pond) || !reflect.DeepEqual(rare.Park, ordinary.Park) {
				t.Fatal("encounter changed underlying rewards or discovery")
			}
			if len(encounterMemories(rare)) != 1 || len(encounterMemories(ordinary)) != 0 {
				t.Fatal("incorrect encounter selection")
			}
		})
	}
}
