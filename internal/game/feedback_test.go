package game

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
	"time"
)

func TestCareFeedbackReportsOnlyActualActionCredit(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name   string
		kind   string
		hunger float64
		clean  float64
		habit  string
		reason string
	}{
		{"needed meal", "feed", 70, 60, "nutrition", "credited"},
		{"not hungry", "feed", 71, 60, "nutrition", "not-needed"},
		{"needed bath", "clean", 60, 65, "clean", "credited"},
		{"already clean", "clean", 60, 66, "clean", "not-needed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := babyAt(now)
			s.Needs.Hunger, s.Needs.Clean = tc.hunger, tc.clean
			_, f, err := s.ApplyWithFeedback(Action{Kind: tc.kind}, now)
			if err != nil || f == nil || f.Reason != tc.reason || f.Habit != tc.habit {
				t.Fatalf("wrong feedback: %+v, %v", f, err)
			}
			if tc.reason == "credited" && (f.Points != .25 || f.HabitGain != 1) {
				t.Fatalf("wrong action reward: %+v", f)
			}
			if tc.reason == "not-needed" && (f.Points != 0 || f.HabitGain != 0) {
				t.Fatalf("invented reward: %+v", f)
			}
		})
	}
}

func TestCareFeedbackCooldownAndAdultCap(t *testing.T) {
	now := time.Now()
	s := babyAt(now)
	s.Growth.Care.LastFeed = now.Add(-10 * time.Minute).UnixMilli()
	s.Needs.Hunger = 60
	_, f, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now)
	if err != nil || f.Reason != "cooldown" || f.Points != 0 || f.HabitGain != 0 || f.RetryAt != now.Add(20*time.Minute).UnixMilli() {
		t.Fatalf("wrong cooldown feedback: %+v, %v", f, err)
	}
	// Need requirements take priority over cooldown: explain the actual reason
	// that this meal would not count even after the timer runs out.
	s.Needs.Hunger = 80
	_, f, _ = s.ApplyWithFeedback(Action{Kind: "feed"}, now)
	if f.Reason != "not-needed" || f.RetryAt != 0 {
		t.Fatalf("misleading cooldown: %+v", f)
	}
	s.Growth = &Growth{Stage: "growing", Points: 71.9, GrowingAt: now.UnixMilli()}
	s.Needs.Hunger = 60
	_, f, err = s.ApplyWithFeedback(Action{Kind: "feed"}, now)
	if err != nil || math.Abs(f.Points-.1) > 1e-9 || f.HabitGain != 1 || s.Growth.Stage != "adult" {
		t.Fatalf("ignored adulthood cap: %+v, %v", f, err)
	}
	s.Needs.Clean = 60
	_, f, err = s.ApplyWithFeedback(Action{Kind: "clean"}, now)
	if err != nil || f.Points != 0 || f.HabitGain != 1 || f.Reason != "credited" {
		t.Fatalf("adult habits should count without growth: %+v, %v", f, err)
	}
}

func TestCareFeedbackDoesNotRewardStartingOrCancellingGames(t *testing.T) {
	now := time.Now()
	s := babyAt(now)
	for _, kind := range []string{"play", "cancel-play", "play"} {
		a := Action{Kind: kind}
		if s.Game != nil {
			a.GameID = s.Game.ID
		}
		_, f, err := s.ApplyWithFeedback(a, now)
		if err != nil || f != nil {
			t.Fatalf("non-care action returned feedback: %s, %+v, %v", kind, f, err)
		}
	}
	for i := 0; i < 5; i++ {
		_, f, err := s.ApplyWithFeedback(Action{Kind: "catch", GameID: s.Game.ID, Lane: i % 3}, now.Add(time.Duration(i)*900*time.Millisecond))
		if err != nil {
			t.Fatal(err)
		}
		if i < 4 && f != nil {
			t.Fatal("unfinished game returned feedback")
		}
		if i == 4 && (f == nil || f.Reason != "credited" || f.Habit != "play" || f.Points != .25) {
			t.Fatalf("finished game credit missing: %+v", f)
		}
	}
}

func TestSleepAndFailedCareFeedbackNeverInventCredit(t *testing.T) {
	now := time.Now()
	s := babyAt(now)
	for _, want := range []string{"resting", "awake"} {
		_, f, err := s.ApplyWithFeedback(Action{Kind: "sleep"}, now)
		if err != nil || f.Reason != want || f.Points != 0 || f.HabitGain != 0 {
			t.Fatalf("sleep toggle invented credit: %+v, %v", f, err)
		}
	}
	s.Needs.Hunger = 100
	_, f, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now)
	if err == nil || f != nil {
		t.Fatal("failed action returned success feedback")
	}
}

// Legacy habits may be fractional. The reply intentionally reports the raw
// subtraction; consumers must display a whole credited action without changing
// stored totals or rejecting harmless IEEE-754 subtraction noise.
func TestCareFeedbackPreservesFractionalLegacyHabitCredit(t *testing.T) {
	now := time.Now()
	for _, kind := range []string{"feed", "clean", "catch"} {
		for _, initial := range []float64{.4, 1.2, .2} {
			t.Run(fmt.Sprintf("%s/%g", kind, initial), func(t *testing.T) {
				s := babyAt(now)
				s.Needs.Hunger, s.Needs.Clean = 50, 60
				s.Growth.Care.Nutrition, s.Growth.Care.Clean, s.Growth.Care.Play = initial, initial, initial
				var f *CareFeedback
				var err error
				if kind == "catch" {
					if _, _, err = s.ApplyWithFeedback(Action{Kind: "play"}, now); err != nil {
						t.Fatal(err)
					}
					for i := 0; i < 5; i++ {
						_, f, err = s.ApplyWithFeedback(Action{Kind: kind, GameID: s.Game.ID, Lane: i % 3}, now.Add(time.Duration(i)*900*time.Millisecond))
						if err != nil {
							t.Fatal(err)
						}
					}
				} else {
					_, f, err = s.ApplyWithFeedback(Action{Kind: kind}, now)
				}
				if err != nil || f == nil || f.Reason != "credited" || f.Points != .25 {
					t.Fatalf("missing actual credit: %+v, %v", f, err)
				}
				stored := s.Growth.Care.Nutrition
				if kind == "clean" {
					stored = s.Growth.Care.Clean
				}
				if kind == "catch" {
					stored = s.Growth.Care.Play
				}
				if stored != initial+1 || f.HabitGain != stored-initial || math.Abs(f.HabitGain-1) > 1e-8 {
					t.Fatalf("changed legacy total or raw credit: before=%v stored=%v feedback=%+v", initial, stored, f)
				}
			})
		}
	}
}

// This checks response metadata through JSON so absent fields remain compatible
// with old clients and portable saves need no new schema.
func TestAdultHabitFeedbackExplainsCompletedGrowth(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := babyAt(now)
	s.Needs.Hunger = 60
	_, young, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now)
	if err != nil {
		t.Fatal(err)
	}
	s.Growth = &Growth{Stage: "growing", Points: 71.9, GrowingAt: now.UnixMilli()}
	s.Needs.Clean = 60
	_, crossing, err := s.ApplyWithFeedback(Action{Kind: "clean"}, now)
	if err != nil || s.Growth.Stage != "adult" {
		t.Fatalf("boundary: %+v %v", crossing, err)
	}
	s.Needs.Hunger = 60
	_, adult, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now.Add(31*time.Minute))
	if err != nil || adult.Reason != "credited" || adult.HabitGain != 1 || adult.Points != 0 {
		t.Fatalf("adult: %+v %v", adult, err)
	}
	s.Needs.Hunger = 60
	_, interval, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now.Add(32*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		f    *CareFeedback
		want bool
	}{
		{"young", young, false}, {"crossing", crossing, false}, {"adult", adult, true}, {"interval", interval, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, _ := json.Marshal(tc.f)
			var got map[string]any
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatal(err)
			}
			if tc.want {
				if got["growthComplete"] != true {
					t.Fatalf("adult explanation missing: %s", data)
				}
			} else if _, exists := got["growthComplete"]; exists {
				t.Fatalf("unearned adult explanation: %s", data)
			}
		})
	}
}

func TestAdultUncreditedFeedbackPreservesGrowthExplanation(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, kind := range []string{"feed", "clean", "catch"} {
		for _, reason := range []string{"cooldown", "not-needed"} {
			if kind == "catch" && reason == "not-needed" {
				continue
			}
			t.Run(kind+"/"+reason, func(t *testing.T) {
				s := babyAt(now)
				s.Growth = &Growth{Stage: "growing", Points: 71.9, GrowingAt: now.UnixMilli()}
				s.Needs.Hunger = 60
				if _, _, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now); err != nil || s.Growth.Stage != "adult" {
					t.Fatal("adult setup", err)
				}
				s.Needs.Hunger, s.Needs.Clean = 60, 60
				s.Growth.Care.LastFeed, s.Growth.Care.LastClean, s.Growth.Care.LastPlay = now.UnixMilli(), now.UnixMilli(), now.UnixMilli()
				if reason == "not-needed" {
					s.Needs.Hunger, s.Needs.Clean = 80, 80
				}
				before := *s.Growth
				var f *CareFeedback
				var err error
				if kind == "catch" {
					if _, _, err = s.ApplyWithFeedback(Action{Kind: "play"}, now); err != nil {
						t.Fatal(err)
					}
					for i := 0; i < 5; i++ {
						_, f, err = s.ApplyWithFeedback(Action{Kind: "catch", GameID: s.Game.ID, Lane: i % 3}, now.Add(time.Duration(i)*900*time.Millisecond))
						if err != nil {
							t.Fatal(err)
						}
					}
				} else {
					_, f, err = s.ApplyWithFeedback(Action{Kind: kind}, now.Add(time.Minute))
				}
				if err != nil || f == nil || f.Reason != reason || f.HabitGain != 0 || f.Points != 0 || !f.GrowthComplete || f.Milestone != nil {
					t.Fatalf("adult explanation lost or credit invented: %+v %v", f, err)
				}
				if s.Growth.Points != before.Points || s.Growth.Form != before.Form || s.Growth.Care != before.Care {
					t.Fatal("explanation changed growth, locked form or habits")
				}
				for _, reason := range []string{"resting", "awake"} {
					_, f, err = s.ApplyWithFeedback(Action{Kind: "sleep"}, now.Add(2*time.Minute))
					if err != nil || f == nil || f.Reason != reason || f.GrowthComplete {
						t.Fatal("sleep gained an action growth explanation", f, err)
					}
				}
			})
		}
	}
}
