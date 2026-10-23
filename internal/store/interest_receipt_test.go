package store

import (
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

func TestInterestReceiptUsesActualSessionAndSettlement(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	for kind, action := range map[string]string{"stars": "catch", "tiles": "tile-pick", "snake": "snake-finish", "tetris": "tetris-finish", "fishing": "fish-finish", "walk": "walk-finish", "treasure": "treasure-finish"} {
		t.Run(kind, func(t *testing.T) {
			id := "0123456789abcdef0123456789abcdef"
			s := game.State{Game: &game.MiniGame{Kind: kind, ID: id}, Companion: &game.Companion{Interests: []game.Interest{{Kind: kind}}}}
			if kind == "stars" {
				s.Game.Kind = ""
			}
			a := &game.Action{Kind: action, GameID: id}
			before := captureGameInterest(s, a)
			if before == nil {
				t.Fatal("missing capture")
			}
			if before.receipt(s, now) != nil {
				t.Fatal("unfinished game has receipt")
			}
			if captureGameInterest(s, nil) != nil || captureGameInterest(s, &game.Action{Kind: "cancel-play", GameID: id}) != nil || captureGameInterest(s, &game.Action{Kind: action, GameID: "stale"}) != nil {
				t.Fatal("unrelated action captured")
			}
			s.Game = nil
			if before.receipt(s, now) != nil {
				t.Fatal("nonqualifying completion has receipt")
			}
			s.Companion.Recent = &game.GameExperience{Kind: kind, ID: id, At: now.UnixMilli()}
			s.Companion.Interests[0].Points = 1
			s.Companion.Interests[0].LastAt = now.UnixMilli()
			want := &InterestGameReceipt{Kind: kind, GameID: id, Before: 0, After: 1, Reason: "credited"}
			if got := before.receipt(s, now); !reflect.DeepEqual(got, want) {
				t.Fatalf("got %+v want %+v", got, want)
			}
			s.Companion.Recent.At--
			if before.receipt(s, now) != nil {
				t.Fatal("old acknowledgement reused")
			}
		})
	}
}

func TestInterestReceiptTransactionCooldownCapAndReadBoundaries(t *testing.T) {
	s, now := recapStore(t)
	complete := func() Result {
		t.Helper()
		r, err := s.Do(&game.Action{Kind: "play"}, nil, false, now)
		if err != nil || r.GameReceipt != nil {
			t.Fatal("start", err, r.GameReceipt)
		}
		id := r.State.Game.ID
		for i := 0; i < 5; i++ {
			now = now.Add(time.Second)
			r, err = s.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0}, nil, false, now)
			if err != nil {
				t.Fatal(err)
			}
			if i < 4 && r.GameReceipt != nil {
				t.Fatal("partial game receipt")
			}
		}
		if r.GameReceipt == nil || r.GameReceipt.Interest == nil {
			t.Fatal("missing settlement receipt")
		}
		return r
	}
	first := complete()
	if first.GameReceipt.Interest.Reason != "credited" || first.GameReceipt.Interest.Before != 0 || first.GameReceipt.Interest.After != 1 {
		t.Fatal(first.GameReceipt.Interest)
	}
	lastAt := now
	r := complete()
	if x := r.GameReceipt.Interest; x.Reason != "cooldown" || x.Before != 1 || x.After != 1 || x.RetryAt != lastAt.Add(game.InterestInterval).UnixMilli() {
		t.Fatal(x)
	}
	if r.CareFeedback == nil || r.CareFeedback.HabitGain != 0 {
		t.Fatal("habit rule changed", r.CareFeedback)
	}
	for points := 2; points <= game.InterestLimit; points++ {
		now = now.Add(game.InterestInterval)
		r = complete()
		if x := r.GameReceipt.Interest; x.Reason != "credited" || x.Before != points-1 || x.After != points {
			t.Fatal(x)
		}
	}
	r = complete()
	if x := r.GameReceipt.Interest; x.Reason != "familiar" || x.Before != 5 || x.After != 5 || x.RetryAt != 0 {
		t.Fatal(x)
	}
	r, err := s.Do(nil, nil, false, now)
	if err != nil || r.GameReceipt != nil {
		t.Fatal("read replayed receipt", err)
	}
	r, err = s.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.Do(&game.Action{Kind: "cancel-play", GameID: r.State.Game.ID}, nil, false, now)
	if err != nil || r.GameReceipt != nil {
		t.Fatal("cancel has receipt", err)
	}
}

func TestDifferentGameInterestCanIncreaseDuringSharedHabitCooldown(t *testing.T) {
	s, now := recapStore(t)
	r, err := s.Do(&game.Action{Kind: "play"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	for i := 0; i < 5; i++ {
		now = now.Add(time.Second)
		r, err = s.Do(&game.Action{Kind: "catch", GameID: id, Lane: 0}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	if r.CareFeedback == nil || r.CareFeedback.HabitGain != 1 {
		t.Fatal("first habit not credited")
	}
	r, err = s.Do(&game.Action{Kind: "play-treasure"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id = r.State.Game.ID
	command := func(kind string, tile int) {
		t.Helper()
		r, err = s.Do(&game.Action{Kind: kind, GameID: id, Step: r.State.Game.Treasure.Step, Tile: tile}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
		if kind != "treasure-finish" && r.GameReceipt != nil {
			t.Fatal("partial exploration receipt")
		}
	}
	command("treasure-resume", 0)
	for i := 0; i < 6; i++ {
		command("treasure-dig", i)
		n := r.State.Game.Treasure
		found := 0
		for _, tile := range n.Opened {
			if n.Layout[tile] > 0 {
				found++
			}
		}
		if found == 3 {
			break
		}
	}
	command("treasure-finish", 0)
	if r.CareFeedback == nil || r.CareFeedback.Reason != "cooldown" || r.CareFeedback.HabitGain != 0 || r.CareFeedback.Points != 0 {
		t.Fatal("shared habit not cooling down", r.CareFeedback)
	}
	if r.GameReceipt == nil || r.GameReceipt.Interest == nil || r.GameReceipt.Interest.Kind != "treasure" || r.GameReceipt.Interest.Reason != "credited" {
		t.Fatal("different game's familiarity missing", r.GameReceipt)
	}
}

func TestNonqualifyingFinishedGameHasNoInterestReceipt(t *testing.T) {
	s, now := recapStore(t)
	r, err := s.Do(&game.Action{Kind: "play-snake"}, nil, false, now)
	if err != nil {
		t.Fatal(err)
	}
	id := r.State.Game.ID
	command := func(kind string) {
		t.Helper()
		r, err = s.Do(&game.Action{Kind: kind, GameID: id, Step: r.State.Game.Snake.Step}, nil, false, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	command("snake-resume")
	for i := 0; r.State.Game.Snake.End == "" && i < game.SnakeWidth; i++ {
		now = now.Add(650 * time.Millisecond)
		command("snake-step")
	}
	if r.State.Game.Snake.End == "" || r.State.Game.Snake.Eaten >= 3 {
		t.Fatal("straight route did not end below qualifying score")
	}
	command("snake-finish")
	if r.State.Game != nil || r.GameReceipt != nil || r.CareFeedback != nil || r.State.Companion.Recent != nil {
		t.Fatal("nonqualifying finish created credit", r)
	}
}
