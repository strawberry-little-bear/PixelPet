package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestWalkingRejectsClientDiscoveriesRewardsAndStaleSessions(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "walk.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	handler := Handler(db, t.TempDir())
	call := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/action", bytes.NewBufferString(body)))
		return w
	}
	read := func() store.Result {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var r store.Result
		json.Unmarshal(w.Body.Bytes(), &r)
		return r
	}
	for _, body := range []string{`{"kind":"hatch","species":1}`, `{"kind":"play-walk"}`} {
		if r := call(body); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	before := read()
	id := before.State.Game.ID
	for _, extra := range []string{` ,"trail":"pond"`, ` ,"beat":72`, ` ,"cleared":12`, ` ,"souvenirs":["leaf"]`, ` ,"park":{"finds":[]}`, `,"catches":["moon-perch"]`, `,"score":3`, `,"coins":6`, `,"phase":"done"`, `,"elapsedMs":40000`, `,"fishing":{"phase":"bite"}`, `,"pond":{"fish":[]}`} {
		if r := call(`{"kind":"walk-finish","gameId":"` + id + `","step":0` + extra + `}`); r.Code != 400 {
			t.Fatal("accepted client result", extra)
		}
	}
	for _, body := range []string{`{"kind":"walk-finish","gameId":"` + id + `"}`, `{"kind":"walk-jump","gameId":"` + id + `"}`, `{"kind":"walk-resume","gameId":"stale"}`, `{"kind":"walk-resume","gameId":"` + id + `","step":1}`} {
		if r := call(body); r.Code != 400 {
			t.Fatal("accepted invalid action", body)
		}
	}
	after := read()
	if after.State.Revision != before.State.Revision || after.State.Economy.Coins != 0 || len(after.State.Park.Finds) != 0 {
		t.Fatal("invalid commands changed pet")
	}
	if r := call(`{"kind":"walk-resume","gameId":"` + id + `","requestId":"same-resume"}`); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := call(`{"kind":"walk-resume","gameId":"` + id + `","requestId":"same-resume"}`); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	after = read()
	if after.State.Game.Walking.Beat != 0 || after.State.Game.Walking.Step != 1 || len(after.State.Park.Finds) != 0 {
		t.Fatal("duplicate cast")
	}
}

func TestWalkingTrailHTTPChoiceUsesSessionAndServerFinds(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "trail.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := Handler(db, t.TempDir())
	call := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/action", bytes.NewBufferString(body)))
		return w
	}
	for _, body := range []string{`{"kind":"hatch","species":2}`, `{"kind":"play-walk"}`} {
		if w := call(body); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
	var before store.Result
	json.Unmarshal(w.Body.Bytes(), &before)
	id := before.State.Game.ID
	for _, body := range []string{
		`{"kind":"walk-trail","item":"pond","gameId":"stale"}`,
		`{"kind":"walk-trail","item":"pond","gameId":"` + id + `","step":1}`,
		`{"kind":"walk-trail","item":"unknown","gameId":"` + id + `"}`,
		`{"kind":"walk-trail","item":"pond","gameId":"` + id + `","souvenirs":["shell","shell","shell"]}`,
	} {
		if w := call(body); w.Code != 400 {
			t.Fatal("invalid choice accepted", body, w.Body.String())
		}
	}
	body := `{"kind":"walk-trail","item":"pond","gameId":"` + id + `","requestId":"pond-once"}`
	first := call(body)
	if first.Code != 200 {
		t.Fatal(first.Body.String())
	}
	second := call(body)
	if second.Code != 200 {
		t.Fatal(second.Body.String())
	}
	var a, b store.Result
	json.Unmarshal(first.Body.Bytes(), &a)
	json.Unmarshal(second.Body.Bytes(), &b)
	if a.State.Revision != b.State.Revision || a.State.Game.Walking.Trail != "pond" || a.State.Game.Walking.Beat != 0 || !a.State.Game.Walking.Paused || len(a.State.Park.Finds) != 0 {
		t.Fatal("duplicate advanced route")
	}
	for _, find := range b.State.Game.Walking.Souvenirs {
		if find != "shell" && find != "pebble" && find != "feather" {
			t.Fatal("invalid find", find)
		}
	}
}
