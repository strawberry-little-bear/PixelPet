package game

import (
	"math"
	"reflect"
	"testing"
	"time"
)

func TestCareRulesRetainExistingRates(t *testing.T) {
	want := CareRules{NeedTolerance: 1e-9, Awake: Needs{Hunger: -3, Mood: -2.5, Clean: -2, Energy: -2}, Sleeping: Needs{Hunger: -3, Mood: 0, Clean: -2, Energy: 14}, MaxOfflineHours: 12, Actions: CareActionEffects{Feed: Needs{Hunger: 20, Mood: 3, Clean: -3}, Clean: Needs{Clean: 35, Mood: 4}}, Growth: GrowthRuleBasis{BasePerHour: .5, ComfortPerHour: .75, RestEnergyPerHabit: 28, RestPointsPerHabit: .25}}
	if got := CareRuleBook(); got != want {
		t.Fatalf("passive rules changed: %+v", got)
	}
	// A caller cannot mutate the server's actual rate table.
	copy := CareRuleBook()
	copy.Sleeping.Energy = 100
	if CareRuleBook() != want {
		t.Fatal("rate book is shared mutable state")
	}
}

func TestCareRulesDescribeActualSettlement(t *testing.T) {
	now := time.Now()
	for _, sleeping := range []bool{false, true} {
		for _, starting := range []float64{0, 1, 50, 99, 100} {
			for _, hours := range []float64{0.25, 1, 48} {
				s := New(now)
				if _, err := s.Apply(Action{Kind: "hatch"}, now); err != nil {
					t.Fatal(err)
				}
				s.Sleeping = sleeping
				s.Needs = Needs{Hunger: starting, Mood: starting, Clean: starting, Energy: starting}
				before := s.Needs
				rules := CareRuleBook()
				rates := rules.Awake
				if sleeping {
					rates = rules.Sleeping
				}
				elapsed := math.Min(hours, rules.MaxOfflineHours)
				want := Needs{Hunger: clamp(before.Hunger + rates.Hunger*elapsed), Mood: clamp(before.Mood + rates.Mood*elapsed), Clean: clamp(before.Clean + rates.Clean*elapsed), Energy: clamp(before.Energy + rates.Energy*elapsed)}
				s.Advance(now.Add(time.Duration(hours * float64(time.Hour))))
				if !reflect.DeepEqual(s.Needs, want) {
					t.Fatalf("sleep=%v start=%v hours=%v: %+v != %+v", sleeping, starting, hours, s.Needs, want)
				}
				// The preview integral and mutation still agree after centralizing rates.
				base := New(now)
				base.Apply(Action{Kind: "hatch"}, now)
				base.Sleeping = sleeping
				base.Needs = before
				preview := base.growthGain(elapsed)
				base.settleSegment(elapsed)
				if math.Abs(base.Growth.Points-preview) > 1e-8 {
					t.Fatal("growth preview differs from settlement")
				}
			}
		}
	}
}

func TestActionRulesDescribeUnchangedCareEffects(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, kind := range []string{"feed", "clean"} {
		for _, start := range []float64{0, 1, 60, 65, 70, 80, 95.999999, 96, 98.999999, 99, 100} {
			for _, mood := range []float64{0, 97, 99, 100} {
				s := babyAt(now)
				s.Needs = Needs{Hunger: start, Mood: mood, Clean: start, Energy: 50}
				before := s.Needs
				_, feedback, err := s.ApplyWithFeedback(Action{Kind: kind}, now)
				rejected := kind == "feed" && start >= 96 || kind == "clean" && start >= 99
				if rejected {
					if err == nil || s.Needs != before || feedback != nil {
						t.Fatalf("%s/%v accepted or mutated rejected action", kind, start)
					}
					continue
				}
				want := Needs{Hunger: clamp(start + 20), Mood: clamp(mood + 3), Clean: clamp(start - 3), Energy: 50}
				delta := CareRuleBook().Actions.Feed
				if kind == "clean" {
					want = Needs{Hunger: start, Mood: clamp(mood + 4), Clean: clamp(start + 35), Energy: 50}
					delta = CareRuleBook().Actions.Clean
				}
				fromMetadata := Needs{Hunger: clamp(before.Hunger + delta.Hunger), Mood: clamp(before.Mood + delta.Mood), Clean: clamp(before.Clean + delta.Clean), Energy: clamp(before.Energy + delta.Energy)}
				if err != nil || feedback == nil || feedback.Effect == nil || s.Needs != want || fromMetadata != want || feedback.Effect.After != want || feedback.Effect.Before != before {
					t.Fatalf("%s/%v/%v: got %+v, want %+v, metadata %+v, err %v", kind, start, mood, s.Needs, want, fromMetadata, err)
				}
			}
		}
	}
	copy := CareRuleBook()
	copy.Actions.Feed.Hunger = 99
	if CareRuleBook().Actions.Feed.Hunger != 20 {
		t.Fatal("action rules shared mutable state")
	}
}
