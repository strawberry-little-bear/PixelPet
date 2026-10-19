package game

import (
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
