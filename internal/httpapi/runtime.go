package httpapi

import (
	"encoding/json"
	"net/http"
	"regexp"
	"runtime/debug"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
)

type buildVersion struct {
	Revision string `json:"revision,omitempty"`
	Modified *bool  `json:"modified,omitempty"`
}

var commitRevision = regexp.MustCompile(`^[0-9a-f]{40,64}$`)

// Publish only VCS identity, never build paths, environment or database content.
func binaryVersion(info *debug.BuildInfo, ok bool) buildVersion {
	var v buildVersion
	if !ok || info == nil {
		return v
	}
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			if commitRevision.MatchString(setting.Value) {
				v.Revision = setting.Value
			}
		case "vcs.modified":
			if setting.Value == "true" || setting.Value == "false" {
				modified := setting.Value == "true"
				v.Modified = &modified
			}
		}
	}
	if v.Revision == "" {
		v.Modified = nil
	}
	return v
}

func runtimeHandler() http.HandlerFunc {
	version := binaryVersion(debug.ReadBuildInfo())
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(struct {
			Schema int          `json:"schema"`
			Build  buildVersion `json:"build"`
		}{game.Schema, version})
	}
}
