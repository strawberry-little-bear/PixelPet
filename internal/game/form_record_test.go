package game

import (
	"math"
	"reflect"
	"testing"
	"time"
)

func nearAdult(t *testing.T, care CareHistory, quality float64) (State, time.Time) {
	t.Helper()
	now := time.Now().Truncate(time.Millisecond)
	born := now.Add(-80 * time.Hour)
	s := babyAt(born)
	s.LastTick = now.UnixMilli()
	s.Needs = Needs{60, 80, 60, 80}
	s.Growth = &Growth{Stage: "growing", Points: 71.9, GrowingAt: born.Add(24 * time.Hour).UnixMilli(), TrackedHours: 12, Wellbeing: 12 * quality, Care: care}
	s.sharedMemory("growing", time.UnixMilli(s.Growth.GrowingAt))
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	return s, now
}

func TestFormRecordIncludesActualThresholdCareAndNeverChangesAfterAdulthood(t *testing.T) {
	cases := []struct {
		form    string
		care    CareHistory
		quality float64
	}{
		{"balanced", CareHistory{Play: 2, Clean: 2, Rest: 2}, .8},
		{"lively", CareHistory{Play: 8}, .8},
		{"gentle", CareHistory{Clean: 4, Rest: 4}, .8},
		{"easygoing", CareHistory{Play: 8}, .2},
	}
	for _, tc := range cases {
		t.Run(tc.form, func(t *testing.T) {
			s, now := nearAdult(t, tc.care, tc.quality)
			if s.Growth.FormRecord != nil {
				t.Fatal("record before threshold")
			}
			if _, err := s.Apply(Action{Kind: "feed"}, now); err != nil {
				t.Fatal(err)
			}
			g := s.Growth
			r := g.FormRecord
			if r == nil || g.Form != tc.form || r.Nutrition != tc.care.Nutrition+1 || r.Play != tc.care.Play || r.Clean != tc.care.Clean || r.Rest != tc.care.Rest || r.TrackedHours != 12 || r.Wellbeing != 12*tc.quality {
				t.Fatal("not the actual threshold totals", g)
			}
			record := *r
			s.Advance(now.Add(time.Hour))
			s.Needs.Clean = 60
			if _, err := s.Apply(Action{Kind: "clean"}, now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			if *g.FormRecord != record || g.Form != tc.form || g.Care.Clean != record.Clean+1 || g.Points != AdultPoints {
				t.Fatal("adult care rewrote evidence", g)
			}
			if err := s.Validate(now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOfflineFormRecordFreezesAtCrossingAndIsPartitionIndependent(t *testing.T) {
	s, start := nearAdult(t, CareHistory{Clean: 3.95}, .1)
	s.Sleeping = true
	s.Needs = Needs{10, 10, 10, 40}
	s.Growth.TrackedHours = 11.8
	s.Growth.Wellbeing = 1.18
	s.Growth.Points = 71.95
	one, many := copyState(s), copyState(s)
	end := start.Add(12 * time.Hour)
	one.Advance(end)
	for i := 1; i <= 720; i++ {
		many.Advance(start.Add(time.Duration(i) * time.Minute))
	}
	a, b := one.Growth.FormRecord, many.Growth.FormRecord
	if a == nil || b == nil || a.TrackedHours >= 12 || one.Growth.TrackedHours <= 12 || a.Rest >= one.Growth.Care.Rest {
		t.Fatal("end-of-absence totals used", one.Growth)
	}
	if one.Growth.Form != a.growth().Tendency() || one.Growth.Form != many.Growth.Form {
		t.Fatal("wrong locked form")
	}
	for _, pair := range [][2]float64{{a.TrackedHours, b.TrackedHours}, {a.Wellbeing, b.Wellbeing}, {a.Rest, b.Rest}, {a.Play, b.Play}, {a.Nutrition, b.Nutrition}, {a.Clean, b.Clean}} {
		if math.Abs(pair[0]-pair[1]) > 1e-8 {
			t.Fatal("refresh changed evidence", a, b)
		}
	}
	if math.Abs(float64(one.Growth.AdultAt-many.Growth.AdultAt)) > 1 {
		t.Fatal("different threshold time")
	}
	for _, state := range []State{one, many} {
		if err := state.Validate(end); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchemaElevenMigrationPreservesUnknownAdultHistoryAndRecordsFutureEvolution(t *testing.T) {
	for _, alreadyAdult := range []bool{false, true} {
		t.Run(map[bool]string{false: "future", true: "legacy"}[alreadyAdult], func(t *testing.T) {
			s, now := nearAdult(t, CareHistory{Play: 4}, .8)
			s.Schema = 11
			s.Companion.Interests = s.Companion.Interests[:6]
			if alreadyAdult {
				if _, err := s.Apply(Action{Kind: "feed"}, now); err != nil {
					t.Fatal(err)
				}
			}
			old := copyState(s)
			old.Companion.Interests = append(old.Companion.Interests, Interest{Kind: "treasure"})
			if !s.Upgrade(now) || s.Schema != Schema || !reflect.DeepEqual(old.Growth, s.Growth) || !reflect.DeepEqual(old.Album, s.Album) || !reflect.DeepEqual(old.Companion, s.Companion) || !reflect.DeepEqual(old.Economy, s.Economy) {
				t.Fatal("migration invented history or altered records")
			}
			if s.Upgrade(now) {
				t.Fatal("upgrade repeated")
			}
			if alreadyAdult {
				s.Advance(now.Add(time.Hour))
				if s.Growth.FormRecord != nil {
					t.Fatal("backfilled current care")
				}
			} else {
				if _, err := s.Apply(Action{Kind: "feed"}, now); err != nil {
					t.Fatal(err)
				}
				if s.Growth.FormRecord == nil {
					t.Fatal("future evolution not recorded")
				}
			}
			if err := s.Validate(now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestFormRecordRejectsImpossibleOrContradictoryPortableEvidence(t *testing.T) {
	s, now := nearAdult(t, CareHistory{Play: 4}, .8)
	s.Apply(Action{Kind: "feed"}, now)
	for name, change := range map[string]func(*State){
		"old schema": func(s *State) {
			s.Schema = 11
			s.Companion.Interests = s.Companion.Interests[:6]
		},
		"not adult":            func(s *State) { s.Growth.Stage = "growing" },
		"wrong form":           func(s *State) { s.Growth.Form = "gentle" },
		"negative":             func(s *State) { s.Growth.FormRecord.Play = -1 },
		"nan":                  func(s *State) { s.Growth.FormRecord.Wellbeing = math.NaN() },
		"infinite":             func(s *State) { s.Growth.FormRecord.Rest = math.Inf(1) },
		"future care":          func(s *State) { s.Growth.FormRecord.Nutrition++ },
		"future play":          func(s *State) { s.Growth.FormRecord.Play++ },
		"future clean":         func(s *State) { s.Growth.FormRecord.Clean++ },
		"future rest":          func(s *State) { s.Growth.FormRecord.Rest++ },
		"future tracking":      func(s *State) { s.Growth.FormRecord.TrackedHours++ },
		"future wellbeing":     func(s *State) { s.Growth.FormRecord.Wellbeing++ },
		"quality over one":     func(s *State) { s.Growth.FormRecord.TrackedHours = 1 },
		"before tracking fits": func(s *State) { s.Growth.FormRecord.TrackedHours = 100; s.Growth.TrackedHours = 100 },
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyState(s)
			change(&bad)
			if bad.Validate(now) == nil {
				t.Fatal("accepted false evidence")
			}
		})
	}
	legacy := copyState(s)
	legacy.Growth.FormRecord = nil
	if err := legacy.Validate(now); err != nil {
		t.Fatal("unknown migrated history rejected", err)
	}
}
