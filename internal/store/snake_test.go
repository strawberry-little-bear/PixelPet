package store

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestSnakePersistenceLeaseAndConcurrentStep(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snake.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	s.Do(&game.Action{Kind: "hatch", Species: 1}, nil, false, now)
	r, err := s.Do(&game.Action{Kind: "play-snake"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	r, err = s.Do(&game.Action{Kind: "snake-resume", GameID: id, RequestID: "resume"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(650 * time.Millisecond)
	pulse := &game.Action{Kind: "snake-step", GameID: id, Step: 0, Turn: -1, RequestID: "pulse"}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			x, e := s.Do(pulse, nil, false, now)
			if e != nil || x.State.Game.Snake.Step != 1 {
				t.Error(e, x)
			}
		}()
	}
	wg.Wait()
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.Game.Snake.Step != 1 {
		t.Fatal(err, r)
	}
	if _, err = s.Do(&game.Action{Kind: "snake-step", GameID: id, Step: 0}, nil, false, now.Add(time.Second)); err == nil {
		t.Fatal("stale pulse accepted")
	}
	before := r.State.Game.Snake
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(3 * time.Second)
	r, err = s.Do(nil, nil, false, now)
	if err != nil || !r.State.Game.Snake.Paused || r.State.Game.Snake.Step != 1 || !reflect.DeepEqual(before.Body, r.State.Game.Snake.Body) {
		t.Fatal("away movement", err, r)
	}
	if _, err = s.Do(&game.Action{Kind: "snake-resume", GameID: "stale", Step: 1}, nil, false, now); err == nil {
		t.Fatal("old tab resumed")
	}
	r, err = s.Do(&game.Action{Kind: "snake-resume", GameID: id, Step: 1}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Hour)
	r, err = s.Do(&game.Action{Kind: "snake-step", GameID: id, Step: 1}, nil, false, now)
	if err != nil || !r.State.Game.Snake.Paused || r.State.Game.Snake.Step != 1 {
		t.Fatal("late pulse", err, r)
	}
	r, err = s.Do(&game.Action{Kind: "cancel-play", GameID: id}, nil, false, now)
	if err != nil || r.State.Economy.Coins != 0 || r.State.CareCount != 0 {
		t.Fatal("cancel paid", err)
	}
}
func TestSnakeFinishExactlyOnceAndImportClearsSession(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "snake.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	s.Do(&game.Action{Kind: "hatch"}, nil, false, now)
	r, _ := s.Do(&game.Action{Kind: "play-snake"}, nil, false, now)
	id := r.State.Game.ID
	n := r.State.Game.Snake
	n.Eaten = 3
	n.Step = 4
	n.End = "wall"
	n.Body = []game.TilePoint{{X: 5, Y: 5}, {X: 4, Y: 5}, {X: 3, Y: 5}, {X: 2, Y: 5}, {X: 1, Y: 5}, {X: 0, Y: 5}}
	n.Food = game.TilePoint{X: 9, Y: 9}
	if err = r.State.Validate(now); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(r.State)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw))
	finish := &game.Action{Kind: "snake-finish", GameID: id, Step: 4, RequestID: "finish"}
	for i := 0; i < 3; i++ {
		r, err = s.Do(finish, nil, false, now)
		if err != nil || r.State.Economy.Coins != 3 || r.State.CareCount != 1 || r.CareFeedback == nil {
			t.Fatal(err, r)
		}
	}
	r, _ = s.Do(&game.Action{Kind: "play-snake"}, nil, false, now)
	if _, err = s.Do(&game.Action{Kind: "snake-finish", GameID: id, Step: 4}, nil, false, now); err == nil {
		t.Fatal("stale finish accepted")
	}
	imported := r.State
	r, err = s.Do(nil, &imported, false, now)
	if err != nil || r.State.Game != nil || r.State.Economy.Coins != 3 || imported.Game == nil {
		t.Fatal("import replayed game or mutated input", err, r)
	}
}
func TestSchemaFiveSnakeUpgradePreservesOldSessionAndSnapshots(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "schema5.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now().Truncate(time.Millisecond).Add(time.Second)
	legacy := game.New(now)
	legacy.Apply(game.Action{Kind: "hatch", Species: 2}, now)
	legacy.Apply(game.Action{Kind: "play-tiles"}, now)
	legacy.Schema = 5
	legacy.Companion = nil
	legacy.Park = nil
	legacy.Pond = nil
	legacy.Economy.Coins = 19
	raw, _ := json.Marshal(legacy)
	s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(raw))
	r, err := s.Do(nil, nil, false, now)
	if err != nil || r.State.Schema != game.Schema || r.State.Economy.Coins != 19 || !reflect.DeepEqual(r.State.Game, legacy.Game) || !reflect.DeepEqual(r.State.Album, legacy.Album) || !reflect.DeepEqual(r.State.Growth, legacy.Growth) {
		t.Fatal("migration changed pet", err, r)
	}
	var snapshot string
	if err = s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&snapshot); err != nil || snapshot != string(raw) {
		t.Fatal("missing exact backup", err)
	}
}
