package httpapi

import (
	"database/sql"
	"encoding/json"
	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestSnapshotListStartsEmpty(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "snapshots.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return time.Now() })
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/snapshots", nil))
	if w.Code != 200 {
		t.Fatalf("recovery points are inaccessible: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Snapshots []json.RawMessage `json:"snapshots"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Snapshots == nil || len(body.Snapshots) != 0 {
		t.Fatalf("expected an explicit empty list: %s %v", w.Body.String(), err)
	}
}

func TestSnapshotHTTPPreviewAndOrdinaryConfirmation(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "flow.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now()
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	call := func(method, path, body, generation string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("X-PixelPet-Generation", generation)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	initial, err := db.Do(&game.Action{Kind: "hatch", Species: 2}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	current, err := db.DoForGeneration(nil, nil, true, now, initial.SaveGeneration)
	if err != nil {
		t.Fatal(err)
	}
	list := call("GET", "/api/snapshots", "", "")
	var envelope struct {
		Snapshots []store.Snapshot `json:"snapshots"`
	}
	if err = json.Unmarshal(list.Body.Bytes(), &envelope); err != nil || len(envelope.Snapshots) != 1 {
		t.Fatal(list.Body.String(), err)
	}
	preview := call("GET", "/api/snapshots/"+envelope.Snapshots[0].ID, "", "")
	expected, _ := json.Marshal(initial.State)
	if preview.Code != 200 || preview.Body.String() != string(expected) || preview.Header().Get("Cache-Control") != "no-store" || !strings.Contains(preview.Header().Get("Content-Type"), "application/json") {
		t.Fatal(preview)
	}
	unchanged, err := db.Do(nil, nil, false, now)
	if err != nil || unchanged.State.HatchedAt != 0 || unchanged.SaveGeneration != current.SaveGeneration {
		t.Fatal("GET replaced save", err)
	}
	rejected := call("POST", "/api/import", preview.Body.String(), initial.SaveGeneration)
	if rejected.Code != 409 {
		t.Fatal("stale confirmation accepted", rejected)
	}
	accepted := call("POST", "/api/import", preview.Body.String(), current.SaveGeneration)
	if accepted.Code != 200 {
		t.Fatal(accepted.Body.String())
	}
	var restored store.Result
	if err = json.Unmarshal(accepted.Body.Bytes(), &restored); err != nil || restored.State.HatchedAt == 0 || restored.SaveGeneration == current.SaveGeneration {
		t.Fatal(accepted.Body.String(), err)
	}
}
func TestSnapshotHTTPUnavailableMissingAndInvalidIDs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "errors.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now()
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err = conn.Exec("INSERT INTO snapshots(body,created_at) VALUES(?,?)", "broken", now.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	unavailable := httptest.NewRecorder()
	h.ServeHTTP(unavailable, httptest.NewRequest("GET", "/api/snapshots/1", nil))
	if unavailable.Code != 409 || unavailable.Header().Get("Cache-Control") != "no-store" || !strings.Contains(unavailable.Body.String(), "原始内容仍保留") {
		t.Fatal(unavailable)
	}
	for _, id := range []string{"0", "-1", "01", "1.0", "abc", "9223372036854775808", "999"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/snapshots/"+id, nil))
		want := 400
		if id == "999" {
			want = 404
		}
		if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(id, w.Code, w.Header())
		}
	}
}
