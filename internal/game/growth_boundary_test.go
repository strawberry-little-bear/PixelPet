package game

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"
)

// A legal schema-1 pet reaches migration with age-based growth but no tracked
// comfort history. Use the real upgrade, not fabricated current growth totals.
func legacyBoundaryPet(t *testing.T, now time.Time, age time.Duration) State {
	t.Helper()
	born := now.Add(-age).UnixMilli()
	s := State{Schema: 1, Species: 2, Name: Species[2], CreatedAt: born,
		HatchedAt: born, LastTick: born, Needs: Needs{}, Logs: []Log{}}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	if !s.Upgrade(now) {
		t.Fatal("legacy upgrade not applied")
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	if s.Growth.TrackedHours != 0 || s.Growth.Points != age.Hours() {
		t.Fatalf("unexpected migration: %+v", s.Growth)
	}
	return s
}

func TestExactGrowthBoundaryIsIndependentOfSettlementPartition(t *testing.T) {
	start := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	for _, age := range []time.Duration{18 * time.Hour, 66 * time.Hour} {
		for _, parts := range []int{1, 10, 60, 100, 600, 720, 1000} {
			t.Run(fmt.Sprintf("age=%dh/parts=%d", int(age.Hours()), parts), func(t *testing.T) {
				s := legacyBoundaryPet(t, start, age)
				end := start.Add(12 * time.Hour)
				for i := 1; i <= parts; i++ {
					at := start.Add(time.Duration(i) * 12 * time.Hour / time.Duration(parts))
					s.Advance(at)
					// Exercise the persisted representation after every actual settlement.
					raw, err := json.Marshal(s)
					if err != nil {
						t.Fatal(err)
					}
					if err = json.Unmarshal(raw, &s); err != nil {
						t.Fatal(err)
					}
					if err = s.Validate(at); err != nil {
						t.Fatal(err)
					}
				}
				if age == 18*time.Hour {
					if s.Growth.Stage != "growing" || math.Abs(s.Growth.Points-GrowingPoints) > 1e-9 || s.Growth.GrowingAt != end.UnixMilli() {
						t.Fatalf("missed exact growing boundary: %+v", s.Growth)
					}
				} else {
					g := s.Growth
					if g.Stage != "adult" || g.Points != AdultPoints || g.AdultAt != end.UnixMilli() {
						t.Fatalf("missed exact adult boundary: %+v", g)
					}
					if g.Form != "easygoing" || g.FormRecord == nil || math.Abs(g.FormRecord.TrackedHours-12) > 1e-12 {
						t.Fatalf("12h form history changed with partition: %+v", g)
					}
				}
				if s.CareCount != 0 || s.Growth.Care != (CareHistory{}) || s.Needs != (Needs{}) {
					t.Fatal("settlement invented care or need changes")
				}
				before, _ := json.Marshal(s)
				if s.Advance(end) {
					t.Fatal("same timestamp settled twice")
				}
				after, _ := json.Marshal(s)
				if string(before) != string(after) {
					t.Fatal("same timestamp changed history")
				}
			})
		}
	}
}

func TestGrowthBoundaryDoesNotArriveOneMillisecondEarly(t *testing.T) {
	start := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	for _, age := range []time.Duration{18 * time.Hour, 66 * time.Hour} {
		s := legacyBoundaryPet(t, start, age)
		stage := s.Growth.Stage
		end := start.Add(12 * time.Hour)
		s.Advance(end.Add(-time.Millisecond))
		if s.Growth.Stage != stage {
			t.Fatalf("advanced early: %+v", s.Growth)
		}
		if s.Growth.TrackedHours >= 12 {
			t.Fatal("rounded a real millisecond of missing history up to 12h")
		}
		s.Advance(end)
		if s.Growth.Stage == stage {
			t.Fatalf("did not advance at exact boundary: %+v", s.Growth)
		}
		if age == 66*time.Hour && s.Growth.Form != "easygoing" {
			t.Fatalf("wrong threshold form: %+v", s.Growth)
		}
		if err := s.Validate(end); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExistingAdultBoundaryRecordIsNotReinterpreted(t *testing.T) {
	start := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	s := legacyBoundaryPet(t, start, 66*time.Hour)
	end := start.Add(12 * time.Hour)
	s.LastTick = end.UnixMilli()
	// Saved by the old exact-threshold solver: it locked balanced just short of
	// 12 tracked hours. Preserve this valid past, even though new growth is fixed.
	s.Growth.Stage = "adult"
	s.Growth.Points = AdultPoints
	s.Growth.AdultAt = end.UnixMilli()
	s.Growth.Form = "balanced"
	s.Growth.TrackedHours = 12
	s.Growth.FormRecord = &FormRecord{TrackedHours: 11.999999999999986}
	s.remember(Memory{Kind: "adult", At: end.UnixMilli(), Source: "shared", Form: "balanced"})
	if err := s.Validate(end); err != nil {
		t.Fatal(err)
	}
	saved := *s.Growth.FormRecord
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var restored State
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	restored.Advance(end.Add(time.Hour))
	if restored.Growth.Form != "balanced" || !reflect.DeepEqual(*restored.Growth.FormRecord, saved) || restored.Growth.AdultAt != end.UnixMilli() {
		t.Fatal("reselected a historical adult")
	}
	if err = restored.Validate(end.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestSavedGrowingBoundaryCanFinishThroughCareWithoutRetimingOldAdults(t *testing.T) {
	start := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	for _, kind := range []string{"feed", "clean"} {
		t.Run(kind, func(t *testing.T) {
			s := legacyBoundaryPet(t, start, 66*time.Hour)
			end := start.Add(12 * time.Hour)
			// Persisted old ten-part settlement: nearly 72 points, nearly 12h, no form.
			s.LastTick = end.UnixMilli()
			s.Growth.Points = 71.99999999999994
			s.Growth.TrackedHours = 11.999999999999998
			if err := s.Validate(end); err != nil {
				t.Fatal(err)
			}
			if s.Advance(end) {
				t.Fatal("same millisecond must not invent elapsed time")
			}
			_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, end)
			if err != nil || f == nil || f.HabitGain != 1 {
				t.Fatalf("care failed: %v %+v", err, f)
			}
			if s.Growth.Stage != "adult" || s.Growth.Form != "easygoing" || s.Growth.FormRecord == nil || s.Growth.FormRecord.TrackedHours != 12 {
				t.Fatalf("care locked a rounding artifact: %+v", s.Growth)
			}
			if err = s.Validate(end); err != nil {
				t.Fatal(err)
			}
		})
	}
}
