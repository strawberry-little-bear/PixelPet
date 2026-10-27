package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

// This is a continuous-visit and idempotency journey over one temporary save.
// The clock is controlled so a multi-day boundary is deterministic; this does
// not claim to replace a real multi-day human raising session.
func TestHTTPContinuousVisitsSettleAndClaimOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "continuous-visits.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	now := time.Now().Truncate(time.Millisecond).Add(time.Hour)
	web := t.TempDir()
	var server *httptest.Server
	open := func() {
		server = httptest.NewServer(handlerWithClock(db, web, func() time.Time { return now }))
	}
	closeServer := func() {
		if server != nil {
			server.Close()
			server = nil
		}
	}
	open()
	defer closeServer()

	call := func(method, route string, body any, generation string) store.Result {
		t.Helper()
		var payload []byte
		if body != nil {
			payload, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req, requestErr := http.NewRequest(method, server.URL+route, bytes.NewReader(payload))
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		req.Header.Set("Content-Type", "application/json")
		if generation != "" {
			req.Header.Set("X-PixelPet-Generation", generation)
		}
		res, requestErr := server.Client().Do(req)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s %s: status %d", method, route, res.StatusCode)
		}
		var result store.Result
		if err = json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		if result.ServerTime != now.UnixMilli() {
			t.Fatalf("%s %s used an unexpected server time: got %d want %d", method, route, result.ServerTime, now.UnixMilli())
		}
		return result
	}

	state := call(http.MethodGet, "/api/state", nil, "")
	reset := call(http.MethodPost, "/api/reset", map[string]bool{"confirm": true}, state.SaveGeneration)
	hatched := call(http.MethodPost, "/api/action", game.Action{Kind: "hatch", Species: 2, RequestID: "continuous-hatch"}, reset.SaveGeneration)
	if hatched.State.Growth.Stage != "baby" || hatched.State.HatchedAt != now.UnixMilli() {
		t.Fatalf("not a fresh baby: %+v", hatched.State.Growth)
	}

	visit := func(at time.Time) store.Result {
		now = at
		return call(http.MethodPost, "/api/visit", struct{}{}, "")
	}
	assertPassive := func(result store.Result, before game.State) {
		t.Helper()
		if result.CareFeedback != nil || result.State.CareCount != before.CareCount {
			t.Fatalf("visit invented active care: feedback=%+v careCount=%d/%d", result.CareFeedback, result.State.CareCount, before.CareCount)
		}
	}

	start := now
	baseline := visit(start)
	if baseline.ReturnRecap != nil || baseline.RecapPending {
		t.Fatal("first foreground visit created a return recap")
	}

	firstReturnAt := start.Add(20 * time.Minute)
	first := visit(firstReturnAt)
	assertPassive(first, baseline.State)
	if first.ReturnRecap == nil || !first.RecapPending {
		t.Fatal("first delayed visit did not create a pending recap")
	}
	firstID := first.ReturnRecap.ID
	if first.ReturnRecap.From != start.UnixMilli() || first.ReturnRecap.To != firstReturnAt.UnixMilli() {
		t.Fatalf("recap period is wrong: %+v", first.ReturnRecap)
	}
	if first.State.LastTick != firstReturnAt.UnixMilli() || first.State.Growth.TrackedHours <= baseline.State.Growth.TrackedHours {
		t.Fatal("delayed visit did not settle time exactly once")
	}

	repeat := visit(firstReturnAt)
	assertPassive(repeat, first.State)
	if repeat.ReturnRecap == nil || repeat.ReturnRecap.ID != firstID || !repeat.RecapPending {
		t.Fatal("same-time repeat visit changed or cleared the pending recap")
	}
	if !reflect.DeepEqual(repeat.State, first.State) {
		t.Fatal("same-time repeat visit changed the saved state")
	}

	claimed := call(http.MethodPost, "/api/recap/read", map[string]string{"id": firstID}, repeat.SaveGeneration)
	if !claimed.RecapClaimed || claimed.RecapPending || claimed.ReturnRecap == nil || claimed.ReturnRecap.ID != firstID {
		t.Fatal("first recap read did not claim exactly one pending recap")
	}
	if !reflect.DeepEqual(claimed.State, first.State) {
		t.Fatal("claiming a recap changed the pet state")
	}

	replayed := call(http.MethodPost, "/api/recap/read", map[string]string{"id": firstID}, claimed.SaveGeneration)
	if replayed.RecapClaimed || replayed.RecapPending || !reflect.DeepEqual(replayed.State, claimed.State) {
		t.Fatal("replaying a claimed recap changed state or claimed it twice")
	}

	// Reopen the same database before the next day. A new service process must
	// retain the baseline and the already-consumed recap without duplication.
	closeServer()
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	open()

	nextDay := firstReturnAt.Add(24 * time.Hour)
	second := visit(nextDay)
	assertPassive(second, replayed.State)
	if second.ReturnRecap == nil || !second.RecapPending || second.ReturnRecap.ID == firstID {
		t.Fatal("next-day visit did not create one new recap")
	}
	if second.ReturnRecap.From != firstReturnAt.UnixMilli() || second.ReturnRecap.To != nextDay.UnixMilli() {
		t.Fatalf("next-day recap period is wrong: %+v", second.ReturnRecap)
	}
	if second.State.LastTick != nextDay.UnixMilli() || second.State.Growth.TrackedHours <= first.State.Growth.TrackedHours {
		t.Fatal("next-day visit did not persist further passive settlement")
	}

	secondClaim := call(http.MethodPost, "/api/recap/read", map[string]string{"id": second.ReturnRecap.ID}, second.SaveGeneration)
	if !secondClaim.RecapClaimed || secondClaim.RecapPending {
		t.Fatal("next-day recap was not claimable exactly once")
	}
	if len(secondClaim.State.Album.Entries) != len(second.State.Album.Entries) {
		t.Fatal("passive visit or recap claim duplicated a milestone")
	}
}
