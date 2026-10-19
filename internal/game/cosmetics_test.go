package game

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestFourCosmeticSlotsReplaceAndToggleIndependently(t *testing.T) {
	s, now := economyPet(t)
	s.Economy.Coins = 1000
	beforeGrowth, beforeNeeds, beforeCare := *s.Growth, s.Needs, s.CareCount
	groups := [][]string{{"leaf-pin", "sunflower-pin", "sky-bow"}, {"clover-pot", "moon-lamp"}, {"meadow-wall", "starlit-wall"}, {"honey-floor", "mint-floor"}}
	for _, group := range groups {
		for _, id := range group {
			previous := s.Economy.Equipped
			if _, err := s.Apply(Action{Kind: "buy", Item: id}, now); err != nil {
				t.Fatal(err)
			}
			if s.Economy.Equipped != previous {
				t.Fatal("purchase equipped automatically")
			}
			coins := s.Economy.Coins
			if _, err := s.Apply(Action{Kind: "equip", Item: id}, now); err != nil {
				t.Fatal(err)
			}
			expected := previous
			item, _ := shopItem(id)
			switch item.Slot {
			case "accessory":
				expected.Accessory = id
			case "room":
				expected.Room = id
			case "wallpaper":
				expected.Wallpaper = id
			case "floor":
				expected.Floor = id
			}
			if s.Economy.Equipped != expected || s.Economy.Coins != coins {
				t.Fatal("changed another slot or charged equip", id, s.Economy)
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(id, err)
			}
			s.Apply(Action{Kind: "equip", Item: id}, now)
			switch item.Slot {
			case "accessory":
				expected.Accessory = ""
			case "room":
				expected.Room = ""
			case "wallpaper":
				expected.Wallpaper = ""
			case "floor":
				expected.Floor = ""
			}
			if s.Economy.Equipped != expected {
				t.Fatal("toggle changed other slot")
			}
			s.Apply(Action{Kind: "equip", Item: id}, now)
		}
	}
	if s.Economy.Equipped != (Equipment{"sky-bow", "moon-lamp", "starlit-wall", "mint-floor"}) {
		t.Fatal(s.Economy.Equipped)
	}
	if beforeGrowth != *s.Growth || beforeNeeds != s.Needs || beforeCare != s.CareCount {
		t.Fatal("cosmetics changed growth")
	}
	if len(s.Album.Entries) != 5 {
		t.Fatal("cosmetic memory duplicated")
	}
	for _, m := range s.Album.Entries {
		if m.Kind == "wallpaper" && m.Item != "meadow-wall" || m.Kind == "floor" && m.Item != "honey-floor" {
			t.Fatal("first pattern rewritten", m)
		}
	}
}

func TestNewCosmeticsRequireOwnershipMatchingSlotAndSchema(t *testing.T) {
	for _, id := range []string{"sunflower-pin", "sky-bow", "meadow-wall", "starlit-wall", "honey-floor", "mint-floor"} {
		t.Run(id, func(t *testing.T) {
			s, now := economyPet(t)
			s.Economy.Coins = 100
			s.Apply(Action{Kind: "buy", Item: id}, now)
			s.Apply(Action{Kind: "equip", Item: id}, now)
			raw, _ := json.Marshal(s)
			for _, badSlot := range []string{"accessory", "room", "wallpaper", "floor"} {
				var bad State
				json.Unmarshal(raw, &bad)
				item, _ := shopItem(id)
				if item.Slot == badSlot {
					continue
				}
				switch badSlot {
				case "accessory":
					bad.Economy.Equipped.Accessory = id
				case "room":
					bad.Economy.Equipped.Room = id
				case "wallpaper":
					bad.Economy.Equipped.Wallpaper = id
				case "floor":
					bad.Economy.Equipped.Floor = id
				}
				if bad.Validate(now) == nil {
					t.Fatal("cross-slot item accepted", badSlot)
				}
			}
			var missing State
			json.Unmarshal(raw, &missing)
			missing.Economy.Owned = nil
			if missing.Validate(now) == nil {
				t.Fatal("unowned equipped item accepted")
			}
			var old State
			json.Unmarshal(raw, &old)
			old.Schema = 8
			old.Companion = nil
			old.Park = nil
			if old.Validate(now) == nil {
				t.Fatal("new item disguised as old save")
			}
		})
	}
	for _, kind := range []string{"wallpaper", "floor"} {
		s, now := economyPet(t)
		s.Economy.Owned = []string{"meadow-wall", "honey-floor"}
		other := "meadow-wall"
		if kind == "wallpaper" {
			other = "honey-floor"
		}
		s.remember(Memory{Kind: kind, Item: other, At: now.UnixMilli(), Source: "shared"})
		if s.Validate(now) == nil {
			t.Fatal("wrong surface memory slot accepted")
		}
	}
}

func TestSchemaEightCosmeticUpgradePreservesRealFishAndActiveSession(t *testing.T) {
	s, now := fishingState(t)
	// The old engine did not record scenery during its real catch.
	s.Schema = 12
	s.Companion.Interests = s.Companion.Interests[:6]
	bite(t, &s, &now)
	fishDo(t, &s, now, "fish-reel")
	s.Economy.Coins = 50
	s.Economy.Owned = []string{"leaf-pin", "moon-lamp"}
	s.Economy.Equipped = Equipment{Accessory: "leaf-pin", Room: "moon-lamp"}
	s.Schema = 8
	s.Companion = nil
	s.Park = nil
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(s)
	if !s.Upgrade(now) || s.Schema != Schema || s.Upgrade(now) {
		t.Fatal("upgrade failed/replayed")
	}
	s.Schema = 8
	s.Companion = nil
	s.Park = nil
	after, _ := json.Marshal(s)
	if string(raw) != string(after) {
		t.Fatal("migration rewrote fish/session/gear/history")
	}
	s.Schema = Schema
	s.Companion = newCompanion(now)
	s.Park = newPark(now)
	if s.Economy.Equipped.Wallpaper != "" || s.Economy.Equipped.Floor != "" {
		t.Fatal("invented surface")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	var restored State
	json.Unmarshal(after, &restored)
	if !reflect.DeepEqual(s.Pond, restored.Pond) || !reflect.DeepEqual(s.Game, restored.Game) {
		t.Fatal("lost fishing")
	}
}

func TestCosmeticsPreserveEveryLockedAdultForm(t *testing.T) {
	for _, form := range []string{"balanced", "lively", "gentle", "easygoing"} {
		s, now := economyPet(t)
		s.Economy.Coins = 1000
		s.Growth.Stage = "adult"
		s.Growth.Points = AdultPoints
		s.Growth.Form = form
		s.Growth.GrowingAt = now.UnixMilli()
		s.Growth.AdultAt = now.UnixMilli()
		s.sharedMemory("growing", now)
		s.remember(Memory{Kind: "adult", At: now.UnixMilli(), Source: "shared", Form: form})
		before := *s.Growth
		for _, item := range ShopRules().Catalog {
			if _, err := s.Apply(Action{Kind: "buy", Item: item.ID}, now); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Apply(Action{Kind: "equip", Item: item.ID}, now); err != nil {
				t.Fatal(err)
			}
		}
		if before != *s.Growth {
			t.Fatal("adult form changed", form)
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
	}
}
