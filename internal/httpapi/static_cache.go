package httpapi

import (
	"net/http"
	"regexp"
	"strings"
)

// Vite's default content-hashed JS/CSS names in assets/. Public files and
// index.html are deliberately excluded: they can change without a new URL.
var hashedBuildAsset = regexp.MustCompile(`^/assets/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(js|css)$`)

type staticCacheWriter struct {
	http.ResponseWriter
	immutable   bool
	html        bool
	wroteHeader bool
}

func (w *staticCacheWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	cache := "no-cache"
	if w.html {
		// Avoid a stale index when a deployment preserves second-resolution
		// mtimes. Hashed resources can be reused; the entry document cannot.
		cache = "no-store"
	}
	// In particular, missing chunks must not acquire a year-long cached 404.
	// Keep ServeContent's range and conditional request behavior intact.
	if w.immutable && (status == http.StatusOK || status == http.StatusPartialContent || status == http.StatusNotModified) {
		cache = "public, max-age=31536000, immutable"
	}
	w.Header().Set("Cache-Control", cache)
	w.ResponseWriter.WriteHeader(status)
}

func (w *staticCacheWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func newStaticCacheWriter(w http.ResponseWriter, path string) *staticCacheWriter {
	return &staticCacheWriter{ResponseWriter: w, immutable: hashedBuildAsset.MatchString(path),
		html: strings.HasSuffix(path, "/") || strings.HasSuffix(path, ".html")}
}
