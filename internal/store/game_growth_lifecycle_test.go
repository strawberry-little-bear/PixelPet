package store

import (
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

// These are mixed-system journeys, not threshold fixtures or a wall-clock soak:
// start with a real egg, use real commands and simulated server time, never
// assign needs, points, habits, stage, boards or rewards. Inspecting legal maps
// to choose inputs proves persistence/rules, not human gameplay or difficulty.
type gameGrowthJourney struct {
	t                  *testing.T
	db                 *Store
	path               string
	now                time.Time
	r                  Result
	sequence           int
	last               game.Action
	growingAt, adultAt int64
	form               string
	evidence           *game.FormRecord
}

func newGameGrowthJourney(t *testing.T) *gameGrowthJourney {
	t.Helper()
	path := filepath.Join(t.TempDir(), "lifecycle.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	j := &gameGrowthJourney{t: t, db: db, path: path, now: time.Now().Truncate(time.Millisecond).Add(time.Second)}
	t.Cleanup(func() { j.db.Close() })
	j.command("hatch", 0)
	return j
}

func (j *gameGrowthJourney) accept(r Result, err error) {
	j.t.Helper()
	if err != nil {
		j.t.Fatal(j.last.Kind, err)
	}
	p, old := r.State, j.r.State
	var saved game.State
	if err := json.Unmarshal([]byte(j.savedBody()), &saved); err != nil {
		j.t.Fatal("decode persisted state", err)
	}
	if !reflect.DeepEqual(p, saved) {
		j.t.Fatal("response differs from persisted state", j.last.Kind)
	}
	if err := p.Validate(j.now); err != nil {
		j.t.Fatal("persisted invalid state", j.last.Kind, err)
	}
	if old.HatchedAt != 0 {
		if p.HatchedAt != old.HatchedAt || p.Name != old.Name || p.Species != old.Species || p.CareCount < old.CareCount || r.SaveGeneration != j.r.SaveGeneration {
			j.t.Fatal("identity, care or generation changed")
		}
		g, prev := p.Growth, old.Growth
		for _, pair := range [][2]float64{{g.Points, prev.Points}, {g.TrackedHours, prev.TrackedHours}, {g.Wellbeing, prev.Wellbeing},
			{g.Care.Nutrition, prev.Care.Nutrition}, {g.Care.Clean, prev.Care.Clean}, {g.Care.Play, prev.Care.Play}, {g.Care.Rest, prev.Care.Rest}} {
			if pair[0]+1e-8 < pair[1] {
				j.t.Fatal("saved growth/history moved backwards")
			}
		}
	}
	g := p.Growth
	if j.growingAt != 0 && g.GrowingAt != j.growingAt {
		j.t.Fatal("growing date changed")
	}
	if g.GrowingAt != 0 {
		j.growingAt = g.GrowingAt
	}
	if j.adultAt != 0 && (g.AdultAt != j.adultAt || g.Form != j.form || !reflect.DeepEqual(g.FormRecord, j.evidence)) {
		j.t.Fatal("adult form, date or frozen evidence changed")
	}
	if g.Stage == "adult" && j.adultAt == 0 {
		if g.FormRecord == nil || g.Points != game.AdultPoints || g.AdultAt < g.GrowingAt {
			j.t.Fatal("missing real threshold evidence")
		}
		j.adultAt, j.form = g.AdultAt, g.Form
		copy := *g.FormRecord
		j.evidence = &copy
	}
	j.r = r
}

func (j *gameGrowthJourney) command(kind string, tile int) {
	j.t.Helper()
	j.sequence++
	a := game.Action{Kind: kind, Tile: tile, RequestID: fmt.Sprintf("mixed-%d", j.sequence)}
	g := j.r.State.Game
	if g != nil {
		a.GameID = g.ID
		a.RequireUnfinished = kind == "cancel-play"
		switch {
		case g.Snake != nil:
			a.Step = g.Snake.Step
		case g.Tetris != nil:
			a.Step = g.Tetris.Step
		case g.Fishing != nil:
			a.Step = g.Fishing.Step
		case g.Walking != nil:
			a.Step = g.Walking.Step
		case g.Treasure != nil:
			a.Step = g.Treasure.Step
		default:
			if kind == "catch" {
				a.Lane = int((j.now.UnixMilli() - g.StartedAt) / 900 % 3)
			}
		}
	}
	j.last = a
	r, err := j.db.DoForGeneration(&a, nil, false, j.now, j.r.SaveGeneration)
	j.accept(r, err)
}

func (j *gameGrowthJourney) read(after time.Duration) {
	j.t.Helper()
	j.now = j.now.Add(after)
	before := j.r.State
	r, err := j.db.Visit(j.now)
	j.accept(r, err)
	if r.CareFeedback != nil || r.State.CareCount != before.CareCount || r.State.Economy.Coins != before.Economy.Coins || !reflect.DeepEqual(r.State.Companion, before.Companion) {
		j.t.Fatal("reading created a care/game reward or experience")
	}
}

func (j *gameGrowthJourney) restart() {
	j.t.Helper()
	before := j.r.State
	if err := j.db.Close(); err != nil {
		j.t.Fatal(err)
	}
	var err error
	j.db, err = Open(j.path)
	if err != nil {
		j.t.Fatal(err)
	}
	r, err := j.db.Do(nil, nil, false, j.now)
	j.accept(r, err)
	if !reflect.DeepEqual(before, r.State) {
		j.t.Fatal("SQLite reopen changed saved state")
	}
}

func (j *gameGrowthJourney) savedBody() string {
	j.t.Helper()
	var raw string
	if err := j.db.db.QueryRow("SELECT body FROM saves WHERE id=1").Scan(&raw); err != nil {
		j.t.Fatal(err)
	}
	return raw
}

func (j *gameGrowthJourney) rejected(a game.Action) {
	j.t.Helper()
	before := j.savedBody()
	if _, err := j.db.DoForGeneration(&a, nil, false, j.now, j.r.SaveGeneration); err == nil {
		j.t.Fatal("unexpected accepted command", a.Kind)
	}
	if j.savedBody() != before {
		j.t.Fatal("failed command changed persisted state", a.Kind)
	}
}

// Round-trip a portable backup into another installation at the exact saved
// time. Import deliberately discards unfinished games and live sleep-session
// continuity, but must retain real growth, frozen evidence and earned history.
func (j *gameGrowthJourney) restoreElsewhere() {
	j.t.Helper()
	before := j.savedBody()
	raw, err := json.Marshal(j.r.State)
	if err != nil {
		j.t.Fatal(err)
	}
	var portable game.State
	if err := json.Unmarshal(raw, &portable); err != nil {
		j.t.Fatal(err)
	}
	db, err := Open(filepath.Join(j.t.TempDir(), "restored.db"))
	if err != nil {
		j.t.Fatal(err)
	}
	defer db.Close()
	r, err := db.Do(nil, &portable, false, j.now)
	if err != nil {
		j.t.Fatal("portable restore", err)
	}
	if err := r.State.Validate(j.now); err != nil {
		j.t.Fatal("invalid restored state", err)
	}
	p, old := r.State, j.r.State
	if p.Game != nil || p.SleepSession != nil || p.Sleeping != old.Sleeping || p.HatchedAt != old.HatchedAt || p.Species != old.Species || p.Name != old.Name || p.CareCount != old.CareCount ||
		!reflect.DeepEqual(p.Growth, old.Growth) || !reflect.DeepEqual(p.Needs, old.Needs) || !reflect.DeepEqual(p.Economy, old.Economy) ||
		!reflect.DeepEqual(p.Companion, old.Companion) || !reflect.DeepEqual(p.Park, old.Park) || !reflect.DeepEqual(p.Pond, old.Pond) || !reflect.DeepEqual(p.Album, old.Album) {
		j.t.Fatal("restore invented rewards, lost history or joined a live session")
	}
	if j.savedBody() != before {
		j.t.Fatal("restoring another installation changed source")
	}
}

// Only lease pause flags and optimistic-lock steps may change while away.
// Every board, selected tile, candidate fish, elapsed wait, route and discovery
// stays intact. Ignore no score/progress/clock field just to make a test pass.
func gameWithoutLease(t *testing.T, g *game.MiniGame) *game.MiniGame {
	t.Helper()
	raw, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	var copy game.MiniGame
	if err := json.Unmarshal(raw, &copy); err != nil {
		t.Fatal(err)
	}
	if copy.Snake != nil {
		copy.Snake.Paused = true
	}
	if copy.Tetris != nil {
		copy.Tetris.Paused, copy.Tetris.Step = true, 0
	}
	if copy.Fishing != nil {
		copy.Fishing.Paused, copy.Fishing.Step = true, 0
	}
	if copy.Walking != nil {
		copy.Walking.Paused, copy.Walking.Step = true, 0
	}
	return &copy
}

// Normalizing lease fields for progress comparison must not conceal a failure
// to pause timed games. Treasure has no clock lease and keeps its own pause flag.
func (j *gameGrowthJourney) assertAwayGame(progress *game.MiniGame) {
	j.t.Helper()
	g := j.r.State.Game
	if g == nil {
		j.t.Fatal("absence discarded the game")
	}
	if (g.Snake != nil && !g.Snake.Paused) || (g.Tetris != nil && !g.Tetris.Paused) ||
		(g.Fishing != nil && !g.Fishing.Paused) || (g.Walking != nil && !g.Walking.Paused) {
		j.t.Fatal("absence did not pause the timed game")
	}
	if !reflect.DeepEqual(progress, gameWithoutLease(j.t, g)) {
		j.t.Fatal("absence or growth changed game progress")
	}
}

func (j *gameGrowthJourney) pair() {
	j.t.Helper()
	board := j.r.State.Game.Tiles.Board
	for a := 0; a < 16; a++ {
		for b := a + 1; b < 16; b++ {
			if game.TilePath(board, a, b) != nil {
				j.command("tile-clear", 0)
				j.command("tile-pick", a)
				j.command("tile-pick", b)
				return
			}
		}
	}
	j.t.Fatal("saved tiles have no legal pair")
}

func (j *gameGrowthJourney) begin(kind string) {
	j.t.Helper()
	start := "play-" + kind
	if kind == "stars" {
		start = "play"
	}
	j.command(start, 0)
	switch kind {
	case "stars":
		j.command("catch", 0)
	case "tiles":
		j.pair()
	case "snake":
		j.command("snake-resume", 0)
		j.now = j.now.Add(600 * time.Millisecond)
		j.command("snake-step", 0)
	case "tetris":
		j.command("tetris-drop", 0)
	case "fishing":
		j.command("fish-cast", 0)
	case "walk":
		j.command("walk-resume", 0)
		j.now = j.now.Add(time.Second)
		j.command("walk-step", 0)
	case "treasure":
		j.command("treasure-resume", 0)
		for at, item := range j.r.State.Game.Treasure.Layout {
			if item == 0 {
				j.command("treasure-dig", at)
				break
			}
		}
	}
}

func (j *gameGrowthJourney) finish(kind string) {
	j.t.Helper()
	switch kind {
	case "stars":
		for j.r.State.Game != nil {
			j.now = j.now.Add(900 * time.Millisecond)
			j.command("catch", 0)
		}
	case "tiles":
		for j.r.State.Game != nil {
			j.pair()
		}
	case "snake":
		j.command("snake-resume", 0)
		for i := 0; j.r.State.Game.Snake.End == "" && i < game.SnakeWidth; i++ {
			j.now = j.now.Add(600 * time.Millisecond)
			j.command("snake-step", 0)
		}
		if j.r.State.Game.Snake.End == "" {
			j.t.Fatal("straight route did not reach a wall")
		}
		j.command("snake-finish", 0)
	case "tetris":
		for i := 0; j.r.State.Game.Tetris.End == "" && i < 30; i++ {
			j.now = j.now.Add(250 * time.Millisecond)
			if !j.r.State.Game.Tetris.Paused {
				j.command("tetris-pause", 0)
			}
			j.command("tetris-drop", 0)
		}
		if j.r.State.Game.Tetris.End == "" {
			j.t.Fatal("fixed-column stack did not end")
		}
		j.command("tetris-finish", 0)
	case "fishing":
		j.command("fish-resume", 0)
		for cast := 0; cast < 3; cast++ {
			if j.r.State.Game.Fishing.Phase != "wait" {
				j.command("fish-cast", 0)
			}
			for i := 0; j.r.State.Game.Fishing.Phase == "wait" && i < 41; i++ {
				j.now = j.now.Add(time.Second)
				j.command("fish-step", 0)
			}
			if j.r.State.Game.Fishing.Phase != "bite" {
				j.t.Fatal("wait did not reach a bite")
			}
			j.command("fish-reel", 0)
		}
		j.command("fish-finish", 0)
	case "walk":
		j.command("walk-resume", 0)
		for j.r.State.Game.Walking.Beat < game.WalkLength {
			j.now = j.now.Add(time.Second)
			j.command("walk-step", 0)
		}
		j.command("walk-finish", 0)
	case "treasure":
		// The persisted map is inspected only to select legal search commands;
		// the test never writes a layout or submits a claimed find/score.
		for at, item := range j.r.State.Game.Treasure.Layout {
			if item > 0 {
				j.command("treasure-dig", at)
			}
		}
		j.command("treasure-finish", 0)
	}
	if j.r.State.Game != nil {
		j.t.Fatal("finished game remained active")
	}
}

func TestSevenGameGrowthLifecycleAcrossAbsenceAndRestart(t *testing.T) {
	for _, kind := range []string{"stars", "tiles", "snake", "tetris", "fishing", "walk", "treasure"} {
		for _, finish := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/finish=%t", kind, finish), func(t *testing.T) {
				j := newGameGrowthJourney(t)
				j.begin(kind)
				id := j.r.State.Game.ID
				progress := gameWithoutLease(t, j.r.State.Game)
				j.restart()
				// Even a rejected care command must not partly commit a later
				// passive settlement, remove the game, or add a sleep session.
				j.now = j.now.Add(time.Minute)
				for _, action := range []string{"feed", "clean", "sleep", "play-treasure"} {
					j.rejected(game.Action{Kind: action})
				}
				tracked := j.r.State.Growth.TrackedHours
				j.read(48 * time.Hour)
				if math.Abs(j.r.State.Growth.TrackedHours-tracked-12) > 1e-8 {
					t.Fatal("single absence cap changed")
				}
				j.assertAwayGame(progress)
				// Irregular reads cross both stages while the original game is
				// unfinished. The 48h gap above and later >12h gaps are capped
				// separately; many visits are not claimed equivalent to one.
				intervals := []time.Duration{75 * time.Minute, 12 * time.Hour, 36 * time.Hour, 900 * time.Millisecond, 4 * time.Hour}
				for i := 0; j.r.State.Growth.Stage != "adult" && i < 50; i++ {
					j.read(intervals[i%len(intervals)])
					j.assertAwayGame(progress)
					if i%3 == 0 {
						j.restart()
						j.assertAwayGame(progress)
					}
				}
				if j.growingAt == 0 || j.adultAt == 0 || j.form != "easygoing" {
					t.Fatal("unattended real history did not reach its expected adult form")
				}
				if j.r.State.CareCount != 0 || j.r.State.Growth.Care.Play != 0 || j.r.State.Economy.Coins != 0 {
					t.Fatal("unfinished game earned care or resources")
				}
				j.restoreElsewhere()
				if finish {
					j.finish(kind)
				} else {
					j.command("cancel-play", 0)
				}
				settled := j.r.State
				eligible := finish && kind != "snake" && kind != "tetris"
				if eligible {
					f := j.r.CareFeedback
					if settled.CareCount != 1 || settled.Growth.Care.Play != 1 || settled.Economy.Coins <= 0 || settled.Companion.Recent == nil || settled.Companion.Recent.ID != id || f == nil || f.HabitGain != 1 || f.Points != 0 || f.Milestone != nil {
						t.Fatal("adult completion credited the wrong care/growth/experience", j.r)
					}
				} else if settled.CareCount != 0 || settled.Growth.Care.Play != 0 || settled.Economy.Coins != 0 || settled.Companion.Recent != nil || j.r.CareFeedback != nil {
					t.Fatal("abandoned/ineligible game was rewarded")
				}
				finishedCommand := j.last
				if _, err := j.db.DoForGeneration(&finishedCommand, nil, false, j.now, j.r.SaveGeneration); err != nil {
					t.Fatal("idempotent acknowledgement lost", err)
				}
				j.read(0)
				if !reflect.DeepEqual(settled, j.r.State) {
					t.Fatal("retry/read duplicated settlement")
				}
				j.restart()
				// Care becomes available only after ending the game. The same
				// real sleep restores energy and keeps the adult evidence frozen.
				j.command("feed", 0)
				j.command("clean", 0)
				j.command("sleep", 0)
				j.read(7*time.Hour + 15*time.Minute)
				if !j.r.State.Sleeping || j.r.State.Needs.Energy != 100 || j.r.State.SleepSession == nil || j.r.State.SleepSession.GrowthPoints != 0 || j.r.State.SleepSession.RestGain <= 0 {
					t.Fatal("post-game sleep progress lost or credited adult growth")
				}
				j.restart()
				j.restoreElsewhere()
				j.command("sleep", 0)
				if j.r.CareFeedback == nil || j.r.CareFeedback.SleepSummary == nil || j.r.CareFeedback.SleepSummary.EnergyRecovered <= 0 || j.r.CareFeedback.SleepSummary.GrowthPoints != 0 {
					t.Fatal("wake lost the persisted adult sleep receipt")
				}
				j.begin(kind)
				newID := j.r.State.Game.ID
				if newID == id {
					t.Fatal("new game reused old session")
				}
				// A cached old acknowledgement is safe, but a new request for
				// an obsolete session must fail without touching the new one.
				before := j.savedBody()
				if _, err := j.db.DoForGeneration(&finishedCommand, nil, false, j.now, j.r.SaveGeneration); err != nil {
					t.Fatal(err)
				}
				if before != j.savedBody() {
					t.Fatal("cached old finish changed new game")
				}
				finishedCommand.RequestID = "obsolete-new-request"
				j.rejected(finishedCommand)
				j.read(0)
				if j.r.State.Game.ID != newID {
					t.Fatal("old result replaced new game")
				}
			})
		}
	}
}
