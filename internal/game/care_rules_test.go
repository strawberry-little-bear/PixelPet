package game

import (
	"math"
	"reflect"
	"testing"
	"time"
)

func TestCareRulesRetainExistingRates(t *testing.T) {
	want := CareRules{Awake: Needs{Hunger: -3, Mood: -2.5, Clean: -2, Energy: -2}, Sleeping: Needs{Hunger: -3, Mood: 0, Clean: -2, Energy: 14}, MaxOfflineHours: 12}
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
