package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func walkDo(t *testing.T, s *State, now time.Time, kind string) {
	t.Helper()
	if _, err := s.Apply(Action{Kind: kind, Step: s.Game.Walking.Step, GameID: s.Game.ID}, now); err != nil {
		t.Fatal(kind, err)
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(kind, err)
	}
}
func walkingState(t *testing.T) (State, time.Time) {
	s, now := economyPet(t)
	if _, err := s.Apply(Action{Kind: "play-walk"}, now); err != nil {
		t.Fatal(err)
	}
	return s, now
}
func walkBeats(t *testing.T, s *State, now *time.Time, to int, perfect bool) {
	t.Helper()
	for s.Game.Walking.Beat < to {
		*now = now.Add(time.Second)
		s.Advance(*now)
		n := s.Game.Walking
		if perfect && (n.Beat+1)%6 == 0 {
			kind := "walk-jump"
			if n.Route[n.Beat/6] == "branch" {
				kind = "walk-duck"
			}
			walkDo(t, s, *now, kind)
		}
		walkDo(t, s, *now, "walk-step")
	}
}
func TestWalkingCompleteAllMissesOrPerfectWithRealDiscoveries(t *testing.T) {
	for _, perfect := range []bool{false, true} {
		t.Run(map[bool]string{false: "all-missed", true: "perfect"}[perfect], func(t *testing.T) {
			s, now := walkingState(t)
			before := s.CareCount
			id := s.Game.ID
			if !s.Game.Walking.Paused {
				t.Fatal("must start paused")
			}
			walkDo(t, &s, now, "walk-resume")
			walkBeats(t, &s, &now, 72, perfect)
			if s.CareCount != before || s.Park.Walks != 0 {
				t.Fatal("reward before explicit settlement")
			}
			counts := map[string]int{}
			for _, id := range s.Game.Walking.Souvenirs {
				counts[id]++
			}
			for _, d := range s.Park.Finds {
				if counts[d.ID] != d.Count {
					t.Fatal("untrue discovery")
				}
			}
			want := 3
			if perfect {
				want = 6
				if s.Game.Walking.Cleared != 12 {
					t.Fatal("cleared")
				}
			}
			walkDo(t, &s, now, "walk-finish")
			if s.Game != nil || s.CareCount != before+1 || s.Economy.Coins != want || s.Park.Walks != 1 || s.Companion.Recent.ID != id || s.Companion.Recent.Kind != "walk" {
				t.Fatal("settlement", s.Park, s.Economy, s.Companion)
			}
			if _, err := s.Apply(Action{Kind: "walk-finish", GameID: id}, now); err == nil {
				t.Fatal("duplicate finish")
			}
		})
	}
}
func TestWalkingPauseLeaseReplayInputWindowAndAbandon(t *testing.T) {
	s, now := walkingState(t)
	walkDo(t, &s, now, "walk-resume")
	id := s.Game.ID
	a := Action{Kind: "walk-step", GameID: id, Step: s.Game.Walking.Step}
	if _, err := s.Apply(a, now); err == nil {
		t.Fatal("rapid heartbeat")
	}
	now = now.Add(time.Second)
	s.Advance(now)
	walkDo(t, &s, now, "walk-jump")
	a.Kind = "walk-duck"
	a.Step = s.Game.Walking.Step
	if _, err := s.Apply(a, now); err == nil {
		t.Fatal("rapid input")
	}
	a.GameID = "stale"
	if _, err := s.Apply(a, now); err == nil {
		t.Fatal("stale session")
	}
	walkDo(t, &s, now, "walk-step")
	if _, err := s.Apply(Action{Kind: "walk-step", GameID: id, Step: 1}, now); err == nil {
		t.Fatal("stale step")
	}
	now = now.Add(24 * time.Hour)
	s.Advance(now)
	walkDo(t, &s, now, "walk-step")
	if !s.Game.Walking.Paused || s.Game.Walking.Beat != 1 {
		t.Fatal("offline progressed")
	}
	walkDo(t, &s, now, "walk-resume")
	walkBeats(t, &s, &now, 24, false)
	if s.Game.Walking.Pose != "" || len(s.Park.Finds) != 1 {
		t.Fatal("pose/discovery")
	}
	if _, err := s.Apply(Action{Kind: "walk-finish", GameID: id, Step: s.Game.Walking.Step}, now); err == nil {
		t.Fatal("early finish")
	}
	care := s.CareCount
	walkDo(t, &s, now, "walk-pause")
	snapshot, _ := json.Marshal(s.Park)
	if _, err := s.Apply(Action{Kind: "cancel-play", GameID: id}, now); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(s.Park)
	if string(snapshot) != string(after) || s.Park.Walks != 0 || s.CareCount != care || s.Companion.Recent != nil {
		t.Fatal("abandon reward or discovery loss")
	}
}
func TestWalkingWideResponseWindowAndNoPenalties(t *testing.T) {
	s, now := walkingState(t)
	walkDo(t, &s, now, "walk-resume")
	walkBeats(t, &s, &now, 3, false)
	n := s.Game.Walking
	n.Route[0] = "rock"
	walkDo(t, &s, now, "walk-jump")
	before := s.Needs
	walkBeats(t, &s, &now, 6, false)
	if n.Cleared != 1 {
		t.Fatal("3 beat early window lost")
	}
	if s.Needs.Energy < before.Energy-0.1 {
		t.Fatal("obstacle damaged needs")
	}
}
func TestWalkSchemaTenUpgradePreservesFiveInterestsAndActiveSession(t *testing.T) {
	s, now := economyPet(t)
	s.Schema = 20 // Build historical experience before keepsakes existed.
	finishExperience(t, &s, &now, "tiles", true)
	s.Apply(Action{Kind: "play-fishing"}, now)
	s.Schema = 10
	if s.Companion != nil {
		s.Companion.History = nil
	}
	s.Park = nil
	s.Companion.Interests = s.Companion.Interests[:5]
	before := s
	raw, _ := json.Marshal(s)
	if s.Validate(now) != nil || !s.Upgrade(now) || s.Upgrade(now) || s.Validate(now) != nil {
		t.Fatal("migration")
	}
	if s.Park.Walks != 0 || len(s.Park.Finds) != 0 || s.Park.Since != now.UnixMilli() || len(s.Companion.Interests) != 7 || s.Companion.Interests[5] != (Interest{Kind: "walk"}) || s.Companion.Interests[6] != (Interest{Kind: "treasure"}) {
		t.Fatal("invented past")
	}
	if !reflect.DeepEqual(s.Game, before.Game) {
		t.Fatal("lost session")
	}
	s.Schema = 10
	if s.Companion != nil {
		s.Companion.History = nil
	}
	s.Park = nil
	s.Companion.Interests = s.Companion.Interests[:5]
	after, _ := json.Marshal(s)
	if string(raw) != string(after) {
		t.Fatal("changed past")
	}
}
func TestWalkingRejectsMalformedSaves(t *testing.T) {
	s, now := walkingState(t)
	walkDo(t, &s, now, "walk-resume")
	walkBeats(t, &s, &now, 24, true)
	raw, _ := json.Marshal(s)
	for i, mutate := range []func(*State){func(s *State) { s.Park = nil }, func(s *State) { s.Park.Since = s.LastTick + 1 }, func(s *State) { s.Park.Walks = -1 }, func(s *State) { s.Park.LastWalkAt = s.LastTick }, func(s *State) { s.Park.Finds = nil }, func(s *State) { s.Park.Finds[0].Count = 0 }, func(s *State) { s.Park.Finds = append(s.Park.Finds, s.Park.Finds[0]) }, func(s *State) { s.Game.Walking.Route[0] = "bad" }, func(s *State) { s.Game.Walking.Route = nil }, func(s *State) { s.Game.Walking.Souvenirs[2] = "bad" }, func(s *State) { s.Game.Walking.Beat = 73 }, func(s *State) { s.Game.Walking.Cleared = 5 }, func(s *State) { s.Game.Walking.Pose = "fly" }, func(s *State) { s.Game.Walking.LastInputAt = s.LastTick + 1 }, func(s *State) { s.Game.Walking.Step = 0 }, func(s *State) { s.Game.Kind = "snake" }, func(s *State) { s.Game.Fishing = newFishing(now) }, func(s *State) { s.Companion.Interests = s.Companion.Interests[:5] }, func(s *State) { s.sharedMemory("walk", now) }} {
		var bad State
		json.Unmarshal(raw, &bad)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("accepted", i)
		}
	}
}

func TestWalkSharesQuotaCooldownAndPreservesAllLockedForms(t *testing.T) {
	for _, form := range []string{"balanced", "lively", "gentle", "easygoing"} {
		for _, coins := range []int{0, MaxCoins - 1, MaxCoins} {
			s, now := economyPet(t)
			now = now.Add(time.Hour)
			s.Advance(now)
			s.Economy.Coins = coins
			s.Economy.LastGameAt = now.UnixMilli()
			s.Economy.GameCoins = GameDailyLimit - 1
			s.Growth.Stage = "adult"
			s.Growth.Points = AdultPoints
			s.Growth.Form = form
			s.Growth.GrowingAt = now.UnixMilli()
			s.Growth.AdultAt = now.UnixMilli()
			s.sharedMemory("growing", now)
			s.remember(Memory{Kind: "adult", At: now.UnixMilli(), Source: "shared", Form: form})
			first := finishExperience(t, &s, &now, "walk", true)
			afterCare := s.Growth.Care.Play
			if s.Economy.Coins != min(MaxCoins, coins+1) || s.Growth.Form != form || s.Growth.Points != AdultPoints || s.CareCount != 1 || s.Companion.Interests[5].Points != 1 {
				t.Fatal("quota/form/experience", s)
			}
			second := finishExperience(t, &s, &now, "walk", true)
			if s.Economy.Coins != min(MaxCoins, coins+1) || s.Growth.Care.Play != afterCare || s.Companion.Interests[5].Points != 1 || first == second || s.Companion.Recent.ID != second || s.Park.Walks != 2 {
				t.Fatal("cooldown or duplicate")
			}
			now = now.Add(InterestInterval)
			finishExperience(t, &s, &now, "walk", true)
			if s.Companion.Interests[5].Points != 2 || s.Growth.Form != form {
				t.Fatal("independent walk interest")
			}
		}
	}
}
func TestWalkGuardrailsAndSaturationRecovery(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := New(now)
	if _, err := s.Apply(Action{Kind: "play-walk"}, now); err == nil {
		t.Fatal("egg plays")
	}
	s.Apply(Action{Kind: "hatch"}, now)
	s.Needs.Energy = 9
	if _, err := s.Apply(Action{Kind: "play-walk"}, now); err == nil {
		t.Fatal("tired")
	}
	s.Needs.Energy = 80
	s.Sleeping = true
	if _, err := s.Apply(Action{Kind: "play-walk"}, now); err == nil {
		t.Fatal("sleeping")
	}
	s.Sleeping = false
	s.Apply(Action{Kind: "play-walk"}, now)
	for _, kind := range []string{"play", "feed", "clean", "buy", "snake-resume", "fish-cast", "walk-jump", "walk-duck", "walk-step", "walk-finish"} {
		if _, err := s.Apply(Action{Kind: kind, GameID: s.Game.ID, Step: 0}, now); err == nil {
			t.Fatal("guard", kind)
		}
	}
	s.Game.Walking.Step = walkStepLimit
	if _, err := s.Apply(Action{Kind: "walk-resume", GameID: s.Game.ID, Step: walkStepLimit}, now); err == nil {
		t.Fatal("command limit")
	}
	walkDo(t, &s, now, "walk-pause")
	if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil {
		t.Fatal("cannot recover")
	}
}
