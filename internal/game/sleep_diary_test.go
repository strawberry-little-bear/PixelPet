package game

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestWakeDiaryRecordsTheSettledSleepAcrossStagesAndReloads(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, stage := range []string{"baby", "growing", "adult"} {
		for _, polls := range []int{1, 60} {
			t.Run(fmt.Sprintf("%s/%d", stage, polls), func(t *testing.T) {
				s := sleepPet(t, now, 40)
				if stage != "baby" {
					s.Growth.Points = GrowingPoints
					if stage == "adult" {
						s.Growth.Points = AdultPoints
					}
					s.evolve(now)
				}
				sleepToggle(t, &s, now)
				count := len(s.Logs)
				for i := 1; i <= polls; i++ {
					s.Advance(now.Add(time.Duration(i) * time.Hour / time.Duration(polls)))
					data, _ := json.Marshal(s)
					if err := json.Unmarshal(data, &s); err != nil {
						t.Fatal(err)
					}
				}
				f := sleepToggle(t, &s, now.Add(time.Hour))
				text := s.Logs[0].Text
				for _, want := range []string{"这一觉", "体力恢复 +14.00", "休息习惯 +0.50", "睡梦里的成长 +"} {
					if !strings.Contains(text, want) {
						t.Fatalf("missing %q in %q", want, text)
					}
				}
				if !strings.Contains(text, fmt.Sprintf("睡梦里的成长 +%.2f 点", f.SleepSummary.GrowthPoints)) {
					t.Fatal(text)
				}
				if len(s.Logs) != count+1 || s.Logs[0].At != now.Add(time.Hour).UnixMilli() {
					t.Fatal("not exactly one wake entry")
				}
				if stage == "adult" && !strings.Contains(text, "睡梦里的成长 +0.00 点") {
					t.Fatal("adult invented growth", text)
				}
				for _, internalTerm := range []string{"实际结算", "期间成长", "含自然成长", "非起床奖励"} {
					if strings.Contains(text, internalTerm) {
						t.Fatalf("diary exposed internal term %q: %s", internalTerm, text)
					}
				}
				if utf8.RuneCountInString(text) > 200 {
					t.Fatal("not portable", text)
				}
				if err := s.Validate(now.Add(time.Hour)); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestWakeDiaryDistinguishesZeroTinyAndUnavailableHistory(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, elapsed := range []time.Duration{0, time.Millisecond} {
		s := sleepPet(t, now, 40)
		sleepToggle(t, &s, now)
		sleepToggle(t, &s, now.Add(elapsed))
		want := "这一觉让体力恢复 +0.00，休息习惯 +0.00；睡梦里的成长 +0.00 点也记下来了。"
		if elapsed > 0 {
			want = "这一觉让体力恢复 +<0.01，休息习惯 +<0.01；睡梦里的成长 +<0.01 点也记下来了。"
		}
		if !strings.Contains(s.Logs[0].Text, want) {
			t.Fatalf("want %s: %s", want, s.Logs[0].Text)
		}
	}
	s := sleepPet(t, now, 40)
	s.Sleeping = true // legacy/imported sleep has no known explicit bedtime
	sleepToggle(t, &s, now.Add(time.Hour))
	if !strings.Contains(s.Logs[0].Text, "没有完整记录") || strings.Contains(s.Logs[0].Text, "+") {
		t.Fatal("invented old sleep", s.Logs[0])
	}
}

func TestWakeDiaryPreservesTheOfflineSettlementCap(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, split := range []bool{false, true} {
		s := sleepPet(t, now, 0)
		sleepToggle(t, &s, now)
		if split {
			s.Advance(now.Add(12 * time.Hour))
		}
		sleepToggle(t, &s, now.Add(24*time.Hour))
		text := s.Logs[0].Text
		if !strings.Contains(text, "体力恢复 +100.00") {
			t.Fatal(text)
		}
		if strings.Contains(text, "另有 12.00 小时没有计入") == split {
			t.Fatal("lost capped interval", text)
		}
		if strings.Contains(text, "之后不会重复补算") == split {
			t.Fatal("missing cap explanation", text)
		}
		if utf8.RuneCountInString(text) > 200 {
			t.Fatal("not portable", text)
		}
	}
}

func TestOnlySuccessfulExplicitWakeWritesSleepDiary(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 40)
	sleepToggle(t, &s, now)
	before := len(s.Logs)
	s.Advance(now.Add(time.Hour))
	if len(s.Logs) != before {
		t.Fatal("passive read wrote diary")
	}
	awake := false
	_, f, err := s.ApplyWithFeedback(Action{Kind: "sleep", ExpectedSleeping: &awake}, now.Add(time.Hour))
	if err != ErrSleepChanged || f != nil || len(s.Logs) != before {
		t.Fatal("rejected intent wrote a wake")
	}
	sleepToggle(t, &s, now.Add(time.Hour))
	first := s.Logs[0]
	sleepToggle(t, &s, now.Add(2*time.Hour))
	sleepToggle(t, &s, now.Add(3*time.Hour))
	if s.Logs[0].Text != first.Text || s.Logs[0].At == first.At {
		t.Fatal("joined different sleeps")
	}
	if s.Logs[2] != first {
		t.Fatal("rewrote historical sleep")
	}
}

func TestWakeDiaryKeepsTheExistingThirtyEntryLimit(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 40)
	for i := 0; i < 35; i++ {
		s.Log(now, fmt.Sprintf("earlier %d", i))
	}
	sleepToggle(t, &s, now)
	sleepToggle(t, &s, now.Add(time.Hour))
	if len(s.Logs) != 30 || !strings.Contains(s.Logs[0].Text, "这一觉") || s.Logs[1].Text != "晚安，小伙伴。睡着时体力会慢慢恢复。" || s.Logs[29].Text != "earlier 7" {
		t.Fatal("changed retention", s.Logs)
	}
	if err := s.Validate(now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
}

// Display precision must not make equivalent persisted sums look different.
func TestWakeDiaryRoundsHalfStepsWithoutSettlementPartitionDust(t *testing.T) {
	for _, n := range []float64{14.325, math.Nextafter(14.325, 0), math.Nextafter(14.325, math.Inf(1))} {
		text := sleepDiary(&SleepSession{GrowthPoints: n}, 0)
		if !strings.Contains(text, "睡梦里的成长 +14.33 点") {
			t.Fatalf("%.17g: %s", n, text)
		}
	}
	for _, tc := range []struct {
		n    float64
		want string
	}{
		{0, "0.00"}, {1e-12, "<0.01"}, {.00499999, "<0.01"},
		{math.Nextafter(.005, 0), "0.01"}, {.005, "0.01"},
		{14.32499999, "14.32"}, {14.32500001, "14.33"},
	} {
		text := sleepDiary(&SleepSession{GrowthPoints: tc.n}, 0)
		if !strings.Contains(text, "睡梦里的成长 +"+tc.want+" 点") {
			t.Fatalf("%.17g: %s", tc.n, text)
		}
	}
}
