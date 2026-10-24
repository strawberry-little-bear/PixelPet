package game

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"
)

func rainID(prefix int) string { return fmt.Sprintf("%06x00000000000000000000000000", prefix) }

func TestRainFishPoolsExactWeightsAndLegacy(t *testing.T) {
	for _, schema := range []int{8, 14, 15, 19, 20} {
		for sky := 0; sky < 48; sky++ {
			for spot := 0; spot < 3; spot++ {
				pool := fishingPool(schema, rainID(sky), spot)
				counts := map[string]int{}
				for _, id := range pool {
					counts[id]++
				}
				rainy := schema >= 15 && sky%3 == 2
				reedClear := schema >= 20 && sky%3 != 2 && spot == 0
				size, common := 3, 1
				if rainy {
					size, common = 24, 7
					if counts["rain-koi"] != 3 {
						t.Fatal("rain chance must be exactly 1/8", counts)
					}
				}
				if reedClear {
					size = 4
				}
				if len(pool) != size {
					t.Fatal("pool size", schema, sky, spot, pool)
				}
				for _, id := range spotFish[spot] {
					if counts[id] != common {
						t.Fatal("common weight", counts)
					}
				}
				if !rainy && counts["rain-koi"] != 0 {
					t.Fatal("rain fish outside rain", counts)
				}
				if counts["willow-darter"] != btoi(reedClear) {
					t.Fatal("willow fish availability", schema, sky, spot, counts)
				}
			}
		}
	}
	for _, id := range []string{"", "bad", "000002ABCDEF00000000000000000000"} {
		if len(fishingPool(15, id, 0)) != 3 {
			t.Fatal("invalid sky enabled rarity", id)
		}
	}
}

func btoi(v bool) int {
	if v {
		return 1
	}
	return 0
}

func TestWillowDarterSchemaBoundaryAndRealDiscovery(t *testing.T) {
	s, now := fishingState(t)
	s.Game.ID = rainID(0)
	fishDo(t, &s, now, "fish-cast")
	s.Game.Fishing.Candidate = "willow-darter"
	s.Game.Fishing.Phase = "bite"
	if err := s.Validate(now); err != nil {
		t.Fatal("schema20 clear-sky candidate rejected", err)
	}
	fishDo(t, &s, now, "fish-reel")
	if len(s.Pond.Fish) != 1 || s.Pond.Fish[0].ID != "willow-darter" || s.Pond.Fish[0].Count != 1 {
		t.Fatal("willow discovery", s.Pond.Fish)
	}

	legacy := copyState(s)
	legacy.Schema = 19
	if legacy.Validate(now) == nil {
		t.Fatal("schema19 accepted new fish")
	}
	rainy := copyState(s)
	rainy.Game = nil
	rainy.Schema = 20
	rainy.Pond.Fish = nil
	rainy.Game = &MiniGame{Kind: "fishing", ID: rainID(2), StartedAt: now.UnixMilli(), LastBeat: -1, Fishing: &Fishing{Spot: 0, Casts: 1, Catches: []string{}, Phase: "bite", Step: 0, WaitMS: 32000, Candidate: "willow-darter", LastPulseAt: now.UnixMilli()}}
	if rainy.Validate(now) == nil {
		t.Fatal("rainy session accepted willow fish")
	}
}

func TestSchemaNineteenMigrationAddsCatalogWithoutChangingSession(t *testing.T) {
	s, now := fishingState(t)
	s.Schema = 19
	before := s
	if !s.Upgrade(now) || s.Schema != 20 {
		t.Fatal("schema19 did not migrate", s.Schema)
	}
	before.Schema = 20
	if !reflect.DeepEqual(before, s) {
		t.Fatal("catalog migration changed saved state")
	}
}

func rareCast(t *testing.T, phase string) (State, time.Time) {
	t.Helper()
	s, now := fishingState(t)
	s.Game.ID = rainID(2)
	fishDo(t, &s, now, "fish-cast")
	s.Game.Fishing.Candidate = "rain-koi" // Construct one valid rare cast, not an RNG claim.
	if phase == "bite" {
		s.Game.Fishing.Phase = "bite"
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	return s, now
}

func TestRainFishOnlyRealReelRecordsAndSameRewards(t *testing.T) {
	for _, outcome := range []string{"caught", "early", "missed"} {
		t.Run(outcome, func(t *testing.T) {
			phase := "bite"
			if outcome == "early" {
				phase = "wait"
			}
			s, now := rareCast(t, phase)
			before := s.CareCount
			if len(s.Pond.Fish) != 0 {
				t.Fatal("candidate revealed")
			}
			if outcome == "missed" {
				for i := 0; i < 10; i++ {
					now = now.Add(time.Second)
					fishDo(t, &s, now, "fish-step")
				}
			} else {
				fishDo(t, &s, now, "fish-reel")
			}
			if s.Game.Fishing.Outcome != outcome || s.CareCount != before || s.Economy.Coins != 0 {
				t.Fatal(s.Game.Fishing)
			}
			expected := 0
			if outcome == "caught" {
				expected = 1
			}
			if len(s.Pond.Fish) != expected {
				t.Fatal(s.Pond)
			}
			// Changing spots after a result must not invalidate the already saved cast.
			fishDo(t, &s, now, "fish-spot")
			for i := 0; i < 2; i++ {
				fishDo(t, &s, now, "fish-cast")
				fishDo(t, &s, now, "fish-reel")
			}
			fishDo(t, &s, now, "fish-finish")
			coins := 0
			if expected == 1 {
				coins = 3
			}
			if s.Economy.Coins != coins || s.CareCount != before+expected {
				t.Fatal("rarity changed rewards", s.Economy, s.CareCount)
			}
		})
	}
}

func TestRainFishPauseRoundTripAndSchema14Migration(t *testing.T) {
	s, now := rareCast(t, "wait")
	fishDo(t, &s, now, "fish-pause")
	raw, _ := json.Marshal(s)
	var loaded State
	if err := json.Unmarshal(raw, &loaded); err != nil {
		t.Fatal(err)
	}
	late := now.Add(time.Hour)
	loaded.Advance(late)
	if err := loaded.Validate(late); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.Game, loaded.Game) || len(loaded.Pond.Fish) != 0 {
		t.Fatal("reload rerolled/discovered candidate")
	}
	fishDo(t, &loaded, late, "fish-resume")
	if loaded.Game.Fishing.Candidate != "rain-koi" {
		t.Fatal("resume rerolled candidate")
	}
	// Existing schema14 rainy casts keep their original common candidate and all history.
	legacy, now := fishingState(t)
	legacy.Schema = 14
	if legacy.Companion != nil {
		legacy.Companion.History = nil
	}
	legacy.Companion.Interests = legacy.Companion.Interests[:6]
	legacy.Pond.Fish = []FishDiscovery{{ID: "reed-minnow", FirstAt: now.UnixMilli(), LastAt: now.UnixMilli(), Count: 2}}
	legacy.Game.ID = rainID(2)
	fishDo(t, &legacy, now, "fish-cast")
	fishDo(t, &legacy, now, "fish-pause")
	before, _ := json.Marshal(legacy)
	if !legacy.Upgrade(now) || legacy.Schema != Schema {
		t.Fatal("missing migration")
	}
	legacy.Schema = 14
	if legacy.Companion != nil {
		legacy.Companion.History = nil
	}
	legacy.Companion.Interests = legacy.Companion.Interests[:6]
	after, _ := json.Marshal(legacy)
	if string(before) != string(after) {
		t.Fatal("migration rewrote history/session")
	}
	legacy.Schema = Schema
	legacy.Companion.History = newGameHistory(now)
	legacy.Companion.Interests = append(legacy.Companion.Interests, Interest{Kind: "treasure"})
	if legacy.Upgrade(now) {
		t.Fatal("migration repeated")
	}
	if err := legacy.Validate(now); err != nil {
		t.Fatal(err)
	}
}

func TestRainFishValidationRejectsOldSchemaOrWrongSky(t *testing.T) {
	for _, phase := range []string{"wait", "bite", "result"} {
		for _, schema := range []int{14, 15} {
			for sky := 0; sky < 3; sky++ {
				s, now := rareCast(t, "bite")
				if phase == "result" {
					fishDo(t, &s, now, "fish-reel")
				} else {
					s.Game.Fishing.Phase = phase
				}
				s.Schema = schema
				if s.Companion != nil {
					s.Companion.History = nil
				}
				s.Companion.Interests = s.Companion.Interests[:6]
				s.Game.ID = rainID(sky)
				if got := s.Validate(now) == nil; got != (schema == 15 && sky == 2) {
					t.Fatal("invalid rare cast accepted", phase, schema, sky, got)
				}
			}
		}
	}
	s, now := rareCast(t, "bite")
	fishDo(t, &s, now, "fish-reel")
	s.Game = nil
	s.Schema = 14
	if s.Companion != nil {
		s.Companion.History = nil
	}
	s.Companion.Interests = s.Companion.Interests[:6]
	if s.Validate(now) == nil {
		t.Fatal("old schema accepted new discovery")
	}
	s.Schema = 15
	if s.Companion != nil {
		s.Companion.History = nil
	}
	if err := s.Validate(now); err != nil {
		t.Fatal("historical discovery must not require an active rainy game", err)
	}
}

func TestRainFishRepeatAndAbandonKeepDiscoveryWithoutRewards(t *testing.T) {
	s, now := rareCast(t, "bite")
	first := now.UnixMilli()
	fishDo(t, &s, now, "fish-reel")
	now = now.Add(time.Second)
	fishDo(t, &s, now, "fish-cast")
	s.Game.Fishing.Candidate = "rain-koi"
	s.Game.Fishing.Phase = "bite" // Controlled second successful encounter.
	fishDo(t, &s, now, "fish-reel")
	if d := s.Pond.Fish[0]; d.FirstAt != first || d.LastAt != now.UnixMilli() || d.Count != 2 {
		t.Fatal("discovery dates/count", d)
	}
	// A rare catch earlier in the session is invalid under a clear sky even if
	// the current candidate is common (the catch-list guard is independent).
	forged := copyState(s)
	forged.Game.ID = rainID(0)
	forged.Game.Fishing.Candidate = "reed-minnow"
	forged.Game.Fishing.LastFish = "reed-minnow"
	forged.Game.Fishing.Catches[1] = "reed-minnow"
	forged.Pond.Fish = append(forged.Pond.Fish, FishDiscovery{ID: "reed-minnow", FirstAt: first, LastAt: now.UnixMilli(), Count: 1})
	if forged.Validate(now) == nil {
		t.Fatal("clear session accepted earlier rare catch")
	}
	fishDo(t, &s, now, "fish-pause")
	if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
		t.Fatal(err)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	if s.Game != nil || len(s.Pond.Fish) != 1 || s.Pond.Fish[0].Count != 2 || s.CareCount != 0 || s.Economy.Coins != 0 {
		t.Fatal("abandon lost fish or awarded resources")
	}
}
