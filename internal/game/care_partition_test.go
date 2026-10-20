package game

import (
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"
)

// Exact care thresholds must have the same discrete outcome after one elapsed
// settlement or frequent persisted reads. Comparing only floats within 1e-8
// would miss a lost habit, growth bonus, or an incorrectly accepted full action.
func TestCareOutcomesIgnoreSettlementPartitionResidue(t *testing.T) {
	start := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	end := start.Add(30 * time.Minute)
	for _, points := range []float64{0, 30, 72} {
		for _, kind := range []string{"feed", "clean"} {
			for _, full := range []bool{false, true} {
				for _, cadence := range []time.Duration{time.Second, 15 * time.Second, 17321 * time.Millisecond} {
					t.Run(fmt.Sprintf("points%g/%s/full=%t/step=%s", points, kind, full, cadence), func(t *testing.T) {
						initial := partitionFixture(t, start, points, "balanced", Needs{80, 80, 80, 80}, false)
						threshold, rate := 70.0, 3.0
						if kind == "clean" {
							threshold, rate = 65, 2
						}
						if full {
							if kind == "feed" {
								threshold = 96
							} else {
								threshold = 99
							}
						}
						if kind == "feed" {
							initial.Needs.Hunger = threshold + rate*.5
						} else {
							initial.Needs.Clean = threshold + rate*.5
						}
						one, many := partitionReload(t, initial, start), partitionReload(t, initial, start)
						one.Advance(end)
						one = partitionReload(t, one, end)
						for at := start.Add(cadence); at.Before(end); at = at.Add(cadence) {
							many.Advance(at)
							many = partitionReload(t, many, at)
						}
						many.Advance(end)
						many = partitionReload(t, many, end)
						check := func(s *State) (*CareFeedback, error) {
							t.Helper()
							before := partitionReload(t, *s, end)
							_, feedback, err := s.ApplyWithFeedback(Action{Kind: kind}, end)
							value := before.Needs.Hunger
							if kind == "clean" {
								value = before.Needs.Clean
							}
							if full {
								if err == nil || feedback != nil {
									t.Fatalf("full %s at %.17g must reject without feedback, got %+v %v", kind, value, feedback, err)
								}
								assertPartitionState(t, *s, before)
								if s.Needs != before.Needs {
									t.Fatal("rejected care rounded stored needs")
								}
							} else {
								if err != nil || feedback == nil || feedback.Reason != "credited" || feedback.HabitGain != 1 {
									t.Fatalf("eligible %s at %.17g lost habit: %+v %v", kind, value, feedback, err)
								}
								expected := math.Min(.25, AdultPoints-before.Growth.Points)
								partitionClose(t, "action growth", feedback.Points, expected)
								if s.CareCount != before.CareCount+1 {
									t.Fatal("care count did not increment exactly once")
								}
							}
							return feedback, err
						}
						oneFeedback, _ := check(&one)
						manyFeedback, _ := check(&many)
						if !full && (oneFeedback.Reason != manyFeedback.Reason || oneFeedback.HabitGain != manyFeedback.HabitGain) {
							t.Fatal("care outcome changed with polling")
						}
						assertPartitionState(t, many, one)
						partitionReload(t, many, end)
					})
				}
			}
		}
	}
}

func TestCareNumericalBoundaryWindowAndMilestones(t *testing.T) {
	now := time.Date(2026, 10, 20, 1, 0, 0, 0, time.UTC)
	for _, points := range []float64{0, 23.9, 71.9, 72} {
		for _, kind := range []string{"feed", "clean"} {
			for _, full := range []bool{false, true} {
				for _, tc := range []struct {
					delta float64
					near  bool
				}{
					{-1e-6, false}, {-2e-9, false}, {-5e-10, true}, {0, true}, {5e-10, true}, {2e-9, false}, {1e-6, false},
				} {
					t.Run(fmt.Sprintf("points%g/%s/full=%t/delta%g", points, kind, full, tc.delta), func(t *testing.T) {
						s := partitionFixture(t, now, points, "balanced", Needs{80, 80, 80, 80}, false)
						threshold := 70.0
						if kind == "clean" {
							threshold = 65
						}
						if full {
							if kind == "feed" {
								threshold = 96
							} else {
								threshold = 99
							}
						}
						if kind == "feed" {
							s.Needs.Hunger = threshold + tc.delta
						} else {
							s.Needs.Clean = threshold + tc.delta
						}
						before := partitionReload(t, s, now)
						_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, now)
						if full && (tc.near || tc.delta > 0) {
							if err == nil || f != nil {
								t.Fatal("full action accepted")
							}
							assertPartitionState(t, s, before)
							if s.Needs != before.Needs {
								t.Fatal("rejected care rounded stored needs")
							}
							return
						}
						if err != nil || f == nil {
							t.Fatalf("action rejected: %v", err)
						}
						wantNeeds := before.Needs
						if kind == "feed" {
							wantNeeds.Hunger = clamp(wantNeeds.Hunger + 20)
							wantNeeds.Mood = clamp(wantNeeds.Mood + 3)
							wantNeeds.Clean = clamp(wantNeeds.Clean - 3)
						} else {
							wantNeeds.Clean = clamp(wantNeeds.Clean + 35)
							wantNeeds.Mood = clamp(wantNeeds.Mood + 4)
						}
						if s.Needs != wantNeeds || f.Effect == nil || f.Effect.Before != before.Needs || f.Effect.After != wantNeeds {
							t.Fatal("comparison tolerance rounded actual care effect or receipt")
						}
						credited := !full && (tc.near || tc.delta < 0)
						if credited {
							if f.Reason != "credited" || f.HabitGain != 1 {
								t.Fatalf("habit not credited: %+v", f)
							}
							partitionClose(t, "bonus", f.Points, math.Min(.25, AdultPoints-points))
							next := before.Growth.Stage
							if points == 23.9 {
								next = "growing"
							}
							if points == 71.9 {
								next = "adult"
							}
							if s.Growth.Stage != next {
								t.Fatal("care milestone lost")
							}
							if (points == 23.9 || points == 71.9) && (f.Milestone == nil || f.Milestone.Stage != next) {
								t.Fatal("care milestone feedback lost")
							}
						} else if f.Reason != "not-needed" || f.HabitGain != 0 || f.Points != 0 {
							t.Fatalf("credited outside window: %+v", f)
						}
						if s.CareCount != before.CareCount+1 {
							t.Fatal("care count changed")
						}
						if before.Growth.FormRecord != nil && !reflect.DeepEqual(s.Growth.FormRecord, before.Growth.FormRecord) {
							t.Fatal("adult record changed")
						}
						partitionReload(t, s, now)
					})
				}
			}
		}
	}
}

func TestCareNumericalResidueDoesNotBypassCooldown(t *testing.T) {
	now := time.Date(2026, 10, 20, 1, 0, 0, 0, time.UTC)
	for _, points := range []float64{0, 30, 72} {
		for _, kind := range []string{"feed", "clean"} {
			for _, early := range []bool{true, false} {
				t.Run(fmt.Sprintf("points%g/%s/early=%t", points, kind, early), func(t *testing.T) {
					s := partitionFixture(t, now, points, "balanced", Needs{80, 80, 80, 80}, false)
					last := now.Add(-30 * time.Minute).UnixMilli()
					if early {
						last++
					}
					if kind == "feed" {
						s.Needs.Hunger = 70 + 5e-10
						s.Growth.Care.LastFeed = last
					} else {
						s.Needs.Clean = 65 + 5e-10
						s.Growth.Care.LastClean = last
					}
					_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, now)
					if err != nil || f == nil {
						t.Fatal(err)
					}
					if early {
						if f.Reason != "cooldown" || f.HabitGain != 0 || f.Points != 0 || f.RetryAt != now.UnixMilli()+1 {
							t.Fatalf("cooldown changed: %+v", f)
						}
					} else if f.Reason != "credited" || f.HabitGain != 1 {
						t.Fatalf("exact cooldown boundary lost: %+v", f)
					}
					partitionReload(t, s, now)
				})
			}
		}
	}
}
