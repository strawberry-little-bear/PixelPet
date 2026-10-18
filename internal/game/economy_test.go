package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func economyPet(t *testing.T) (State, time.Time) {
	t.Helper()
	now := time.Date(2026, 10, 18, 23, 59, 0, 0, time.UTC)
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch", Species: 2}, now); err != nil {
		t.Fatal(err)
	}
	return s, now
}
func TestDailyUsesServerUTCDayWithoutStreakOrPassiveRewards(t *testing.T) {
	s, now := economyPet(t)
	s.Advance(now.Add(30 * time.Second))
	if s.Economy.Coins != 0 {
		t.Fatal("passive settlement awarded coins")
	}
	if _, err := s.Apply(Action{Kind: "daily"}, now.Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(Action{Kind: "daily"}, now.Add(59*time.Second)); err == nil {
		t.Fatal("double claim")
	}
	next := now.Add(time.Minute)
	s.Advance(next)
	if _, err := s.Apply(Action{Kind: "daily"}, next); err != nil {
		t.Fatal("UTC boundary", err)
	}
	later := now.Add(19 * 24 * time.Hour)
	s.Advance(later)
	if _, err := s.Apply(Action{Kind: "daily"}, later); err != nil {
		t.Fatal(err)
	}
	if s.Economy.Coins != 3*DailyCoins {
		t.Fatal("missed days punished or rewarded", s.Economy)
	}
	if err := s.Validate(later); err != nil {
		t.Fatal(err)
	}
}
func TestShopOwnershipSlotsAndMemoriesDoNotChangeGrowth(t *testing.T) {
	s, now := economyPet(t)
	s.Economy.Coins = 1000
	growth, needs, care := *s.Growth, s.Needs, s.CareCount
	for _, item := range ShopRules().Catalog {
		before := s.Economy.Coins
		if _, err := s.Apply(Action{Kind: "equip", Item: item.ID}, now); err == nil {
			t.Fatal("equipped unowned item")
		}
		if _, err := s.Apply(Action{Kind: "buy", Item: item.ID}, now); err != nil {
			t.Fatal(err)
		}
		if s.Economy.Coins != before-item.Price {
			t.Fatal("price not charged")
		}
		if _, err := s.Apply(Action{Kind: "buy", Item: item.ID}, now); err == nil || s.Economy.Coins != before-item.Price {
			t.Fatal("duplicate charge")
		}
		if _, err := s.Apply(Action{Kind: "equip", Item: item.ID}, now); err != nil {
			t.Fatal(err)
		}
		if item.Slot == "accessory" && s.Economy.Equipped.Accessory != item.ID || item.Slot == "room" && s.Economy.Equipped.Room != item.ID {
			t.Fatal("wrong slot")
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(item.ID, err)
		}
		s.Apply(Action{Kind: "equip", Item: item.ID}, now)
	}
	if *s.Growth != growth || s.Needs != needs || s.CareCount != care {
		t.Fatal("cosmetics changed care or growth")
	}
	if len(s.Album.Entries) != 5 {
		t.Fatal("memories repeated", s.Album)
	}
	for i := 0; i < 40; i++ {
		s.Log(now, "普通日记")
	}
	if len(s.Album.Entries) != 5 || len(s.Logs) != 30 {
		t.Fatal("permanent memory rolled away")
	}
}
func TestShopErrorsLeaveEconomyUntouchedAndRespectSleepAndGames(t *testing.T) {
	for _, kind := range []string{"buy", "equip", "daily"} {
		for _, condition := range []string{"egg", "sleep", "game"} {
			s, now := economyPet(t)
			s.Economy.Coins = 50
			switch condition {
			case "egg":
				s = New(now)
			case "sleep":
				s.Apply(Action{Kind: "sleep"}, now)
			case "game":
				s.Apply(Action{Kind: "play"}, now)
			}
			before, _ := json.Marshal(s)
			if _, err := s.Apply(Action{Kind: kind, Item: "leaf-pin"}, now); err == nil {
				t.Fatal("accepted", kind, condition)
			}
			after, _ := json.Marshal(s)
			if string(before) != string(after) {
				t.Fatal("failed action mutated save", kind, condition)
			}
		}
	}
	s, now := economyPet(t)
	for _, id := range []string{"", "not-real", "LEAF-PIN", "../leaf-pin"} {
		if _, err := s.Apply(Action{Kind: "buy", Item: id}, now); err == nil {
			t.Fatal("unknown item accepted", id)
		}
	}
	if _, err := s.Apply(Action{Kind: "buy", Item: "leaf-pin"}, now); err == nil {
		t.Fatal("negative wallet")
	}
	s.Economy.Coins = MaxCoins
	if _, err := s.Apply(Action{Kind: "daily"}, now); err == nil {
		t.Fatal("overflow")
	}
}
func playStars(t *testing.T, s *State, now time.Time, score int) time.Time {
	t.Helper()
	s.Advance(now)
	if _, err := s.Apply(Action{Kind: "play"}, now); err != nil {
		t.Fatal(err)
	}
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
func TestStarCoinsOnlyOnCompleteScoreAndDailyCap(t *testing.T) {
	for score := 0; score <= 5; score++ {
		s, now := economyPet(t)
		s.Apply(Action{Kind: "play"}, now)
		s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now)
		if s.Economy.Coins != 0 {
			t.Fatal("cancel gave coins")
		}
		s.Apply(Action{Kind: "play"}, now)
		s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: 0}, now)
		if _, err := s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: 0}, now); err == nil {
			t.Fatal("repeat beat accepted")
		}
		if s.Economy.Coins != 0 {
			t.Fatal("partial gave coins")
		}
		s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now)
		end := playStars(t, &s, now, score)
		if s.Economy.Coins != 3+score || s.Economy.GameCoins != 3+score || s.Game != nil {
			t.Fatal("wrong score payout", score, s.Economy)
		}
		if _, err := s.Apply(Action{Kind: "catch", GameID: "completed-game", Lane: 1}, end); err == nil {
			t.Fatal("replayed completed game")
		}
		if err := s.Validate(end); err != nil {
			t.Fatal(err)
		}
	}
	s, now := economyPet(t)
	now = now.Add(time.Hour) // Keep wallet-cap assertions within one UTC day.
	for i := 0; i < 6; i++ {
		now = playStars(t, &s, now.Add(5*time.Second), 5)
	}
	if s.Economy.Coins != GameDailyLimit || s.Economy.GameCoins != GameDailyLimit {
		t.Fatal("cap bypassed", s.Economy)
	}
	tomorrow := now.Add(24 * time.Hour)
	playStars(t, &s, tomorrow, 0)
	if s.Economy.Coins != GameDailyLimit+3 || s.Economy.GameCoins != 3 {
		t.Fatal("new day not reset", s.Economy)
	}
	// Coins are bounded independently of the game cap.
	s.Economy.Coins = MaxCoins - 1
	s.Needs.Energy = 80
	playStars(t, &s, tomorrow.Add(time.Minute), 5)
	if s.Economy.Coins != MaxCoins || s.Economy.GameCoins != 4 {
		t.Fatal("wallet overflow")
	}
}
func TestEconomyRejectsInvalidBackups(t *testing.T) {
	mutations := map[string]func(*State){
		"missing":             func(s *State) { s.Economy = nil },
		"negative":            func(s *State) { s.Economy.Coins = -1 },
		"overflow":            func(s *State) { s.Economy.Coins = MaxCoins + 1 },
		"unknown":             func(s *State) { s.Economy.Owned = []string{"fake"} },
		"duplicates":          func(s *State) { s.Economy.Owned = []string{"leaf-pin", "leaf-pin"} },
		"unowned equipped":    func(s *State) { s.Economy.Equipped.Accessory = "leaf-pin" },
		"wrong slot":          func(s *State) { s.Economy.Owned = []string{"leaf-pin"}; s.Economy.Equipped.Room = "leaf-pin" },
		"future daily":        func(s *State) { s.Economy.LastDailyAt = s.LastTick + 1 },
		"before hatch":        func(s *State) { s.Economy.LastDailyAt = s.HatchedAt - 1 },
		"negative game coins": func(s *State) { s.Economy.GameCoins = -1 },
		"game cap":            func(s *State) { s.Economy.GameCoins = GameDailyLimit + 1 },
		"no session day":      func(s *State) { s.Economy.GameCoins = 1 },
		"unknown memory item": func(s *State) { s.remember(Memory{Kind: "outfit", At: s.LastTick, Source: "shared", Item: "fake"}) },
		"unowned memory":      func(s *State) { s.remember(Memory{Kind: "outfit", At: s.LastTick, Source: "shared", Item: "leaf-pin"}) },
		"wrong memory slot": func(s *State) {
			s.Economy.Owned = []string{"leaf-pin"}
			s.remember(Memory{Kind: "decoration", At: s.LastTick, Source: "shared", Item: "leaf-pin"})
		},
		"item on other memory": func(s *State) { s.Album.Entries[0].Item = "leaf-pin" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			s, now := economyPet(t)
			mutate(&s)
			if s.Validate(now) == nil {
				t.Fatal("accepted invalid backup")
			}
		})
	}
	egg := New(time.Now())
	egg.Economy.Coins = 1
	if egg.Validate(time.Now()) == nil {
		t.Fatal("egg wallet")
	}
}
func TestSchemaThreeUpgradeStartsEmptyWithoutInventingEconomy(t *testing.T) {
	s, now := economyPet(t)
	s.Schema = 3
	s.Companion = nil
	s.Pond = nil
	s.Economy = nil
	beforeGrowth, beforeAlbum := *s.Growth, *s.Album
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	if !s.Upgrade(now) || s.Schema != Schema || !reflect.DeepEqual(s.Economy, newEconomy()) {
		t.Fatal("migration failed")
	}
	if !reflect.DeepEqual(*s.Album, beforeAlbum) || *s.Growth != beforeGrowth {
		t.Fatal("economy migration rewrote past")
	}
	if s.Upgrade(now) {
		t.Fatal("migration replayed")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	rules := ShopRules()
	rules.Catalog[0].Price = 0
	if ShopRules().Catalog[0].Price == 0 {
		t.Fatal("catalog mutation leaked")
	}
}

func TestStarSessionIdentityPreventsStaleOrMissingOperations(t *testing.T) {
	s, now := economyPet(t)
	s.Apply(Action{Kind: "play"}, now)
	first := s.Game.ID
	if !validGameID(first) {
		t.Fatal("missing session identity")
	}
	s.Apply(Action{Kind: "cancel-play", GameID: first}, now)
	s.Apply(Action{Kind: "play"}, now)
	if s.Game.ID == first {
		t.Fatal("reused session identity at same timestamp")
	}
	second := *s.Game
	for _, kind := range []string{"catch", "cancel-play"} {
		for _, id := range []string{"", first, "invalid"} {
			if _, err := s.Apply(Action{Kind: kind, GameID: id}, now); err == nil || *s.Game != second {
				t.Fatal("stale operation affected new session", kind, id)
			}
		}
	}
	s.Game.ID = "not-a-session"
	if s.Validate(now) == nil {
		t.Fatal("invalid session backup")
	}
}
func TestLegacyActiveGameMigrationKeepsProgressAndAssignsIdentity(t *testing.T) {
	s, now := economyPet(t)
	s.Apply(Action{Kind: "play"}, now)
	s.Apply(Action{Kind: "catch", GameID: s.Game.ID, Lane: 0}, now)
	s.Schema = 3
	s.Companion = nil
	s.Pond = nil
	s.Economy = nil
	s.Game.ID = ""
	before := *s.Game
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	s.Upgrade(now)
	if !validGameID(s.Game.ID) || s.Game.Round != before.Round || s.Game.Score != before.Score || s.Game.StartedAt != before.StartedAt {
		t.Fatal("legacy session lost progress")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
}

func TestShopPublishesActualWalletAndSharedGameLimits(t *testing.T) {
	rules := ShopRules()
	if rules.MaxCoins != MaxCoins || rules.GameDailyLimit != GameDailyLimit {
		t.Fatal("UI rules do not match reward caps", rules)
	}
	raw, err := json.Marshal(rules)
	if err != nil {
		t.Fatal(err)
	}
	var published map[string]any
	if err := json.Unmarshal(raw, &published); err != nil {
		t.Fatal(err)
	}
	if published["maxCoins"] != float64(MaxCoins) || published["gameDailyLimit"] != float64(GameDailyLimit) {
		t.Fatal("limits absent from wire rules", string(raw))
	}
}
