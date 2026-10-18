package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func fishingState(t *testing.T) (State, time.Time) {
	t.Helper()
	now := time.Now().Truncate(time.Millisecond)
	s := New(now)
	if _, err := s.Apply(Action{Kind: "hatch", Species: 3}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(Action{Kind: "play-fishing"}, now); err != nil {
		t.Fatal(err)
	}
	return s, now
}
func fishAction(s *State, kind string) Action {
	return Action{Kind: kind, GameID: s.Game.ID, Step: s.Game.Fishing.Step}
}
func fishDo(t *testing.T, s *State, now time.Time, kind string) {
	t.Helper()
	s.Advance(now)
	if _, err := s.Apply(fishAction(s, kind), now); err != nil {
		t.Fatal(kind, err)
	}
	if err := s.Validate(now); err != nil {
		b, _ := json.Marshal(s.Game.Fishing)
		t.Fatalf("%s %s: %v", kind, b, err)
	}
}
func bite(t *testing.T, s *State, now *time.Time) {
	t.Helper()
	fishDo(t, s, *now, "fish-cast")
	for s.Game.Fishing.Phase == "wait" {
		*now = now.Add(time.Second)
		fishDo(t, s, *now, "fish-step")
	}
}
func TestFishingThreeCastsRealDiscoveriesAndFinishOnce(t *testing.T) {
	s, now := fishingState(t)
	for i := 0; i < 3; i++ {
		fishDo(t, &s, now, "fish-spot")
		bite(t, &s, &now)
		if len(s.Pond.Fish) != 0 && i == 0 {
			t.Fatal("discovered before reel")
		}
		before := s.CareCount
		fishDo(t, &s, now, "fish-reel")
		if s.CareCount != before || s.Economy.Coins != 0 {
			t.Fatal("premature completion")
		}
		n := s.Game.Fishing
		if len(n.Catches) != i+1 || n.Outcome != "caught" {
			t.Fatal(n)
		}
	}
	id := s.Game.ID
	a := fishAction(&s, "fish-finish")
	msg, f, err := s.ApplyWithFeedback(a, now)
	if err != nil || s.Game != nil || s.CareCount != 1 || s.Economy.Coins != 6 || f == nil || f.Habit != "play" {
		t.Fatal(msg, f, err, s)
	}
	if _, err = s.Apply(a, now); err == nil {
		t.Fatal("double finish", id)
	}
	count := 0
	for _, d := range s.Pond.Fish {
		count += d.Count
		if d.FirstAt < s.HatchedAt || d.LastAt < d.FirstAt {
			t.Fatal(d)
		}
	}
	if count != 3 {
		t.Fatal(count)
	}
	found := false
	for _, m := range s.Album.Entries {
		found = found || m.Kind == "fishing"
	}
	if !found {
		t.Fatal("missing memory")
	}
	if err = s.Validate(now); err != nil {
		t.Fatal(err)
	}
}
func TestFishingEarlyMissedAndAllMissNoReward(t *testing.T) {
	s, now := fishingState(t)
	fishDo(t, &s, now, "fish-cast")
	fishDo(t, &s, now, "fish-reel")
	if s.Game.Fishing.Outcome != "early" {
		t.Fatal(s.Game.Fishing)
	}
	bite(t, &s, &now)
	for i := 0; i < 10; i++ {
		now = now.Add(time.Second)
		fishDo(t, &s, now, "fish-step")
	}
	if s.Game.Fishing.Outcome != "missed" {
		t.Fatal(s.Game.Fishing)
	}
	fishDo(t, &s, now, "fish-cast")
	fishDo(t, &s, now, "fish-reel")
	fishDo(t, &s, now, "fish-finish")
	if s.CareCount != 0 || s.Economy.Coins != 0 || len(s.Pond.Fish) != 0 {
		t.Fatal("miss paid")
	}
}
func TestFishingPauseExpiryDoesNotUseTimeOrCasts(t *testing.T) {
	for _, phase := range []string{"wait", "bite"} {
		t.Run(phase, func(t *testing.T) {
			s, now := fishingState(t)
			if phase == "bite" {
				bite(t, &s, &now)
			} else {
				fishDo(t, &s, now, "fish-cast")
			}
			old := *s.Game.Fishing
			late := now.Add(12 * time.Hour)
			s.Advance(late)
			if !s.ExpireFishing(late) || !s.Game.Fishing.Paused || s.Game.Fishing.ElapsedMS != old.ElapsedMS || s.Game.Fishing.Casts != old.Casts || s.Game.Fishing.Phase != old.Phase {
				t.Fatal("offline progression")
			}
			fishDo(t, &s, late, "fish-resume")
			late = late.Add(time.Second)
			fishDo(t, &s, late, "fish-step")
			if s.Game.Fishing.ElapsedMS != old.ElapsedMS+1000 {
				t.Fatal("catch-up")
			}
			fishDo(t, &s, late, "fish-pause")
			frozen := *s.Game.Fishing
			late = late.Add(time.Hour)
			s.Advance(late)
			if s.ExpireFishing(late) || !reflect.DeepEqual(frozen, *s.Game.Fishing) {
				t.Fatal("paused changed")
			}
			if _, err := s.Apply(fishAction(&s, "fish-step"), late); err == nil {
				t.Fatal("paused beat")
			}
		})
	}
	s, now := fishingState(t)
	fishDo(t, &s, now, "fish-cast")
	late := now.Add(time.Hour)
	s.Advance(late)
	if _, err := s.Apply(fishAction(&s, "fish-step"), late); err != nil || !s.Game.Fishing.Paused || s.Game.Fishing.ElapsedMS != 0 {
		t.Fatal("late beat must save pause", err)
	}
}
func TestFishingTimingAndSessionGuards(t *testing.T) {
	s, now := fishingState(t)
	for _, kind := range []string{"fish-step", "fish-reel", "fish-finish"} {
		if _, err := s.Apply(fishAction(&s, kind), now); err == nil {
			t.Fatal(kind)
		}
	}
	fishDo(t, &s, now, "fish-cast")
	for _, a := range []Action{{Kind: "fish-step", GameID: "wrong"}, {Kind: "feed"}, {Kind: "fish-spot", GameID: s.Game.ID, Step: s.Game.Fishing.Step}, {Kind: "fish-step", GameID: s.Game.ID, Step: 0}} {
		if _, err := s.Apply(a, now); err == nil {
			t.Fatal(a)
		}
	}
	a := fishAction(&s, "fish-step")
	if _, err := s.Apply(a, now.Add(999*time.Millisecond)); err == nil {
		t.Fatal("fast tick")
	}
	now = now.Add(2 * time.Second)
	fishDo(t, &s, now, "fish-step")
	if s.Game.Fishing.ElapsedMS != 1500 {
		t.Fatal("unbounded tick")
	}
	if _, err := s.Apply(a, now); err == nil {
		t.Fatal("repeat step")
	}
}
func TestFishingDiscoveryPersistsWithoutCompletionAndSaturates(t *testing.T) {
	s, now := fishingState(t)
	bite(t, &s, &now)
	fishDo(t, &s, now, "fish-reel")
	id := s.Pond.Fish[0].ID
	first := s.Pond.Fish[0].FirstAt
	s.Pond.Fish[0].Count = fishCountLimit
	s.discoverFish(id, now.Add(time.Second))
	if s.Pond.Fish[0].Count != fishCountLimit || s.Pond.Fish[0].FirstAt != first || len(s.Pond.Fish) != 1 {
		t.Fatal(s.Pond)
	}
	s.Advance(now.Add(time.Second))
	s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now.Add(time.Second))
	if len(s.Pond.Fish) != 1 || s.CareCount != 0 || s.Economy.Coins != 0 {
		t.Fatal("cancel rewrote discovery or paid")
	}
}
func TestFishingSharedCapWalletAndLockedAdultForm(t *testing.T) {
	for _, coins := range []int{0, MaxCoins - 1, MaxCoins} {
		t.Run(time.Duration(coins).String(), func(t *testing.T) {
			s, now := fishingState(t)
			s.Economy.Coins = coins
			s.Economy.LastGameAt = now.UnixMilli()
			s.Economy.GameCoins = 29
			s.Growth.Stage = "adult"
			s.Growth.Points = AdultPoints
			s.Growth.Form = "gentle"
			s.Growth.GrowingAt = now.UnixMilli()
			s.Growth.AdultAt = now.UnixMilli()
			s.sharedMemory("growing", now)
			s.remember(Memory{Kind: "adult", At: now.UnixMilli(), Source: "shared", Form: "gentle"})
			for i := 0; i < 3; i++ {
				bite(t, &s, &now)
				fishDo(t, &s, now, "fish-reel")
			}
			fishDo(t, &s, now, "fish-finish")
			if s.Economy.Coins != min(MaxCoins, coins+1) || s.Growth.Form != "gentle" || s.CareCount != 1 {
				t.Fatal(s)
			}
		})
	}
}
func TestFishingInvalidDataAndLegacyMigration(t *testing.T) {
	s, now := fishingState(t)
	bite(t, &s, &now)
	fishDo(t, &s, now, "fish-reel")
	encoded, _ := json.Marshal(s)
	cases := []func(*State){
		func(s *State) { s.Pond = nil }, func(s *State) { s.Pond.Fish[0].ID = "made-up" }, func(s *State) { s.Pond.Fish = append(s.Pond.Fish, s.Pond.Fish[0]) }, func(s *State) { s.Pond.Fish[0].Count = 0 }, func(s *State) { s.Pond.Fish[0].LastAt = s.LastTick + 1 }, func(s *State) { s.Game.Fishing.Phase = "done" }, func(s *State) { s.Game.Fishing.Spot = 3 }, func(s *State) { s.Game.Fishing.WaitMS = 1 }, func(s *State) { s.Game.Fishing.Catches = append(s.Game.Fishing.Catches, "made-up") }, func(s *State) { s.Game.Fishing.Outcome = "invented" }, func(s *State) { s.Game.Fishing.LastFish = "made-up" }, func(s *State) { s.Game.Fishing.ElapsedMS = -1 }, func(s *State) { s.Game.Fishing.LastPulseAt = s.LastTick + 1 }, func(s *State) { s.Game.Kind = "" }, func(s *State) { s.Game.Tiles = &TileMatch{} }, func(s *State) { s.Game.Fishing.Candidate = "made-up" },
	}
	for i, mutate := range cases {
		var bad State
		json.Unmarshal(encoded, &bad)
		mutate(&bad)
		if bad.Validate(now) == nil {
			t.Fatal("accepted corrupt", i)
		}
	}
	old := New(now)
	old.Apply(Action{Kind: "hatch"}, now)
	old.Apply(Action{Kind: "play-tetris"}, now)
	old.Schema = 7
	old.Companion = nil
	old.Park = nil
	old.Pond = nil
	before, _ := json.Marshal(old.Game)
	if err := old.Validate(now); err != nil {
		t.Fatal(err)
	}
	later := now.Add(time.Second)
	if !old.Upgrade(later) || old.Schema != Schema || old.Pond.Since != later.UnixMilli() || len(old.Pond.Fish) != 0 {
		t.Fatal(old)
	}
	after, _ := json.Marshal(old.Game)
	if !reflect.DeepEqual(before, after) || old.Upgrade(later) || old.Validate(later) != nil {
		t.Fatal("migration changed game or repeated")
	}
}

func TestFishingStepBoundRemainsValid(t *testing.T) {
	s, now := fishingState(t)
	s.Game.Fishing.Step = fishingStepLimit - 1
	fishDo(t, &s, now, "fish-cast")
	now = now.Add(4 * time.Second)
	s.Advance(now)
	if !s.ExpireFishing(now) || s.Game.Fishing.Step != fishingStepLimit {
		t.Fatal("lease must pause without overflowing step")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(fishAction(&s, "fish-resume"), now); err == nil {
		t.Fatal("exhausted command budget accepted")
	}
	fishDo(t, &s, now, "fish-pause")
	if _, err := s.Apply(Action{Kind: "cancel-play", GameID: s.Game.ID}, now); err != nil || s.Game != nil {
		t.Fatal("cannot safely abandon exhausted session", err)
	}
}
