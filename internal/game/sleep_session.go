package game

import (
	"fmt"
	"math"
)

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

// Keep one factual wake entry in the existing recent diary. This is not a new
// reward or a durable copy of the response receipt: ordinary reads never call
// it, and the diary still trims to its existing thirty-entry limit.
func sleepDiary(session *SleepSession, wokeAt int64) string {
	if session == nil {
		return "早安！这段休息没有完整记录，未估算恢复量；下次明确入睡后会记录。"
	}
	// Keep the diary's first sentence about the shared moment. Exact settlement
	// values remain in a secondary sentence so the entry reads like a diary,
	// while still preserving the canonical precision for review and export.
	text := fmt.Sprintf("早安！这一觉睡得很踏实，醒来后感觉更有精神了。结算记录：体力恢复 +%s，休息习惯 +%s，睡梦里的成长 +%s 点。",
		diaryAmount(session.EnergyRecovered), diaryAmount(session.RestGain), diaryAmount(session.GrowthPoints))
	unsettled := float64(wokeAt-session.StartedAt)/3600000 - session.SettledHours
	if unsettled > 1e-7 {
		text += fmt.Sprintf("这次休息按单次上限记录，另有 %s 小时没有计入，之后不会重复补算。", diaryAmount(unsettled))
	}
	return text
}
