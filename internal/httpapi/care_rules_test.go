package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestCareRulesHTTPMetadataDoesNotChangeBackups(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "rules.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := Handler(s, t.TempDir())
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "state", ""}, {"POST", "action", `{"kind":"hatch","requestId":"hatch"}`},
		{"POST", "visit", `{}`}, {"POST", "action", `{"kind":"hatch","requestId":"hatch"}`}, {"GET", "backup", ""},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, "/api/"+tc.path, strings.NewReader(tc.body)))
		if w.Code != 200 {
			t.Fatal(tc.path, w.Body.String())
		}
		if tc.path == "backup" {
			var state game.State
			if json.Unmarshal(w.Body.Bytes(), &state) != nil || state.Schema != game.Schema || strings.Contains(w.Body.String(), "careRules") {
				t.Fatal("backup changed", w.Body.String())
			}
		} else {
			var r store.Result
			if json.Unmarshal(w.Body.Bytes(), &r) != nil || r.CareRules != game.CareRuleBook() {
				t.Fatal("rules absent", w.Body.String())
			}
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/action", strings.NewReader(`{"kind":"feed","careRules":{"maxOfflineHours":999}}`)))
	if w.Code != 400 {
		t.Fatal("accepted client-owned rules", w.Body.String())
	}
}
