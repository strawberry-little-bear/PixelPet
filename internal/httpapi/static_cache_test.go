package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func TestStaticCachePolicy(t *testing.T) {
	web := t.TempDir()
	modified := time.Date(2026, 10, 19, 10, 0, 0, 0, time.UTC)
	for _, name := range []string{"index.html", "assets/index-lMJngONK.js", "assets/react-vendor-BjXWrvmJ.js", "assets/index-CA4MvhBD.css", "assets/settings.js", "favicon.svg", "pets/characters.png", "assets/folder-12345678.js/index.html"} {
		file := filepath.Join(web, name)
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(strings.Repeat("fixture", 20)), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(file, modified, modified); err != nil {
			t.Fatal(err)
		}
	}
	db, err := store.Open(filepath.Join(t.TempDir(), "cache.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := httptest.NewServer(Handler(db, web))
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	immutable := "public, max-age=31536000, immutable"
	for _, tt := range []struct {
		name, method, path, header, value string
		status                            int
		cache                             string
	}{
		{"html", "GET", "/", "", "", 200, "no-store"},
		{"html head", "HEAD", "/", "", "", 200, "no-store"},
		{"html revalidation", "GET", "/", "If-Modified-Since", modified.Format(http.TimeFormat), 304, "no-store"},
		{"html redirect", "GET", "/index.html", "", "", 301, "no-store"},
		{"app", "GET", "/assets/index-lMJngONK.js", "", "", 200, immutable},
		{"runtime", "GET", "/assets/react-vendor-BjXWrvmJ.js", "", "", 200, immutable},
		{"css query", "GET", "/assets/index-CA4MvhBD.css?v=1", "", "", 200, immutable},
		{"asset head", "HEAD", "/assets/index-lMJngONK.js", "", "", 200, immutable},
		{"asset revalidation", "GET", "/assets/index-lMJngONK.js", "If-Modified-Since", modified.Format(http.TimeFormat), 304, immutable},
		{"partial", "GET", "/assets/index-lMJngONK.js", "Range", "bytes=0-4", 206, immutable},
		{"invalid range", "GET", "/assets/index-lMJngONK.js", "Range", "bytes=99999-", 416, "no-cache"},
		{"failed precondition", "GET", "/assets/index-lMJngONK.js", "If-Unmodified-Since", modified.Add(-time.Hour).Format(http.TimeFormat), 412, "no-cache"},
		{"missing hashed js", "GET", "/assets/missing-12345678.js", "", "", 404, "no-cache"},
		{"missing hashed css", "HEAD", "/assets/missing-12345678.css", "", "", 404, "no-cache"},
		{"directory", "GET", "/assets/folder-12345678.js", "", "", 301, "no-cache"},
		{"directory index", "GET", "/assets/folder-12345678.js/", "", "", 200, "no-store"},
		{"unhashed", "GET", "/assets/settings.js", "", "", 200, "no-cache"},
		{"favicon", "GET", "/favicon.svg", "", "", 200, "no-cache"},
		{"public image", "GET", "/pets/characters.png", "", "", 200, "no-cache"},
		{"path redirect", "GET", "/assets/../assets/index-lMJngONK.js", "", "", 307, ""},
		{"api state", "GET", "/api/state", "", "", 200, "no-store"},
		{"api backup", "GET", "/api/backup", "", "", 200, "no-store"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r, err := http.NewRequest(tt.method, server.URL+tt.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tt.header != "" {
				r.Header.Set(tt.header, tt.value)
			}
			response, err := client.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tt.status || response.Header.Get("Cache-Control") != tt.cache {
				t.Fatalf("status=%d cache=%q; want %d %q", response.StatusCode, response.Header.Get("Cache-Control"), tt.status, tt.cache)
			}
			if tt.method == "HEAD" && len(body) != 0 {
				t.Fatal("HEAD returned a body")
			}
			if tt.status == 206 && string(body) != "fixtu" {
				t.Fatal("range response changed")
			}
		})
	}
}
