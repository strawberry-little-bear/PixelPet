package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestAPIFlowAndOriginProtection(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "pet.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := Handler(db, t.TempDir())
	call := func(method, path, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call("GET", "/api/state", "", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("POST", "/api/action", `{"kind":"hatch","species":1}`, "https://foreign.example"); w.Code != 403 {
		t.Fatal("cross-origin write accepted")
	}
	if w := call("POST", "/api/action", `{"kind":"hatch","species":1}`, ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for _, path := range []string{"/api/visit", "/api/recap/read"} {
		body := `{}`
		if path == "/api/recap/read" {
			body = `{"id":"not-pending"}`
		}
		if w := call("POST", path, body, "https://foreign.example"); w.Code != 403 {
			t.Fatal("cross-origin presence accepted", path)
		}
		if w := call("POST", path, body, ""); w.Code != 200 {
			t.Fatal(path, w.Body.String())
		}
		if w := call("POST", path, `{"unknown":true}`, ""); w.Code != 400 {
			t.Fatal("invalid presence accepted", path)
		}
	}
	if w := call("POST", "/api/recap/read", `{"id":""}`, ""); w.Code != 400 {
		t.Fatal("empty recap ID accepted")
	}
	backup := call("GET", "/api/backup", "", "")
	var state game.State
	if err = json.Unmarshal(backup.Body.Bytes(), &state); err != nil || state.Species != 1 || state.HatchedAt == 0 {
		t.Fatal("invalid backup")
	}
	if w := call("POST", "/api/import", `{"schema":99}`, ""); w.Code != 400 {
		t.Fatal("invalid save accepted")
	}
	if w := call("POST", "/api/reset", `{"confirm":false}`, ""); w.Code != 400 {
		t.Fatal("unconfirmed reset accepted")
	}
	if w := call("POST", "/api/action", `{"kind":"feed"} {}`, ""); w.Code != 400 {
		t.Fatal("trailing payload accepted")
	}
	if w := call("GET", "/api/unknown", "", ""); w.Code != 404 {
		t.Fatal("unknown API fell through")
	}
}

func TestShopAPIRejectsClientPricesScoresAndForeignWrites(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "shop.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := Handler(db, t.TempDir())
	call := func(body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/action", bytes.NewBufferString(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, body := range []string{`{"kind":"hatch","species":2}`, `{"kind":"daily","requestId":"today"}`} {
		if w := call(body, ""); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	for _, body := range []string{
		`{"kind":"daily","coins":10000}`, `{"kind":"daily","day":"2099-01-01"}`,
		`{"kind":"buy","item":"leaf-pin","price":0}`, `{"kind":"catch","score":5}`,
		`{"kind":"buy","item":"not-real"}`, `{"kind":"equip","item":"leaf-pin"}`,
		`{"kind":"catch","lane":1}`, `{"kind":"daily"}`,
	} {
		if w := call(body, ""); w.Code != 400 {
			t.Fatal("accepted unsafe action", body, w.Body.String())
		}
	}
	if w := call(`{"kind":"buy","item":"leaf-pin"}`, "https://foreign.example"); w.Code != 403 {
		t.Fatal("foreign shop mutation accepted")
	}
	r := httptest.NewRequest("GET", "/api/backup", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var state game.State
	json.Unmarshal(w.Body.Bytes(), &state)
	if state.Economy.Coins != game.DailyCoins || len(state.Economy.Owned) != 0 {
		t.Fatal("rejected actions changed wallet", state)
	}
}
