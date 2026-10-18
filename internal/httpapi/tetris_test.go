package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestTetrisRejectsSubmittedBoardScoresAndStaleSessions(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "tetris.db"))
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
	for _, body := range []string{`{"kind":"hatch","species":2}`, `{"kind":"play-tetris"}`} {
		if w := call(body); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
	var before store.Result
	json.Unmarshal(w.Body.Bytes(), &before)
	id := before.State.Game.ID
	for _, extra := range []string{`,"score":8`, `,"lines":8`, `,"coins":6`, `,"board":[]`, `,"active":{"x":1,"y":1}`, `,"tetris":{"end":"won"}`} {
		if r := call(`{"kind":"tetris-finish","gameId":"` + id + `","step":0` + extra + `}`); r.Code != 400 {
			t.Fatal("accepted client result", extra)
		}
	}
	for _, body := range []string{`{"kind":"tetris-finish","gameId":"` + id + `"}`, `{"kind":"tetris-resume","gameId":"stale"}`, `{"kind":"tetris-resume","gameId":"` + id + `","step":1}`} {
		if r := call(body); r.Code != 400 {
			t.Fatal("invalid action accepted", body)
		}
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/state", nil))
	var after store.Result
	json.Unmarshal(w.Body.Bytes(), &after)
	if after.State.Revision != before.State.Revision || after.State.Game.ID != id || after.State.Economy.Coins != 0 || after.State.Game.Tetris.Lines != 0 {
		t.Fatal("invalid request changed session")
	}
}
