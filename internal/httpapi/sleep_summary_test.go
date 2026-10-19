package httpapi

import (
	"bytes"
	"encoding/json"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
	"math"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestHTTPSleepSummaryIncludesPollingAndOriginalWakeOnReplay(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "sleep-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().Truncate(time.Millisecond)
	start := now
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	call := func(path, body, condition string) store.Result {
		t.Helper()
		method := "POST"
		if body == "" {
			method = "GET"
		}
		req := httptest.NewRequest(method, "/api/"+path, bytes.NewBufferString(body))
		if condition != "" {
			req.Header.Set("X-PixelPet-Sleep-If", condition)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("%s %d %s", path, w.Code, w.Body.String())
		}
		var r store.Result
		if err := json.Unmarshal(w.Body.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	call("action", `{"kind":"hatch","species":2}`, "")
	bed := call("action", `{"kind":"sleep","requestId":"bed"}`, "awake")
	for i := 1; i <= 3; i++ {
		now = start.Add(time.Duration(i) * 20 * time.Minute)
		r := call("visit", `{}`, "")
		if r.CareFeedback != nil || r.State.SleepSession == nil {
			t.Fatal("read manufactured wake receipt")
		}
	}
	wake := call("action", `{"kind":"sleep","requestId":"wake"}`, "sleeping")
	r := wake.CareFeedback.SleepSummary
	if r == nil || r.StartedAt != bed.State.SleepSession.StartedAt || r.WokeAt != now.UnixMilli() || r.SettledHours != 1 {
		t.Fatalf("HTTP lost session %+v", r)
	}
	if math.Abs(r.EnergyRecovered-14) > 1e-8 || math.Abs(r.RestGain-.5) > 1e-8 || wake.CareFeedback.Points != 0 || wake.CareFeedback.HabitGain != 0 || wake.State.SleepSession != nil {
		t.Fatalf("incorrect response %+v", wake.CareFeedback)
	}
	now = now.Add(time.Hour)
	replay := call("action", `{"kind":"sleep","requestId":"wake"}`, "sleeping")
	if *replay.CareFeedback.SleepSummary != *r || replay.CareFeedback.Effect.At != r.WokeAt {
		t.Fatal("replay rewrote historical wake")
	}
	state := call("state", "", "")
	if state.CareFeedback != nil || state.State.SleepSession != nil || state.State.Sleeping {
		t.Fatal("ordinary read rebuilt wake")
	}
}
