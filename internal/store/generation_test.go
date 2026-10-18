package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func generationDB(t *testing.T) (*Store, time.Time) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "pet.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, time.Now()
}
func generationState(t *testing.T, s *Store, now time.Time) Result {
	t.Helper()
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.SaveGeneration) != 32 {
		t.Fatal("invalid generation", r.SaveGeneration)
	}
	return r
}
func generationDump(t *testing.T, s *Store) string {
	t.Helper()
	var out []string
	for _, query := range []string{"SELECT body FROM saves", "SELECT token FROM save_generation", "SELECT body FROM snapshots ORDER BY id", "SELECT id,body FROM requests ORDER BY id", "SELECT last_seen,baseline,recap,pending FROM visits"} {
		rows, err := s.db.Query(query)
		if err != nil {
			t.Fatal(err)
		}
		cols, _ := rows.Columns()
		for rows.Next() {
			values := make([]any, len(cols))
			ptr := make([]any, len(cols))
			for i := range values {
				ptr[i] = &values[i]
			}
			if err = rows.Scan(ptr...); err != nil {
				t.Fatal(err)
			}
			out = append(out, fmt.Sprint(values))
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
	}
	return strings.Join(out, "\n")
}

func TestSaveGenerationPersistsAndOnlyReplacementRotatesIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "persistent.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	initial := generationState(t, s, now)
	hatch, err := s.DoForGeneration(&game.Action{Kind: "hatch", Species: 2, RequestID: "hatch"}, nil, false, now, initial.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	if hatch.SaveGeneration != initial.SaveGeneration {
		t.Fatal("hatching rotated installation generation")
	}
	replay, err := s.DoForGeneration(&game.Action{Kind: "hatch", Species: 2, RequestID: "hatch"}, nil, false, now, initial.SaveGeneration)
	if err != nil || replay.SaveGeneration != initial.SaveGeneration || replay.State.Revision != hatch.State.Revision {
		t.Fatal("cached reply lost generation", err)
	}
	r := generationState(t, s, now.Add(time.Hour))
	if r.SaveGeneration != initial.SaveGeneration {
		t.Fatal("clock settlement rotated generation")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	reopened := generationState(t, s, now.Add(time.Hour))
	if reopened.SaveGeneration != initial.SaveGeneration {
		t.Fatal("restart rotated generation")
	}
	backup := reopened.State
	imported, err := s.DoForGeneration(nil, &backup, false, now.Add(time.Hour), reopened.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	if imported.SaveGeneration == reopened.SaveGeneration || imported.State.CreatedAt != backup.CreatedAt || imported.State.HatchedAt != backup.HatchedAt {
		t.Fatal("same-pet import did not rotate only generation")
	}
	reset, err := s.DoForGeneration(nil, nil, true, now.Add(time.Hour), imported.SaveGeneration)
	if err != nil || reset.SaveGeneration == imported.SaveGeneration || reset.State.HatchedAt != 0 {
		t.Fatal("reset generation", err)
	}
}

func TestGenerationRejectionIsAtomicIncludingCacheAndExpiredGame(t *testing.T) {
	s, now := generationDB(t)
	initial := generationState(t, s, now)
	r, err := s.DoForGeneration(&game.Action{Kind: "hatch", Species: 2}, nil, false, now, initial.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.DoForGeneration(&game.Action{Kind: "play-snake", RequestID: "cached-game"}, nil, false, now, r.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	before := generationDump(t, s)
	wrong := strings.Repeat("0", 32)
	for _, kind := range []string{"feed", "clean", "sleep", "play-tiles", "claim-daily", "cancel-play", "snake-step"} {
		_, err = s.DoForGeneration(&game.Action{Kind: kind, RequestID: "cached-game"}, nil, false, now.Add(2*time.Hour), wrong)
		if !errors.Is(err, ErrSaveChanged) || generationDump(t, s) != before {
			t.Fatalf("%s changed state/cache/time/recap: %v", kind, err)
		}
	}
	backup := r.State
	for _, reset := range []bool{false, true} {
		var imported *game.State
		if !reset {
			imported = &backup
		}
		_, err = s.DoForGeneration(nil, imported, reset, now.Add(2*time.Hour), wrong)
		if !errors.Is(err, ErrSaveChanged) || generationDump(t, s) != before {
			t.Fatal("stale replacement mutated db", err)
		}
	}
	_, err = s.ReadRecapForGeneration("old", now.Add(2*time.Hour), wrong)
	if !errors.Is(err, ErrSaveChanged) || generationDump(t, s) != before {
		t.Fatal("stale recap changed presence", err)
	}
}

func TestRejectedImportAndActionDoNotRotateGeneration(t *testing.T) {
	s, now := generationDB(t)
	r := generationState(t, s, now)
	before := generationDump(t, s)
	invalid := r.State
	invalid.Schema = 999
	if _, err := s.DoForGeneration(nil, &invalid, false, now, r.SaveGeneration); err == nil || generationDump(t, s) != before {
		t.Fatal("invalid import changed generation")
	}
	if _, err := s.DoForGeneration(&game.Action{Kind: "not-an-action"}, nil, false, now, r.SaveGeneration); err == nil || generationDump(t, s) != before {
		t.Fatal("rejected action changed generation")
	}
}

func TestCorruptSaveDiagnosisAndRepairCarryGeneration(t *testing.T) {
	s, now := generationDB(t)
	r := generationState(t, s, now)
	if _, err := s.db.Exec("UPDATE saves SET body=? WHERE id=1", `{"schema":11,"revision":5,"needs":"broken"}`); err != nil {
		t.Fatal(err)
	}
	diagnosed, err := s.Do(nil, nil, false, now)
	if !errors.Is(err, ErrInvalidSave) || diagnosed.SaveGeneration != r.SaveGeneration {
		t.Fatal("corrupt diagnosis needs guard metadata", err)
	}
	before := generationDump(t, s)
	if _, err = s.DoForGeneration(nil, nil, true, now, strings.Repeat("f", 32)); !errors.Is(err, ErrSaveChanged) || generationDump(t, s) != before {
		t.Fatal("stale repair mutated bytes", err)
	}
	repaired, err := s.DoForGeneration(nil, nil, true, now, diagnosed.SaveGeneration)
	if err != nil || repaired.SaveGeneration == r.SaveGeneration {
		t.Fatal("explicit repair did not rotate generation", err)
	}
}

func TestOnlyOneConcurrentReplacementCanUseTheSameGeneration(t *testing.T) {
	s, now := generationDB(t)
	r := generationState(t, s, now)
	var wg sync.WaitGroup
	out := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.DoForGeneration(nil, nil, true, now, r.SaveGeneration)
			out <- err
		}()
	}
	wg.Wait()
	close(out)
	accepted, rejected := 0, 0
	for err := range out {
		if err == nil {
			accepted++
		} else if errors.Is(err, ErrSaveChanged) {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if accepted != 1 || rejected != 11 {
		t.Fatal("multiple stale confirmations accepted", accepted, rejected)
	}
	var snapshots int
	s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&snapshots)
	if snapshots != 1 {
		t.Fatal("rejected replacements left snapshots", snapshots)
	}
}

func TestGenerationUpgradeDoesNotRewriteLegacyPetUntilNormalMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	legacy := game.New(now.Add(-80 * time.Hour))
	legacy.Schema = 1
	legacy.HatchedAt = legacy.CreatedAt
	legacy.Growth = nil
	legacy.Album = nil
	legacy.Economy = nil
	legacy.Pond = nil
	legacy.Companion = nil
	legacy.Park = nil
	body, _ := json.Marshal(legacy)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body))
	s.db.Exec("DROP TABLE save_generation")

	s.Close()
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var stored string
	reopened.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&stored)
	if stored != string(body) {
		t.Fatal("adding metadata rewrote the old save")
	}
	r := generationState(t, reopened, now)
	if r.State.Schema != game.Schema || r.State.Growth.Stage != "adult" {
		t.Fatal("normal legacy migration failed")
	}
}
