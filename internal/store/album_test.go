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

func TestAlbumPersistsAcrossRetriesDiaryReopenAndImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "album.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	if _, err = s.Do(&game.Action{Kind: "hatch", Species: 2, RequestID: "hatch"}, nil, false, now); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := s.Do(&game.Action{Kind: "feed", RequestID: "one-meal"}, nil, false, now); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	for i := 0; i < 40; i++ {
		if _, err = s.Do(&game.Action{Kind: "rename", Name: "小草莓"}, nil, false, now); err != nil {
			t.Fatal(err)
		}
	}
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.State.Album.Entries) != 2 || r.State.CareCount != 1 || len(r.State.Logs) != 30 {
		t.Fatal("lost/duplicated memories", r.State.Album)
	}
	backupJSON, _ := json.Marshal(r.State)
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	persistedJSON, _ := json.Marshal(r.State)
	if string(backupJSON) != string(persistedJSON) {
		t.Fatal("restart changed save")
	}
	var backup game.State
	json.Unmarshal(backupJSON, &backup)
	// A later import can append anniversary cards, but must not mutate its input.
	importAt := now.Add(8 * 24 * time.Hour)
	r, err = s.Do(nil, &backup, false, importAt)
	if err != nil {
		t.Fatal(err)
	}
	afterInput, _ := json.Marshal(backup)
	if string(afterInput) != string(backupJSON) {
		t.Fatal("import mutated caller")
	}
	if len(r.State.Album.Entries) != 4 || r.State.Album.Entries[1].Kind != "meal" {
		t.Fatal("import lost/additionally invented history", r.State.Album)
	}
	good := r.State
	invalid := r.State
	album := *invalid.Album
	album.Entries = append([]game.Memory{}, album.Entries...)
	invalid.Album = &album
	invalid.Album.Entries[1].Source = "saved"
	var beforeSnapshots, afterSnapshots int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&beforeSnapshots); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Do(nil, &invalid, false, importAt); err == nil {
		t.Fatal("corrupt memory import accepted")
	}
	if err = s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&afterSnapshots); err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(nil, nil, false, importAt)
	if err != nil || !reflect.DeepEqual(good, r.State) || beforeSnapshots != afterSnapshots {
		t.Fatal("rejected import damaged state", err)
	}
	reset, err := s.Do(nil, nil, true, importAt)
	if err != nil || len(reset.State.Album.Entries) != 0 || reset.State.Album.Legacy {
		t.Fatal("reset retained other pet's memories", err)
	}
}

func TestSchemaTwoAlbumMigrationSnapshotsAndDoesNotReplay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old-album.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	now := time.Now().Truncate(time.Millisecond)
	born := now.Add(-48 * time.Hour)
	legacy := game.New(born)
	legacy.Apply(game.Action{Kind: "hatch", Species: 2}, born)
	legacy.Schema = 2
	legacy.Economy = nil
	legacy.Album = nil
	legacy.CareCount = 90
	legacy.LastTick = now.Add(-time.Hour).UnixMilli()
	legacy.Growth.Points = 23.9
	body, _ := json.Marshal(legacy)
	if _, err = s.db.Exec("UPDATE saves SET body=? WHERE id=1", string(body)); err != nil {
		t.Fatal(err)
	}
	r, err := s.Do(nil, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	if !r.State.Album.Legacy || r.State.Growth.Stage != "growing" || len(r.State.Album.Entries) != 3 {
		t.Fatal("wrong migration", r.State.Album)
	}
	for _, m := range r.State.Album.Entries {
		if m.Kind != "days" && m.Source != "saved" {
			t.Fatal("fabricated shared past", m)
		}
	}
	rev := r.State.Revision
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(nil, nil, false, now)
	if err != nil || r.State.Revision != rev {
		t.Fatal("migration replayed after reopen", err)
	}
	var original string
	if err = s.db.QueryRow("SELECT body FROM snapshots ORDER BY id DESC LIMIT 1").Scan(&original); err != nil || original != string(body) {
		t.Fatal("original migration snapshot lost", err)
	}
	var snapshots int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM snapshots").Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if snapshots != 1 {
		t.Fatal("migration snapshotted repeatedly")
	}
	if _, err = s.Do(nil, &legacy, false, now); err != nil {
		t.Fatal("old backup no longer importable", err)
	}
	if legacy.Album != nil || legacy.Schema != 2 || legacy.Growth.Stage != "baby" {
		t.Fatal("migration modified input")
	}
}
