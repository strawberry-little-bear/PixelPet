package game

import "math"

// MaxOfflineHours is the existing cap for one elapsed-time settlement. Expose
// the same value used by Advance, not a separate handbook approximation.
const MaxOfflineHours = 12.0

// CareActionEffects describes the existing immediate base deltas, before
// clamping. It does not promise that an action is available or earns growth.
type CareActionEffects struct {
	Feed  Needs `json:"feed"`
	Clean Needs `json:"clean"`
}

func careActionEffects() CareActionEffects {
	return CareActionEffects{Feed: Needs{Hunger: 20, Mood: 3, Clean: -3}, Clean: Needs{Clean: 35, Mood: 4}}
}

// Existing integration coefficients; changing the handbook must not tune growth.
const (
	growthBasePerHour    = 0.5
	growthComfortPerHour = 0.75
	restEnergyPerHabit   = 28.0
	restPointsPerHabit   = 0.25
)

// GrowthRuleBasis describes integration, not the time until the next stage.
type GrowthRuleBasis struct {
	BasePerHour        float64 `json:"basePerHour"`
	ComfortPerHour     float64 `json:"comfortPerHour"`
	RestEnergyPerHabit float64 `json:"restEnergyPerHabit"`
	RestPointsPerHabit float64 `json:"restPointsPerHabit"`
}

func growthRuleBasis() GrowthRuleBasis {
	return GrowthRuleBasis{BasePerHour: growthBasePerHour, ComfortPerHour: growthComfortPerHour, RestEnergyPerHabit: restEnergyPerHabit, RestPointsPerHabit: restPointsPerHabit}
}

// A millisecond of passive decay is at least 5e-7 points. This comparison-only
// tolerance removes much smaller accumulated floating-point residue at care
// boundaries without rounding persisted needs or changing rates/bonus amounts.
const careNeedTolerance = 1e-9

func careNeed(value, boundary float64) float64 {
	if math.Abs(value-boundary) <= careNeedTolerance {
		return boundary
	}
	return value
}

// CareRules is response metadata, never part of the portable pet save.
type CareRules struct {
	Awake           Needs             `json:"awake"`
	Sleeping        Needs             `json:"sleeping"`
	NeedTolerance   float64           `json:"needTolerance"`
	MaxOfflineHours float64           `json:"maxOfflineHours"`
	Actions         CareActionEffects `json:"actions"`
	Growth          GrowthRuleBasis   `json:"growth"`
}

func needRates(sleeping bool) Needs {
	r := Needs{Hunger: -3, Mood: -2.5, Clean: -2, Energy: -2}
	if sleeping {
		r.Mood, r.Energy = 0, 14
	}
	return r
}

func CareRuleBook() CareRules {
	return CareRules{NeedTolerance: careNeedTolerance, Awake: needRates(false), Sleeping: needRates(true), MaxOfflineHours: MaxOfflineHours, Actions: careActionEffects(), Growth: growthRuleBasis()}
}
