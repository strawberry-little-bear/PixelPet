package httpapi

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestCancelPreconditionHTTPBoundary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cancel.db")
	s, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	h := Handler(s, t.TempDir())
	call := func(body, condition, generation string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/action", strings.NewReader(body))
		if condition != "" {
			r.Header.Set("X-PixelPet-Cancel-If", condition)
		}
		if generation != "" {
			r.Header.Set("X-PixelPet-Generation", generation)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	// Compare every persisted row, not just the visible game/revision.
	dump := func() string {
		t.Helper()
		var out []string
		for _, table := range []string{"saves", "save_generation", "snapshots", "requests", "visits"} {
			rows, err := raw.Query("SELECT * FROM " + table + " ORDER BY 1")
			if err != nil {
				t.Fatal(err)
			}
			columns, err := rows.Columns()
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				values := make([]any, len(columns))
				pointers := make([]any, len(columns))
				for i := range values {
					pointers[i] = &values[i]
				}
				if err := rows.Scan(pointers...); err != nil {
					t.Fatal(err)
				}
				out = append(out, table+fmt.Sprint(values))
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			rows.Close()
		}
		return strings.Join(out, "\n")
	}
	if w := call(`{"kind":"hatch"}`, "", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for _, start := range []string{"play", "play-tiles", "play-snake", "play-tetris", "play-fishing", "play-walk"} {
		t.Run(start, func(t *testing.T) {
			w := call(`{"kind":"`+start+`"}`, "", "")
			var r store.Result
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &r) != nil {
				t.Fatal(w.Body.String())
			}
			body := `{"kind":"cancel-play","gameId":"` + r.State.Game.ID + `"}`
			before := dump()
			for _, invalid := range []struct{ body, header string }{
				{body, "finished"}, {body, "UNFINISHED"}, {`{"kind":"feed"}`, "unfinished"},
				{strings.TrimSuffix(body, "}") + `,"requireUnfinished":true}`, ""},
			} {
				if w := call(invalid.body, invalid.header, r.SaveGeneration); w.Code != 400 {
					t.Fatal("accepted invalid precondition", w.Code, w.Body.String())
				}
				if dump() != before {
					t.Fatal("invalid precondition mutated database")
				}
			}
			w = call(body, "unfinished", r.SaveGeneration)
			var canceled store.Result
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &canceled) != nil || canceled.State.Game != nil || canceled.State.CareCount != 0 {
				t.Fatal("unfinished cancellation failed", w.Body.String())
			}
		})
	}
	w := call(`{"kind":"play-snake"}`, "", "")
	var terminal store.Result
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &terminal) != nil {
		t.Fatal(w.Body.String())
	}
	n := terminal.State.Game.Snake
	n.Eaten, n.Step, n.End = 3, 4, "wall"
	n.Body = []game.TilePoint{{X: 5, Y: 5}, {X: 4, Y: 5}, {X: 3, Y: 5}, {X: 2, Y: 5}, {X: 1, Y: 5}, {X: 0, Y: 5}}
	n.Food = game.TilePoint{X: 9, Y: 9}
	if err := terminal.State.Validate(time.Now()); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(terminal.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = raw.Exec("UPDATE saves SET body=? WHERE id=1", string(encoded)); err != nil {
		t.Fatal(err)
	}
	body := `{"kind":"cancel-play","gameId":"` + terminal.State.Game.ID + `","requestId":"stale-discard"}`
	before := dump()
	for _, tc := range []struct{ generation, code string }{
		{terminal.SaveGeneration, "game_finished"}, {"", "game_finished"}, {strings.Repeat("0", 32), "save_changed"},
	} {
		w := call(body, "unfinished", tc.generation)
		var failure struct {
			Code       string `json:"code"`
			Generation string `json:"saveGeneration"`
		}
		if w.Code != 409 || json.Unmarshal(w.Body.Bytes(), &failure) != nil || failure.Code != tc.code || failure.Generation != terminal.SaveGeneration {
			t.Fatal("wrong conflict", w.Code, w.Body.String())
		}
		if dump() != before {
			t.Fatal("known rejection mutated database or request cache")
		}
	}
	// The portable JSON is unchanged: old clients deliberately omitting the
	// precondition retain their original terminal-discard behavior.
	w = call(body, "", terminal.SaveGeneration)
	var discarded store.Result
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &discarded) != nil || discarded.State.Game != nil || discarded.State.CareCount != 0 || discarded.State.Economy.Coins != 0 {
		t.Fatal("legacy discard changed", w.Body.String())
	}
}
