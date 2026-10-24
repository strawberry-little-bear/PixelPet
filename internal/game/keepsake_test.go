package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func keepsakeEntries(s State) []Memory {
	var entries []Memory
	for _, m := range s.Album.Entries {
		if m.Kind == "keepsake" {
			entries = append(entries, m)
		}
	}
	return entries
}

func TestKeepsakesRecordSevenActualGamesOnceEvenAtCoinLimit(t *testing.T) {
	s, now := economyPet(t)
	s.Economy.Coins = MaxCoins
	s.Economy.GameCoins = GameDailyLimit
	s.Economy.LastGameAt = now.UnixMilli()
	for _, k := range gameKeepsakes {
		finishExperience(t, &s, &now, k.game, true)
		var found bool
		for _, m := range keepsakeEntries(s) {
			if m.Item == k.item {
				found = m.At == now.UnixMilli() && m.Source == "shared"
			}
		}
		if !found {
			t.Fatal("missing keepsake", k)
		}
	}
	first := keepsakeEntries(s)
	if len(first) != 7 || s.Economy.Coins != MaxCoins {
		t.Fatal("bad collection or wallet", first, s.Economy)
	}
	for _, k := range gameKeepsakes {
		now = now.Add(time.Minute)
		finishExperience(t, &s, &now, k.game, true)
	}
	if !reflect.DeepEqual(first, keepsakeEntries(s)) {
		t.Fatal("rewrote or duplicated keepsakes")
	}
	// Portable JSON is also the representation used by exported/imported state.
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var restored State
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Validate(now) != nil || !reflect.DeepEqual(s, restored) {
		t.Fatal("roundtrip lost saved memories")
	}
	// Saved entry order is not part of identity or validation.
	for i, j := 0, len(restored.Album.Entries)-1; i < j; i, j = i+1, j-1 {
		restored.Album.Entries[i], restored.Album.Entries[j] = restored.Album.Entries[j], restored.Album.Entries[i]
	}
	if err := restored.Validate(now); err != nil {
		t.Fatal("order-dependent validation", err)
	}
}

func TestKeepsakesDoNotRewardPartialAbandonedOrOfflineGames(t *testing.T) {
	for _, kind := range []string{"snake", "tetris", "fishing"} {
		s, now := economyPet(t)
		finishExperience(t, &s, &now, kind, false)
		if len(keepsakeEntries(s)) != 0 {
			t.Fatal("short game earned keepsake", kind)
		}
	}
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk", "play-treasure"} {
		s, now := economyPet(t)
		keepsakeAction(t, &s, now, Action{Kind: start})
		id := s.Game.ID
		s.Advance(now.Add(time.Hour))
		if len(keepsakeEntries(s)) != 0 {
			t.Fatal("offline invented keepsake", start)
		}
		keepsakeAction(t, &s, now.Add(time.Hour), Action{Kind: "cancel-play", GameID: id})
		if len(keepsakeEntries(s)) != 0 {
			t.Fatal("abandon earned keepsake", start)
		}
	}
}

func TestKeepsakeSchema20UpgradePreservesPastAndActiveGames(t *testing.T) {
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk", "play-treasure"} {
		s, now := economyPet(t)
		s.Schema = 20
		finishExperience(t, &s, &now, "tiles", true)
		s.Needs.Energy = 90
		keepsakeAction(t, &s, now, Action{Kind: start})
		before := copyState(s)
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		if !s.Upgrade(now) || s.Upgrade(now) || s.Schema != Schema {
			t.Fatal("upgrade boundary")
		}
		before.Schema = Schema
		if !reflect.DeepEqual(before, s) || len(keepsakeEntries(s)) != 0 {
			t.Fatal("migration rewrote experience or active game")
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		keepsakeAction(t, &s, now, Action{Kind: "cancel-play", GameID: s.Game.ID})
		finishExperience(t, &s, &now, "tiles", true)
		if len(keepsakeEntries(s)) != 1 || keepsakeEntries(s)[0].Item != "tile-basket" {
			t.Fatal("next real settlement did not record keepsake")
		}
	}
}

func TestKeepsakeChangesOnlyAlbum(t *testing.T) {
	s, now := economyPet(t)
	before := copyState(s)
	s.rememberGameKeepsake("unknown", now)
	if !reflect.DeepEqual(before, s) {
		t.Fatal("unknown game changed state")
	}
	s.rememberGameKeepsake("stars", now)
	s.Album = before.Album
	if !reflect.DeepEqual(before, s) {
		t.Fatal("keepsake changed economy, growth or needs")
	}
}

func TestKeepsakesRejectForgedFieldsAndInconsistentEvidence(t *testing.T) {
	s, now := economyPet(t)
	finishExperience(t, &s, &now, "stars", true)
	index := len(s.Album.Entries) - 1
	for name, mutate := range map[string]func(*State){
		"old schema":     func(s *State) { s.Schema = 20 },
		"unknown item":   func(s *State) { s.Album.Entries[index].Item = "unknown" },
		"wrong game":     func(s *State) { s.Album.Entries[index].Item = "pond-shell" },
		"saved source":   func(s *State) { s.Album.Entries[index].Source = "saved" },
		"elapsed source": func(s *State) { s.Album.Entries[index].Source = "elapsed" },
		"missing count":  func(s *State) { s.Companion.History.Completions[0].Count = 0 },
		"missing game card": func(s *State) {
			for i, m := range s.Album.Entries {
				if m.Kind == "stars" {
					s.Album.Entries = append(s.Album.Entries[:i], s.Album.Entries[i+1:]...)
					break
				}
			}
		},
		"before game":             func(s *State) { s.Album.Entries[index].At-- },
		"after latest settlement": func(s *State) { s.LastTick++; s.Album.Entries[index].At++ },
		"score":                   func(s *State) { s.Album.Entries[index].Score = 1 },
		"days":                    func(s *State) { s.Album.Entries[index].Days = 1 },
		"duplicate":               func(s *State) { s.Album.Entries = append(s.Album.Entries, s.Album.Entries[index]) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyState(s)
			mutate(&bad)
			if bad.Validate(now.Add(time.Second)) == nil {
				t.Fatal("accepted forged keepsake")
			}
		})
	}
}

func keepsakeAction(t *testing.T, s *State, now time.Time, action Action) {
	t.Helper()
	if _, err := s.Apply(action, now); err != nil {
		t.Fatal(err)
	}
}
