package game

import (
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestCareDiaryKeepsTheAcknowledgedLearningInTheExistingEntry(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, kind := range []string{"feed", "clean"} {
		for _, stage := range []string{"baby", "growing", "adult"} {
			for _, reason := range []string{"credited", "not-needed", "cooldown"} {
				t.Run(fmt.Sprintf("%s/%s/%s", kind, stage, reason), func(t *testing.T) {
					s := sleepPet(t, now, 70)
					if stage != "baby" {
						s.Growth.Points = GrowingPoints
						if stage == "adult" {
							s.Growth.Points = AdultPoints
						}
						s.evolve(now)
					}
					s.Needs.Hunger, s.Needs.Clean = 50, 50
					if reason == "not-needed" {
						s.Needs.Hunger, s.Needs.Clean = 80, 80
					}
					if reason == "cooldown" {
						s.Growth.Care.LastFeed, s.Growth.Care.LastClean = now.UnixMilli(), now.UnixMilli()
					}
					count := len(s.Logs)
					msg, f, err := s.ApplyWithFeedback(Action{Kind: kind}, now)
					if err != nil || f == nil || f.Reason != reason {
						t.Fatalf("%s %+v %v", msg, f, err)
					}
					text := s.Logs[0].Text
					if !strings.HasPrefix(text, msg) || !strings.Contains(text, "本次成长 +") || !strings.Contains(text, "不含操作前的时间成长") {
						t.Fatal("missing learning diary", text)
					}
					label := "喂食"
					if kind == "clean" {
						label = "清洁"
					}
					if !strings.Contains(text, fmt.Sprintf("%s习惯 +%.2f", label, f.HabitGain)) {
						t.Fatal(text)
					}
					points := "+0.00 点"
					if reason == "credited" && stage != "adult" {
						points = "+0.25 点"
					}
					if !strings.Contains(text, "本次成长 "+points) {
						t.Fatal("wrong growth", text)
					}
					if reason == "not-needed" && !strings.Contains(text, "记录时"+map[string]string{"feed": "饱食", "clean": "清洁"}[kind]+"已满足") {
						t.Fatal(text)
					}
					if reason == "cooldown" && !strings.Contains(text, "同类习惯仍在间隔内") {
						t.Fatal(text)
					}
					if stage == "adult" && !strings.Contains(text, "成年后形态不变") {
						t.Fatal(text)
					}
					if len(s.Logs) != count+1 || s.Logs[0].At != now.UnixMilli() || utf8.RuneCountInString(text) > 200 {
						t.Fatal("changed log shape", s.Logs)
					}
					if err := s.Validate(now); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
}

// All seven finalizers use their real command path. Snake/Tetris use validated
// terminal-board fixtures, not a claim of playing those boards to completion.
func finishDiaryGame(t *testing.T, s *State, now *time.Time, kind string, qualifies bool) (string, *CareFeedback, int) {
	t.Helper()
	start := map[string]string{"stars": "play", "tiles": "play-tiles", "snake": "play-snake", "tetris": "play-tetris", "fishing": "play-fishing", "walk": "play-walk", "treasure": "play-treasure"}[kind]
	if _, f, err := s.ApplyWithFeedback(Action{Kind: start}, *now); err != nil || f != nil {
		t.Fatal(start, f, err)
	}
	var finish Action
	switch kind {
	case "stars":
		for i := 0; i < 4; i++ {
			*now = now.Add(time.Second)
			s.Advance(*now)
			if _, f, err := s.ApplyWithFeedback(Action{Kind: "catch", GameID: s.Game.ID, Lane: i % 3}, *now); err != nil || f != nil {
				t.Fatal("early receipt", f, err)
			}
		}
		*now = now.Add(time.Second)
		s.Advance(*now)
		finish = Action{Kind: "catch", GameID: s.Game.ID, Lane: 1}
	case "tiles":
		for {
			a, b := tilePair(t, s, *now)
			if _, f, err := s.ApplyWithFeedback(Action{Kind: "tile-pick", GameID: s.Game.ID, Tile: a}, *now); err != nil || f != nil {
				t.Fatal("first tile", f, err)
			}
			remaining := 0
			for _, v := range s.Game.Tiles.Board {
				if v != 0 {
					remaining++
				}
			}
			finish = Action{Kind: "tile-pick", GameID: s.Game.ID, Tile: b}
			if remaining == 2 {
				break
			}
			if _, f, err := s.ApplyWithFeedback(finish, *now); err != nil || f != nil {
				t.Fatal("unfinished pair", f, err)
			}
		}
	case "snake":
		n := s.Game.Snake
		n.End = "wall"
		if qualifies {
			n.Eaten = 3
			n.Step = 3
			n.Body = []TilePoint{{5, 5}, {4, 5}, {3, 5}, {2, 5}, {1, 5}, {0, 5}}
			n.Food = TilePoint{9, 9}
		}
		finish = snakeAction(s, "snake-finish")
	case "tetris":
		n := s.Game.Tetris
		n.End = "limit"
		n.Active = nil
		n.Step = tetrisStepLimit
		if qualifies {
			n.Lines = 2
			n.Pieces = TetrisWidth * n.Lines / 4
		}
		finish = blockAction(s, "tetris-finish")
	case "fishing":
		for i := 0; i < 3; i++ {
			if qualifies {
				bite(t, s, now)
			} else {
				fishDo(t, s, *now, "fish-cast")
			}
			fishDo(t, s, *now, "fish-reel")
		}
		finish = fishAction(s, "fish-finish")
	case "walk":
		walkDo(t, s, *now, "walk-resume")
		for s.Game.Walking.Beat < WalkLength {
			*now = now.Add(time.Second)
			s.Advance(*now)
			walkDo(t, s, *now, "walk-step")
		}
		finish = Action{Kind: "walk-finish", GameID: s.Game.ID, Step: s.Game.Walking.Step}
	case "treasure":
		treasureCommand(t, s, *now, "treasure-resume", 0)
		for i := 0; !s.Game.Treasure.done(); i++ {
			treasureCommand(t, s, *now, "treasure-dig", i)
		}
		finish = Action{Kind: "treasure-finish", GameID: s.Game.ID, Step: s.Game.Treasure.Step}
	}
	if err := s.Validate(*now); err != nil {
		t.Fatal("invalid pre-finish fixture", kind, err)
	}
	count := len(s.Logs)
	msg, f, err := s.ApplyWithFeedback(finish, *now)
	if err != nil || s.Game != nil {
		t.Fatal("finish", kind, err)
	}
	if err = s.Validate(*now); err != nil {
		t.Fatal("invalid final state", kind, err)
	}
	return msg, f, count
}

func TestCareDiaryCoversAllSevenGameSettlementsWithoutChangingRewards(t *testing.T) {
	for _, kind := range companionGames {
		for _, scenario := range []string{"credited", "cooldown", "adult"} {
			t.Run(kind+"/"+scenario, func(t *testing.T) {
				s, now := economyPet(t)
				s.Needs.Energy = 90
				s.Name = strings.Repeat("熊", 12) // Longest legal name must still fit the existing log limit.
				if scenario == "cooldown" {
					s.Growth.Care.LastPlay = now.UnixMilli()
				}
				if scenario == "adult" {
					s.Growth.Points = AdultPoints
					s.evolve(now)
				}
				// A full wallet does not turn genuine companionship into no habit credit.
				s.Economy.Coins = MaxCoins
				msg, f, count := finishDiaryGame(t, &s, &now, kind, true)
				wantReason := "credited"
				habit := 1.0
				if scenario == "cooldown" {
					wantReason = "cooldown"
					habit = 0
				}
				if f == nil || f.Reason != wantReason || f.HabitGain != habit {
					t.Fatalf("%s %+v", msg, f)
				}
				text := s.Logs[0].Text
				if !strings.HasPrefix(text, msg) || !strings.Contains(text, fmt.Sprintf("陪玩习惯 +%.2f", habit)) || !strings.Contains(text, "不含操作前的时间成长") || !strings.Contains(text, fmt.Sprintf("本次成长 +%.2f 点", f.Points)) {
					t.Fatal(text)
				}
				if len(s.Logs) != count+1 || utf8.RuneCountInString(text) > 200 || s.Economy.Coins != MaxCoins {
					t.Fatal("changed logging or rewards", text)
				}
			})
		}
	}
	for _, kind := range []string{"snake", "tetris", "fishing"} {
		t.Run(kind+"/non-qualifying", func(t *testing.T) {
			s, now := economyPet(t)
			msg, f, count := finishDiaryGame(t, &s, &now, kind, false)
			if f != nil || s.Logs[0].Text != msg || len(s.Logs) != count+1 {
				t.Fatal("invented care learning", f, s.Logs[0])
			}
		})
	}
}

func TestCareDiaryDistinguishesActionMilestonesFromPassiveGrowth(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for _, points := range []float64{23.9, 71.9} {
		for _, kind := range []string{"feed", "clean"} {
			for _, passive := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%.1f/passive=%t", kind, points, passive), func(t *testing.T) {
					s := legacyBoundaryPet(t, now, time.Duration(points*3600)*time.Second)
					at := now
					if passive {
						at = now.Add(time.Hour)
						s.Advance(at)
					}
					_, f, err := s.ApplyWithFeedback(Action{Kind: kind}, at)
					if err != nil || f == nil {
						t.Fatal(f, err)
					}
					text := s.Logs[0].Text
					if strings.Contains(text, "这次照顾推动进入") == passive {
						t.Fatal("wrong milestone attribution", text)
					}
					if !strings.Contains(text, fmt.Sprintf("本次成长 +%.2f 点", f.Points)) {
						t.Fatal("wrong capped growth", text)
					}
					if f.Milestone != nil && f.Milestone.Stage == "adult" && !strings.Contains(text, FormName(s.Growth.Form)+"已定型") {
						t.Fatal(text)
					}
					if err = s.Validate(at); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
}

func TestCareDiaryKeepsThirtyEntriesAndTinyCappedGrowth(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	s := sleepPet(t, now, 40)
	s.Needs.Hunger = 40
	s.Growth.Points = GrowingPoints
	s.evolve(now)
	s.Growth.Points = AdultPoints - .00001
	old := make([]Log, 30)
	for i := range old {
		old[i] = Log{At: now.UnixMilli(), Text: fmt.Sprintf("旧日记 %d，不倒填。", i)}
	}
	s.Logs = append([]Log(nil), old...)
	_, f, err := s.ApplyWithFeedback(Action{Kind: "feed"}, now)
	if err != nil || f == nil || f.Points <= 0 || f.Points >= .005 {
		t.Fatal(f, err)
	}
	if !strings.Contains(s.Logs[0].Text, "本次成长 +<0.01 点") || !strings.Contains(s.Logs[0].Text, "已定型") {
		t.Fatal(s.Logs[0])
	}
	if len(s.Logs) != 30 {
		t.Fatal("changed rolling limit", len(s.Logs))
	}
	if s.Logs[1].Text != s.Name+"长大啦！照顾习惯让它成为了"+FormName(s.Growth.Form)+"。" {
		t.Fatal("lost original evolution log", s.Logs[1])
	}
	for i := 2; i < len(s.Logs); i++ {
		if s.Logs[i] != old[i-2] {
			t.Fatal("rewrote historical entry", i, s.Logs[i])
		}
	}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
}

func TestDiaryAmountOnlyFormatsWithoutHidingTinyGains(t *testing.T) {
	for _, tc := range []struct {
		n    float64
		want string
	}{{0, "0.00"}, {.00001, "<0.01"}, {.004, "<0.01"}, {.005, "0.01"}, {.25, "0.25"}, {14.325 - 1e-12, "14.33"}, {14.325 + 1e-12, "14.33"}} {
		if got := diaryAmount(tc.n); got != tc.want {
			t.Fatalf("%g: %s != %s", tc.n, got, tc.want)
		}
	}
}
