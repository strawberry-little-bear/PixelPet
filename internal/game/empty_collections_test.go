package game

import (
	"encoding/json"
	"testing"
)

// All three empty representations are valid, including nil Go slices. This
// is distinct from import's defensive copy to [] and from malformed records.
func TestEmptyOutingCollectionsValidateAndAppendRealDiscoveries(t *testing.T) {
	for _, kind := range []string{"fishing", "walk"} {
		for _, representation := range []string{"nil", "omitted", "empty"} {
			t.Run(kind+"/"+representation, func(t *testing.T) {
				s, now := encounterState(t, kind)
				if representation != "empty" {
					s.Pond.Fish = nil
					s.Park.Finds = nil
				}
				if err := s.Validate(now); err != nil {
					t.Fatal(err)
				}
				raw, err := json.Marshal(s)
				if err != nil {
					t.Fatal(err)
				}
				if representation == "omitted" {
					var v map[string]any
					if err := json.Unmarshal(raw, &v); err != nil {
						t.Fatal(err)
					}
					delete(v["pond"].(map[string]any), "fish")
					delete(v["park"].(map[string]any), "finds")
					raw, err = json.Marshal(v)
					if err != nil {
						t.Fatal(err)
					}
				}
				var loaded State
				if err := json.Unmarshal(raw, &loaded); err != nil {
					t.Fatal(err)
				}
				if err := loaded.Validate(now); err != nil {
					t.Fatal(err)
				}
				if len(loaded.Pond.Fish) != 0 || len(loaded.Park.Finds) != 0 {
					t.Fatal("invented discovery on decode")
				}
				if representation != "empty" && (loaded.Pond.Fish != nil || loaded.Park.Finds != nil) {
					t.Fatal("decode concealed the nil-slice fixture")
				}
				discoverEncounter(t, &loaded, &now)
				if err := loaded.Validate(now); err != nil {
					t.Fatal(err)
				}
				var discoveries []FishDiscovery
				if kind == "fishing" {
					discoveries = loaded.Pond.Fish
				} else {
					discoveries = loaded.Park.Finds
				}
				if len(discoveries) != 1 || discoveries[0].Count != 1 || discoveries[0].FirstAt != now.UnixMilli() || discoveries[0].LastAt != now.UnixMilli() {
					t.Fatal("first real discovery failed", discoveries)
				}
				if loaded.CareCount != 0 || loaded.Economy.Coins != 0 || loaded.Park.Walks != 0 {
					t.Fatal("discovery fabricated settlement")
				}
			})
		}
	}
}
