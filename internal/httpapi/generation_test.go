package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

// A backup may retain the exact same pet timestamps/species. Old-page intent
// must not be silently applied to that restored save, even before its next poll.
func TestOldPageCannotMutateAReplacedSave(t *testing.T) {
	for _, target := range []string{"feed", "reset", "import", "recap", "play"} {
		t.Run(target, func(t *testing.T) {
			s, err := store.Open(filepath.Join(t.TempDir(), "save.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			h := Handler(s, t.TempDir())
			call := func(path, body, generation string) *httptest.ResponseRecorder {
				r := httptest.NewRequest("POST", "/api/"+path, strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				if generation != "" {
					r.Header.Set("X-PixelPet-Generation", generation)
				}
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				return w
			}
			if w := call("action", `{"kind":"hatch","species":2}`, ""); w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			before, err := s.Do(nil, nil, false, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(before)
			var metadata struct {
				Generation string `json:"saveGeneration"`
			}
			json.Unmarshal(encoded, &metadata)
			generation := metadata.Generation
			if generation == "" {
				generation = strings.Repeat("a", 32)
			}
			backup, _ := json.Marshal(before.State)
			if w := call("import", string(backup), generation); w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			current, err := s.Do(nil, nil, false, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			path, body := "action", `{"kind":"feed","requestId":"stale-intent"}`
			switch target {
			case "reset":
				path, body = "reset", `{"confirm":true}`
			case "import":
				path, body = "import", string(backup)
			case "recap":
				path, body = "recap/read", `{"id":"old-recap"}`
			case "play":
				body = `{"kind":"play-tiles","requestId":"stale-game"}`
			}
			w := call(path, body, generation)
			if w.Code != 409 {
				t.Fatalf("stale %s was accepted: status=%d body=%s", target, w.Code, w.Body.String())
			}
			var failure struct {
				Code string `json:"code"`
			}
			json.Unmarshal(w.Body.Bytes(), &failure)
			if failure.Code != "save_changed" {
				t.Fatalf("wrong conflict: %s", w.Body.String())
			}
			after, err := s.Do(nil, nil, false, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if after.State.Revision != current.State.Revision || after.State.CareCount != current.State.CareCount || after.State.HatchedAt != current.State.HatchedAt || after.State.Game != nil {
				t.Fatal("rejected stale request changed the new save")
			}
			if metadata.Generation == "" {
				t.Fatal("missing save generation")
			}
			// The original portable backup is still a normal versioned pet state.
			var legacy game.State
			if err = json.Unmarshal(backup, &legacy); err != nil || legacy.Schema != game.Schema {
				t.Fatal("backup format changed")
			}
		})
	}
}

func TestGenerationHTTPBoundaryAndLegacyCompatibility(t *testing.T) {
	path := filepath.Join(t.TempDir(), "boundary.db")
	s, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := Handler(s, t.TempDir())
	call := func(method, path, body, generation, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/"+path, strings.NewReader(body))
		if generation != "" {
			r.Header.Set("X-PixelPet-Generation", generation)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	initial := call("GET", "state", "", "", "")
	var metadata struct {
		SaveGeneration string `json:"saveGeneration"`
		Code           string `json:"code"`
	}
	if initial.Code != 200 || json.Unmarshal(initial.Body.Bytes(), &metadata) != nil || len(metadata.SaveGeneration) != 32 {
		t.Fatal(initial.Body.String())
	}
	generation := metadata.SaveGeneration
	before := call("GET", "backup", "", "", "").Body.String()
	for _, token := range []string{"short", strings.Repeat("g", 32), strings.Repeat("a", 31), strings.Repeat("a", 34)} {
		for _, endpoint := range []struct{ path, body string }{
			{"action", `{"kind":"hatch","species":2}`}, {"reset", `{"confirm":true}`}, {"import", before}, {"recap/read", `{"id":"old"}`}, {"visit", `{}`},
		} {
			if w := call("POST", endpoint.path, endpoint.body, token, ""); w.Code != 400 {
				t.Fatalf("%s accepted malformed generation %q: %s", endpoint.path, token, w.Body.String())
			}
		}
	}
	if after := call("GET", "backup", "", "", "").Body.String(); after != before {
		t.Fatal("malformed header mutated save")
	}
	if w := call("POST", "action", `{"kind":"hatch","species":2}`, generation, "https://foreign.example"); w.Code != 403 {
		t.Fatal("generation bypassed origin protection")
	}
	if w := call("POST", "action", `{"kind":"hatch","species":2}`, generation, ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	// Older clients omit the header; that compatibility deliberately has no guard.
	if w := call("POST", "action", `{"kind":"feed"}`, "", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	reset := call("POST", "reset", `{"confirm":true}`, generation, "")
	if reset.Code != 200 || json.Unmarshal(reset.Body.Bytes(), &metadata) != nil || metadata.SaveGeneration == generation {
		t.Fatal("reset did not rotate metadata", reset.Body.String())
	}
	current := metadata.SaveGeneration
	// Presence must remain able to discover the current save even from an old page.
	if w := call("POST", "visit", `{}`, generation, ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	stale := call("POST", "action", `{"kind":"hatch","species":2}`, generation, "")
	if stale.Code != 409 || json.Unmarshal(stale.Body.Bytes(), &metadata) != nil || metadata.Code != "save_changed" || metadata.SaveGeneration != current {
		t.Fatal("missing typed conflict metadata", stale.Body.String())
	}
	// A first-load corrupt diagnosis still scopes an explicit repair.
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err = raw.Exec(`UPDATE saves SET body='{"schema":11,"revision":"broken"}' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	corrupt := call("GET", "state", "", "", "")
	if corrupt.Code != 409 || json.Unmarshal(corrupt.Body.Bytes(), &metadata) != nil || metadata.Code != "save_corrupt" || metadata.SaveGeneration != current {
		t.Fatal("missing corrupt repair metadata", corrupt.Body.String())
	}
	repaired := call("POST", "reset", `{"confirm":true}`, current, "")
	if repaired.Code != 200 || json.Unmarshal(repaired.Body.Bytes(), &metadata) != nil || metadata.SaveGeneration == current {
		t.Fatal("guarded repair failed", repaired.Body.String())
	}
}
