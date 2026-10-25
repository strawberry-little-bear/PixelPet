package game

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestWalkTrailChoiceAndNaturalCompletion(t *testing.T) {
	for _, trail := range []string{"woodland", "pond", "garden"} {
		t.Run(trail, func(t *testing.T) {
			s, now := walkingState(t)
			route := append([]string(nil), s.Game.Walking.Route...)
			id := s.Game.ID
			if _, err := s.Apply(Action{Kind: "walk-trail", Item: trail, GameID: id}, now); err != nil {
				t.Fatal(err)
			}
			n := s.Game.Walking
			if n.Trail != trail || !n.Paused || n.Step != 1 || !reflect.DeepEqual(route, n.Route) || len(s.Park.Finds) != 0 || s.Economy.Coins != 0 {
				t.Fatal("choice advanced or rewarded", n)
			}
			if err := s.Validate(now); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(s)
			// Once chosen, neither a second choice nor a stale request can reroll it.
			for _, action := range []Action{
				{Kind: "walk-trail", Item: "pond", GameID: id, Step: n.Step},
				{Kind: "walk-trail", Item: trail, GameID: id},
			} {
				if _, err := s.Apply(action, now); err == nil {
					t.Fatal("rerolled")
				}
				after, _ := json.Marshal(s)
				if string(after) != string(before) {
					t.Fatal("rejection mutated save")
				}
			}
			walkDo(t, &s, now, "walk-resume")
			walkBeats(t, &s, &now, 72, true)
			for _, d := range s.Park.Finds {
				found := false
				for _, id := range walkTrailPool(trail) {
					found = found || id == d.ID
				}
				if !found {
					t.Fatal("find outside selected trail", d.ID)
				}
			}
			walkDo(t, &s, now, "walk-finish")
			if s.Park.Walks != 1 || s.Economy.Coins != 6 || s.Companion.Recent.Kind != "walk" {
				t.Fatal("settlement changed")
			}
		})
	}
}
func TestWalkTrailRejectsUnknownStaleAndLateChoice(t *testing.T) {
	s, now := walkingState(t)
	id := s.Game.ID
	for _, a := range []Action{
		{Kind: "walk-trail", GameID: id, Item: "unknown"},
		{Kind: "walk-trail", GameID: "stale", Item: "pond"},
		{Kind: "walk-trail", GameID: id, Item: "pond", Step: 1},
	} {
		before, _ := json.Marshal(s)
		if _, err := s.Apply(a, now); err == nil {
			t.Fatal("accepted", a)
		}
		after, _ := json.Marshal(s)
		if string(before) != string(after) {
			t.Fatal("mutated")
		}
	}
	walkDo(t, &s, now, "walk-resume")
	if _, err := s.Apply(Action{Kind: "walk-trail", GameID: id, Item: "pond", Step: s.Game.Walking.Step}, now); err == nil {
		t.Fatal("selected while moving")
	}
	walkBeats(t, &s, &now, 1, false)
	walkDo(t, &s, now, "walk-pause")
	if _, err := s.Apply(Action{Kind: "walk-trail", GameID: id, Item: "pond", Step: s.Game.Walking.Step}, now); err == nil {
		t.Fatal("selected after first step")
	}
}
func TestWalkTrailLegacyUpgradeAndValidation(t *testing.T) {
	for _, beat := range []int{0, 28} {
		s, now := walkingState(t)
		walkDo(t, &s, now, "walk-resume")
		walkBeats(t, &s, &now, beat, false)
		walkDo(t, &s, now, "walk-pause")
		s.Schema = 22
		s.Game.Walking.Trail = ""
		before, _ := json.Marshal(s.Game)
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
		s.Upgrade(now)
		after, _ := json.Marshal(s.Game)
		if s.Schema != 23 || string(before) != string(after) {
			t.Fatal("legacy route changed")
		}
		if _, err := s.Apply(Action{Kind: "walk-trail", Item: "pond", GameID: s.Game.ID, Step: s.Game.Walking.Step}, now); err == nil {
			t.Fatal("legacy rerolled")
		}
		if err := s.Validate(now); err != nil {
			t.Fatal(err)
		}
	}
	s, now := walkingState(t)
	s.Game.Walking.Trail = "unknown"
	if s.Validate(now) == nil {
		t.Fatal("unknown trail")
	}
	s.Game.Walking.Trail = "pond"
	s.Game.Walking.Souvenirs = []string{"shell", "pebble", "pinecone"}
	if s.Validate(now) == nil {
		t.Fatal("foreign find")
	}
	s.Game.Walking.Souvenirs = []string{"shell", "pebble", "feather"}
	if err := s.Validate(now); err != nil {
		t.Fatal(err)
	}
	s.Schema = 22
	if s.Validate(now) == nil {
		t.Fatal("new field in old schema")
	}
	// A save/load roundtrip must preserve an accepted choice verbatim.
	s.Schema = Schema
	body, _ := json.Marshal(s)
	var restored State
	if err := json.Unmarshal(body, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s, restored) {
		t.Fatal("roundtrip changed choice")
	}
	restored.Advance(now.Add(time.Second))
	if err := restored.Validate(now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
}
