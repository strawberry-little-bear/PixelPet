package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestEmptyFishingCatchesReadReopenAndAct(t *testing.T) {
	for _, phase := range []string{"ready", "bite", "done"} {
		for _, representation := range []string{"nil", "omitted"} {
			t.Run(phase+"/"+representation, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "catches.db")
				db, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				defer func() { db.Close() }()
				now := time.Now().Truncate(time.Millisecond).Add(time.Second)
				fixture := game.New(now)
				for _, a := range []game.Action{{Kind: "hatch", Species: 2}, {Kind: "play-fishing"}} {
					if _, err = fixture.Apply(a, now); err != nil {
						t.Fatal(err)
					}
				}
				actFixture := func(kind string) {
					t.Helper()
					fixture.Advance(now)
					if _, err = fixture.Apply(game.Action{Kind: kind, GameID: fixture.Game.ID, Step: fixture.Game.Fishing.Step}, now); err != nil {
						t.Fatal(err)
					}
				}
				if phase == "bite" {
					actFixture("fish-cast")
					for fixture.Game.Fishing.Phase == "wait" {
						now = now.Add(time.Second)
						actFixture("fish-step")
					}
				} else if phase == "done" {
					for i := 0; i < 3; i++ {
						actFixture("fish-cast")
						actFixture("fish-reel")
					}
				}
				actFixture("fish-pause")
				fixture.Game.Fishing.Catches = nil
				if err = fixture.Validate(now); err != nil {
					t.Fatal(err)
				}
				raw, err := json.Marshal(fixture)
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
				if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
					t.Fatal(err)
				}
				var r Result
				for i := 0; i < 2; i++ {
					r, err = db.Do(nil, nil, false, now)
					if err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(r.State.Game, fixture.Game) || r.State.CareCount != 0 || r.State.Economy.Coins != 0 || len(r.State.Pond.Fish) != 0 {
						t.Fatal("read altered session or credited history")
					}
					body, err := json.Marshal(r)
					if err != nil {
						t.Fatal(err)
					}
					var response map[string]any
					if err = json.Unmarshal(body, &response); err != nil {
						t.Fatal(err)
					}
					if response["state"].(map[string]any)["game"].(map[string]any)["fishing"].(map[string]any)["catches"] != nil {
						t.Fatal("legal null not represented on wire")
					}
					if i == 0 {
						if err = db.Close(); err != nil {
							t.Fatal(err)
						}
						db, err = Open(path)
						if err != nil {
							t.Fatal(err)
						}
					}
				}
				var count int
				if err = db.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&count); err != nil || count != 0 {
					t.Fatal("read caused recovery or migration", err, count)
				}
				act := func(kind string) {
					t.Helper()
					a := &game.Action{Kind: kind, GameID: r.State.Game.ID, Step: r.State.Game.Fishing.Step, RequestID: kind + "-once"}
					r, err = db.Do(a, nil, false, now)
					if err != nil {
						t.Fatal(err)
					}
					retry, err := db.Do(a, nil, false, now)
					if err != nil || !reflect.DeepEqual(retry, r) {
						t.Fatal("retry altered result", err)
					}
				}
				if phase == "done" {
					act("fish-finish")
					if r.State.Game != nil || r.State.CareCount != 0 || r.State.Economy.Coins != 0 || r.State.Companion.Recent != nil {
						t.Fatal("empty finish credited rewards")
					}
				} else if phase == "bite" {
					act("fish-resume")
					act("fish-reel")
					if len(r.State.Game.Fishing.Catches) != 1 || len(r.State.Pond.Fish) != 1 || r.State.Pond.Fish[0].Count != 1 || r.State.CareCount != 0 || r.State.Economy.Coins != 0 {
						t.Fatal("first real catch failed or rewarded early")
					}
				} else {
					act("fish-resume")
					act("fish-spot")
					act("fish-cast")
					act("fish-reel")
					if r.State.Game.Fishing.Catches != nil || r.State.Game.Fishing.Outcome != "early" || r.State.Game.Fishing.Casts != 1 {
						t.Fatal("early reel changed empty catches")
					}
				}
				// Existing import intentionally ends active games; it must not turn an
				// empty session into discoveries, completion credit or a reward.
				backup := r.State
				oldGame := backup.Game
				restored, err := db.Do(nil, &backup, false, now)
				if err != nil {
					t.Fatal(err)
				}
				if restored.State.Game != nil || backup.Game != oldGame || restored.State.CareCount != backup.CareCount || restored.State.Economy.Coins != backup.Economy.Coins || !reflect.DeepEqual(restored.State.Pond, backup.Pond) {
					t.Fatal("import changed discovery/settlement contract")
				}
			})
		}
	}
}
