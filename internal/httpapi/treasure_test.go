package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestTreasureHTTPJourneyRejectsClientScoresStaleStepsAndDuplicateAwards(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "treasure.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond)
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	var r store.Result
	call := func(path, body string, headers map[string]string) *httptest.ResponseRecorder {
		method := "POST"
		if body == "" {
			method = "GET"
		}
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	success := func(body string) {
		t.Helper()
		w := call("/api/action", body, nil)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		r = store.Result{}
		if err = json.Unmarshal(w.Body.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
	}
	success(`{"kind":"hatch"}`)
	success(`{"kind":"play-treasure"}`)
	id := r.State.Game.ID
	generation := r.SaveGeneration
	revision := r.State.Revision
	for _, extra := range []string{`"score":9`, `"coins":99`, `"found":3`, `"layout":[1,2,3,0,0,0,0,0,0]`, `"opened":[0,1,2]`, `"treasure":{"paused":false}`, `"baseCoins":6`} {
		w := call("/api/action", `{"kind":"treasure-finish","gameId":"`+id+`",`+extra+`}`, nil)
		if w.Code != 400 {
			t.Fatal("injected result accepted", extra, w.Code)
		}
	}
	for _, body := range []string{
		`{"kind":"treasure-dig","gameId":"` + id + `","tile":0}`,
		`{"kind":"treasure-finish","gameId":"` + id + `"}`,
		`{"kind":"treasure-resume","gameId":"old"}`,
		`{"kind":"treasure-resume","gameId":"` + id + `","step":1}`,
	} {
		if w := call("/api/action", body, nil); w.Code != 400 {
			t.Fatal("invalid command", body, w.Code)
		}
	}
	w := call("/api/state", "", nil)
	json.Unmarshal(w.Body.Bytes(), &r)
	if r.State.Revision != revision || r.State.CareCount != 0 {
		t.Fatal("rejected command mutated save")
	}
	success(`{"kind":"treasure-resume","gameId":"` + id + `"}`)
	for i := 0; !r.State.Game.AwaitingFinish(); i++ {
		success(fmt.Sprintf(`{"kind":"treasure-dig","gameId":%q,"step":%d,"tile":%d}`, id, r.State.Game.Treasure.Step, i))
	}
	if r.State.CareCount != 0 || r.State.Economy.Coins != 0 {
		t.Fatal("auto-awarded")
	}
	found := 0
	for _, i := range r.State.Game.Treasure.Opened {
		if r.State.Game.Treasure.Layout[i] > 0 {
			found++
		}
	}
	if w := call("/api/action", `{"kind":"cancel-play","gameId":"`+id+`"}`, map[string]string{"X-PixelPet-Cancel-If": "unfinished"}); w.Code != 409 {
		t.Fatal("stale abandon", w.Code, w.Body.String())
	}
	finish := fmt.Sprintf(`{"kind":"treasure-finish","gameId":%q,"step":%d,"requestId":"finish-once"}`, id, r.State.Game.Treasure.Step)
	success(finish)
	if r.State.Game != nil || r.State.CareCount != 1 || r.State.Economy.Coins != 3+found || r.CareFeedback == nil || r.CareFeedback.Kind != "treasure-finish" {
		t.Fatal("bad reward", r)
	}
	revision = r.State.Revision
	success(finish)
	if r.State.Revision != revision {
		t.Fatal("duplicate reward")
	}
	// Restore the valid portable state: no uncollected game or old intent crosses generation.
	backup, _ := json.Marshal(r.State)
	if w := call("/api/import", string(backup), nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("/api/action", `{"kind":"play-treasure"}`, map[string]string{"X-PixelPet-Generation": generation}); w.Code != 409 {
		t.Fatal("stale generation", w.Code, w.Body.String())
	}
}
