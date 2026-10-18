package game

// MaxOfflineHours is the existing cap for one elapsed-time settlement. Expose
// the same value used by Advance, not a separate handbook approximation.
const MaxOfflineHours = 12.0

// CareRules describes passive need changes, not button effects or a forecast.
// It is response metadata and never part of the portable pet save.
type CareRules struct {
	Awake           Needs   `json:"awake"`
	Sleeping        Needs   `json:"sleeping"`
	MaxOfflineHours float64 `json:"maxOfflineHours"`
}

func needRates(sleeping bool) Needs {
	r := Needs{Hunger: -3, Mood: -2.5, Clean: -2, Energy: -2}
	if sleeping {
		r.Mood, r.Energy = 0, 14
	}
	return r
}

func CareRuleBook() CareRules {
	return CareRules{Awake: needRates(false), Sleeping: needRates(true), MaxOfflineHours: MaxOfflineHours}
}
