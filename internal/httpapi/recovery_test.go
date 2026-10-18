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

func TestCorruptSaveHTTPDiagnosisAndRepair(t *testing.T) {
	path := filepath.Join(t.TempDir(), "repair.db")
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
	if _, err = raw.Exec("UPDATE saves SET body='broken' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	h := Handler(db, t.TempDir())
	call := func(method, path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewBufferString(body)))
		return w
	}
	for _, request := range []struct{ method, path, body string }{{"GET", "/api/state", ""}, {"GET", "/api/backup", ""}, {"POST", "/api/visit", "{}"}, {"POST", "/api/action", `{"kind":"hatch"}`}} {
		w := call(request.method, request.path, request.body)
		var body map[string]string
		if w.Code != 409 || json.Unmarshal(w.Body.Bytes(), &body) != nil || body["code"] != "save_corrupt" {
			t.Fatal("missing recoverable diagnosis", w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("diagnosis cached")
		}
	}
	for _, path := range []string{"/api/import", "/api/reset"} {
		w := call("POST", path, `{}`)
		if w.Code != 400 || bytes.Contains(w.Body.Bytes(), []byte(`"save_corrupt"`)) {
			t.Fatal("invalid replacement enabled repair", w.Code, w.Body.String())
		}
	}
	backup := game.New(time.Now())
	payload, _ := json.Marshal(backup)
	w := call("POST", "/api/import", string(payload))
	if w.Code != 200 {
		t.Fatal("could not repair", w.Code, w.Body.String())
	}
	if w = call("GET", "/api/state", ""); w.Code != 200 {
		t.Fatal("repaired save unavailable")
	}
	var original string
	if err = raw.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&original); err != nil || original != "broken" {
		t.Fatal("original snapshot missing", err, original)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	w = call("GET", "/api/state", "")
	if w.Code == 409 || bytes.Contains(w.Body.Bytes(), []byte(`"save_corrupt"`)) {
		t.Fatal("database failure confused with recoverable JSON corruption", w.Code, w.Body.String())
	}
}
