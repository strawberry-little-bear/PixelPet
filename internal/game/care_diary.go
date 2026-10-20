package game

import (
	"fmt"
	"math"
	"strings"
)

// Canonicalize only nanounit-scale float dust at display half-steps. Equivalent
// settlements should print the same two decimals; stored amounts never change.
func diaryAmount(n float64) string {
	rounded := math.Round(n*100+1e-7) / 100
	if n > 0 && rounded == 0 {
		return "<0.01"
	}
	return fmt.Sprintf("%.2f", rounded)
}

// Keep actual, clamped action deltas, not base-rule promises or the passive
// settlement preceding the action. Omit unchanged fields to keep the existing
// portable 200-character diary budget, but explicitly describe an all-zero effect.
func careNeedsDiary(effect CareEffect) string {
	changes := []string{}
	for _, row := range []struct {
		label         string
		before, after float64
	}{
		{"饱食", effect.Before.Hunger, effect.After.Hunger},
		{"心情", effect.Before.Mood, effect.After.Mood},
		{"清洁", effect.Before.Clean, effect.After.Clean},
		{"体力", effect.Before.Energy, effect.After.Energy},
	} {
		delta := row.after - row.before
		if delta == 0 {
			continue
		}
		sign := "+"
		if delta < 0 {
			sign, delta = "−", -delta
		}
		changes = append(changes, row.label+sign+diaryAmount(delta))
	}
	text := strings.Join(changes, "、")
	if len(changes) == 0 {
		text = "不变"
	}
	return "即时需求：" + text + "（不含时间结算）。"
}

// Annotate only the one entry just written by this successful action, within
// its transaction. Ordinary reads and cached request replays never reach here.
// The canonical feedback already excludes the preceding passive settlement.
func (s *State) recordCareDiary(message string, f *CareFeedback) {
	if f == nil || f.Effect == nil || len(s.Logs) == 0 || s.Logs[0].At != f.Effect.At || s.Logs[0].Text != message {
		return
	}
	label := map[string]string{"nutrition": "喂食", "clean": "清洁", "play": "陪玩"}[f.Habit]
	if label == "" {
		return
	}
	var reason string
	switch f.Reason {
	case "credited":
		reason = "本次习惯已计入。"
	case "cooldown":
		reason = "记录时同类习惯仍在间隔内，本次不计习惯。"
	case "not-needed":
		if f.Kind == "feed" {
			reason = "记录时饱食已满足，本次不计习惯。"
		} else if f.Kind == "clean" {
			reason = "记录时清洁已满足，本次不计习惯。"
		} else {
			return
		}
	default:
		return
	}
	text := fmt.Sprintf("%s%s本次成长 +%s 点，%s习惯 +%s。%s不含操作前的时间成长。", message, careNeedsDiary(*f.Effect), diaryAmount(f.Points), label, diaryAmount(f.HabitGain), reason)
	if f.Milestone != nil {
		if f.Milestone.Stage == "growing" {
			text += "这次照顾推动进入成长期。"
		}
		if f.Milestone.Stage == "adult" {
			text += "这次照顾推动进入成年期，" + FormName(f.Milestone.Form) + "已定型。"
		}
	} else if s.Growth != nil && s.Growth.Stage == "adult" {
		text += "成年后形态不变。"
	}
	s.Logs[0].Text = text
}
