package game

import (
	"fmt"
	"math"
	"time"
)

const GrowingPoints = 24.0
const AdultPoints = 72.0

const growthPointTolerance = 1e-9
const formHistoryHours = 12.0

type CareHistory struct {
	Nutrition float64 `json:"nutrition"`
	Play      float64 `json:"play"`
	Clean     float64 `json:"clean"`
	Rest      float64 `json:"rest"`
	LastFeed  int64   `json:"lastFeed"`
	LastPlay  int64   `json:"lastPlay"`
	LastClean int64   `json:"lastClean"`
}

// FormRecord freezes the actual totals used at the adult threshold. A missing
// record means legacy history is unknown, never that its totals were zero.
type FormRecord struct {
	TrackedHours float64 `json:"trackedHours"`
	Wellbeing    float64 `json:"wellbeing"`
	Nutrition    float64 `json:"nutrition"`
	Play         float64 `json:"play"`
	Clean        float64 `json:"clean"`
	Rest         float64 `json:"rest"`
}

func (r FormRecord) growth() Growth {
	return Growth{TrackedHours: r.TrackedHours, Wellbeing: r.Wellbeing,
		Care: CareHistory{Nutrition: r.Nutrition, Play: r.Play, Clean: r.Clean, Rest: r.Rest}}
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
	FormRecord   *FormRecord `json:"formRecord,omitempty"`
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
		s.Companion.Interests = s.Companion.Interests[:5]
		s.Schema = 10
	}
	if s.Schema == 10 {
		s.Advance(now)
		s.Park = newPark(now)
		s.Companion.Interests = append(s.Companion.Interests, Interest{Kind: "walk"})
		s.Schema = 11
	}
	if s.Schema == 11 {
		// Existing adults have no threshold snapshot. Preserve that absence instead
		// of reconstructing it from current care; future evolution records its own.
		s.Schema = 12
	}
	if s.Schema == 12 {
		// Existing discoveries do not tell us their fictional sky. Start recording
		// only on future real events; never backfill scenery from old collections.
		s.Schema = 13
	}
	if s.Schema == 13 {
		// Past discoveries do not prove an encounter. Keep history unchanged;
		// only future successful catches/discovery points can record one.
		s.Schema = 14
	}
	if s.Schema == 14 {
		// Enable a new catalogue entry without rerolling existing casts or
		// fabricating past discoveries, scenery, care or reward history.
		s.Schema = 15
	}
	if s.Schema == 15 {
		// A new interest starts empty; past six-game sessions and history are
		// unchanged. Never infer treasure play from care or other games.
		s.Companion.Interests = append(s.Companion.Interests, Interest{Kind: "treasure"})
		s.Schema = 16
	}
	if s.Schema == 16 {
		// An older sleeping flag does not prove when this sleep began.
		// Track only future explicit bedtimes, never invent a legacy session.
		s.Schema = 17
	}
	if s.Schema == 17 {
		// Preserve a known active sleep, but never infer a past rested wake.
		// The new memory can only be recorded by a future explicit wake.
		s.Schema = 18
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
		crosses := target > 0 && s.Growth.Points+s.growthGain(step) >= target-growthPointTolerance
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
	rates := needRates(s.Sleeping)
	_, hunger := linearNeed(s.Needs.Hunger, rates.Hunger, hours)
	_, clean := linearNeed(s.Needs.Clean, rates.Clean, hours)
	endEnergy, energy := linearNeed(s.Needs.Energy, rates.Energy, hours)
	_, mood := linearNeed(s.Needs.Mood, rates.Mood, hours)
	gain := hours * (growthBasePerHour + growthComfortPerHour*(hunger+mood+clean+energy)/400)
	if s.Sleeping {
		gain += math.Max(0, endEnergy-s.Needs.Energy) / restEnergyPerHabit * restPointsPerHabit
	}
	return gain
}

func (s *State) settleSegment(hours float64) {
	var hunger, mood, clean, energy float64
	beforeEnergy := s.Needs.Energy
	rates := needRates(s.Sleeping)
	s.Needs.Hunger, hunger = linearNeed(s.Needs.Hunger, rates.Hunger, hours)
	s.Needs.Clean, clean = linearNeed(s.Needs.Clean, rates.Clean, hours)
	s.Needs.Energy, energy = linearNeed(s.Needs.Energy, rates.Energy, hours)
	s.Needs.Mood, mood = linearNeed(s.Needs.Mood, rates.Mood, hours)
	if s.Growth == nil {
		return
	}
	quality := (hunger + mood + clean + energy) / 400
	s.Growth.TrackedHours = normalizedTrackedHours(s.Growth.TrackedHours + hours)
	s.Growth.Wellbeing += quality * hours
	s.Growth.Points = math.Min(AdultPoints, s.Growth.Points+hours*(growthBasePerHour+growthComfortPerHour*quality))
	if s.Sleeping {
		rest := math.Max(0, s.Needs.Energy-beforeEnergy) / restEnergyPerHabit
		s.Growth.Care.Rest += rest
		s.Growth.Points = math.Min(AdultPoints, s.Growth.Points+rest*restPointsPerHabit)
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
		if careNeed(before, 70) > 70 {
			return
		}
		last = &c.LastFeed
		score = &c.Nutrition
	case "clean":
		if careNeed(before, 65) > 65 {
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

// Elapsed inputs have millisecond resolution. Remove only a few microseconds of
// arithmetic residue around the 12h history boundary before freezing a new form.
// Do not relax Tendency's predicates: existing frozen records must remain valid.
func normalizedTrackedHours(hours float64) float64 {
	if math.Abs(hours-formHistoryHours) < 1e-9 {
		return formHistoryHours
	}
	return hours
}

func (g Growth) AverageQuality() float64 {
	if g.TrackedHours == 0 {
		return 1
	}
	return g.Wellbeing / g.TrackedHours
}
func (g Growth) Tendency() string {
	if g.TrackedHours >= formHistoryHours && g.AverageQuality() < 0.45-1e-9 {
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
	if g.Points >= GrowingPoints-growthPointTolerance && g.Stage == "baby" {
		g.Points = math.Max(g.Points, GrowingPoints)
		g.Stage = "growing"
		g.GrowingAt = now.UnixMilli()
		s.sharedMemory("growing", now)
		s.Log(now, fmt.Sprintf("%s进入成长期，有了新的模样！", s.Name))
	}
	if g.Points >= AdultPoints-growthPointTolerance && g.Stage == "growing" {
		g.Points = AdultPoints
		g.Stage = "adult"
		g.AdultAt = now.UnixMilli()
		// A saved pre-fix growing state may reach adulthood by care at the
		// same millisecond, without a new elapsed-time settlement first.
		g.TrackedHours = normalizedTrackedHours(g.TrackedHours)
		g.Form = g.Tendency()
		if s.Schema >= 12 {
			g.FormRecord = &FormRecord{TrackedHours: g.TrackedHours, Wellbeing: g.Wellbeing,
				Nutrition: g.Care.Nutrition, Play: g.Care.Play, Clean: g.Care.Clean, Rest: g.Care.Rest}
		}
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
	if !s.validFormRecord() {
		return false
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

// A portable record must agree with the locked form and cannot exceed the
// totals accumulated so far. Optional for migrated adults whose past is lost.
func (s State) validFormRecord() bool {
	g := s.Growth
	r := g.FormRecord
	if r == nil {
		return true
	}
	if s.Schema < 12 || g.Stage != "adult" || s.HatchedAt == 0 {
		return false
	}
	pairs := [][2]float64{{r.TrackedHours, g.TrackedHours}, {r.Wellbeing, g.Wellbeing},
		{r.Nutrition, g.Care.Nutrition}, {r.Play, g.Care.Play}, {r.Clean, g.Care.Clean}, {r.Rest, g.Care.Rest}}
	for _, p := range pairs {
		if math.IsNaN(p[0]) || math.IsInf(p[0], 0) || p[0] < 0 || p[0] > 1_000_000 || p[0] > p[1]+1e-8 {
			return false
		}
	}
	if r.Wellbeing > r.TrackedHours+1e-8 || r.TrackedHours > float64(g.AdultAt-s.HatchedAt)/3600000+1e-8 {
		return false
	}
	return r.growth().Tendency() == g.Form
}
