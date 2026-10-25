package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"runtime/debug"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestRuntimeDoesNotOpenSaveOrAdvanceClock(t *testing.T) {
	// nil database and a forbidden clock demonstrate this works even when the
	// save is inaccessible. Version metadata is not a save-health diagnosis.
	dir := t.TempDir()
	h := handlerWithClock(nil, dir, func() time.Time { panic("runtime accessed save clock") })
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/runtime", nil))
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
			t.Fatal(w.Code, w.Header(), w.Body.String())
		}
		var report struct {
			Schema int          `json:"schema"`
			Build  buildVersion `json:"build"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil || report.Schema != game.Schema {
			t.Fatal(err, w.Body.String())
		}
		for _, private := range []string{"pixelpet.db", "GoVersion", "Settings", "Path", "Deps"} {
			if strings.Contains(w.Body.String(), private) {
				t.Fatal("private runtime data", w.Body.String())
			}
		}
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatal("runtime created data", files, err)
	}
}

func TestBinaryVersionOnlyReportsKnownVCSFields(t *testing.T) {
	revision := strings.Repeat("a", 40)
	for _, modified := range []string{"true", "false", "unknown"} {
		v := binaryVersion(&debug.BuildInfo{Path: "/private/build", Settings: []debug.BuildSetting{
			{Key: "vcs.revision", Value: revision}, {Key: "vcs.modified", Value: modified},
			{Key: "secret", Value: "must-not-be-served"},
		}}, true)
		if v.Revision != revision {
			t.Fatal(v)
		}
		if modified == "unknown" {
			if v.Modified != nil {
				t.Fatal(v)
			}
		} else if v.Modified == nil || *v.Modified != (modified == "true") {
			t.Fatal(v)
		}
	}
	for _, info := range []*debug.BuildInfo{nil, {}, {Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "not a commit"}, {Key: "vcs.modified", Value: "false"}}}} {
		for _, ok := range []bool{true, false} {
			v := binaryVersion(info, ok)
			if v.Revision != "" || v.Modified != nil {
				t.Fatal("invented build version", v)
			}
		}
	}
}
