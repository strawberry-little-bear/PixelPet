package store

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestCorruptStateDiagnosisAndExplicitRepair(t *testing.T) {
	for _, raw := range []string{"broken-json", `null`, `[]`, `{"schema":999,"revision":7,"hatchedAt":1,"lastTick":1,"growth":{"stage":"baby","points":-100}}`} {
		t.Run(raw, func(t *testing.T) {
			s, err := Open(filepath.Join(t.TempDir(), "repair.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			now := time.Now().Truncate(time.Millisecond)
			if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", raw); err != nil {
				t.Fatal(err)
			}
			for _, call := range []func() (Result, error){func() (Result, error) { return s.Do(nil, nil, false, now) }, func() (Result, error) { return s.Visit(now) }, func() (Result, error) { return s.Do(&game.Action{Kind: "hatch"}, nil, false, now) }} {
				if _, err = call(); !errors.Is(err, ErrInvalidSave) {
					t.Fatalf("missing typed diagnosis: %v", err)
				}
			}
			invalid := game.New(now)
			invalid.Schema = 999
			if _, err = s.Do(nil, &invalid, false, now); err == nil || errors.Is(err, ErrInvalidSave) {
				t.Fatalf("invalid backup confused with current-save diagnosis: %v", err)
			}
			var actual string
			if err = s.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&actual); err != nil || actual != raw {
				t.Fatal("failed read/import changed original", err, actual)
			}
			var count int
			s.db.QueryRow("SELECT count(*) FROM snapshots").Scan(&count)
			if count != 0 {
				t.Fatal("failed repair created snapshot")
			}
			backup := game.New(now)
			backup.Species = 2
			backup.Name = "修复伙伴"
			before, _ := json.Marshal(backup)
			r, err := s.Do(nil, &backup, false, now)
			if err != nil || r.State.Name != "修复伙伴" {
				t.Fatal("explicit repair failed", err)
			}
			after, _ := json.Marshal(backup)
			if string(before) != string(after) {
				t.Fatal("repair mutated backup")
			}
			if err = s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&actual); err != nil || actual != raw {
				t.Fatal("original bytes not preserved", err, actual)
			}
			if _, err = s.Do(nil, nil, false, now); err != nil {
				t.Fatal("repaired state unreadable", err)
			}
			if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", raw); err != nil {
				t.Fatal(err)
			}
			r, err = s.Do(nil, nil, true, now)
			if err != nil || r.State.HatchedAt != 0 || r.State.Schema != game.Schema {
				t.Fatal("explicit reset failed", err)
			}
			if err = s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&actual); err != nil || actual != raw {
				t.Fatal("reset lost damaged bytes", err)
			}
		})
	}
}
