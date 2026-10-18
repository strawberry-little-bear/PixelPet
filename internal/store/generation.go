package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// A generation belongs to this installation, not the portable pet backup.
// Restoring even the same pet invalidates intent from its previous generation.
var ErrSaveChanged = errors.New("存档已在其他页面替换，本次操作未执行。请先读取当前存档")

func newSaveGeneration() (string, error) {
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(token[:]), nil
}

// DoForGeneration compares and writes in one transaction. Empty is retained
// only for older clients, which did not send a generation precondition.
func (s *Store) DoForGeneration(a *game.Action, imported *game.State, reset bool, now time.Time, generation string) (Result, error) {
	return s.do(a, imported, reset, now, false, "", generation)
}
func (s *Store) ReadRecapForGeneration(id string, now time.Time, generation string) (Result, error) {
	return s.do(nil, nil, false, now, true, id, generation)
}
