package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestSleepPreconditionRejectsReversedIntent(t *testing.T) {
	for _, sleeping := range []bool{false, true} {
		t.Run(map[bool]string{false: "stale-wake", true: "stale-bedtime"}[sleeping], func(t *testing.T) {
			db, err := store.Open(filepath.Join(t.TempDir(), "sleep.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			h := Handler(db, t.TempDir())
			call := func(body, condition string) *httptest.ResponseRecorder {
				r := httptest.NewRequest("POST", "/api/action", bytes.NewBufferString(body))
				if condition != "" {
					r.Header.Set("X-PixelPet-Sleep-If", condition)
				}
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				return w
			}
			if w := call(`{"kind":"hatch","species":2}`, ""); w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			if sleeping {
				if w := call(`{"kind":"sleep"}`, ""); w.Code != 200 {
					t.Fatal(w.Body.String())
				}
			}
			stale := map[bool]string{false: "sleeping", true: "awake"}[sleeping]
			w := call(`{"kind":"sleep","requestId":"stale-sleep"}`, stale)
			var failure map[string]string
			json.Unmarshal(w.Body.Bytes(), &failure)
			if w.Code != 409 || failure["code"] != "sleep_changed" {
				t.Fatalf("opposite intention executed: %d %s", w.Code, w.Body.String())
			}
			// A correctly re-selected action works; legacy callers keep their toggle.
			current := map[bool]string{false: "awake", true: "sleeping"}[sleeping]
			if w = call(`{"kind":"sleep","requestId":"fresh-sleep"}`, current); w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			var result store.Result
			json.Unmarshal(w.Body.Bytes(), &result)
			if result.State.Sleeping == sleeping {
				t.Fatal("fresh intent not applied")
			}
			if w = call(`{"kind":"sleep"}`, ""); w.Code != 200 {
				t.Fatal(w.Body.String())
			}
		})
	}
}

func TestSleepPreconditionRejectsInvalidTransportUsage(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "sleep.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := Handler(db, t.TempDir())
	for _, tc := range []struct{ kind, condition string }{{"sleep", "yes"}, {"sleep", "false"}, {"feed", "awake"}, {"hatch", "sleeping"}} {
		r := httptest.NewRequest("POST", "/api/action", bytes.NewBufferString(`{"kind":"`+tc.kind+`"}`))
		r.Header.Set("X-PixelPet-Sleep-If", tc.condition)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("accepted invalid sleep header %s/%s: %d", tc.kind, tc.condition, w.Code)
		}
	}
}
