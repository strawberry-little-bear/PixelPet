package store

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestCareRulesMetadataIsFreshAndNotPortable(t *testing.T) {
	s, now := generationDB(t)
	check := func(r Result, err error) Result {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		if r.CareRules != game.CareRuleBook() {
			t.Fatalf("missing/current rules: %+v", r.CareRules)
		}
		raw, err := json.Marshal(r.State)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "careRules") || r.State.Schema != game.Schema {
			t.Fatal("rules leaked into save")
		}
		return r
	}
	check(s.Do(nil, nil, false, now))
	hatch := game.Action{Kind: "hatch", RequestID: "rules-hatch"}
	r := check(s.Do(&hatch, nil, false, now))
	check(s.Visit(now))
	// Old cache entries omit rules, and stale metadata must never become the
	// current rule book. Refresh response metadata without rewriting cached rows.
	var cached string
	if err := s.db.QueryRow("SELECT body FROM requests WHERE id=?", hatch.RequestID).Scan(&cached); err != nil {
		t.Fatal(err)
	}
	var legacy map[string]json.RawMessage
	if err := json.Unmarshal([]byte(cached), &legacy); err != nil {
		t.Fatal(err)
	}
	for _, body := range []json.RawMessage{nil, json.RawMessage(`{"awake":{"energy":999},"maxOfflineHours":1}`)} {
		if body == nil {
			delete(legacy, "careRules")
		} else {
			legacy["careRules"] = body
		}
		encoded, err := json.Marshal(legacy)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.db.Exec("UPDATE requests SET body=? WHERE id=?", string(encoded), hatch.RequestID); err != nil {
			t.Fatal(err)
		}
		before := generationDump(t, s)
		check(s.Do(&hatch, nil, false, now))
		if generationDump(t, s) != before {
			t.Fatal("metadata refresh rewrote persisted cache/save")
		}
	}
	portable := r.State
	check(s.Do(nil, &portable, false, now))
	check(s.Do(nil, nil, true, now))
}

// The new optional action metadata also replaces stale/missing values in a
// cached idempotent reply without rerunning or editing the original action.
func TestActionRulesReplayUsesCurrentMetadata(t *testing.T) {
	s, now := generationDB(t)
	hatch := game.Action{Kind: "hatch", RequestID: "action-rules-hatch"}
	original, err := s.Do(&hatch, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	var cached string
	if err = s.db.QueryRow("SELECT body FROM requests WHERE id=?", hatch.RequestID).Scan(&cached); err != nil {
		t.Fatal(err)
	}
	var legacy map[string]json.RawMessage
	if err = json.Unmarshal([]byte(cached), &legacy); err != nil {
		t.Fatal(err)
	}
	for _, actions := range []string{`null`, `{"feed":{"hunger":999}}`} {
		legacy["careRules"] = json.RawMessage(`{"awake":{"hunger":-3},"actions":` + actions + `}`)
		encoded, _ := json.Marshal(legacy)
		if _, err = s.db.Exec("UPDATE requests SET body=? WHERE id=?", string(encoded), hatch.RequestID); err != nil {
			t.Fatal(err)
		}
		before := generationDump(t, s)
		got, err := s.Do(&hatch, nil, false, now)
		if err != nil || got.CareRules.Actions != game.CareRuleBook().Actions || got.State.Revision != original.State.Revision {
			t.Fatalf("replay %+v, %v", got, err)
		}
		if generationDump(t, s) != before {
			t.Fatal("metadata refresh rewrote save/cache")
		}
	}
}
