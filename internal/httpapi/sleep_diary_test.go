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

func TestHTTPWakeDiarySurvivesRestartBackupAndImportWithoutReplayingCare(t *testing.T) {
	for _, importedSleep := range []bool{false, true} {
		t.Run(map[bool]string{false: "explicit-sleep", true: "imported-sleep"}[importedSleep], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "sleep-diary.db")
			db, err := store.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { db.Close() }()
			now := time.Now().Truncate(time.Millisecond)
			h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
			raw := func(path, body, condition string, status int) []byte {
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
				if w.Code != status {
					t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
				}
				return w.Body.Bytes()
			}
			call := func(path, body, condition string) store.Result {
				t.Helper()
				var r store.Result
				if err := json.Unmarshal(raw(path, body, condition, 200), &r); err != nil {
					t.Fatal(err)
				}
				return r
			}
			call("action", `{"kind":"hatch","species":2}`, "")
			call("action", `{"kind":"sleep","requestId":"bed"}`, "awake")
			if importedSleep {
				call("import", string(raw("backup", "", "", 200)), "")
			}
			now = now.Add(time.Hour)
			before := call("state", "", "")
			raw("action", `{"kind":"sleep","requestId":"wrong-intent"}`, "awake", 409)
			wake := call("action", `{"kind":"sleep","requestId":"wake"}`, "sleeping")
			logs := wake.State.Logs
			if len(logs) != len(before.State.Logs)+1 {
				t.Fatal("not exactly one new wake log")
			}
			text := logs[0].Text
			if importedSleep {
				if !strings.Contains(text, "没有完整记录") || strings.Contains(text, "+") {
					t.Fatal("invented imported sleep", text)
				}
			} else if !strings.Contains(text, "实际结算 1.00 小时") || !strings.Contains(text, "恢复体力 +14.00") {
				t.Fatal(text)
			}
			now = now.Add(time.Hour)
			replay := call("action", `{"kind":"sleep","requestId":"wake"}`, "sleeping")
			if !reflect.DeepEqual(replay.State.Logs, logs) {
				t.Fatal("idempotent replay rewrote journal")
			}
			if err = db.Close(); err != nil {
				t.Fatal(err)
			}
			db, err = store.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			h = handlerWithClock(db, t.TempDir(), func() time.Time { return now })
			read := call("state", "", "")
			if !reflect.DeepEqual(read.State.Logs, logs) || read.State.Sleeping || read.CareFeedback != nil {
				t.Fatal("restart lost log or rebuilt wake receipt")
			}
			var backup game.State
			body := raw("backup", "", "", 200)
			if err = json.Unmarshal(body, &backup); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(backup.Logs, logs) {
				t.Fatal("backup lost diary")
			}
			restored := call("import", string(body), "")
			if !reflect.DeepEqual(restored.State.Logs, logs) || restored.CareFeedback != nil || restored.State.CareCount != wake.State.CareCount {
				t.Fatal("import changed history or replayed care")
			}
		})
	}
}
