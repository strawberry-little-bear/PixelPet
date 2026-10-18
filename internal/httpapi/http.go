package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/game"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func Handler(db *store.Store, web string) http.Handler {
	mux := http.NewServeMux()
	write := func(w http.ResponseWriter, result store.Result, err error) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if err != nil {
			status := http.StatusBadRequest
			body := map[string]string{"error": err.Error()}
			if errors.Is(err, store.ErrClockAhead) {
				status = http.StatusConflict
				body["code"] = "clock_ahead"
			}
			if errors.Is(err, store.ErrInvalidSave) {
				status = http.StatusConflict
				body["code"] = "save_corrupt"
			}
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(body)
			return
		}
		json.NewEncoder(w).Encode(result)
	}
	decode := func(w http.ResponseWriter, r *http.Request, v any) bool {
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if err := d.Decode(v); err != nil {
			http.Error(w, "无效的 JSON 请求", 400)
			return false
		}
		if d.Decode(&struct{}{}) != io.EOF {
			http.Error(w, "请求只能包含一份 JSON", 400)
			return false
		}
		return true
	}
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		result, err := db.Do(nil, nil, false, time.Now())
		write(w, result, err)
	})
	mux.HandleFunc("POST /api/visit", func(w http.ResponseWriter, r *http.Request) {
		var visit struct{}
		if !decode(w, r, &visit) {
			return
		}
		result, err := db.Visit(time.Now())
		write(w, result, err)
	})
	mux.HandleFunc("POST /api/recap/read", func(w http.ResponseWriter, r *http.Request) {
		var receipt struct {
			ID string `json:"id"`
		}
		if !decode(w, r, &receipt) {
			return
		}
		if len(receipt.ID) == 0 || len(receipt.ID) > 100 {
			http.Error(w, "无效的小结编号", 400)
			return
		}
		result, err := db.ReadRecap(receipt.ID, time.Now())
		write(w, result, err)
	})
	mux.HandleFunc("POST /api/action", func(w http.ResponseWriter, r *http.Request) {
		var a game.Action
		if !decode(w, r, &a) {
			return
		}
		if len(a.RequestID) > 100 {
			http.Error(w, "请求编号过长", 400)
			return
		}
		result, err := db.Do(&a, nil, false, time.Now())
		write(w, result, err)
	})
	mux.HandleFunc("GET /api/backup", func(w http.ResponseWriter, r *http.Request) {
		result, err := db.Do(nil, nil, false, time.Now())
		if err != nil {
			write(w, result, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Disposition", `attachment; filename="pixelpet-backup.json"`)
		json.NewEncoder(w).Encode(result.State)
	})
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		var state game.State
		if !decode(w, r, &state) {
			return
		}
		result, err := db.Do(nil, &state, false, time.Now())
		write(w, result, err)
	})
	mux.HandleFunc("POST /api/reset", func(w http.ResponseWriter, r *http.Request) {
		var confirmation struct {
			Confirm bool `json:"confirm"`
		}
		if !decode(w, r, &confirmation) {
			return
		}
		if !confirmation.Confirm {
			http.Error(w, "需要确认重新开始", 400)
			return
		}
		result, err := db.Do(nil, nil, true, time.Now())
		write(w, result, err)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "API not found", 404) })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		if _, err := os.Stat(filepath.Join(web, "index.html")); err != nil {
			http.Error(w, "前端尚未构建。开发时请打开 http://127.0.0.1:5173；或先在 web 目录执行 pnpm build。", 503)
			return
		}
		http.FileServer(http.Dir(web)).ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Mutations are same-origin, protecting the local service from foreign web pages.
		if r.Method == "POST" {
			if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
				http.Error(w, "只接受当前游戏页面的操作", 403)
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host && origin != "https://"+r.Host {
				http.Error(w, "来源不匹配", 403)
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}
