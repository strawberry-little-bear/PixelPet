package game

import (
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestCareDiaryRecordsOnlyTheActionsActualNeedChanges(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, tc := range []struct {
		name, kind, expected string
		needs                Needs
		cooldown             bool
	}{
		{"meal", "feed", "即时需求：饱食+20.00、心情+3.00、清洁−3.00（不含时间结算）。", Needs{50, 60, 50, 70}, false},
		{"cooldown meal still helps", "feed", "即时需求：饱食+20.00、心情+3.00、清洁−3.00（不含时间结算）。", Needs{50, 60, 50, 70}, true},
		{"clamped meal", "feed", "即时需求：饱食+5.00、心情+0.50、清洁−1.00（不含时间结算）。", Needs{95, 99.5, 1, 70}, false},
		{"tiny meal", "feed", "即时需求：饱食+20.00、清洁−<0.01（不含时间结算）。", Needs{50, 100, .00001, 70}, false},
		{"bath", "clean", "即时需求：心情+4.00、清洁+35.00（不含时间结算）。", Needs{50, 60, 50, 70}, false},
		{"clamped bath", "clean", "即时需求：清洁+1.01（不含时间结算）。", Needs{50, 100, 98.99, 70}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := sleepPet(t, now.Add(-time.Hour), 70)
			s.Needs = tc.needs
			// Passive decay is settled before the acknowledged action, exactly as
			// in the HTTP transaction; it must not leak into this historical delta.
			s.Advance(now)
			if tc.name != "meal" {
				s.Needs = tc.needs
			}
			if tc.cooldown {
				s.Growth.Care.LastFeed = now.UnixMilli()
			}
			_, f, err := s.ApplyWithFeedback(Action{Kind: tc.kind}, now)
			if err != nil || f == nil || f.Effect == nil {
				t.Fatal(f, err)
			}
			text := s.Logs[0].Text
			if !strings.Contains(text, tc.expected) || strings.Contains(text, "体力") {
				t.Fatal("missing actual changes or invented unchanged change", text)
			}
			if tc.cooldown && (!strings.Contains(text, "同类习惯仍在间隔内") || f.Points != 0 || f.HabitGain != 0) {
				t.Fatal("cooldown must retain both need effects and zero learning", text, f)
			}
			if utf8.RuneCountInString(text) > 200 {
				t.Fatal("exceeds portable diary limit", text)
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCareDiaryNeedChangesCoverAllSevenFinalizers(t *testing.T) {
	for _, kind := range companionGames {
		for _, full := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/full=%t", kind, full), func(t *testing.T) {
				s, now := economyPet(t)
				s.Name = strings.Repeat("熊", 12)
				if full {
					s.Needs.Mood = 100
				} else {
					s.Needs.Mood = 30
				}
				_, f, _ := finishDiaryGame(t, &s, &now, kind, true)
				if f == nil || f.Effect == nil {
					t.Fatal("missing acknowledged effect", f)
				}
				text := s.Logs[0].Text
				changed := false
				for _, row := range []struct {
					label         string
					before, after float64
				}{{"饱食", f.Effect.Before.Hunger, f.Effect.After.Hunger}, {"心情", f.Effect.Before.Mood, f.Effect.After.Mood}, {"清洁", f.Effect.Before.Clean, f.Effect.After.Clean}, {"体力", f.Effect.Before.Energy, f.Effect.After.Energy}} {
					if row.before == row.after {
						continue
					}
					changed = true
					sign, delta := "+", row.after-row.before
					if delta < 0 {
						sign, delta = "−", -delta
					}
					if !strings.Contains(text, row.label+sign+diaryAmount(delta)) {
						t.Fatal("wrong action delta", row, text)
					}
				}
				if !changed && !strings.Contains(text, "即时需求：不变（不含时间结算）。") {
					t.Fatal("zero effect must be explicit", text)
				}
				if utf8.RuneCountInString(text) > 200 {
					t.Fatal("exceeds portable diary limit", text)
				}
			})
		}
	}
}

func TestCareNeedsDiaryZeroAndTinyChanges(t *testing.T) {
	for _, tc := range []struct {
		name, expected string
		effect         CareEffect
	}{
		{"unchanged", "即时需求：不变（不含时间结算）。", CareEffect{Before: Needs{100, 100, 100, 100}, After: Needs{100, 100, 100, 100}}},
		{"tiny positive and negative", "即时需求：心情+<0.01、体力−<0.01（不含时间结算）。", CareEffect{Before: Needs{50, 50, 50, 50}, After: Needs{50, 50.00001, 50, 49.99999}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := careNeedsDiary(tc.effect); got != tc.expected {
				t.Fatalf("got %q want %q", got, tc.expected)
			}
		})
	}
}

func TestCareNeedsDiaryAndAdultMilestoneFitPortableHistory(t *testing.T) {
	for _, kind := range companionGames {
		t.Run(kind, func(t *testing.T) {
			s, now := economyPet(t)
			s.Name = strings.Repeat("熊", 12)
			s.Growth.Points = GrowingPoints
			s.evolve(now)
			s.Growth.Points = AdultPoints - .1
			_, f, _ := finishDiaryGame(t, &s, &now, kind, true)
			if f == nil || f.Milestone == nil || f.Milestone.Stage != "adult" {
				t.Fatal("fixture must actually reach adulthood via this finalizer", f)
			}
			text := s.Logs[0].Text
			if !strings.Contains(text, "即时需求：") || !strings.Contains(text, "这次照顾推动进入成年期") || utf8.RuneCountInString(text) > 200 {
				t.Fatal("missing actual effects or adult milestone, or exceeded diary budget", text)
			}
		})
	}
}
