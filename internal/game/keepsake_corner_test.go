package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestKeepsakeCornerPlacesOnlyOwnedMemoriesWithoutRewardsOrDiary(t *testing.T) {
	s, now := economyPet(t)
	for _, k := range gameKeepsakes {
		finishExperience(t, &s, &now, k.game, true)
	}
	s.Sleeping = true // Quiet home decoration need not wake a sleeping companion.
	for _, item := range append([]string{""}, keepsakeItemsForTest()...) {
		before := copyState(s)
		for n := 0; n < 2; n++ {
			if _, err := s.Apply(Action{Kind: "display-keepsake", Item: item}, now); err != nil {
				t.Fatal(err)
			}
			if s.Album.DisplayItem != item {
				t.Fatal("wrong display", s.Album)
			}
		}
		before.Album.DisplayItem = item
		if !reflect.DeepEqual(before, s) {
			t.Fatal("decoration changed needs, economy, growth, memories or diary")
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(s)
		var restored State
		if err := json.Unmarshal(raw, &restored); err != nil || restored.Validate(now) != nil || !reflect.DeepEqual(s, restored) {
			t.Fatal("portable corner lost")
		}
	}
}
func keepsakeItemsForTest() []string {
	var items []string
	for _, k := range gameKeepsakes {
		items = append(items, k.item)
	}
	return append(items, "")
}
func TestKeepsakeCornerRejectsUnownedUnknownAndOldSchema(t *testing.T) {
	for _, item := range []string{"star-ribbon", "leaf-pin", "unknown"} {
		s, now := economyPet(t)
		before := copyState(s)
		if _, err := s.Apply(Action{Kind: "display-keepsake", Item: item}, now); err == nil {
			t.Fatal("accepted unowned", item)
		}
		if !reflect.DeepEqual(before, s) {
			t.Fatal("refusal changed state")
		}
	}
	s, now := economyPet(t)
	finishExperience(t, &s, &now, "stars", true)
	s.Schema = 21
	if _, err := s.Apply(Action{Kind: "display-keepsake", Item: "star-ribbon"}, now); err == nil {
		t.Fatal("old schema accepted placement")
	}
	s.Schema = Schema
	s.Album.Entries[len(s.Album.Entries)-1].Source = "saved"
	if _, err := s.Apply(Action{Kind: "display-keepsake", Item: "star-ribbon"}, now); err == nil {
		t.Fatal("accepted saved-only ownership")
	}
}
func TestKeepsakeCornerValidationRejectsInvalidOwnership(t *testing.T) {
	for _, condition := range []string{"unknown", "shop-item", "unowned", "old-schema", "missing-record", "forged-source", "egg"} {
		t.Run(condition, func(t *testing.T) {
			s, now := economyPet(t)
			finishExperience(t, &s, &now, "stars", true)
			s.Album.DisplayItem = "star-ribbon"
			switch condition {
			case "unknown":
				s.Album.DisplayItem = "future"
			case "shop-item":
				s.Album.DisplayItem = "leaf-pin"
			case "unowned":
				s.Album.DisplayItem = "pond-shell"
			case "old-schema":
				s.Schema = 21
			case "missing-record":
				for i, m := range s.Album.Entries {
					if m.Kind == "keepsake" {
						s.Album.Entries = append(s.Album.Entries[:i], s.Album.Entries[i+1:]...)
						break
					}
				}
			case "forged-source":
				for i, m := range s.Album.Entries {
					if m.Kind == "keepsake" {
						s.Album.Entries[i].Source = "saved"
					}
				}
			case "egg":
				s = New(now)
				s.Album.DisplayItem = "star-ribbon"
			}
			if s.Validate(now) == nil {
				t.Fatal("invalid display accepted")
			}
		})
	}
}
func TestKeepsakeCornerMigrationPreservesOwnedItemsAndUnfinishedGames(t *testing.T) {
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk", "play-treasure"} {
		s, now := economyPet(t)
		finishExperience(t, &s, &now, "stars", true)
		s.Needs.Energy = 90
		keepsakeAction(t, &s, now, Action{Kind: start})
		s.Schema = 21
		before := copyState(s)
		if !s.Upgrade(now) || s.Upgrade(now) || s.Schema != Schema {
			t.Fatal("migration boundary")
		}
		before.Schema = Schema
		if !reflect.DeepEqual(before, s) || s.Album.DisplayItem != "" {
			t.Fatal("migration changed game or auto-placed an item")
		}
		if _, err := s.Apply(Action{Kind: "display-keepsake", Item: "star-ribbon"}, now); err == nil {
			t.Fatal("placement interrupted a game")
		}
		keepsakeAction(t, &s, now, Action{Kind: "cancel-play", GameID: s.Game.ID})
		keepsakeAction(t, &s, now, Action{Kind: "display-keepsake", Item: "star-ribbon"})
		s.Advance(now.Add(time.Hour))
		if s.Album.DisplayItem != "star-ribbon" || s.Validate(now.Add(time.Hour)) != nil {
			t.Fatal("offline lost corner")
		}
	}
}
