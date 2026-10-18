package game

import (
	"math"
	"testing"
	"time"
)

// Lock the server boundaries explained by the read-only menu preview. The menu
// is not an authority: ApplyWithFeedback must still decide the actual outcome.
func TestCarePreviewExplainedBoundaries(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, stage := range []string{"baby", "growing", "adult"} {
		for _, kind := range []string{"feed", "clean"} {
			needed, full := 70.0, 96.0
			if kind == "clean" {
				needed, full = 65, 99
			}
			for _, tc := range []struct {
				name   string
				need   float64
				ago    time.Duration
				reason string
			}{
				{"need-inclusive", needed, time.Hour, "credited"},
				{"above-need", needed + .000001, time.Hour, "not-needed"},
				{"just-below-full", full - .000001, time.Hour, "not-needed"},
				{"full", full, time.Hour, "rejected"},
				{"cooldown-before", needed, 30*time.Minute - time.Millisecond, "cooldown"},
				{"cooldown-exact", needed, 30 * time.Minute, "credited"},
				{"need-before-cooldown", needed + .000001, time.Minute, "not-needed"},
			} {
				t.Run(stage+"/"+kind+"/"+tc.name, func(t *testing.T) {
					s := babyAt(now.Add(-2 * time.Hour))
					s.LastTick = now.UnixMilli()
					s.Growth.Stage = stage
					if stage != "baby" {
						s.Growth.Points, s.Growth.GrowingAt = 30, now.UnixMilli()
						s.remember(Memory{Kind: "growing", At: now.UnixMilli(), Source: "shared"})
					}
					if stage == "adult" {
						s.Growth.Points, s.Growth.AdultAt, s.Growth.Form = 72, now.UnixMilli(), "gentle"
						s.remember(Memory{Kind: "adult", At: now.UnixMilli(), Source: "shared", Form: "gentle"})
					}
					last := now.Add(-tc.ago).UnixMilli()
					if kind == "feed" {
						s.Needs.Hunger, s.Growth.Care.LastFeed = tc.need, last
					} else {
						s.Needs.Clean, s.Growth.Care.LastClean = tc.need, last
					}
					if err := s.Validate(now); err != nil {
						t.Fatalf("invalid test fixture: %v", err)
					}
					before := *s.Growth
					_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, now)
					if tc.reason == "rejected" {
						if err == nil || f != nil || *s.Growth != before {
							t.Fatalf("full care must fail without credit: %+v %v", f, err)
						}
						return
					}
					if err != nil || f == nil || f.Reason != tc.reason {
						t.Fatalf("preview contract mismatch: %+v %v", f, err)
					}
					wantHabit, wantPoints := 0.0, 0.0
					if tc.reason == "credited" {
						wantHabit = 1
						if stage != "adult" {
							wantPoints = .25
						}
					}
					if f.HabitGain != wantHabit || math.Abs(f.Points-wantPoints) > 1e-9 {
						t.Fatalf("wrong habit/growth: %+v", f)
					}
					if stage == "adult" && (s.Growth.Form != "gentle" || s.Growth.Points != 72) {
						t.Fatal("care changed locked adulthood")
					}
				})
			}
		}
	}
}
