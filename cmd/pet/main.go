package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/strawberry-little-bear/PixelPet/internal/httpapi"
	"github.com/strawberry-little-bear/PixelPet/internal/store"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	db, err := store.Open(env("PIXELPET_DB", "data/pixelpet.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	addr := env("PIXELPET_ADDR", "127.0.0.1:8080")
	srv := &http.Server{Addr: addr, Handler: httpapi.Handler(db, env("PIXELPET_WEB", "web/dist")), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("PixelPet is ready at http://%s", addr)
	log.Fatal(srv.ListenAndServe())
}
