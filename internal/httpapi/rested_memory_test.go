package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestHTTPRestedMemoryIsSavedOnlyOnQualifiedWake(t *testing.T) {
	for _, tc := range []struct {
		name          string
		energy        float64
		unknown, want bool
	}{
		{"recovered", 86, false, true}, {"partly-rested", 40, false, false}, {"full-without-recovery", 100, false, false}, {"imported-sleep", 86, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "rested-http.db")
			db, err := store.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { db.Close() }()
			now := time.Now().Truncate(time.Millisecond)
			h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
			raw := func(path string, body any, condition string, status int) []byte {
				t.Helper()
				method := "GET"
				var input []byte
				if body != nil {
					method = "POST"
					input, _ = json.Marshal(body)
				}
				req := httptest.NewRequest(method, "/api/"+path, bytes.NewReader(input))
				if condition != "" {
					req.Header.Set("X-PixelPet-Sleep-If", condition)
				}
				w := httptest.NewRecorder()
				h.ServeHTTP(w, req)
				if w.Code != status {
					t.Fatalf("%s %d: %s", path, w.Code, w.Body.String())
				}
				return w.Body.Bytes()
			}
			call := func(path string, body any, condition string) store.Result {
				t.Helper()
				var r store.Result
				if err := json.Unmarshal(raw(path, body, condition, 200), &r); err != nil {
					t.Fatal(err)
				}
				return r
			}
			cards := func(s game.State) []game.Memory {
				var out []game.Memory
				for _, m := range s.Album.Entries {
					if m.Kind == "rested" {
						out = append(out, m)
					}
				}
				return out
			}
			seed := game.New(now)
			seed.Apply(game.Action{Kind: "hatch"}, now)
			seed.Needs.Energy = tc.energy
			call("import", seed, "")
			call("action", map[string]any{"kind": "sleep", "requestId": "bed"}, "awake")
			if tc.unknown {
				call("import", json.RawMessage(raw("backup", nil, "", 200)), "")
			}
			now = now.Add(time.Hour)
			before := call("visit", map[string]any{}, "")
			if len(cards(before.State)) != 0 {
				t.Fatal("reading manufactured wake memory")
			}
			raw("action", map[string]any{"kind": "sleep", "requestId": "wrong-intent"}, "awake", 409)
			wake := call("action", map[string]any{"kind": "sleep", "requestId": "wake"}, "sleeping")
			memories := cards(wake.State)
			if (len(memories) == 1) != tc.want || len(memories) > 1 {
				t.Fatal("wrong wake memory", memories)
			}
			if !reflect.DeepEqual(before.State.Growth, wake.State.Growth) || !reflect.DeepEqual(before.State.Economy, wake.State.Economy) || wake.CareFeedback.Points != 0 || wake.CareFeedback.HabitGain != 0 {
				t.Fatal("memory added resources")
			}
			replay := call("action", map[string]any{"kind": "sleep", "requestId": "wake"}, "sleeping")
			if !reflect.DeepEqual(wake.State, replay.State) || !reflect.DeepEqual(wake.CareFeedback, replay.CareFeedback) {
				t.Fatal("idempotent wake changed reply")
			}
			if err = db.Close(); err != nil {
				t.Fatal(err)
			}
			db, err = store.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			h = handlerWithClock(db, t.TempDir(), func() time.Time { return now })
			loaded := call("state", nil, "")
			if !reflect.DeepEqual(memories, cards(loaded.State)) || loaded.CareFeedback != nil {
				t.Fatal("restart changed memory or invented receipt")
			}
			backup := raw("backup", nil, "", 200)
			restored := call("import", json.RawMessage(backup), "")
			if !reflect.DeepEqual(memories, cards(restored.State)) {
				t.Fatal("backup/import lost memory")
			}
			if tc.want {
				bad := restored.State
				album := *bad.Album
				album.Entries = append(append([]game.Memory{}, album.Entries...), memories[0])
				bad.Album = &album
				raw("import", bad, "", 400)
				current := call("state", nil, "")
				if !reflect.DeepEqual(restored.State, current.State) {
					t.Fatal("bad import damaged save")
				}
			}
		})
	}
}
