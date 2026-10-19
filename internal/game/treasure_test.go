package game

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"testing"
)

// Prototype fixtures exercise map/turn rules, NOT a naturally played pet save.
func treasureFixture() *TreasureHunt {
	return &TreasureHunt{Layout: []int{0, 0, 1, 0, 2, 0, 3, 0, 0}, Opened: []int{}, Paused: true}
}
func treasureJSON(t testing.TB, n *TreasureHunt) []byte {
	t.Helper()
	data, err := json.Marshal(n)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func treasureDo(t *testing.T, n *TreasureHunt, kind string, index int) {
	t.Helper()
	if err := n.apply(kind, index, n.Step); err != nil {
		t.Fatal(err)
	}
	if !n.valid() {
		t.Fatalf("action made invalid round: %+v", n)
	}
}

func TestTreasureNewRoundAndEntropyFailure(t *testing.T) {
	for i := 0; i < 50; i++ {
		n, err := newTreasure()
		if err != nil {
			t.Fatal(err)
		}
		if !n.valid() || !n.Paused || n.Step != 0 || len(n.Opened) != 0 || n.done() || n.found() != 0 {
			t.Fatalf("not a new paused map: %+v", n)
		}
		for cell := 0; cell < TreasureCells; cell++ {
			view := n.cell(cell)
			if view.Opened || view.Item != 0 || view.Nearby != nil {
				t.Fatal("unopened map exposed a clue/item")
			}
		}
	}
	n, err := newTreasureWithEntropy(treasureBrokenEntropy{})
	if n != nil || !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatal("failed entropy produced a playable or fallback map")
	}
}

// Failure after several draws must not publish a partially shuffled round.
func TestTreasurePartialEntropyFailure(t *testing.T) {
	n, err := newTreasureWithEntropy(bytes.NewReader(make([]byte, 5)))
	if n != nil || !errors.Is(err, io.EOF) {
		t.Fatalf("partial entropy produced a round: %+v / %v", n, err)
	}
}

type treasureBrokenEntropy struct{}

func (treasureBrokenEntropy) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestTreasureTurnRulesAndFailureAtomicity(t *testing.T) {
	for _, tc := range []struct {
		name, kind    string
		index, offset int
		prepare       func(*TreasureHunt)
	}{
		{name: "paused", kind: "treasure-dig", index: 0},
		{name: "negative", kind: "treasure-dig", index: -1, prepare: func(n *TreasureHunt) { treasureDo(t, n, "treasure-resume", 0) }},
		{name: "off-board", kind: "treasure-dig", index: 9, prepare: func(n *TreasureHunt) { treasureDo(t, n, "treasure-resume", 0) }},
		{name: "duplicate", kind: "treasure-dig", index: 0, prepare: func(n *TreasureHunt) { treasureDo(t, n, "treasure-resume", 0); treasureDo(t, n, "treasure-dig", 0) }},
		{name: "old-step", kind: "treasure-resume", offset: -1},
		{name: "future-step", kind: "treasure-resume", offset: 1},
		{name: "unknown-command", kind: "treasure-win"},
		{name: "completed-dig", kind: "treasure-dig", index: 1, prepare: func(n *TreasureHunt) {
			treasureDo(t, n, "treasure-resume", 0)
			for _, i := range []int{2, 4, 6} {
				treasureDo(t, n, "treasure-dig", i)
			}
		}},
		{name: "completed-resume", kind: "treasure-resume", prepare: func(n *TreasureHunt) {
			treasureDo(t, n, "treasure-resume", 0)
			for _, i := range []int{2, 4, 6} {
				treasureDo(t, n, "treasure-dig", i)
			}
		}},
		{name: "step-limit", kind: "treasure-resume", prepare: func(n *TreasureHunt) { n.Step = treasureStepLimit }},
		{name: "active-step-limit", kind: "treasure-dig", index: 0, prepare: func(n *TreasureHunt) { n.Step = treasureStepLimit; n.Paused = false }},
		{name: "stale-pause", kind: "treasure-pause", offset: -1, prepare: func(n *TreasureHunt) { treasureDo(t, n, "treasure-resume", 0) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			n := treasureFixture()
			if tc.prepare != nil {
				tc.prepare(n)
			}
			before := treasureJSON(t, n)
			if err := n.apply(tc.kind, tc.index, n.Step+tc.offset); err == nil {
				t.Fatal("invalid turn accepted")
			}
			if !reflect.DeepEqual(before, treasureJSON(t, n)) {
				t.Fatal("rejection changed round")
			}
		})
	}
	n := treasureFixture()
	treasureDo(t, n, "treasure-resume", 0)
	step := n.Step
	treasureDo(t, n, "treasure-resume", 0)
	if n.Step != step {
		t.Fatal("redundant resume used a turn")
	}
	treasureDo(t, n, "treasure-dig", 0)
	before := append([]int(nil), n.Opened...)
	layout := append([]int(nil), n.Layout...)
	treasureDo(t, n, "treasure-pause", 0)
	step = n.Step
	treasureDo(t, n, "treasure-pause", 0)
	if n.Step != step {
		t.Fatal("redundant pause used a turn")
	}
	treasureDo(t, n, "treasure-resume", 0)
	if !reflect.DeepEqual(before, n.Opened) || !reflect.DeepEqual(layout, n.Layout) {
		t.Fatal("pause/resume re-rolled or advanced the search")
	}
	n.Step = treasureStepLimit
	n.Paused = false
	treasureDo(t, n, "treasure-pause", 0)
	if !n.Paused || n.Step != treasureStepLimit {
		t.Fatal("step limit trapped running round instead of permitting pause")
	}
}

func TestTreasureCluesAcrossAllMaps(t *testing.T) {
	maps := 0
	for a := 0; a < 7; a++ {
		for b := a + 1; b < 8; b++ {
			for c := b + 1; c < 9; c++ {
				maps++
				n := &TreasureHunt{Layout: make([]int, 9), Opened: []int{}, Paused: true}
				n.Layout[a] = 1
				n.Layout[b] = 2
				n.Layout[c] = 3
				for spot := 0; spot < 9; spot++ {
					if !n.valid() {
						t.Fatal("valid map rejected")
					}
					hidden := n.cell(spot)
					if hidden.Opened || hidden.Item != 0 || hidden.Nearby != nil {
						t.Fatal("hidden clue disclosed")
					}
					treasureDo(t, n, "treasure-resume", 0)
					treasureDo(t, n, "treasure-dig", spot)
					got := n.cell(spot)
					if !got.Opened || got.Item != n.Layout[spot] {
						t.Fatal("opened cell lost actual finding")
					}
					if n.Layout[spot] != 0 {
						if got.Nearby != nil {
							t.Fatal("treasure must not also show an empty-cell clue")
						}
					} else {
						want := 0
						for _, item := range []int{a, b, c} {
							row, col := item/3-spot/3, item%3-spot%3
							if row >= -1 && row <= 1 && col >= -1 && col <= 1 {
								want++
							}
						}
						if got.Nearby == nil || *got.Nearby != want {
							t.Fatalf("map %d,%d,%d spot %d: clue %+v, want %d", a, b, c, spot, got, want)
						}
					}
					n.Opened = []int{}
					n.Step = 0
					n.Paused = true
				}
			}
		}
	}
	if maps != 84 {
		t.Fatalf("enumerated %d maps, want 9 choose 3", maps)
	}
}

func TestTreasureMapJourneysAndJSONPersistence(t *testing.T) {
	journeys := 0
	for a := 0; a < 7; a++ {
		for b := a + 1; b < 8; b++ {
			for c := b + 1; c < 9; c++ {
				for origin := 0; origin < 9; origin++ {
					for _, direction := range []int{1, -1} {
						journeys++
						n := &TreasureHunt{Layout: make([]int, 9), Opened: []int{}, Paused: true}
						n.Layout[a] = 1
						n.Layout[b] = 2
						n.Layout[c] = 3
						if _, err := n.outcome(); err == nil {
							t.Fatal("unfinished round got settlement")
						}
						treasureDo(t, n, "treasure-resume", 0)
						for offset := 0; offset < 9 && !n.done(); offset++ {
							index := (origin + direction*offset + 9) % 9
							treasureDo(t, n, "treasure-dig", index)
							original := treasureJSON(t, n)
							var restored TreasureHunt
							if err := json.Unmarshal(original, &restored); err != nil || !restored.valid() || !reflect.DeepEqual(original, treasureJSON(t, &restored)) {
								t.Fatal("JSON restore changed search order, clue or map")
							}
							n = &restored
							if !n.done() {
								treasureDo(t, n, "treasure-pause", 0)
								treasureDo(t, n, "treasure-resume", 0)
							}
						}
						result, err := n.outcome()
						if err != nil {
							t.Fatal(err)
						}
						if !n.Paused || result.Found != n.found() || result.Searches != len(n.Opened) || result.BaseCoins != 3+n.found() || result.Found > 3 || result.Searches > 6 || (result.Found != 3 && result.Searches != 6) {
							t.Fatalf("incorrect terminal result: %+v / %+v", result, n)
						}
						before := treasureJSON(t, n)
						again, err := n.outcome()
						if err != nil || result != again || !reflect.DeepEqual(before, treasureJSON(t, n)) {
							t.Fatal("observing result paid or modified round")
						}
						for i := 0; i < 9; i++ {
							if n.cell(i).Item != n.Layout[i] {
								t.Fatal("terminal overview did not reveal map")
							}
						}
					}
				}
			}
		}
	}
	if journeys != 1512 {
		t.Fatalf("ran %d journeys", journeys)
	}
}

func TestTreasureTerminalRevealIsNotAnActualFind(t *testing.T) {
	n := &TreasureHunt{Layout: []int{0, 0, 0, 0, 0, 0, 1, 2, 3}, Opened: []int{}, Paused: true}
	treasureDo(t, n, "treasure-resume", 0)
	for i := 0; i < 6; i++ {
		treasureDo(t, n, "treasure-dig", i)
	}
	before := treasureJSON(t, n)
	for i := 0; i < 9; i++ {
		view := n.cell(i)
		if view.Opened != (i < 6) || view.Item != n.Layout[i] {
			t.Fatalf("overview falsely counted an unsearched item: %d / %+v", i, view)
		}
		if (view.Nearby != nil) != (i < 6) {
			t.Fatalf("overview fabricated or lost an explored-empty clue: %d / %+v", i, view)
		}
	}
	result, err := n.outcome()
	if err != nil || result.Found != 0 || result.BaseCoins != 3 || !reflect.DeepEqual(before, treasureJSON(t, n)) {
		t.Fatalf("revealing the map changed actual progress: %+v / %v", result, err)
	}
}

func TestTreasureZeroFindsStillCompletesAndInvalidSaveStates(t *testing.T) {
	empty := &TreasureHunt{Layout: []int{0, 0, 0, 0, 0, 0, 1, 2, 3}, Opened: []int{}, Paused: true}
	treasureDo(t, empty, "treasure-resume", 0)
	for i := 0; i < 6; i++ {
		treasureDo(t, empty, "treasure-dig", i)
	}
	result, err := empty.outcome()
	if err != nil || result.Found != 0 || result.Searches != 6 || result.BaseCoins != 3 {
		t.Fatal("six real searches did not qualify independently of luck")
	}
	for name, mutate := range map[string]func(*TreasureHunt){
		"nil-layout": func(n *TreasureHunt) { n.Layout = nil }, "short-layout": func(n *TreasureHunt) { n.Layout = n.Layout[:8] }, "extra-layout": func(n *TreasureHunt) { n.Layout = append(n.Layout, 0) },
		"negative-item": func(n *TreasureHunt) { n.Layout[0] = -1 }, "unknown-item": func(n *TreasureHunt) { n.Layout[0] = 4 }, "duplicate-item": func(n *TreasureHunt) { n.Layout[0] = 1 }, "missing-item": func(n *TreasureHunt) { n.Layout[2] = 0 },
		"nil-opened": func(n *TreasureHunt) { n.Opened = nil }, "negative-index": func(n *TreasureHunt) { n.Opened = []int{-1}; n.Step = 2 }, "extra-index": func(n *TreasureHunt) { n.Opened = []int{9}; n.Step = 2 }, "duplicate-opened": func(n *TreasureHunt) { n.Opened = []int{0, 0}; n.Step = 3 },
		"seven-searches": func(n *TreasureHunt) { n.Opened = []int{0, 1, 2, 3, 4, 5, 6}; n.Step = 8 }, "search-after-all-found": func(n *TreasureHunt) { n.Opened = []int{2, 4, 6, 0}; n.Step = 5 },
		"negative-step": func(n *TreasureHunt) { n.Step = -1 }, "oversized-step": func(n *TreasureHunt) { n.Step = treasureStepLimit + 1 }, "missing-resume": func(n *TreasureHunt) { n.Paused = false }, "too-few-steps": func(n *TreasureHunt) { n.Opened = []int{0}; n.Step = 1 },
		"unpaused-result": func(n *TreasureHunt) { n.Opened = []int{2, 4, 6}; n.Step = 4; n.Paused = false },
	} {
		t.Run(name, func(t *testing.T) {
			n := treasureFixture()
			mutate(n)
			if n.valid() {
				t.Fatalf("invalid prototype save accepted: %+v", n)
			}
		})
	}
	if (&TreasureHunt{}).valid() || (*TreasureHunt)(nil).valid() {
		t.Fatal("missing round accepted")
	}
	n := treasureFixture()
	n.Layout[0] = 99
	before := treasureJSON(t, n)
	if err := n.apply("treasure-resume", 0, 0); err == nil || !reflect.DeepEqual(before, treasureJSON(t, n)) {
		t.Fatal("invalid input was played or mutated")
	}
	for _, index := range []int{-1, 9} {
		if cell := treasureFixture().cell(index); cell.Opened || cell.Item != 0 || cell.Nearby != nil {
			t.Fatal("invalid cell exposed map")
		}
	}
}

func FuzzTreasureTurns(f *testing.F) {
	initial := &TreasureHunt{Layout: []int{0, 0, 1, 0, 2, 0, 3, 0, 0}, Opened: []int{}, Paused: true}
	data, _ := json.Marshal(initial)
	f.Add(data, "treasure-resume", 0, 0)
	active := *initial
	active.Paused = false
	active.Step = 1
	data, _ = json.Marshal(active)
	f.Add(data, "treasure-dig", 0, 1)
	f.Add(data, "treasure-pause", 0, 1)
	f.Add([]byte(`{"layout":[],"opened":[]}`), "treasure-dig", -1, 0)
	f.Fuzz(func(t *testing.T, data []byte, kind string, index, step int) {
		var n TreasureHunt
		if json.Unmarshal(data, &n) != nil {
			return
		}
		before := treasureJSON(t, &n)
		valid := n.valid()
		err := n.apply(kind, index, step)
		if err != nil {
			if !reflect.DeepEqual(before, treasureJSON(t, &n)) {
				t.Fatal("rejected operation changed prototype")
			}
			return
		}
		if !valid || !n.valid() {
			t.Fatal("accepted operation left invalid state")
		}
	})
}
