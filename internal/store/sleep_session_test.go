package store

import (
	"encoding/json"
	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"math"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func seedSleepStore(t *testing.T, s *Store, now time.Time) {
	t.Helper()
	state := game.New(now)
	state.Apply(game.Action{Kind: "hatch", Species: 2}, now)
	state.Needs.Energy = 40
	body, _ := json.Marshal(state)
	if _, err := s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
}
func TestSleepReceiptPersistsAcrossRestartAndIdempotentWake(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sleep.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	seedSleepStore(t, s, now)
	if _, err = s.Do(&game.Action{Kind: "sleep", RequestID: "bed"}, nil, false, now); err != nil {
		t.Fatal(err)
	}
	for _, minutes := range []int{10, 30, 45} {
		r, err := s.Do(nil, nil, false, now.Add(time.Duration(minutes)*time.Minute))
		if err != nil || r.CareFeedback != nil || r.State.SleepSession == nil {
			t.Fatalf("poll: %v %+v", err, r)
		}
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	asleep := true
	a := &game.Action{Kind: "sleep", RequestID: "wake", ExpectedSleeping: &asleep}
	wake, err := s.Do(a, nil, false, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	f := wake.CareFeedback
	if f == nil || f.SleepSummary == nil || f.Points != 0 || f.HabitGain != 0 || f.Effect.Before != f.Effect.After || wake.State.SleepSession != nil {
		t.Fatalf("bad receipt %+v", f)
	}
	summary := *f.SleepSummary
	if math.Abs(summary.EnergyRecovered-14) > 1e-8 || math.Abs(summary.SettledHours-1) > 1e-8 || math.Abs(summary.RestGain-.5) > 1e-8 {
		t.Fatalf("only counted last tick %+v", summary)
	}
	again, err := s.Do(a, nil, false, now.Add(2*time.Hour))
	if err != nil || !reflect.DeepEqual(again.CareFeedback, f) || again.State.Sleeping {
		t.Fatalf("wake replay altered receipt: %v %+v", err, again.CareFeedback)
	}
	// A different page can begin another sleep. Replaying the old wake must not
	// end it or lend its counters to the old receipt.
	bed, err := s.Do(&game.Action{Kind: "sleep", RequestID: "bed-again"}, nil, false, now.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	again, err = s.Do(a, nil, false, now.Add(3*time.Hour))
	if err != nil || !reflect.DeepEqual(again.CareFeedback, f) {
		t.Fatal("old receipt mutated")
	}
	current, err := s.Do(nil, nil, false, now.Add(3*time.Hour))
	if err != nil || !current.State.Sleeping || current.CareFeedback != nil || current.State.SleepSession.StartedAt != bed.State.SleepSession.StartedAt {
		t.Fatalf("replay touched new sleep: %v", err)
	}
	second, err := s.Do(&game.Action{Kind: "sleep", RequestID: "new-wake", ExpectedSleeping: &asleep}, nil, false, now.Add(3*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if second.CareFeedback.SleepSummary.StartedAt != now.Add(2*time.Hour).UnixMilli() || math.Abs(second.CareFeedback.SleepSummary.SettledHours-1) > 1e-8 {
		t.Fatal("joined separate sleeps")
	}
	var raw string
	s.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&raw)
	var saved map[string]any
	json.Unmarshal([]byte(raw), &saved)
	if saved["sleepSummary"] != nil || saved["careFeedback"] != nil || saved["sleepSession"] != nil {
		t.Fatal("wake receipt persisted in pet save")
	}
}
func TestImportClearsSleepContinuityWithoutMutatingBackup(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "import.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond)
	seedSleepStore(t, s, now)
	s.Do(&game.Action{Kind: "sleep"}, nil, false, now)
	r, err := s.Do(nil, nil, false, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	backup := r.State
	session := *backup.SleepSession
	restored, err := s.Do(nil, &backup, false, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if !restored.State.Sleeping || restored.State.SleepSession != nil || !reflect.DeepEqual(restored.State.Growth, backup.Growth) || *backup.SleepSession != session {
		t.Fatal("import lost totals or mutated caller")
	}
	awake, err := s.Do(&game.Action{Kind: "sleep", RequestID: "wake-import"}, nil, false, now.Add(2*time.Hour))
	if err != nil || awake.CareFeedback.SleepSummary != nil {
		t.Fatalf("invented imported sleep: %v", err)
	}
	if awake.State.Growth.Care.Rest <= backup.Growth.Care.Rest {
		t.Fatal("imported sleeping pet stopped resting")
	}
	// After the imported unknown sleep ends, an explicit bedtime tracks again.
	// Resetting the pet then removes that active record too.
	fresh, err := s.Do(&game.Action{Kind: "sleep", RequestID: "fresh-bed"}, nil, false, now.Add(2*time.Hour))
	if err != nil || fresh.State.SleepSession == nil {
		t.Fatal("could not begin new tracked sleep")
	}
	reset, err := s.Do(nil, nil, true, now.Add(2*time.Hour))
	if err != nil || reset.State.SleepSession != nil {
		t.Fatal("reset leaked sleep")
	}
}
func TestStaleSleepIntentRollsBackSettlementAndKeepsSession(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "stale.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond)
	seedSleepStore(t, s, now)
	before, err := s.Do(&game.Action{Kind: "sleep"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	awake := false
	if _, err = s.Do(&game.Action{Kind: "sleep", RequestID: "stale-bed", ExpectedSleeping: &awake}, nil, false, now.Add(time.Hour)); err != game.ErrSleepChanged {
		t.Fatalf("stale intent accepted: %v", err)
	}
	read, err := s.Do(nil, nil, false, now)
	if err != nil || !reflect.DeepEqual(read.State, before.State) {
		t.Fatal("rejected action saved settlement")
	}
	wake, err := s.Do(&game.Action{Kind: "sleep", RequestID: "actual-wake"}, nil, false, now.Add(time.Hour))
	if err != nil || math.Abs(wake.CareFeedback.SleepSummary.EnergyRecovered-14) > 1e-8 {
		t.Fatalf("rejection double counted: %v", err)
	}
}
