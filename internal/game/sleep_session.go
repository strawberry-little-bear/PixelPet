package game

import "math"

// SleepSession accumulates only the existing settlements after an explicit
// bedtime. Persisting it, rather than subtracting client snapshots, preserves
// one sleep across polling/reloads and cannot join two sleeps from other tabs.
// Legacy/imported sleeping saves deliberately have no session.
type SleepSession struct {
	StartedAt       int64   `json:"startedAt"`
	SettledHours    float64 `json:"settledHours"`
	EnergyRecovered float64 `json:"energyRecovered"`
	RestGain        float64 `json:"restGain"`
	GrowthPoints    float64 `json:"growthPoints"`
}

// SleepSummary is an immutable response receipt on a successful explicit wake.
// GrowthPoints includes natural growth during sleep, not a wake-up bonus.
type SleepSummary struct {
	SleepSession
	WokeAt int64 `json:"wokeAt"`
}

func (s State) validSleepSession() bool {
	r := s.SleepSession
	if r == nil {
		return true
	}
	if s.Schema < 17 || !s.Sleeping || s.HatchedAt == 0 || s.Game != nil || s.Growth == nil ||
		r.StartedAt < s.HatchedAt || r.StartedAt > s.LastTick {
		return false
	}
	for _, n := range []float64{r.SettledHours, r.EnergyRecovered, r.RestGain, r.GrowthPoints} {
		if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
			return false
		}
	}
	const eps = 1e-7
	return r.SettledHours <= float64(s.LastTick-r.StartedAt)/3600000+eps &&
		r.SettledHours <= s.Growth.TrackedHours+eps &&
		r.EnergyRecovered <= s.Needs.Energy+eps && r.EnergyRecovered <= r.SettledHours*needRates(true).Energy+eps &&
		math.Abs(r.RestGain-r.EnergyRecovered/restEnergyPerHabit) <= eps && r.RestGain <= s.Growth.Care.Rest+eps &&
		r.GrowthPoints <= s.Growth.Points+eps &&
		r.GrowthPoints <= r.SettledHours*(growthBasePerHour+growthComfortPerHour)+r.RestGain*restPointsPerHabit+eps
}
