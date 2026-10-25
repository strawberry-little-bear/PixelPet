package httpapi

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

// A real route/SQLite journey with a controlled server clock, not an edited
// sleep receipt: nine seconds produces a half-cent recovery plus float dust.
// The React regressions consume this same raw numeric value without rounding
// the payload, while the diary keeps the backend's canonical display text.
func TestHTTPSleepAmountKeepsRawRecoveryAndCanonicalDiaryAcrossReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "care-amount.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	h := handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	call := func(body string) store.Result {
		t.Helper()
		method, route := "POST", "/api/action"
		if body == "" {
			method, route = "GET", "/api/state"
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(method, route, bytes.NewBufferString(body)))
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", route, w.Code, w.Body.String())
		}
		var result store.Result
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	call(`{"kind":"hatch","species":2}`)
	bed := call(`{"kind":"sleep"}`)
	now = now.Add(9 * time.Second)
	wake := call(`{"kind":"sleep","requestId":"wake-nine-seconds"}`)
	if wake.CareFeedback == nil || wake.CareFeedback.SleepSummary == nil {
		t.Fatal("missing actual sleep history")
	}
	summary := wake.CareFeedback.SleepSummary
	wantRaw := (bed.State.Needs.Energy + 14.0*9/3600) - bed.State.Needs.Energy
	if math.Float64bits(summary.EnergyRecovered) != math.Float64bits(wantRaw) || summary.EnergyRecovered == .04 {
		t.Fatalf("actual recovery changed or was rounded in storage: %.17g", summary.EnergyRecovered)
	}
	if !strings.Contains(wake.State.Logs[0].Text, "体力恢复 +0.04") {
		t.Fatal("diary did not retain canonical precision", wake.State.Logs[0])
	}
	if wake.CareFeedback.Points != 0 || wake.CareFeedback.HabitGain != 0 || wake.State.CareCount != 0 {
		t.Fatal("wake invented care/growth credit")
	}
	replay := call(`{"kind":"sleep","requestId":"wake-nine-seconds"}`)
	if !reflect.DeepEqual(replay.CareFeedback, wake.CareFeedback) || !reflect.DeepEqual(replay.State.Logs, wake.State.Logs) {
		t.Fatal("replay altered raw receipt or diary")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	h = handlerWithClock(db, t.TempDir(), func() time.Time { return now })
	read := call("")
	if !reflect.DeepEqual(read.State, wake.State) || read.CareFeedback != nil {
		t.Fatal("reload changed values/history or reconstructed the receipt")
	}
}
