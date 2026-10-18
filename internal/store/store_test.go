package store

import (
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestLegacyMigrationPersistsOnceAndKeepsOriginalSnapshot(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	born := now.Add(-80 * time.Hour)
	legacy := game.New(born)
	legacy.Schema = 1
	legacy.Economy = nil
	legacy.Growth = nil
	legacy.Album = nil
	legacy.HatchedAt = born.UnixMilli()
	legacy.Name = "我的老朋友"
	legacy.Species = 7
	body, _ := json.Marshal(legacy)
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Schema != game.Schema || r.State.Growth.Stage != "adult" || r.State.Species != 7 || r.State.Name != "我的老朋友" {
		t.Fatal("migration changed existing pet", r.State)
	}
	firstRevision := r.State.Revision
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.Revision != firstRevision {
		t.Fatal("migration replayed", err)
	}
	var snapshot string
	if err = s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&snapshot); err != nil || snapshot != string(body) {
		t.Fatal("original schema 1 snapshot lost", err)
	}
	r, err = s.Do(nil, &legacy, false, now)
	if err != nil || r.State.Schema != game.Schema || r.State.Growth.Stage != "adult" {
		t.Fatal("schema 1 backup could not be imported", err)
	}
	if legacy.Schema != 1 || legacy.Growth != nil {
		t.Fatal("import mutated the caller's backup")
	}
}

func TestEvolutionAndCareCreditAreIdempotent(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "evolution.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	initial := game.New(now)
	initial.Apply(game.Action{Kind: "hatch", Species: 1}, now)
	initial.Needs.Hunger = 60
	initial.Growth.Points = 23.9
	body, _ := json.Marshal(initial)
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	a := &game.Action{Kind: "feed", RequestID: "same-evolution"}
	if _, err = s.Do(a, nil, false, now); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Do(a, nil, false, now); err != nil {
		t.Fatal(err)
	}
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Growth.Stage != "growing" || r.State.Growth.Care.Nutrition != 1 || r.State.CareCount != 1 {
		t.Fatal("evolution/action replayed", r.State)
	}
}

func TestPersistenceIdempotencyAndImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pet.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	r, err := s.Do(&game.Action{Kind: "hatch", Species: 8, RequestID: "hatch-1"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	backup := r.State
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := s.Do(&game.Action{Kind: "feed", RequestID: "feed-once"}, nil, false, now); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	r, err = s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.CareCount != 1 || r.State.Revision != 2 {
		t.Fatalf("duplicate mutation: %+v", r.State)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err = s.Do(nil, nil, false, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Species != 8 || r.State.CareCount != 1 {
		t.Fatal("save lost after reopening")
	}
	invalid := backup
	invalid.Needs.Clean = -5
	if _, err = s.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("invalid import accepted")
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.CareCount != 1 {
		t.Fatal("invalid import changed current save")
	}
	r, err = s.Do(nil, &backup, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.CareCount != 0 || r.State.Revision != 3 {
		t.Fatal("import failed or revision rolled backwards")
	}
	var snapshots int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&snapshots); err != nil || snapshots != 1 {
		t.Fatal("pre-import snapshot missing")
	}
	r, err = s.Do(nil, nil, true, now)
	if err != nil || r.State.HatchedAt != 0 || r.State.Revision != 4 {
		t.Fatal("reset failed")
	}
	if _, err = s.db.Exec("UPDATE saves SET body='corrupted' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Do(nil, nil, false, now); err == nil {
		t.Fatal("damaged save silently replaced")
	}
	r, err = s.Do(nil, &backup, false, now)
	if err != nil || r.State.Species != 8 {
		t.Fatal("could not recover damaged save from backup", err)
	}
}

func TestAdultGrowthSurvivesReopenAndRejectedImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adult.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now()
	born := now.Add(-72 * time.Hour)
	backup := game.New(born)
	backup.Apply(game.Action{Kind: "hatch", Species: 2}, born)
	backup.LastTick = now.UnixMilli()
	backup.Growth = &game.Growth{Stage: "growing", Points: 71.9,
		GrowingAt: born.Add(24 * time.Hour).UnixMilli(), Care: game.CareHistory{Play: 3}}
	backup.Album.Entries = append(backup.Album.Entries, game.Memory{Kind: "growing", At: backup.Growth.GrowingAt, Source: "shared"})
	backup.Needs.Hunger = 60
	if _, err = s.Do(nil, &backup, false, now); err != nil {
		t.Fatal(err)
	}
	grown, err := s.Do(&game.Action{Kind: "feed", RequestID: "adult-meal"}, nil, false, now)
	if err != nil || grown.State.Growth.Form != "lively" {
		t.Fatal("adult evolution did not persist", err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	invalid := grown.State
	g := *invalid.Growth
	invalid.Growth = &g
	invalid.Growth.AdultAt = now.Add(time.Hour).UnixMilli()
	if _, err = s.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("future evolution timestamp was accepted")
	}
	r, err := s.Do(nil, nil, false, now)
	if err != nil || *r.State.Growth != *grown.State.Growth || r.State.Revision != grown.State.Revision {
		t.Fatal("adult history was lost after reopen or rejected import", err)
	}
	var snapshots int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&snapshots); err != nil || snapshots != 1 {
		t.Fatal("rejected import modified snapshots", err)
	}
}

func TestCareFeedbackExcludesPassiveGrowthAndReplaysWithRequest(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "feedback.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	born := now.Add(-time.Hour)
	initial := game.New(born)
	initial.Apply(game.Action{Kind: "hatch", Species: 1}, born)
	initial.Needs.Hunger = 60
	body, _ := json.Marshal(initial)
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	a := &game.Action{Kind: "feed", RequestID: "feedback-once"}
	r, err := s.Do(a, nil, false, now)
	if err != nil || r.CareFeedback == nil || r.CareFeedback.Points != .25 || r.State.Growth.Points <= .25 {
		t.Fatalf("passive growth confused with action credit: %+v, %v", r, err)
	}
	replay, err := s.Do(a, nil, false, now.Add(time.Second))
	if err != nil || replay.CareFeedback == nil || *replay.CareFeedback != *r.CareFeedback || replay.State.Revision != r.State.Revision {
		t.Fatal("idempotent replay lost saved feedback", err)
	}
	current, err := s.Do(nil, nil, false, now.Add(time.Second))
	if err != nil || current.CareFeedback != nil || current.State.Growth.Care.Nutrition != 1 {
		t.Fatal("polling replayed feedback or action credit", err)
	}
	encoded, _ := json.Marshal(current.State)
	var save map[string]any
	json.Unmarshal(encoded, &save)
	if _, ok := save["careFeedback"]; ok {
		t.Fatal("ephemeral feedback leaked into backup")
	}
}
