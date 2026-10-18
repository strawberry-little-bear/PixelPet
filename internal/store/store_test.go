package store

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestPersistenceIdempotencyAndImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pet.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	r, err := s.Do(&game.Action{Kind: "hatch", Species: 8, RequestID: "hatch-1"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	backup := r.State
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := s.Do(&game.Action{Kind: "feed", RequestID: "feed-once"}, nil, false, now); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	r, err = s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.CareCount != 1 || r.State.Revision != 2 {
		t.Fatalf("duplicate mutation: %+v", r.State)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err = s.Do(nil, nil, false, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if r.State.Species != 8 || r.State.CareCount != 1 {
		t.Fatal("save lost after reopening")
	}
	invalid := backup
	invalid.Needs.Clean = -5
	if _, err = s.Do(nil, &invalid, false, now); err == nil {
		t.Fatal("invalid import accepted")
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.CareCount != 1 {
		t.Fatal("invalid import changed current save")
	}
	r, err = s.Do(nil, &backup, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if r.State.CareCount != 0 || r.State.Revision != 3 {
		t.Fatal("import failed or revision rolled backwards")
	}
	var snapshots int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&snapshots); err != nil || snapshots != 1 {
		t.Fatal("pre-import snapshot missing")
	}
	r, err = s.Do(nil, nil, true, now)
	if err != nil || r.State.HatchedAt != 0 || r.State.Revision != 4 {
		t.Fatal("reset failed")
	}
}
