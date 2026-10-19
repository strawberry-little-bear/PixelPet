package game

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func TestGrowthBasisDescribesExistingIntegration(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	rule := CareRuleBook().Growth
	if rule != (GrowthRuleBasis{BasePerHour: .5, ComfortPerHour: .75, RestEnergyPerHabit: 28, RestPointsPerHabit: .25}) {
		t.Fatalf("existing coefficients changed: %+v", rule)
	}
	for _, sleeping := range []bool{false, true} {
		for _, starting := range []float64{0, 1, 40, 99, 100} {
			for _, hours := range []float64{.001, .25, 1, 12} {
				s := babyAt(now)
				s.Needs = Needs{Hunger: starting, Mood: starting, Clean: starting, Energy: starting}
				s.Sleeping = sleeping
				before := *s.Growth
				beforeEnergy := s.Needs.Energy
				preview := s.growthGain(hours)
				s.settleSegment(hours)
				comfortIntegral := s.Growth.Wellbeing - before.Wellbeing
				recovered := math.Max(0, s.Needs.Energy-beforeEnergy)
				rest := recovered / rule.RestEnergyPerHabit
				want := hours*rule.BasePerHour + comfortIntegral*rule.ComfortPerHour + rest*rule.RestPointsPerHabit
				if math.Abs(s.Growth.Points-before.Points-want) > 1e-9 || math.Abs(preview-want) > 1e-9 || math.Abs(s.Growth.Care.Rest-before.Care.Rest-rest) > 1e-9 {
					t.Fatalf("sleep=%v start=%v hours=%v: growth %v preview %v expected %v rest %v", sleeping, starting, hours, s.Growth.Points-before.Points, preview, want, s.Growth.Care.Rest-before.Care.Rest)
				}
			}
		}
	}
	copy := CareRuleBook()
	copy.Growth.BasePerHour = 50
	if CareRuleBook().Growth.BasePerHour != .5 {
		t.Fatal("growth rule book is mutable")
	}
}

func TestGrowthBasisDoesNotAwardRestForFullEnergyOrSleepToggle(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, start := range []float64{0, 99, 100} {
		s := babyAt(now)
		s.Needs.Energy = start
		before := *s.Growth
		_, feedback, err := s.ApplyWithFeedback(Action{Kind: "sleep"}, now)
		if err != nil || feedback.Points != 0 || s.Needs.Energy != start || s.Growth.Care.Rest != before.Care.Rest || s.Growth.Points != before.Points {
			t.Fatal("sleep toggle rewarded", err)
		}
		s.Advance(now.Add(12 * time.Hour))
		wantRest := (100 - start) / CareRuleBook().Growth.RestEnergyPerHabit
		if math.Abs(s.Growth.Care.Rest-before.Care.Rest-wantRest) > 1e-9 {
			t.Fatalf("start %v: rest %v != %v", start, s.Growth.Care.Rest-before.Care.Rest, wantRest)
		}
	}
}

func TestGrowthBasisRemainsResponseOnlyAndAdultCapped(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := babyAt(now)
	s.Growth.Points = 71.99
	s.Growth.Stage = "growing"
	s.Growth.GrowingAt = now.UnixMilli()
	s.Sleeping = true
	s.Needs.Energy = 0
	s.Advance(now.Add(12 * time.Hour))
	if s.Growth.Stage != "adult" || s.Growth.Points != 72 || s.Growth.FormRecord == nil {
		t.Fatal("adult transition changed")
	}
	fixed := s.Growth.Form
	record := *s.Growth.FormRecord
	rest := s.Growth.Care.Rest
	s.Needs.Energy = 0
	s.Advance(now.Add(24 * time.Hour))
	if s.Growth.Points != 72 || s.Growth.Form != fixed || *s.Growth.FormRecord != record || s.Growth.Care.Rest <= rest {
		t.Fatal("adult growth or form changed, or rest stopped")
	}
	b, err := json.Marshal(s)
	if err != nil || strings.Contains(string(b), "basePerHour") || strings.Contains(string(b), "restEnergyPerHabit") || s.Schema != 12 {
		t.Fatal("rule metadata leaked into save", err)
	}
}
