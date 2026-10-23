package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func recoveryStore(t *testing.T) (*Store, time.Time) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "recovery.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, time.Now().Truncate(time.Millisecond)
}
func insertRecovery(t *testing.T, s *Store, body string, now time.Time) int64 {
	t.Helper()
	r, err := s.db.Exec("INSERT INTO snapshots(body,created_at) VALUES(?,?)", body, now.UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func changes(t *testing.T, s *Store) int64 {
	t.Helper()
	var n int64
	if err := s.db.QueryRow("SELECT total_changes()").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func TestRecoveryBrowsingIsReadOnlyDespiteDamagedCurrentSave(t *testing.T) {
	s, now := recoveryStore(t)
	legacy := game.New(now.Add(-72 * time.Hour))
	legacy.Schema = 1
	legacy.HatchedAt = legacy.CreatedAt
	legacy.Name = "旧伙伴"
	legacy.Growth = nil
	legacy.Album = nil
	legacy.Economy = nil
	legacy.Pond = nil
	legacy.Park = nil
	legacy.Companion = nil
	body, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = legacy.Validate(now); err != nil {
		t.Fatal(err)
	}
	id := insertRecovery(t, s, string(body), now)
	if _, err = s.db.Exec("UPDATE saves SET body='broken' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	before := changes(t, s)
	list, err := s.Snapshots(now)
	if err != nil || len(list) != 1 {
		t.Fatal(list, err)
	}
	if list[0].Status != "available" || list[0].Pet.Stage != "unknown" || list[0].Pet.Name != "旧伙伴" {
		t.Fatal(list)
	}
	got, err := s.SnapshotBody(id, now)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatal("raw legacy bytes changed", err)
	}
	if changes(t, s) != before {
		t.Fatal("browsing wrote to database")
	}
	var current string
	if err = s.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&current); err != nil || current != "broken" {
		t.Fatal("damaged current save changed", err)
	}
}
func TestRecoveryAvailabilityAndFutureClock(t *testing.T) {
	s, now := recoveryStore(t)
	future := game.New(now.Add(time.Hour))
	futureBody, _ := json.Marshal(future)
	healthy, _ := json.Marshal(game.New(now))
	cases := []struct{ body, status string }{
		{"{", "unreadable"}, {"null", "unreadable"}, {"{}", "unreadable"},
		{strings.Repeat(" ", 65537), "too-large"}, {string(futureBody), "clock-ahead"},
		{strings.Replace(string(healthy), `"schema":`, `"schema":999000`, 1), "unreadable"},
		{string(healthy), "available"},
		{strings.TrimSuffix(string(healthy), "}") + `,"unknownFutureField":true}`, "unreadable"},
		{string(healthy) + ` {}`, "unreadable"},
	}
	for _, c := range cases {
		id := insertRecovery(t, s, c.body, now)
		info := snapshotInfo(id, now.UnixMilli(), c.body, now)
		if info.Status != c.status {
			t.Fatalf("%s: got %s", c.status, info.Status)
		}
		_, err := s.SnapshotBody(id, now)
		if c.status == "available" {
			if err != nil {
				t.Fatal(err)
			}
		} else if !errors.Is(err, ErrSnapshotUnavailable) || info.Pet != nil {
			t.Fatal("unavailable snapshot exposed", err)
		}
	}
	if info := snapshotInfo(1, now.UnixMilli(), string(futureBody), now.Add(time.Hour)); info.Status != "available" {
		t.Fatal("clock recovery failed", info)
	}
}
func TestRecoveryRetentionUsesExactIDs(t *testing.T) {
	s, now := recoveryStore(t)
	body, _ := json.Marshal(game.New(now))
	var first int64
	for i := 0; i < 12; i++ {
		id := insertRecovery(t, s, string(body), now)
		if i == 0 {
			first = id
		}
	}
	list, err := s.Snapshots(now)
	if err != nil || len(list) != 10 {
		t.Fatal(list, err)
	}
	for i, p := range list {
		if p.ID != fmt.Sprint(12-i) {
			t.Fatal("not newest first", list)
		}
	}
	if _, err = s.db.Exec("DELETE FROM snapshots WHERE id=?", first); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SnapshotBody(first, now); !errors.Is(err, ErrSnapshotMissing) {
		t.Fatal("pruned selection fell back to another point", err)
	}
}
func TestRecoveryUsesGenerationProtectedImportAndPreservesCurrent(t *testing.T) {
	s, now := recoveryStore(t)
	initial, err := s.Do(&game.Action{Kind: "hatch", Species: 2}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	original, _ := json.Marshal(initial.State)
	reset, err := s.DoForGeneration(nil, nil, true, now, initial.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	points, err := s.Snapshots(now)
	if err != nil || len(points) != 1 {
		t.Fatal(points, err)
	}
	raw, err := s.SnapshotBody(1, now)
	if err != nil || !bytes.Equal(raw, original) {
		t.Fatal("reset failed to retain exact pet", err)
	}
	var recovered game.State
	if err = json.Unmarshal(raw, &recovered); err != nil {
		t.Fatal(err)
	}
	before := changes(t, s)
	if _, err = s.DoForGeneration(nil, &recovered, false, now, initial.SaveGeneration); err == nil {
		t.Fatal("stale generation restored")
	}
	if changes(t, s) != before {
		t.Fatal("rejected restore wrote")
	}
	restored, err := s.DoForGeneration(nil, &recovered, false, now, reset.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	if restored.State.HatchedAt == 0 || restored.State.Species != 2 || restored.SaveGeneration == reset.SaveGeneration {
		t.Fatal("restore failed", restored)
	}
	list, err := s.Snapshots(now)
	if err != nil || len(list) != 2 || list[0].Pet.Stage != "egg" {
		t.Fatal("current egg not preserved", list, err)
	}
	// Repeated replacements retain at most ten, including the state before restore.
	for i := 0; i < 12; i++ {
		r, e := s.DoForGeneration(nil, nil, true, now, restored.SaveGeneration)
		if e != nil {
			t.Fatal(e)
		}
		restored = r
	}
	var count int
	if err = s.db.QueryRow("SELECT count(*) FROM snapshots").Scan(&count); err != nil || count != 10 {
		t.Fatal("retention failed", count, err)
	}
	if _, err = s.SnapshotBody(1, now); !errors.Is(err, ErrSnapshotMissing) {
		t.Fatal("removed point should be missing", err)
	}
}
