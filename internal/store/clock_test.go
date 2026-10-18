package store

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestClockRollbackDoesNotDiagnoseHealthySaveAsCorrupt(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "clock.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond)
	future := now.Add(time.Hour)
	state := game.New(future)
	raw, _ := json.Marshal(state)
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Do(nil, nil, false, now); err == nil || errors.Is(err, ErrInvalidSave) {
		t.Fatalf("healthy future save must be clock-blocked, not corrupt: %v", err)
	}
}

func TestClockAheadBlocksEveryWriteWithoutChangingAnyTable(t *testing.T) {
	for _, mode := range []string{"egg", "baby", "adult", "sleep", "play", "play-tiles", "play-snake", "play-tetris", "play-walk", "play-fishing", "legacy"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "clock.db")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { s.Close() }()
			now := time.Now().Truncate(time.Millisecond)
			future := now.Add(time.Hour)
			state := game.New(future)
			if mode != "egg" {
				if _, err = state.Apply(game.Action{Kind: "hatch", Species: 2}, future); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "sleep" || len(mode) > 4 && mode[:4] == "play" {
				if _, err = state.Apply(game.Action{Kind: mode}, future); err != nil {
					t.Fatal(mode, err)
				}
			} else if mode == "play" {
				if _, err = state.Apply(game.Action{Kind: mode}, future); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "legacy" {
				state.Schema = 1
				state.Companion = nil
				state.Park = nil
				state.Pond = nil
				state.Economy = nil
				state.Growth = nil
				state.Album = nil
			}
			if mode == "adult" {
				born := future.Add(-100 * time.Hour)
				state = game.New(born)
				state.Schema = 1
				state.HatchedAt = born.UnixMilli()
				state.Companion, state.Park, state.Pond, state.Economy, state.Growth, state.Album = nil, nil, nil, nil, nil, nil
				state.Upgrade(future)
				if state.Growth.Stage != "adult" {
					t.Fatal("adult fixture did not evolve")
				}
			}
			if err = state.Validate(future); err != nil {
				t.Fatal("bad fixture", mode, err)
			}
			raw, _ := json.Marshal(state)
			_, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw))
			if err != nil {
				t.Fatal(err)
			}
			cached, _ := json.Marshal(Result{State: state, ServerTime: future.UnixMilli()})
			s.db.Exec("INSERT INTO requests(id,body) VALUES('old',?)", string(cached))
			baselineJSON, _ := json.Marshal(returnSnapshot(state))
			recapJSON, _ := json.Marshal(ReturnRecap{ID: "pending-clock", From: future.Add(-time.Hour).UnixMilli(), To: future.UnixMilli(), Before: returnSnapshot(state), After: returnSnapshot(state)})
			s.db.Exec("INSERT INTO visits VALUES(1,?,?,?,1)", future.UnixMilli(), string(baselineJSON), string(recapJSON))
			s.db.Exec("INSERT INTO snapshots(body,created_at) VALUES('original',?)", future.UnixMilli())
			backup := game.New(now)
			calls := []func() (Result, error){
				func() (Result, error) { return s.Do(nil, nil, false, now) },
				func() (Result, error) { return s.Visit(now) },
				func() (Result, error) { return s.ReadRecap("pending-clock", now) },
				func() (Result, error) { return s.Do(&game.Action{Kind: "feed", RequestID: "new"}, nil, false, now) },
				func() (Result, error) { return s.Do(&game.Action{Kind: "feed", RequestID: "old"}, nil, false, now) },
				func() (Result, error) { return s.Do(nil, &backup, false, now) },
				func() (Result, error) { return s.Do(nil, nil, true, now) },
			}
			for i, call := range calls {
				if _, err = call(); !errors.Is(err, ErrClockAhead) {
					t.Fatalf("call %d: %v", i, err)
				}
			}
			var body, baseline, recap string
			var lastSeen int64
			var pending int
			if err = s.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&body); err != nil || body != string(raw) {
				t.Fatal("save changed", err)
			}
			if err = s.db.QueryRow("SELECT last_seen,baseline,recap,pending FROM visits").Scan(&lastSeen, &baseline, &recap, &pending); err != nil || lastSeen != future.UnixMilli() || baseline != string(baselineJSON) || recap != string(recapJSON) || pending != 1 {
				t.Fatal("visit changed", err)
			}
			for _, table := range []string{"snapshots", "requests"} {
				var n int
				s.db.QueryRow("SELECT count(*) FROM " + table).Scan(&n)
				if n != 1 {
					t.Fatal(table, "changed", n)
				}
			}
			// Restart while still behind: diagnosis must survive without a migration.
			s.Close()
			s, err = Open(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.Do(nil, nil, false, now); !errors.Is(err, ErrClockAhead) {
				t.Fatal("restart", err)
			}
			// Catch-up at precisely LastTick does not invent care or settlement.
			r, err := s.Do(nil, nil, false, future)
			if err != nil {
				t.Fatal("catch up", err)
			}
			if mode == "adult" && (r.State.Growth.Stage != "adult" || r.State.Growth.Form != state.Growth.Form) {
				t.Fatal("clock recovery rerolled adult form")
			}
			if r.State.HatchedAt != state.HatchedAt || r.State.CareCount != state.CareCount || r.State.Needs != state.Needs {
				t.Fatal("catch up replayed action or time")
			}
			if err = r.State.Validate(future); err != nil {
				t.Fatal("catch up invalid", err)
			}
			rev := r.State.Revision
			again, err := s.Do(nil, nil, false, future)
			if err != nil || again.State.Revision != rev {
				t.Fatal("repeated catch up mutated", err)
			}
		})
	}
}

func TestClockDiagnosisRequiresInternallyValidStateAndImportsStayStrict(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	future := now.Add(time.Hour)
	for _, field := range []string{"schema", "needs", "log", "growth"} {
		t.Run(field, func(t *testing.T) {
			s, err := Open(filepath.Join(t.TempDir(), "invalid.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			state := game.New(future)
			switch field {
			case "schema":
				state.Schema = 999
			case "needs":
				state.Needs.Hunger = -1
			case "log":
				state.Logs = []game.Log{{At: future.Add(time.Hour).UnixMilli(), Text: "bad"}}
			case "growth":
				state.Growth = nil
			}
			raw, _ := json.Marshal(state)
			s.db.Exec("UPDATE saves SET body=?", string(raw))
			if _, err = s.Do(nil, nil, false, now); !errors.Is(err, ErrInvalidSave) || errors.Is(err, ErrClockAhead) {
				t.Fatal("corruption masked as clock", err)
			}
		})
	}
	s, err := Open(filepath.Join(t.TempDir(), "import.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	current, _ := json.Marshal(game.New(now))
	if _, err = s.db.Exec("UPDATE saves SET body=?", string(current)); err != nil {
		t.Fatal(err)
	}
	backup := game.New(future)
	if _, err = s.Do(nil, &backup, false, now); err == nil || errors.Is(err, ErrClockAhead) {
		t.Fatal("future import must stay invalid", err)
	}
	var n int
	s.db.QueryRow("SELECT count(*) FROM snapshots").Scan(&n)
	if n != 0 {
		t.Fatal("invalid import snapshotted")
	}
}

func TestClockRecoverySettlesOnlyThePostSaveInterval(t *testing.T) {
	for _, sleeping := range []bool{false, true} {
		t.Run(map[bool]string{false: "awake", true: "sleeping"}[sleeping], func(t *testing.T) {
			s, err := Open(filepath.Join(t.TempDir(), "settle.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			savedAt := time.Now().Truncate(time.Millisecond).Add(time.Hour)
			state := game.New(savedAt)
			state.Apply(game.Action{Kind: "hatch", Species: 2}, savedAt)
			if sleeping {
				state.Apply(game.Action{Kind: "sleep"}, savedAt)
			}
			raw, _ := json.Marshal(state)
			s.db.Exec("UPDATE saves SET body=?", string(raw))
			for _, back := range []time.Duration{time.Millisecond, time.Second, time.Hour, 48 * time.Hour} {
				if _, err = s.Visit(savedAt.Add(-back)); !errors.Is(err, ErrClockAhead) {
					t.Fatal("backwards time", back, err)
				}
			}
			// Forty-eight hours away still uses the existing twelve-hour cap. The
			// blocked interval neither drains needs backwards nor earns care/rewards.
			after := savedAt.Add(48 * time.Hour)
			expected := state
			expected.Advance(after)
			r, err := s.Do(nil, nil, false, after)
			if err != nil {
				t.Fatal(err)
			}
			if r.State.Needs != expected.Needs || r.State.CareCount != expected.CareCount || r.State.Growth.TrackedHours != expected.Growth.TrackedHours || r.State.Growth.Points != expected.Growth.Points || r.State.Economy.Coins != expected.Economy.Coins {
				t.Fatal("clock recovery changed settlement rules")
			}
			rev := r.State.Revision
			r, err = s.Do(nil, nil, false, after)
			if err != nil || r.State.Revision != rev {
				t.Fatal("settled twice", err)
			}
		})
	}
}
