package game

import (
	"testing"
	"time"
)

func TestEncounterDiscoveryMessageOnlyOnFirstSavedRecord(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		for _, mode := range []string{"first", "ordinary", "legacy", "repeat", "later-session"} {
			t.Run(kind+"/"+mode, func(t *testing.T) {
				s, now := encounterState(t, kind)
				if mode == "legacy" {
					s.Schema = 13
					if s.Game != nil && s.Game.Walking != nil {
						s.Game.Walking.Trail = ""
					}
					if s.Companion != nil {
						s.Companion.History = nil
					}
					s.Companion.Interests = s.Companion.Interests[:6]
				}
				if mode == "ordinary" {
					s.Game.ID = "00000001000000000000000000000001"
				}
				if mode == "repeat" || mode == "later-session" {
					discoverEncounter(t, &s, &now)
					if mode == "later-session" {
						s.Game.ID = s.Game.ID[:31] + "2"
					}
				}
				action := "fish-reel"
				if kind == "fishing" {
					bite(t, &s, &now)
				} else {
					if s.Game.Walking.Paused {
						walkDo(t, &s, now, "walk-resume")
					}
					walkBeats(t, &s, &now, (s.Game.Walking.Beat/24+1)*24-1, false)
					now = now.Add(time.Second)
					s.Advance(now)
					action = "walk-step"
				}
				step := 0
				if kind == "fishing" {
					step = s.Game.Fishing.Step
				} else {
					step = s.Game.Walking.Step
				}
				msg, err := s.Apply(Action{Kind: action, GameID: s.Game.ID, Step: step}, now)
				if err != nil {
					t.Fatal(err)
				}
				want := ""
				if mode == "first" {
					title := "星光涟漪"
					if kind == "walk" {
						title = "晚霞纸鸢"
					}
					want = "偶遇 · " + title + "，已收进风景手记。"
				}
				if msg != want {
					t.Fatalf("message %q, want %q", msg, want)
				}
				next := 0
				if kind == "fishing" {
					next = s.Game.Fishing.Step
				} else {
					next = s.Game.Walking.Step
				}
				if next != step+1 {
					t.Fatal("notification skipped action step")
				}
				if err := s.Validate(now); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestEncounterEarlyActionsNeverAnnounce(t *testing.T) {
	s, now := encounterState(t, "fishing")
	fishDo(t, &s, now, "fish-cast")
	msg, err := s.Apply(fishAction(&s, "fish-reel"), now)
	if err != nil || msg != "" || len(encounterMemories(s)) != 0 {
		t.Fatal(msg, err)
	}
	s, now = encounterState(t, "walk")
	walkDo(t, &s, now, "walk-resume")
	now = now.Add(time.Second)
	s.Advance(now)
	msg, err = s.Apply(Action{Kind: "walk-step", GameID: s.Game.ID, Step: s.Game.Walking.Step}, now)
	if err != nil || msg != "" || len(encounterMemories(s)) != 0 {
		t.Fatal(msg, err)
	}
}
