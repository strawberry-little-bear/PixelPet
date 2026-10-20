package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestHTTPCareDiaryPersistsActualLearningWithoutReplayOrExtraEntries(t *testing.T) {
	var now time.Time
	path := filepath.Join(t.TempDir(), "care-diary.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now = time.Now().Truncate(time.Millisecond)
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	raw := func(path string, body any, status int) []byte {
		t.Helper()
		var input []byte
		method := "GET"
		if body != nil {
			method = "POST"
			var err error
			input, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(method, "/api/"+path, bytes.NewReader(input)))
		if w.Code != status {
			t.Fatalf("%s %d: %s", path, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	call := func(path string, body any) store.Result {
		t.Helper()
		var r store.Result
		if err := json.Unmarshal(raw(path, body, 200), &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := call("action", map[string]any{"kind": "hatch", "species": 2})
	// Controlled valid legacy need/history fixture, not naturally low needs.
	seed := r.State
	seed.Needs.Hunger, seed.Needs.Clean = 20, 0
	seed.Logs = []game.Log{{At: now.UnixMilli(), Text: "旧日记保持原文。"}}
	r = call("import", seed)
	for _, tc := range []struct{ kind, id, reason, needs string }{
		{"feed", "first-feed", "credited", "饱食+20.00、心情+3.00"}, {"feed", "second-feed", "cooldown", "饱食+20.00、心情+3.00"}, {"feed", "third-feed", "cooldown", "饱食+20.00、心情+3.00"}, {"feed", "fourth-feed", "not-needed", "饱食+20.00、心情+3.00"},
		{"clean", "first-clean", "credited", "心情+4.00、清洁+35.00"}, {"clean", "second-clean", "cooldown", "心情+4.00、清洁+35.00"}, {"clean", "third-clean", "not-needed", "清洁+30.00"},
	} {
		before := r.State.Logs
		action := map[string]any{"kind": tc.kind, "requestId": tc.id}
		r = call("action", action)
		f := r.CareFeedback
		if f == nil || f.Reason != tc.reason {
			t.Fatal(tc, f)
		}
		if len(r.State.Logs) != len(before)+1 || !reflect.DeepEqual(r.State.Logs[1:], before) {
			t.Fatal("not one new log or rewrote old history")
		}
		if !strings.HasPrefix(r.State.Logs[0].Text, r.Message) || !strings.Contains(r.State.Logs[0].Text, "本次成长 +") {
			t.Fatal("missing learning", r.State.Logs)
		}
		if !strings.Contains(r.State.Logs[0].Text, "即时需求："+tc.needs+"（不含时间结算）。") {
			t.Fatal("wrong persisted actual need effect", tc, r.State.Logs[0])
		}
		replay := call("action", action)
		if !reflect.DeepEqual(replay.State.Logs, r.State.Logs) || !reflect.DeepEqual(replay.CareFeedback, f) {
			t.Fatal("replay changed acknowledgement")
		}
		read := call("state", nil)
		if !reflect.DeepEqual(read.State.Logs, r.State.Logs) || read.CareFeedback != nil {
			t.Fatal("read invented care")
		}
	}
	logs := r.State.Logs
	raw("action", map[string]any{"kind": "feed", "requestId": "rejected-full"}, 400)
	raw("action", map[string]any{"kind": "clean", "requestId": "rejected-clean"}, 400)
	if read := call("state", nil); !reflect.DeepEqual(read.State.Logs, logs) {
		t.Fatal("failed care wrote journal")
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	h = handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	read := call("state", nil)
	if !reflect.DeepEqual(read.State.Logs, logs) || read.CareFeedback != nil {
		t.Fatal("restart changed history")
	}
	var backup game.State
	if err = json.Unmarshal(raw("backup", nil, 200), &backup); err != nil {
		t.Fatal(err)
	}
	restored := call("import", backup)
	if !reflect.DeepEqual(restored.State.Logs, logs) || restored.CareFeedback != nil || restored.State.CareCount != r.State.CareCount {
		t.Fatal("import changed diary or replayed care")
	}
	// A future settlement must never rewrite the factual old action summary.
	now = now.Add(time.Hour)
	read = call("state", nil)
	if !reflect.DeepEqual(read.State.Logs, logs) {
		t.Fatal("passive settlement rewrote diary")
	}
}
