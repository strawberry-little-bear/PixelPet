package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func restedCards(s game.State) []game.Memory {
	var out []game.Memory
	for _, m := range s.Album.Entries {
		if m.Kind == "rested" {
			out = append(out, m)
		}
	}
	return out
}

func TestRestedMemorySchema17SnapshotAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rested.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	old := game.New(now)
	old.Apply(game.Action{Kind: "hatch"}, now)
	old.Needs.Energy = 86
	old.Apply(game.Action{Kind: "sleep"}, now)
	old.Schema = 17
	if old.Companion != nil {
		old.Companion.History = nil
	}
	body, _ := json.Marshal(old)
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	r, err := db.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	expected := old
	expected.Schema = game.Schema
	expected.Companion = &game.Companion{Since: old.Companion.Since, Interests: old.Companion.Interests, Recent: old.Companion.Recent, History: game.New(now).Companion.History}
	expected.Revision++
	if !reflect.DeepEqual(expected, r.State) || len(restedCards(r.State)) != 0 {
		t.Fatal("migration changed existing sleep/history")
	}
	var snapshot string
	if err = db.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&snapshot); err != nil || snapshot != string(body) {
		t.Fatal("missing exact pre-migration snapshot", err)
	}
	// Poll to full and reopen the DB: neither a read nor a restart earns a wake.
	r, err = db.Do(nil, nil, false, now.Add(time.Hour))
	if err != nil || r.State.Needs.Energy != 100 || len(restedCards(r.State)) != 0 {
		t.Fatal("read earned card", err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	asleep := true
	action := &game.Action{Kind: "sleep", RequestID: "one-wake", ExpectedSleeping: &asleep}
	wake, err := db.Do(action, nil, false, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	first := restedCards(wake.State)
	if len(first) != 1 || first[0].At != now.Add(time.Hour).UnixMilli() || wake.State.Sleeping {
		t.Fatal("missing explicit wake memory")
	}
	replay, err := db.Do(action, nil, false, now.Add(2*time.Hour))
	if err != nil || !reflect.DeepEqual(restedCards(replay.State), first) || !reflect.DeepEqual(replay.CareFeedback, wake.CareFeedback) {
		t.Fatal("replay duplicated or rewrote wake", err)
	}
	// A valid backup preserves memories, but not a live sleep continuity record.
	backup := wake.State
	restored, err := db.Do(nil, &backup, false, now.Add(time.Hour))
	if err != nil || !reflect.DeepEqual(restedCards(restored.State), first) {
		t.Fatal("import lost memory", err)
	}
	// Reject an invalid duplicate before snapshotting or replacing player state.
	bad := backup
	album := *backup.Album
	album.Entries = append(append([]game.Memory{}, album.Entries...), first[0])
	bad.Album = &album
	var before, after int
	db.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&before)
	if _, err = db.Do(nil, &bad, false, now.Add(time.Hour)); err == nil {
		t.Fatal("accepted duplicate memory import")
	}
	db.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&after)
	current, err := db.Do(nil, nil, false, now.Add(time.Hour))
	if err != nil || before != after || !reflect.DeepEqual(restored.State, current.State) {
		t.Fatal("rejected import mutated state", err)
	}
	reset, err := db.Do(nil, nil, true, now.Add(time.Hour))
	if err != nil || len(restedCards(reset.State)) != 0 {
		t.Fatal("reset kept another pet's memory", err)
	}
}

func TestRestedMemoryImportDoesNotAwardUnknownSleepingHistory(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "unknown.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond)
	s := game.New(now)
	s.Apply(game.Action{Kind: "hatch"}, now)
	s.Needs.Energy = 86
	s.Apply(game.Action{Kind: "sleep"}, now)
	s.Advance(now.Add(time.Hour))
	imported, err := db.Do(nil, &s, false, now.Add(time.Hour))
	if err != nil || imported.State.SleepSession != nil {
		t.Fatal(err)
	}
	wake, err := db.Do(&game.Action{Kind: "sleep"}, nil, false, now.Add(time.Hour))
	if err != nil || len(restedCards(wake.State)) != 0 {
		t.Fatal("import invented a rested wake", err)
	}
}

func TestRestedMemoryDoesNotBackfillCachedSchema17Wake(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "cached-old-wake.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond)
	old := game.New(now)
	old.Apply(game.Action{Kind: "hatch"}, now)
	old.Schema = 17
	if old.Companion != nil {
		old.Companion.History = nil
	}
	old.Needs.Energy = 86
	old.Apply(game.Action{Kind: "sleep"}, now)
	now = now.Add(time.Hour)
	old.Advance(now)
	message, feedback, err := old.ApplyWithFeedback(game.Action{Kind: "sleep"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(restedCards(old)) != 0 || old.Needs.Energy != 100 || feedback.SleepSummary.EnergyRecovered <= 0 {
		t.Fatal("not an old qualified wake fixture")
	}
	body, _ := json.Marshal(old)
	cached, _ := json.Marshal(Result{State: old, Message: message, CareFeedback: feedback})
	if _, err = db.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.db.Exec("INSERT INTO requests(id,body) VALUES(?,?)", "old-wake", string(cached)); err != nil {
		t.Fatal(err)
	}
	replay, err := db.Do(&game.Action{Kind: "sleep", RequestID: "old-wake"}, nil, false, now)
	if err != nil || replay.State.Schema != game.Schema || len(restedCards(replay.State)) != 0 || !reflect.DeepEqual(replay.CareFeedback, feedback) {
		t.Fatal("cache migration invented memory or rewrote feedback", err)
	}
	current, err := db.Do(nil, nil, false, now)
	if err != nil || current.State.Schema != game.Schema || len(restedCards(current.State)) != 0 {
		t.Fatal("normal migration backfilled old wake", err)
	}
}
