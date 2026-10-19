package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func sceneryEntries(s game.State) []game.Memory {
	out := []game.Memory{}
	for _, m := range s.Album.Entries {
		if strings.HasPrefix(m.Kind, "scenery-") {
			out = append(out, m)
		}
	}
	return out
}

// All DBs are t.TempDir; timestamps advance through acknowledged actions, not
// forged catches. The browser regression separately tests wall-clock play.
func TestOutingAtomicDiscoveryReplayReopenAndBackup(t *testing.T) {
	for _, mode := range []string{"weather", "encounter"} {
		for _, kind := range []string{"fishing", "walk"} {
			t.Run(kind+"/"+mode, func(t *testing.T) {
				entries := func(s game.State) []game.Memory {
					if mode == "weather" {
						return sceneryEntries(s)
					}
					out := []game.Memory{}
					for _, m := range s.Album.Entries {
						if strings.HasPrefix(m.Kind, "encounter-") {
							out = append(out, m)
						}
					}
					return out
				}
				path := filepath.Join(t.TempDir(), "outings.db")
				db, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				defer func() { db.Close() }()
				now := time.Now().Truncate(time.Millisecond)
				r, err := db.Do(&game.Action{Kind: "hatch"}, nil, false, now)
				if err != nil {
					t.Fatal(err)
				}
				do := func(a *game.Action) {
					t.Helper()
					r, err = db.Do(a, nil, false, now)
					if err != nil {
						t.Fatal(a.Kind, err)
					}
				}
				do(&game.Action{Kind: "play-" + kind})
				if mode == "encounter" {
					// An explicit test-only saved session fixture, not a forced production RNG.
					scene := 36
					if kind == "walk" {
						scene = 24
					}
					r.State.Game.ID = fmt.Sprintf("%06x00%024x", scene, 1)
					if err = r.State.Validate(now); err != nil {
						t.Fatal(err)
					}
					raw, marshalErr := json.Marshal(r.State)
					if marshalErr != nil {
						t.Fatal(marshalErr)
					}
					// Import intentionally clears active games. Write only this temporary
					// store's valid fixture, then read it through the normal load path.
					if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
						t.Fatal(err)
					}
					r, err = db.Do(nil, nil, false, now)
					if err != nil {
						t.Fatal(err)
					}
				}
				id := r.State.Game.ID
				command := func(k string) {
					t.Helper()
					step := 0
					if kind == "fishing" {
						step = r.State.Game.Fishing.Step
					} else {
						step = r.State.Game.Walking.Step
					}
					do(&game.Action{Kind: k, GameID: id, Step: step})
				}
				if kind == "fishing" {
					command("fish-cast")
					for r.State.Game.Fishing.Phase == "wait" {
						now = now.Add(time.Second)
						command("fish-step")
					}
				} else {
					command("walk-resume")
					for r.State.Game.Walking.Beat < 23 {
						now = now.Add(time.Second)
						command("walk-step")
					}
					now = now.Add(time.Second)
				}
				if len(entries(r.State)) != 0 {
					t.Fatal("discovery before action")
				}
				step := 0
				action := "fish-reel"
				if kind == "fishing" {
					step = r.State.Game.Fishing.Step
				} else {
					action = "walk-step"
					step = r.State.Game.Walking.Step
				}
				a := &game.Action{Kind: action, GameID: id, Step: step, RequestID: "real-discovery"}
				// Discovery, its memory and the idempotency receipt share one transaction.
				var beforeFailure, afterFailure string
				if err = db.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&beforeFailure); err != nil {
					t.Fatal(err)
				}
				if _, err = db.db.Exec("CREATE TRIGGER fail_discovery BEFORE UPDATE ON saves BEGIN SELECT RAISE(ABORT, 'simulated disk write failure'); END"); err != nil {
					t.Fatal(err)
				}
				if _, err = db.Do(a, nil, false, now); err == nil {
					t.Fatal("write failure ignored")
				}
				if err = db.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&afterFailure); err != nil || beforeFailure != afterFailure {
					t.Fatal("failed write changed state", err)
				}
				var receipts int
				if err = db.db.QueryRow("SELECT COUNT(*) FROM requests WHERE id=?", a.RequestID).Scan(&receipts); err != nil || receipts != 0 {
					t.Fatal("failed write cached success", err)
				}
				if _, err = db.db.Exec("DROP TRIGGER fail_discovery"); err != nil {
					t.Fatal(err)
				}
				var wg sync.WaitGroup
				for i := 0; i < 8; i++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						retry, e := db.Do(a, nil, false, now)
						if e != nil {
							t.Error(e)
							return
						}
						if mode == "encounter" {
							title := "星光涟漪"
							if kind == "walk" {
								title = "晚霞纸鸢"
							}
							if retry.Message != "偶遇 · "+title+"，已收进风景手记。" {
								t.Error("retry lost discovery receipt", retry.Message)
							}
						}
					}()
				}
				wg.Wait()
				r, err = db.Do(nil, nil, false, now)
				if err != nil {
					t.Fatal(err)
				}
				if r.Message != "" {
					t.Fatal("read replayed discovery notification", r.Message)
				}
				memories := entries(r.State)
				if len(memories) != 1 || memories[0].At != now.UnixMilli() || r.State.CareCount != 0 || r.State.Economy.Coins != 0 {
					t.Fatal("lost/duplicated/rewarded discovery", memories)
				}
				if kind == "fishing" {
					if r.State.Game.Fishing.Casts != 1 || len(r.State.Game.Fishing.Catches) != 1 {
						t.Fatal("duplicate fish")
					}
				} else {
					if r.State.Game.Walking.Beat != 24 {
						t.Fatal("duplicate step")
					}
				}
				// The identical stale step without its idempotency key is refused atomically.
				stale := *a
				stale.RequestID = ""
				if _, e := db.Do(&stale, nil, false, now); e == nil {
					t.Fatal("stale accepted")
				}
				do(&game.Action{Kind: "cancel-play", GameID: id})
				backupRaw, _ := json.Marshal(r.State)
				if err = db.Close(); err != nil {
					t.Fatal(err)
				}
				db, err = Open(path)
				if err != nil {
					t.Fatal(err)
				}
				r, err = db.Do(nil, nil, false, now)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(memories, entries(r.State)) {
					t.Fatal("reopen lost memory")
				}
				var backup game.State
				if err = json.Unmarshal(backupRaw, &backup); err != nil {
					t.Fatal(err)
				}
				do(&game.Action{Kind: "rename", Name: "暂改名字"})
				r, err = db.Do(nil, &backup, false, now)
				if err != nil || !reflect.DeepEqual(memories, entries(r.State)) {
					t.Fatal("backup roundtrip", err)
				}
				before, _ := json.Marshal(r.State)
				badRaw, _ := json.Marshal(r.State)
				corruptions := []string{"unknown-kind", "invalid-provenance", "wrong-light"}
				for _, corruption := range corruptions {
					var bad game.State
					if err = json.Unmarshal(badRaw, &bad); err != nil {
						t.Fatal(err)
					}
					m := &bad.Album.Entries[len(bad.Album.Entries)-1]
					switch corruption {
					case "unknown-kind":
						m.Kind = "scenery-walk-snow"
					case "invalid-provenance":
						m.OutingID = strings.Repeat("g", 32)
					case "wrong-light":
						m.OutingID = "00000000000000000000000000000001"
					}
					if _, err = db.Do(nil, &bad, false, now); err == nil {
						t.Fatal("corrupt backup accepted", corruption)
					}
					r, err = db.Do(nil, nil, false, now)
					after, _ := json.Marshal(r.State)
					if err != nil || string(before) != string(after) {
						t.Fatal("bad import mutated save", corruption, err)
					}
				}
			})
		}
	}
}

func TestOutingSchema12MigrationSnapshotsWithoutBackfill(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "legacy-outings.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond)
	old := game.New(now)
	old.Apply(game.Action{Kind: "hatch"}, now)
	old.Schema = 12
	old.Apply(game.Action{Kind: "play-walk"}, now)
	id := old.Game.ID
	old.Apply(game.Action{Kind: "walk-resume", GameID: id, Step: 0}, now)
	for i := 0; i < 24; i++ {
		now = now.Add(time.Second)
		old.Advance(now)
		if _, err = old.Apply(game.Action{Kind: "walk-step", GameID: id, Step: old.Game.Walking.Step}, now); err != nil {
			t.Fatal(err)
		}
	}
	if len(old.Park.Finds) != 1 || len(sceneryEntries(old)) != 0 {
		t.Fatal("legacy fixture")
	}
	raw, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	r, err := db.Do(nil, nil, false, now)
	if err != nil || r.State.Schema != game.Schema || len(sceneryEntries(r.State)) != 0 || !reflect.DeepEqual(old.Album, r.State.Album) || !reflect.DeepEqual(old.Park, r.State.Park) || !reflect.DeepEqual(old.Game, r.State.Game) {
		t.Fatal("upgrade invented or changed history", err)
	}
	for i := 0; i < 2; i++ {
		if _, err = db.Do(nil, nil, false, now); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var snapshot string
	if err = db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&count, &snapshot); err != nil || count != 1 || snapshot != string(raw) {
		t.Fatal("migration snapshot", count, err)
	}
}

func TestEncounterSchema13MigrationSnapshotsWithoutInventingHistory(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "migration.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond)
	old := game.New(now)
	old.Apply(game.Action{Kind: "hatch"}, now)
	old.Apply(game.Action{Kind: "play-walk"}, now)
	old.Schema = 13
	old.Game.ID = "00001800000000000000000000000001"
	id := old.Game.ID
	old.Apply(game.Action{Kind: "walk-resume", GameID: id, Step: 0}, now)
	for i := 0; i < 24; i++ {
		now = now.Add(time.Second)
		old.Advance(now)
		if _, err = old.Apply(game.Action{Kind: "walk-step", GameID: id, Step: old.Game.Walking.Step}, now); err != nil {
			t.Fatal(err)
		}
	}
	if err = old.Validate(now); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	r, err := db.Do(nil, nil, false, now)
	var expected game.State
	if err = json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	expected.Schema = game.Schema
	expected.Revision++ // normal persisted migration revision; no gameplay/history changes
	if err != nil || !reflect.DeepEqual(expected, r.State) {
		want, _ := json.Marshal(expected)
		got, _ := json.Marshal(r.State)
		t.Fatalf("migration fabricated/changed history: %v\nwant: %s\ngot: %s", err, want, got)
	}
	for i := 0; i < 2; i++ {
		if _, err = db.Do(nil, nil, false, now); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var snapshot string
	if err = db.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&count, &snapshot); err != nil || count != 1 || snapshot != string(raw) {
		t.Fatal("missing/duplicate migration snapshot", count, err)
	}
	for r.State.Game.Walking.Beat < 48 {
		now = now.Add(time.Second)
		r, err = db.Do(&game.Action{Kind: "walk-step", GameID: id, Step: r.State.Game.Walking.Step}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	found := false
	for _, m := range r.State.Album.Entries {
		if m.Kind == "encounter-walk-kite" {
			found = true
			if m.At != now.UnixMilli() || m.OutingID != id {
				t.Fatal("incorrect future provenance", m)
			}
		}
	}
	if !found {
		t.Fatal("upgraded session lost future discovery")
	}
}
