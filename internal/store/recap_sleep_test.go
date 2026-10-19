package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func assertSnapshotSleep(t *testing.T, snapshot ReturnSnapshot, want bool) {
	t.Helper()
	// Inspect the wire format as well: awake must be false, not omitted.
	body, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields["sleeping"]) != map[bool]string{true: "true", false: "false"}[want] {
		t.Fatalf("sleeping = %s, want %v in %s", fields["sleeping"], want, body)
	}
}

func TestReturnSleepContextPrecedesReturnActionAndSurvivesReplay(t *testing.T) {
	for _, sleeping := range []bool{false, true} {
		t.Run(map[bool]string{false: "awake", true: "asleep"}[sleeping], func(t *testing.T) {
			s, now := recapStore(t)
			if sleeping {
				if _, err := s.Do(&game.Action{Kind: "sleep"}, nil, false, now); err != nil {
					t.Fatal(err)
				}
			}
			action := &game.Action{Kind: "sleep", RequestID: "return-toggle"}
			at := now.Add(time.Hour)
			r, err := s.Do(action, nil, false, at)
			if err != nil || r.ReturnRecap == nil {
				t.Fatal("missing return", err)
			}
			assertSnapshotSleep(t, r.ReturnRecap.Before, sleeping)
			assertSnapshotSleep(t, r.ReturnRecap.After, sleeping)
			if r.State.Sleeping == sleeping {
				t.Fatal("return action did not toggle")
			}
			if sleeping && r.ReturnRecap.After.Needs.Energy <= r.ReturnRecap.Before.Needs.Energy {
				t.Fatal("missing actual rest")
			}
			if !sleeping && r.ReturnRecap.After.Needs.Energy >= r.ReturnRecap.Before.Needs.Energy {
				t.Fatal("missing actual awake decay")
			}
			beforeReplay := generationDump(t, s)
			replay, err := s.Do(action, nil, false, at.Add(time.Second))
			if err != nil || replay.ReturnRecap != nil || replay.State.Sleeping != r.State.Sleeping {
				t.Fatal("duplicate must not repeat action or replay notification", err)
			}
			if generationDump(t, s) != beforeReplay {
				t.Fatal("duplicate wrote business tables")
			}
			read, err := s.Do(nil, nil, false, at.Add(time.Second))
			if err != nil || read.ReturnRecap == nil || read.ReturnRecap.ID != r.ReturnRecap.ID {
				t.Fatal("replay changed stored record", err)
			}
			assertSnapshotSleep(t, read.ReturnRecap.After, sleeping)
			next, err := s.Visit(at.Add(time.Hour))
			if err != nil || next.ReturnRecap == nil || next.ReturnRecap.ID == r.ReturnRecap.ID {
				t.Fatal("missing next return", err)
			}
			assertSnapshotSleep(t, next.ReturnRecap.Before, !sleeping)
			assertSnapshotSleep(t, next.ReturnRecap.After, !sleeping)
		})
	}
}

func removeSleepContext(t *testing.T, body []byte) []byte {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		t.Fatal(err)
	}
	delete(fields, "sleeping")
	out, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestReturnLegacySleepContextIsUnknownNotAwake(t *testing.T) {
	s, now := recapStore(t)
	var baseline string
	if err := s.db.QueryRow("SELECT baseline FROM visits WHERE id=1").Scan(&baseline); err != nil {
		t.Fatal(err)
	}
	old := removeSleepContext(t, []byte(baseline))
	if _, err := s.db.Exec("UPDATE visits SET baseline=? WHERE id=1", string(old)); err != nil {
		t.Fatal(err)
	}
	r, err := s.Visit(now.Add(time.Hour))
	if err != nil || r.ReturnRecap == nil {
		t.Fatal("missing return", err)
	}
	if r.ReturnRecap.Before.Sleeping != nil {
		t.Fatal("legacy departure fabricated")
	}
	assertSnapshotSleep(t, r.ReturnRecap.After, false)
	// Simulate an old recap with neither endpoint. Reading or changing live
	// mode must not fill historical gaps with the current pet's state.
	r.ReturnRecap.After.Sleeping = nil
	saved, err := json.Marshal(r.ReturnRecap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE visits SET recap=? WHERE id=1", string(saved)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Do(&game.Action{Kind: "sleep"}, nil, false, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(nil, nil, false, now.Add(time.Hour+time.Minute))
	if err != nil || r.ReturnRecap == nil {
		t.Fatal("lost legacy record", err)
	}
	if r.ReturnRecap.Before.Sleeping != nil || r.ReturnRecap.After.Sleeping != nil {
		t.Fatal("legacy recap fabricated")
	}
	// omitempty also leaves unknown endpoints absent in the wire response.
	saved, err = json.Marshal(r.ReturnRecap)
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(saved, &record); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"before", "after"} {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(record[endpoint], &fields); err != nil {
			t.Fatal(err)
		}
		if _, exists := fields["sleeping"]; exists {
			t.Fatal("legacy field backfilled", string(saved))
		}
	}
}

func TestReturnSleepSnapshotDoesNotAliasLiveState(t *testing.T) {
	state := game.New(time.Now())
	state.Sleeping = true
	snapshot := returnSnapshot(state)
	state.Sleeping = false
	assertSnapshotSleep(t, snapshot, true)
}

func TestReturnSleepContextPersistsAcrossRestartAndClaim(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sleep.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	if _, err := s.Do(&game.Action{Kind: "hatch", Species: 2}, nil, false, now); err != nil {
		t.Fatal(err)
	}
	r, err := s.Visit(now.Add(time.Hour))
	if err != nil || r.ReturnRecap == nil {
		t.Fatal("missing persisted recap", err)
	}
	id := r.ReturnRecap.ID
	s.Close()
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s = reopened
	r, err = s.ReadRecap(id, now.Add(time.Hour))
	if err != nil || !r.RecapClaimed || r.ReturnRecap == nil {
		t.Fatal("claim failed", err)
	}
	assertSnapshotSleep(t, r.ReturnRecap.Before, false)
	assertSnapshotSleep(t, r.ReturnRecap.After, false)
	r, err = s.Visit(now.Add(time.Hour + time.Second))
	if err != nil || r.RecapPending || r.ReturnRecap == nil {
		t.Fatal(err)
	}
	assertSnapshotSleep(t, r.ReturnRecap.After, false)
}
