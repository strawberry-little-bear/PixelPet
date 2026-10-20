package game

import (
	"encoding/json"
	"testing"
	"time"
)

// nil/missing catches are legal when no fish has been caught. In particular,
// they are not damaged collections and must remain playable after a read.
func TestEmptyFishingCatchesRoundTripAndContinue(t *testing.T) {
	for _, phase := range []string{"ready", "wait", "bite", "result", "done"} {
		for _, representation := range []string{"nil", "omitted", "array"} {
			t.Run(phase+"/"+representation, func(t *testing.T) {
				s, now := fishingState(t)
				switch phase {
				case "wait":
					fishDo(t, &s, now, "fish-cast")
				case "bite":
					bite(t, &s, &now)
				case "result":
					fishDo(t, &s, now, "fish-cast")
					fishDo(t, &s, now, "fish-reel")
				case "done":
					for i := 0; i < 3; i++ {
						fishDo(t, &s, now, "fish-cast")
						fishDo(t, &s, now, "fish-reel")
					}
				}
				if representation != "array" {
					s.Game.Fishing.Catches = nil
				}
				fishDo(t, &s, now, "fish-pause")
				raw, err := json.Marshal(s)
				if err != nil {
					t.Fatal(err)
				}
				if representation == "omitted" {
					var v map[string]any
					if err = json.Unmarshal(raw, &v); err != nil {
						t.Fatal(err)
					}
					delete(v["game"].(map[string]any)["fishing"].(map[string]any), "catches")
					raw, err = json.Marshal(v)
					if err != nil {
						t.Fatal(err)
					}
				}
				var loaded State
				if err = json.Unmarshal(raw, &loaded); err != nil {
					t.Fatal(err)
				}
				if err = loaded.Validate(now); err != nil {
					t.Fatal(err)
				}
				n := loaded.Game.Fishing
				if n.Phase != phase || !n.Paused || len(n.Catches) != 0 || (representation != "array" && n.Catches != nil) {
					t.Fatal("round trip changed session", n)
				}
				if len(loaded.Pond.Fish) != 0 || loaded.Economy.Coins != 0 || loaded.CareCount != 0 {
					t.Fatal("invented discovery or settlement")
				}
				if phase == "done" {
					fishDo(t, &loaded, now, "fish-finish")
					if loaded.Game != nil || loaded.Economy.Coins != 0 || loaded.CareCount != 0 || loaded.Companion.Recent != nil {
						t.Fatal("zero-catch finish credited companionship or coins")
					}
					return
				}
				fishDo(t, &loaded, now, "fish-resume")
				if phase == "ready" || phase == "result" {
					fishDo(t, &loaded, now, "fish-cast")
				}
				for loaded.Game.Fishing.Phase == "wait" {
					now = now.Add(time.Second)
					fishDo(t, &loaded, now, "fish-step")
				}
				fishDo(t, &loaded, now, "fish-reel")
				n = loaded.Game.Fishing
				if len(n.Catches) != 1 || n.Catches[0] != n.LastFish || len(loaded.Pond.Fish) != 1 || loaded.Pond.Fish[0].Count != 1 {
					t.Fatal("first real catch failed", n)
				}
				if loaded.Economy.Coins != 0 || loaded.CareCount != 0 {
					t.Fatal("catch prematurely settled")
				}
			})
		}
	}
}
