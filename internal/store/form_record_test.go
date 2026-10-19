package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func formRecordFixture(now time.Time) game.State {
	born := now.Add(-80 * time.Hour)
	p := game.New(born)
	p.Apply(game.Action{Kind: "hatch", Species: 2}, born)
	p.LastTick = now.UnixMilli()
	p.Needs = game.Needs{Hunger: 60, Mood: 80, Clean: 60, Energy: 80}
	p.Growth = &game.Growth{Stage: "growing", Points: 71.9, GrowingAt: born.Add(24 * time.Hour).UnixMilli(), TrackedHours: 12, Wellbeing: 9.6, Care: game.CareHistory{Play: 4}}
	p.Album.Entries = append(p.Album.Entries, game.Memory{Kind: "growing", At: p.Growth.GrowingAt, Source: "shared"})
	return p
}

func TestFormRecordPersistsExactlyOnceAndSurvivesPortableRestore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "form.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	fixture := formRecordFixture(now)
	if _, err = s.Do(nil, &fixture, false, now); err != nil {
		t.Fatal(err)
	}
	a := &game.Action{Kind: "feed", RequestID: "threshold-once"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Do(a, nil, false, now)
			if e != nil || r.State.Growth.FormRecord == nil || r.State.Growth.FormRecord.Nutrition != 1 || r.State.CareCount != 1 {
				t.Error("duplicate threshold", e)
			}
		}()
	}
	wg.Wait()
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	record := *r.State.Growth.FormRecord
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(nil, nil, false, now.Add(time.Hour))
	if err != nil || *r.State.Growth.FormRecord != record {
		t.Fatal("restart lost record", err)
	}
	backup := r.State
	restored, err := s.Do(nil, &backup, false, now.Add(time.Hour))
	if err != nil || *restored.State.Growth.FormRecord != record || restored.State.Growth.Form != "lively" {
		t.Fatal("restore lost evidence", err)
	}
	// The imported record must be owned by the restored result, not caller memory.
	backup.Growth.FormRecord.Play = 999
	if restored.State.Growth.FormRecord.Play != record.Play {
		t.Fatal("import aliases caller record")
	}
	before, _ := json.Marshal(restored.State)
	bad := restored.State
	g := *bad.Growth
	rCopy := *g.FormRecord
	bad.Growth = &g
	g.FormRecord = &rCopy
	rCopy.Rest = 999
	if _, err = s.Do(nil, &bad, false, now.Add(time.Hour)); err == nil {
		t.Fatal("bad record accepted")
	}
	current, err := s.Do(nil, nil, false, now.Add(time.Hour))
	after, _ := json.Marshal(current.State)
	if err != nil || string(before) != string(after) {
		t.Fatal("failed restore changed save", err)
	}
}

func TestSchemaElevenFormRecordMigrationKeepsOneRawSnapshotWithoutBackfilling(t *testing.T) {
	s, now := recapStore(t)
	old := formRecordFixture(now)
	old.Schema = 11
	old.Companion.Interests = old.Companion.Interests[:6]
	old.Apply(game.Action{Kind: "feed"}, now)
	if old.Growth.FormRecord != nil {
		t.Fatal("legacy fixture has a record")
	}
	raw, _ := json.Marshal(old)
	if _, err := s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		r, err := s.Do(nil, nil, false, now)
		if err != nil || r.State.Schema != game.Schema || r.State.Growth.FormRecord != nil || !reflect.DeepEqual(r.State.Growth, old.Growth) || !reflect.DeepEqual(r.State.Economy, old.Economy) {
			t.Fatal("migration rewrote history", err)
		}
	}
	var n int
	var snapshot string
	if err := s.db.QueryRow("SELECT COUNT(*),body FROM snapshots").Scan(&n, &snapshot); err != nil || n != 1 || snapshot != string(raw) {
		t.Fatal("original not preserved exactly once", err)
	}
}

func TestSchemaElevenFutureOfflineAdulthoodGetsARealRecordAfterUpgrade(t *testing.T) {
	s, now := recapStore(t)
	old := formRecordFixture(now)
	old.Schema = 11
	old.Companion.Interests = old.Companion.Interests[:6]
	raw, _ := json.Marshal(old)
	if _, err := s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	r, err := s.Do(nil, nil, false, now.Add(12*time.Hour))
	if err != nil || r.State.Growth.FormRecord == nil || r.State.Growth.Stage != "adult" || r.State.Growth.FormRecord.TrackedHours >= r.State.Growth.TrackedHours {
		t.Fatal("lost actual threshold on upgrade", err, r.State.Growth)
	}
}
