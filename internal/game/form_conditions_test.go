package game

import (
	"fmt"
	"testing"
)

// Mirror the handbook's boundary cases against the authoritative rules, not
// rounded labels. This batch changes explanation only, never these decisions.
func TestHandbookFormConditionBoundaries(t *testing.T) {
	for _, tc := range []struct {
		hours, average, play, calm float64
		want                       string
	}{
		{0, 0, 0, 0, "balanced"},
		{11.99999, .1, 0, 0, "balanced"},
		{12, .44999, 0, 0, "easygoing"},
		{12, .45, 0, 0, "balanced"},
		{12, .45 - 5e-10, 0, 0, "balanced"},
		{12, .45 - 2e-9, 0, 0, "easygoing"},
		{12, .8, 1.99999, 0, "balanced"},
		{12, .8, 2, 0, "lively"},
		{12, .8, 3, 2, "balanced"},
		{12, .8, 3 + 5e-10, 2, "balanced"},
		{12, .8, 3 + 2e-9, 2, "lively"},
		{12, .8, 0, 1.99999, "balanced"},
		{12, .8, 0, 2 - 5e-10, "gentle"},
		{12, .8, 0, 2, "gentle"},
		{12, .1, 100, 0, "easygoing"},
	} {
		t.Run(fmt.Sprintf("%g/%g/%g/%g", tc.hours, tc.average, tc.play, tc.calm), func(t *testing.T) {
			g := Growth{TrackedHours: tc.hours, Wellbeing: tc.hours * tc.average,
				Care: CareHistory{Play: tc.play, Clean: tc.calm, Rest: tc.calm}}
			if got := g.Tendency(); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}
