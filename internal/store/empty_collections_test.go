package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestEmptyOutingCollectionsReadReopenAndImport(t *testing.T) {
	for _, representation := range []string{"nil", "omitted"} {
		t.Run(representation, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "empty.db")
			db, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { db.Close() }()
			now := time.Now().Truncate(time.Millisecond).Add(time.Second)
			fixture := game.New(now)
			if _, err = fixture.Apply(game.Action{Kind: "hatch", Species: 2}, now); err != nil {
				t.Fatal(err)
			}
			fixture.Pond.Fish = nil
			fixture.Park.Finds = nil
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
				delete(v["pond"].(map[string]any), "fish")
				delete(v["park"].(map[string]any), "finds")
				raw, err = json.Marshal(v)
				if err != nil {
					t.Fatal(err)
				}
			}
			// Fixture writes are confined to this test's private SQLite file.
			if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				r, err := db.Do(nil, nil, false, now)
				if err != nil {
					t.Fatal(err)
				}
				if r.State.Pond.Fish != nil || r.State.Park.Finds != nil || r.State.CareCount != 0 || r.State.Economy.Coins != 0 || r.State.Revision != fixture.Revision {
					t.Fatal("read invented history or rewrote empty slices")
				}
				body, err := json.Marshal(r)
				if err != nil {
					t.Fatal(err)
				}
				var response map[string]any
				if err = json.Unmarshal(body, &response); err != nil {
					t.Fatal(err)
				}
				state := response["state"].(map[string]any)
				if state["pond"].(map[string]any)["fish"] != nil || state["park"].(map[string]any)["finds"] != nil {
					t.Fatal("wire response did not expose legal null slices")
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
				t.Fatal("read caused recovery/migration", count, err)
			}
			backup, err := db.Do(nil, nil, false, now)
			if err != nil {
				t.Fatal(err)
			}
			imported, err := db.Do(nil, &backup.State, false, now)
			if err != nil {
				t.Fatal(err)
			}
			// Preserve the existing import contract: defensive copies normalize to [].
			if imported.State.Pond.Fish == nil || imported.State.Park.Finds == nil || len(imported.State.Pond.Fish) != 0 || len(imported.State.Park.Finds) != 0 {
				t.Fatal("import empty-array contract changed")
			}
			if backup.State.Pond.Fish != nil || backup.State.Park.Finds != nil {
				t.Fatal("import mutated caller backup")
			}
			if imported.State.CareCount != 0 || imported.State.Economy.Coins != 0 || imported.State.Game != nil {
				t.Fatal("import invented care/reward/game")
			}
		})
	}
}
