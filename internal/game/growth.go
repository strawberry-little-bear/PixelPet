package game

import (
	"fmt"
	"math"
	"time"
)

const GrowingPoints = 24.0
const AdultPoints = 72.0

type CareHistory struct {
	Nutrition float64 `json:"nutrition"`
	Play      float64 `json:"play"`
	Clean     float64 `json:"clean"`
	Rest      float64 `json:"rest"`
	LastFeed  int64   `json:"lastFeed"`
	LastPlay  int64   `json:"lastPlay"`
	LastClean int64   `json:"lastClean"`
}
type Growth struct {
	Stage        string      `json:"stage"`
	Points       float64     `json:"points"`
	Form         string      `json:"form"`
	TrackedHours float64     `json:"trackedHours"`
	Wellbeing    float64     `json:"wellbeing"`
	GrowingAt    int64       `json:"growingAt"`
	AdultAt      int64       `json:"adultAt"`
	Care         CareHistory `json:"care"`
}

// Upgrade settles old intervals before opening an album: we cannot claim that
// offline/legacy evolution was witnessed after the album opened. Version-1
// growth dates are migration dates and must retain saved (not shared) provenance.
func (s *State) Upgrade(now time.Time) bool {
	if s.Schema < 1 || s.Schema >= Schema {
		return false
	}
	if s.Schema == 1 {
		s.Advance(now)
		s.Schema = 2
		s.Growth = &Growth{Stage: "egg"}
		if s.HatchedAt > 0 {
			s.Growth.Points = math.Min(AdultPoints, math.Max(0, float64(now.UnixMilli()-s.HatchedAt)/3600000))
			s.Growth.Stage = "baby"
			if s.Growth.Points >= GrowingPoints {
				s.Growth.Stage = "growing"
				s.Growth.GrowingAt = now.UnixMilli()
			}
			if s.Growth.Points >= AdultPoints {
				s.Growth.Stage = "adult"
				s.Growth.AdultAt = now.UnixMilli()
				s.Growth.Form = "balanced"
			}
			s.Log(now, "成长手册已开启，今后的照顾习惯会被好好记住。")
		}
	}
	if s.Schema == 2 {
		s.Advance(now)
		s.Schema = 3
		s.openLegacyAlbum(now)
	}
	if s.Schema == 3 {
		s.Economy = newEconomy()
		if s.Game != nil {
			s.Game.ID = newGameID()
		}
		s.Schema = 4
	}
	if s.Schema == 4 {
		s.Schema = 5
	}
	if s.Schema == 5 {
		s.Schema = 6
	}
	if s.Schema == 6 {
		s.Schema = 7
	}
	if s.Schema == 7 {
		s.Advance(now)
		s.Pond = newPond(now)
		s.Schema = 8
	}
	if s.Schema == 8 {
		// New cosmetic slots start empty. Preserve gear, fish, sessions and all
		// past care; buying or previewing must never invent an earlier memory.
		s.Schema = 9
	}
	if s.Schema == 9 {
		s.Advance(now)
		s.Companion = newCompanion(now)
		s.Schema = 10
	}
	return true
}

// Exact integration makes frequent refreshes and a single offline settlement
// equivalent, including needs which reach their upper/lower bounds mid-tick.
func linearNeed(start, rate, hours float64) (end, mean float64) {
	end = clamp(start + rate*hours)
	if hours <= 0 || rate == 0 {
		return end, start
	}
	bound := 100.0
	if rate < 0 {
		bound = 0
	}
	hit := (bound - start) / rate
	if hit >= 0 && hit < hours {
		return end, ((start+bound)*hit/2 + bound*(hours-hit)) / hours
	}
	return end, (start + end) / 2
}

// Settle up to each milestone before locking the adult form. Otherwise an
// offline visit would include care after adulthood when choosing the form,
// unlike frequent refreshes over the exact same interval.
func (s *State) settle(hours float64, now time.Time) {
	remaining := hours
	for remaining > 0 {
		step := remaining
		target := 0.0
		if s.Growth != nil {
			switch s.Growth.Stage {
			case "baby":
				target = GrowingPoints
			case "growing":
				target = AdultPoints
			}
		}
		crosses := target > 0 && s.Growth.Points+s.growthGain(step) >= target
		if crosses {
			lo, hi := 0.0, step
			for i := 0; i < 60; i++ {
				mid := (lo + hi) / 2
				if s.Growth.Points+s.growthGain(mid) < target {
					lo = mid
				} else {
					hi = mid
				}
			}
			step = hi
		}
		s.settleSegment(step)
		remaining -= step
		if crosses {
			s.Growth.Points = target
			// Round up to the first millisecond at which the threshold is met.
			at := now.UnixMilli() - int64(math.Floor(remaining*3600000))
			s.evolve(time.UnixMilli(at))
		} else {
			break
		}
	}
}

// growthGain previews the same integral used by settleSegment without mutating
// needs, habits or logs, so milestone times can be found monotonically.
func (s *State) growthGain(hours float64) float64 {
	_, hunger := linearNeed(s.Needs.Hunger, -3, hours)
	_, clean := linearNeed(s.Needs.Clean, -2, hours)
	energyRate, moodRate := -2.0, -2.5
	if s.Sleeping {
		energyRate, moodRate = 14, 0
	}
	endEnergy, energy := linearNeed(s.Needs.Energy, energyRate, hours)
	_, mood := linearNeed(s.Needs.Mood, moodRate, hours)
	gain := hours * (0.5 + 0.75*(hunger+mood+clean+energy)/400)
	if s.Sleeping {
		gain += math.Max(0, endEnergy-s.Needs.Energy) / 28 * 0.25
	}
	return gain
}

func (s *State) settleSegment(hours float64) {
	var hunger, mood, clean, energy float64
	beforeEnergy := s.Needs.Energy
	s.Needs.Hunger, hunger = linearNeed(s.Needs.Hunger, -3, hours)
	s.Needs.Clean, clean = linearNeed(s.Needs.Clean, -2, hours)
	energyRate, moodRate := -2.0, -2.5
	if s.Sleeping {
		energyRate = 14
		moodRate = 0
	}
	s.Needs.Energy, energy = linearNeed(s.Needs.Energy, energyRate, hours)
	s.Needs.Mood, mood = linearNeed(s.Needs.Mood, moodRate, hours)
	if s.Growth == nil {
		return
	}
	quality := (hunger + mood + clean + energy) / 400
	s.Growth.TrackedHours += hours
	s.Growth.Wellbeing += quality * hours
	s.Growth.Points = math.Min(AdultPoints, s.Growth.Points+hours*(0.5+0.75*quality))
	if s.Sleeping {
		rest := math.Max(0, s.Needs.Energy-beforeEnergy) / 28
		s.Growth.Care.Rest += rest
		s.Growth.Points = math.Min(AdultPoints, s.Growth.Points+rest*0.25)
	}
}
func (s *State) recordCare(kind string, before float64, now time.Time) {
	if s.Growth == nil {
		return
	}
	c := &s.Growth.Care
	var last *int64
	var score *float64
	switch kind {
	case "feed":
		if before > 70 {
			return
		}
		last = &c.LastFeed
		score = &c.Nutrition
	case "clean":
		if before > 65 {
			return
		}
		last = &c.LastClean
		score = &c.Clean
	case "play":
		last = &c.LastPlay
		score = &c.Play
	default:
		return
	}
	if *last > 0 && now.UnixMilli()-*last < int64(30*time.Minute/time.Millisecond) {
		return
	}
	*last = now.UnixMilli()
	*score += 1
	s.Growth.Points = math.Min(AdultPoints, s.Growth.Points+0.25)
	s.evolve(now)
}
func (g Growth) AverageQuality() float64 {
	if g.TrackedHours == 0 {
		return 1
	}
	return g.Wellbeing / g.TrackedHours
}
func (g Growth) Tendency() string {
	if g.TrackedHours >= 12 && g.AverageQuality() < 0.45-1e-9 {
		return "easygoing"
	}
	gentle := (g.Care.Clean + g.Care.Rest) / 2
	if g.Care.Play >= 2 && g.Care.Play > gentle*1.5+1e-9 {
		return "lively"
	}
	if gentle >= 2-1e-9 && gentle > g.Care.Play*1.5+1e-9 {
		return "gentle"
	}
	return "balanced"
}
func FormName(form string) string {
	switch form {
	case "lively":
		return "活力型"
	case "gentle":
		return "恬静型"
	case "easygoing":
		return "自在型"
	default:
		return "均衡型"
	}
}
func (s *State) evolve(now time.Time) {
	g := s.Growth
	if g == nil || s.HatchedAt == 0 {
		return
	}
	if g.Points >= GrowingPoints-1e-9 && g.Stage == "baby" {
		g.Points = math.Max(g.Points, GrowingPoints)
		g.Stage = "growing"
		g.GrowingAt = now.UnixMilli()
		s.sharedMemory("growing", now)
		s.Log(now, fmt.Sprintf("%s进入成长期，戴上了小围巾！", s.Name))
	}
	if g.Points >= AdultPoints-1e-9 && g.Stage == "growing" {
		g.Points = AdultPoints
		g.Stage = "adult"
		g.AdultAt = now.UnixMilli()
		g.Form = g.Tendency()
		s.remember(Memory{Kind: "adult", At: now.UnixMilli(), Source: "shared", Form: g.Form})
		s.Log(now, fmt.Sprintf("%s长大啦！照顾习惯让它成为了%s。", s.Name, FormName(g.Form)))
	}
}
func (s State) validGrowth(now time.Time) bool {
	if s.Schema == 1 {
		return s.Growth == nil
	}
	g := s.Growth
	if g == nil {
		return false
	}
	for _, v := range []float64{g.Points, g.TrackedHours, g.Wellbeing, g.Care.Nutrition, g.Care.Play, g.Care.Clean, g.Care.Rest} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1_000_000 {
			return false
		}
	}
	if g.Points > AdultPoints || g.Wellbeing > g.TrackedHours+1e-8 {
		return false
	}
	for _, at := range []int64{g.GrowingAt, g.AdultAt, g.Care.LastFeed, g.Care.LastPlay, g.Care.LastClean} {
		if at != 0 && (at < s.HatchedAt || at > s.LastTick || at > now.UnixMilli()) {
			return false
		}
	}
	if s.HatchedAt == 0 {
		return g.Stage == "egg" && g.Points == 0 && g.Form == "" && g.TrackedHours == 0 && g.GrowingAt == 0 && g.AdultAt == 0 && g.Care == (CareHistory{})
	}
	if g.TrackedHours > float64(s.LastTick-s.HatchedAt)/3600000+1e-8 {
		return false
	}
	switch g.Stage {
	case "baby":
		return g.Points < GrowingPoints && g.GrowingAt == 0 && g.AdultAt == 0 && g.Form == ""
	case "growing":
		return g.Points >= GrowingPoints && g.Points < AdultPoints && g.GrowingAt > 0 && g.AdultAt == 0 && g.Form == ""
	case "adult":
		return g.Points == AdultPoints && g.GrowingAt > 0 && g.AdultAt >= g.GrowingAt && (g.Form == "balanced" || g.Form == "lively" || g.Form == "gentle" || g.Form == "easygoing")
	}
	return false
}
