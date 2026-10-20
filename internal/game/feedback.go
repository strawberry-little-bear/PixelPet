package game

import "time"

// CareEffect is response-only: the state is already settled before Apply.
// Its timestamp stays with an idempotent acknowledgement, even on a later replay.
type CareEffect struct {
	At     int64 `json:"at"`
	Before Needs `json:"before"`
	After  Needs `json:"after"`
}

// CareMilestone records a stage crossed by this action only. Passive settlement
// has already happened before ApplyWithFeedback; it must not be credited here.
// Like the rest of the receipt, this is response/cache metadata, not save state.
type CareMilestone struct {
	Stage string `json:"stage"`
	At    int64  `json:"at"`
	Form  string `json:"form,omitempty"`
}

// CareFeedback describes only the saved action, not passive growth settled
// before it. SleepSummary separately describes the complete recorded sleep,
// never crediting passive growth to the wake action. Feedback is response-only.
type CareFeedback struct {
	Kind         string         `json:"kind"`
	Points       float64        `json:"points"`
	Habit        string         `json:"habit,omitempty"`
	HabitGain    float64        `json:"habitGain"`
	Reason       string         `json:"reason"`
	RetryAt      int64          `json:"retryAt,omitempty"`
	Effect       *CareEffect    `json:"effect,omitempty"`
	SleepSummary *SleepSummary  `json:"sleepSummary,omitempty"`
	Milestone    *CareMilestone `json:"milestone,omitempty"`
}

// ApplyWithFeedback runs the existing rules first. Comparing settled growth
// immediately before and after Apply avoids crediting elapsed-time growth to
// a button press, including when the final bonus is capped at adulthood.
func (s *State) ApplyWithFeedback(a Action, now time.Time) (string, *CareFeedback, error) {
	var sleepSummary *SleepSummary
	if a.Kind == "sleep" && s.Sleeping && s.SleepSession != nil {
		sleepSummary = &SleepSummary{SleepSession: *s.SleepSession, WokeAt: now.UnixMilli()}
	}
	beforeCare := s.CareCount
	beforeNeeds := s.Needs
	var before Growth
	if s.Growth != nil {
		before = *s.Growth
	}
	message, err := s.Apply(a, now)
	if err != nil || s.Growth == nil {
		return message, nil, err
	}
	f := &CareFeedback{Kind: a.Kind, Points: s.Growth.Points - before.Points,
		Effect: &CareEffect{At: now.UnixMilli(), Before: beforeNeeds, After: s.Needs}}
	var last int64
	switch a.Kind {
	case "feed":
		f.Habit = "nutrition"
		f.HabitGain = s.Growth.Care.Nutrition - before.Care.Nutrition
		last = before.Care.LastFeed
		if careNeed(beforeNeeds.Hunger, 70) > 70 {
			f.Reason = "not-needed"
		}
	case "clean":
		f.Habit = "clean"
		f.HabitGain = s.Growth.Care.Clean - before.Care.Clean
		last = before.Care.LastClean
		if careNeed(beforeNeeds.Clean, 65) > 65 {
			f.Reason = "not-needed"
		}
	case "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish":
		if (a.Kind == "snake-finish" || a.Kind == "tetris-finish" || a.Kind == "fish-finish" || a.Kind == "walk-finish" || a.Kind == "treasure-finish") && s.CareCount == beforeCare {
			return message, nil, nil
		}
		if s.Game != nil {
			return message, nil, nil
		}
		f.Habit = "play"
		f.HabitGain = s.Growth.Care.Play - before.Care.Play
		last = before.Care.LastPlay
	case "sleep":
		f.Reason = "awake"
		f.SleepSummary = sleepSummary
		if s.Sleeping {
			f.Reason = "resting"
		}
		return message, f, nil
	default:
		return message, nil, nil
	}
	if f.HabitGain > 0 {
		f.Reason = "credited"
	} else if f.Reason == "" {
		f.Reason = "cooldown"
		f.RetryAt = last + int64(30*time.Minute/time.Millisecond)
	}
	if f.Reason == "credited" {
		g := s.Growth
		if before.Stage == "baby" && g.Stage == "growing" {
			f.Milestone = &CareMilestone{Stage: "growing", At: g.GrowingAt}
		} else if before.Stage == "growing" && g.Stage == "adult" {
			f.Milestone = &CareMilestone{Stage: "adult", At: g.AdultAt, Form: g.Form}
		}
	}
	return message, f, nil
}
