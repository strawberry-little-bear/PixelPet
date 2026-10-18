package httpapi

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestClockAheadHTTPProtectsSaveAndAllowsCatchUp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "clock.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	state := game.New(time.Now().Add(time.Hour))
	encoded, _ := json.Marshal(state)
	if _, err = raw.Exec("UPDATE saves SET body=?", string(encoded)); err != nil {
		t.Fatal(err)
	}
	h := Handler(db, t.TempDir())
	nowBackup, _ := json.Marshal(game.New(time.Now()))
	for _, request := range []struct{ method, path, body string }{
		{"GET", "/api/state", ""}, {"GET", "/api/backup", ""}, {"POST", "/api/visit", "{}"},
		{"POST", "/api/recap/read", `{"id":"recap"}`}, {"POST", "/api/action", `{"kind":"hatch","requestId":"clock"}`},
		{"POST", "/api/import", string(nowBackup)}, {"POST", "/api/reset", `{"confirm":true}`},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(request.method, request.path, bytes.NewBufferString(request.body)))
		var body map[string]string
		if w.Code != 409 || json.Unmarshal(w.Body.Bytes(), &body) != nil || body["code"] != "clock_ahead" {
			t.Fatal(request.path, w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Disposition") != "" {
			t.Fatal("clock diagnosis must not download/cache a backup")
		}
	}
	var actual string
	raw.QueryRow("SELECT body FROM saves").Scan(&actual)
	if actual != string(encoded) {
		t.Fatal("blocked endpoint changed original save")
	}
	for _, table := range []string{"requests", "snapshots", "visits"} {
		var count int
		raw.QueryRow("SELECT count(*) FROM " + table).Scan(&count)
		if count != 0 {
			t.Fatal("blocked endpoint wrote", table)
		}
	}
	// Simulate a corrected service clock without modifying machine time.
	state = game.New(time.Now().Add(-time.Second))
	encoded, _ = json.Marshal(state)
	raw.Exec("UPDATE saves SET body=?", string(encoded))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
	if w.Code != 200 {
		t.Fatal("valid read after correction", w.Code, w.Body.String())
	}
}
