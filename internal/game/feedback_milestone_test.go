package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestCareMilestoneReportsOnlyActionCrossing(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, age := range []time.Duration{23*time.Hour + 54*time.Minute, 71*time.Hour + 54*time.Minute} {
		for _, kind := range []string{"feed", "clean"} {
			t.Run(age.String()+"/"+kind, func(t *testing.T) {
				s := legacyBoundaryPet(t, now, age)
				_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, now)
				if err != nil || f == nil || f.Milestone == nil {
					t.Fatalf("missing milestone: %+v %v", f, err)
				}
				m := *f.Milestone
				if m.Stage != s.Growth.Stage || m.At != now.UnixMilli() || m.Form != s.Growth.Form || f.Reason != "credited" || f.Points <= 0 {
					t.Fatalf("wrong milestone: %+v %+v", m, f)
				}
				if err = s.Validate(now); err != nil {
					t.Fatal(err)
				}
				// The receipt owns its values: later pet changes must not rewrite it.
				saved, _ := json.Marshal(f)
				s.Advance(now.Add(2 * time.Hour))
				if !reflect.DeepEqual(*f.Milestone, m) {
					t.Fatal("later growth rewrote action milestone")
				}
				after, _ := json.Marshal(f)
				if string(saved) != string(after) {
					t.Fatal("later growth changed receipt")
				}
			})
		}
	}
}

func TestCareMilestoneDoesNotClaimPassiveOrNonCreditedGrowth(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, kind := range []string{"feed", "clean"} {
		for _, scenario := range []string{"passive", "ordinary", "not-needed", "cooldown", "adult", "rejected"} {
			t.Run(kind+"/"+scenario, func(t *testing.T) {
				s := legacyBoundaryPet(t, now, 23*time.Hour+54*time.Minute)
				at := now
				switch scenario {
				case "passive":
					at = now.Add(time.Hour)
					s.Advance(at)
					if s.Growth.Stage != "growing" {
						t.Fatal("fixture did not cross naturally")
					}
				case "ordinary":
					s.Growth.Points = 20
				case "not-needed":
					s.Needs.Hunger, s.Needs.Clean = 80, 80
				case "cooldown":
					s.Growth.Care.LastFeed, s.Growth.Care.LastClean = now.UnixMilli(), now.UnixMilli()
				case "adult":
					s = legacyBoundaryPet(t, now, 72*time.Hour)
				case "rejected":
					s.Needs.Hunger, s.Needs.Clean = 100, 100
				}
				_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, at)
				if scenario == "rejected" {
					if err == nil || f != nil {
						t.Fatal("rejected action returned receipt")
					}
					return
				}
				if err != nil || f == nil || f.Milestone != nil {
					t.Fatalf("invented action milestone: %+v %v", f, err)
				}
			})
		}
	}
}

func TestStarsCareMilestoneOnlyAppearsOnCompletion(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := legacyBoundaryPet(t, now, 23*time.Hour+54*time.Minute)
	s.Needs.Energy = 80
	if _, f, err := s.ApplyWithFeedback(Action{Kind: "play"}, now); err != nil || f != nil {
		t.Fatalf("start: %+v %v", f, err)
	}
	for i := 0; i < 5; i++ {
		at := now.Add(time.Duration(i) * 900 * time.Millisecond)
		s.Advance(at)
		_, f, err := s.ApplyWithFeedback(Action{Kind: "catch", GameID: s.Game.ID, Lane: i % 3}, at)
		if err != nil {
			t.Fatal(err)
		}
		if i < 4 && f != nil {
			t.Fatal("unfinished stars returned receipt")
		}
		if i == 4 && (f == nil || f.Milestone == nil || f.Milestone.Stage != "growing" || f.Milestone.At != at.UnixMilli()) {
			t.Fatalf("completion missing milestone: %+v", f)
		}
	}
}
