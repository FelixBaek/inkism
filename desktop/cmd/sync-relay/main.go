package main

import (
	"encoding/base64"
	"flag"
	"github.com/FelixBaek/inkism/desktop/internal/relay"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	address := flag.String("listen", "127.0.0.1:47832", "Listen behind HTTPS reverse proxy")
	database := flag.String("db", "relay.db", "Opaque encrypted event database")
	cert := flag.String("tls-cert", "", "TLS certificate")
	key := flag.String("tls-key", "", "TLS private key")
	register := flag.Bool("register-owner-key-stdin", false, "offline administrator: register an existing vault key from stdin, then exit")
	flag.Parse()
	server, err := relay.Open(*database, env("RELAY_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	defer server.Close()
	clientID, subject, encodedKey := env("RECOVERY_GOOGLE_CLIENT_ID"), env("RECOVERY_GOOGLE_SUBJECT"), env("RECOVERY_MASTER_KEY")
	if clientID != "" || subject != "" || encodedKey != "" {
		masterKey, err := base64.StdEncoding.Strict().DecodeString(encodedKey)
		if err != nil {
			log.Fatal("invalid owner recovery master key")
		}
		err = server.EnableOwnerRecovery(clientID, subject, masterKey)
		clear(masterKey)
		if err != nil {
			log.Fatal(err)
		}
	}
	if *register {
		raw, err := io.ReadAll(io.LimitReader(os.Stdin, 46))
		if err != nil || len(raw) > 45 {
			log.Fatal("invalid recovery provisioning input")
		}
		key, err := base64.StdEncoding.Strict().DecodeString(strings.TrimSpace(string(raw)))
		clear(raw)
		if err == nil {
			err = server.RegisterOwnerKey(key)
		}
		clear(key)
		if err != nil {
			log.Fatal("recovery provisioning failed; preserve the original key and database")
		}
		log.Print("owner recovery key registered")
		return
	}
	httpServer := &http.Server{Addr: *address, Handler: server, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 90 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Private encrypted sync relay: %s", *address)
	if *cert != "" {
		log.Fatal(httpServer.ListenAndServeTLS(*cert, *key))
	}
	log.Fatal(httpServer.ListenAndServe())
}

// env reads INKISM_<name>, falling back to the old NOOK_<name> so existing .env files keep working.
func env(name string) string {
	if v := os.Getenv("INKISM_" + name); v != "" {
		return v
	}
	return os.Getenv("NOOK_" + name)
}
