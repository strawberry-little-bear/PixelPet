package store

import (
	"encoding/json"
	"math"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func recapStore(t *testing.T) (*Store, time.Time) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "recap.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	now := time.Now().Truncate(time.Millisecond)
	r, err := s.Do(&game.Action{Kind: "hatch", Species: 2}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.ReturnRecap != nil {
		t.Fatal("first hatch invented absence")
	}
	return s, now
}
func closeTo(t *testing.T, a, b float64) {
	t.Helper()
	if math.Abs(a-b) > 1e-7 {
		t.Fatalf("got %v want %v", a, b)
	}
}

func TestReturnRecapUsesActualSettlementWithoutRewards(t *testing.T) {
	s, now := recapStore(t)
	r, _ := s.Do(&game.Action{Kind: "sleep"}, nil, false, now)
	before := r.State
	// GET/backup settlement is not foreground presence, nor is it a return.
	poll, err := s.Do(nil, nil, false, now.Add(time.Hour))
	if err != nil || poll.ReturnRecap != nil {
		t.Fatal("background GET created recap", err)
	}
	r, err = s.Visit(now.Add(2 * time.Hour))
	if err != nil || !r.RecapPending || r.ReturnRecap == nil {
		t.Fatal("missing return", err)
	}
	recap := r.ReturnRecap
	expected := before
	// Deep copy to avoid the expected settle mutating the before snapshot.
	g := *before.Growth
	expected.Growth = &g
	expected.Advance(now.Add(2 * time.Hour))
	if r.State.CareCount != before.CareCount {
		t.Fatal("extra care awarded")
	}
	closeTo(t, recap.After.Points, expected.Growth.Points)
	closeTo(t, recap.After.Rest-recap.Before.Rest, (100-before.Needs.Energy)/28)
	closeTo(t, recap.After.Needs.Energy, 100)
	if recap.From != now.UnixMilli() || recap.To != now.Add(2*time.Hour).UnixMilli() {
		t.Fatal("incorrect interval")
	}
	// Sleeping cannot be interrupted or consume this notification.
	denied, err := s.ReadRecap(recap.ID, now.Add(2*time.Hour))
	if err != nil || denied.RecapClaimed || !denied.RecapPending {
		t.Fatal("sleep consumed recap", err)
	}
	_, err = s.Do(&game.Action{Kind: "sleep"}, nil, false, now.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	read, err := s.ReadRecap(recap.ID, now.Add(2*time.Hour))
	if err != nil || !read.RecapClaimed || read.RecapPending {
		t.Fatal("not claimed", err)
	}
	again, err := s.Visit(now.Add(2*time.Hour + time.Second))
	if err != nil || again.RecapPending || again.ReturnRecap.ID != recap.ID {
		t.Fatal("reload repeats recap", err)
	}
	// Kept for deliberate menu review without a new reward or popup.
	closeTo(t, again.ReturnRecap.After.Points, recap.After.Points)
}

func TestReturnThresholdActionsAndCap(t *testing.T) {
	s, now := recapStore(t)
	r, err := s.Visit(now.Add(14 * time.Minute))
	if err != nil || r.ReturnRecap != nil {
		t.Fatal("short gap counted", err)
	}
	r, err = s.Do(&game.Action{Kind: "feed"}, nil, false, now.Add(29*time.Minute))
	if err != nil || !r.RecapPending {
		t.Fatal("action did not register return", err)
	}
	closeTo(t, r.ReturnRecap.After.Needs.Hunger, 80-3*29.0/60)
	if r.State.Needs.Hunger <= r.ReturnRecap.After.Needs.Hunger {
		t.Fatal("meal confused with absence")
	}
	r, err = s.Visit(now.Add(48 * time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	closeTo(t, r.ReturnRecap.After.TrackedHours-r.ReturnRecap.Before.TrackedHours, 12)
	if r.ReturnRecap.To-r.ReturnRecap.From <= (12 * time.Hour).Milliseconds() {
		t.Fatal("absence duration capped instead of settlement")
	}
}

func TestReturnCrossingAndOldSaveHaveNoInventedHistory(t *testing.T) {
	s, now := recapStore(t)
	initial, _ := s.Do(nil, nil, false, now)
	initial.State.Growth.Points = 23.9
	encoded, _ := json.Marshal(initial.State)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(encoded))
	// Simulate pre-feature install. First visit establishes baseline, no fabricated recap.
	s.db.Exec("DELETE FROM visits")
	r, err := s.Visit(now)
	if err != nil || r.ReturnRecap != nil {
		t.Fatal("invented old history", err)
	}
	r, err = s.Visit(now.Add(time.Hour))
	if err != nil || r.ReturnRecap.Before.Stage != "baby" || r.ReturnRecap.After.Stage != "growing" {
		t.Fatal("stage crossing absent", err)
	}
	if r.State.Growth.GrowingAt <= now.UnixMilli() {
		t.Fatal("lost real crossing timestamp")
	}
	// An unknown ID cannot acknowledge a pending notice.
	r, err = s.ReadRecap("wrong", now.Add(time.Hour))
	if err != nil || r.RecapClaimed || !r.RecapPending {
		t.Fatal("wrong id consumed notice", err)
	}
	// Exactly one competing tab may claim automatic presentation.
	id := r.ReturnRecap.ID
	var wg sync.WaitGroup
	claims := make(chan bool, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.ReadRecap(id, now.Add(time.Hour))
			if e != nil {
				t.Error(e)
			}
			claims <- r.RecapClaimed
		}()
	}
	wg.Wait()
	close(claims)
	count := 0
	for c := range claims {
		if c {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("claimed %d times", count)
	}
}

func TestReturnDeferredByGameAndClearedByResetImport(t *testing.T) {
	s, now := recapStore(t)
	r, err := s.Do(&game.Action{Kind: "play"}, nil, false, now.Add(time.Hour))
	if err != nil || !r.RecapPending {
		t.Fatal(err)
	}
	id := r.ReturnRecap.ID
	r, err = s.ReadRecap(id, now.Add(time.Hour))
	if err != nil || r.RecapClaimed || !r.RecapPending {
		t.Fatal("game interrupted", err)
	}
	backup := r.State
	r, err = s.Do(nil, &backup, false, now.Add(time.Hour))
	if err != nil || r.ReturnRecap != nil || r.RecapPending {
		t.Fatal("import retained visit notice", err)
	}
	r, err = s.Visit(now.Add(time.Hour))
	if err != nil || r.ReturnRecap != nil {
		t.Fatal("import invented absence", err)
	}
	r, err = s.Do(nil, nil, true, now.Add(2*time.Hour))
	if err != nil || r.ReturnRecap != nil {
		t.Fatal("reset kept notice", err)
	}
	r, err = s.Visit(now.Add(4 * time.Hour))
	if err != nil || r.ReturnRecap != nil {
		t.Fatal("egg created notice", err)
	}
}

func TestPendingReturnSurvivesStoreReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "persist.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	s.Do(&game.Action{Kind: "hatch", Species: 1}, nil, false, now)
	r, err := s.Visit(now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	id := r.ReturnRecap.ID
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err = s.Visit(now.Add(time.Hour))
	if err != nil || !r.RecapPending || r.ReturnRecap.ID != id {
		t.Fatal("pending lost on restart", err)
	}
	r, err = s.ReadRecap(id, now.Add(time.Hour))
	if err != nil || !r.RecapClaimed {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Visit(now.Add(time.Hour))
	if err != nil || r.RecapPending {
		t.Fatal("consumed replayed after restart", err)
	}
	s.Close()
}

func TestReturnRecapPreservesSubDisplaySettlementAcrossReload(t *testing.T) {
	s, now := recapStore(t)
	// A legitimate legacy save one millisecond short of adulthood, with
	// nearly exhausted needs and nearly full sleeping energy. Only a temp DB.
	legacy := game.State{
		Schema: 1, Revision: 1, Species: 2, Name: "精度回归",
		CreatedAt: now.Add(-72 * time.Hour).UnixMilli(),
		HatchedAt: now.Add(-72*time.Hour + time.Millisecond).UnixMilli(),
		LastTick:  now.UnixMilli(), Sleeping: true,
		Needs: game.Needs{Hunger: .001, Mood: 40, Clean: .02, Energy: 99.999},
		Logs:  []game.Log{},
	}
	if _, err := s.Do(nil, &legacy, false, now); err != nil {
		t.Fatal(err)
	}
	baseline, err := s.Visit(now)
	if err != nil || baseline.ReturnRecap != nil {
		t.Fatal("legacy import invented history", err)
	}
	r, err := s.Visit(now.Add(time.Hour))
	if err != nil || r.ReturnRecap == nil || !r.RecapPending {
		t.Fatal("missing settled recap", err)
	}
	if err := r.State.Validate(now.Add(time.Hour)); err != nil {
		t.Fatal("settlement produced invalid save", err)
	}
	recap := *r.ReturnRecap
	if recap.Before.Stage != "growing" || recap.After.Stage != "adult" {
		t.Fatal("missing actual adult crossing", recap)
	}
	for label, change := range map[string]float64{
		"growth": recap.After.Points - recap.Before.Points,
		"rest":   recap.After.Rest - recap.Before.Rest,
		"hunger": recap.Before.Needs.Hunger - recap.After.Needs.Hunger,
		"clean":  recap.Before.Needs.Clean - recap.After.Needs.Clean,
		"energy": recap.After.Needs.Energy - recap.Before.Needs.Energy,
	} {
		if change <= 0 || change >= .05 {
			t.Fatalf("%s must retain a tiny positive actual change: %.15g", label, change)
		}
	}
	closeTo(t, recap.After.Points, 72)
	closeTo(t, recap.After.Rest-recap.Before.Rest, .001/28)
	closeTo(t, recap.After.TrackedHours-recap.Before.TrackedHours, 1)
	// Subsequent settlement and JSON/SQLite round trips must not rewrite
	// the saved precision or the adult form in this historical receipt.
	for _, at := range []time.Time{now.Add(time.Hour), now.Add(time.Hour + time.Minute)} {
		poll, err := s.Do(nil, nil, false, at)
		if err != nil || poll.ReturnRecap == nil || *poll.ReturnRecap != recap {
			t.Fatal("poll changed saved recap", err)
		}
	}
	if _, err := s.Do(&game.Action{Kind: "sleep"}, nil, false, now.Add(time.Hour+time.Minute)); err != nil {
		t.Fatal(err)
	}
	read, err := s.ReadRecap(recap.ID, now.Add(time.Hour+time.Minute))
	if err != nil || !read.RecapClaimed || read.ReturnRecap == nil || *read.ReturnRecap != recap {
		t.Fatal("acknowledgement changed recap", err)
	}
}
