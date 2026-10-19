package game

import (
	"testing"
	"time"
)

func TestGrowingDiaryDoesNotInventEquipment(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for index, name := range Species {
		t.Run(name, func(t *testing.T) {
			s := New(now)
			if _, err := s.Apply(Action{Kind: "hatch", Species: index}, now); err != nil {
				t.Fatal(err)
			}
			// Existing diary text is history, not a migration target. Only future
			// evolution entries use the accurate, anatomy-neutral wording.
			historical := "以前的记录：戴上了小围巾！"
			s.Log(now, historical)
			s.Growth.Points = 23.9
			s.Needs.Hunger = 60
			before := s.Economy.Equipped
			if _, err := s.Apply(Action{Kind: "feed"}, now); err != nil {
				t.Fatal(err)
			}
			if s.Growth.Stage != "growing" || s.Growth.GrowingAt != now.UnixMilli() || s.Growth.Points != 24.15 || s.Growth.Care.Nutrition != 1 {
				t.Fatal("growth rules changed", s.Growth)
			}
			found, retained := 0, false
			for _, entry := range s.Logs {
				if entry.Text == s.Name+"进入成长期，有了新的模样！" {
					found++
				}
				if entry.Text == historical {
					retained = true
				}
			}
			if found != 1 || !retained {
				t.Fatal("missing new diary or changed old history", s.Logs)
			}
			if s.Economy.Equipped != before || len(s.Economy.Owned) != 0 {
				t.Fatal("growth equipped or awarded clothing")
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			s.Advance(now.Add(time.Minute))
			count := 0
			for _, entry := range s.Logs {
				if entry.Text == s.Name+"进入成长期，有了新的模样！" {
					count++
				}
			}
			if count != 1 {
				t.Fatal("growth diary replayed")
			}
		})
	}
}
