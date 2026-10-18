package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestFishingRejectsClientCatchesRewardsAndStaleSessions(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "pond.db"))
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
	for _, body := range []string{`{"kind":"hatch","species":1}`, `{"kind":"play-fishing"}`} {
		if r := call(body); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
	}
	before := read()
	id := before.State.Game.ID
	for _, extra := range []string{`,"catches":["moon-perch"]`, `,"score":3`, `,"coins":6`, `,"phase":"done"`, `,"elapsedMs":40000`, `,"fishing":{"phase":"bite"}`, `,"pond":{"fish":[]}`} {
		if r := call(`{"kind":"fish-finish","gameId":"` + id + `","step":0` + extra + `}`); r.Code != 400 {
			t.Fatal("accepted client result", extra)
		}
	}
	for _, body := range []string{`{"kind":"fish-finish","gameId":"` + id + `"}`, `{"kind":"fish-reel","gameId":"` + id + `"}`, `{"kind":"fish-cast","gameId":"stale"}`, `{"kind":"fish-cast","gameId":"` + id + `","step":1}`} {
		if r := call(body); r.Code != 400 {
			t.Fatal("accepted invalid action", body)
		}
	}
	after := read()
	if after.State.Revision != before.State.Revision || after.State.Economy.Coins != 0 || len(after.State.Pond.Fish) != 0 {
		t.Fatal("invalid commands changed pet")
	}
	if r := call(`{"kind":"fish-cast","gameId":"` + id + `","requestId":"same-cast"}`); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := call(`{"kind":"fish-cast","gameId":"` + id + `","requestId":"same-cast"}`); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	after = read()
	if after.State.Game.Fishing.Casts != 1 || after.State.Game.Fishing.Step != 1 || len(after.State.Pond.Fish) != 0 {
		t.Fatal("duplicate cast")
	}
}
