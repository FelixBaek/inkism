// update-sign manages the Inkism update-feed ed25519 key (stdlib only).
//
//	update-sign keygen <private-key> <public-key>   new keypair (private file 0600, never printed)
//	update-sign sign   <private-key> <file>          writes <file>.sig (base64 signature)
//	update-sign verify <public-key>  <file>          checks <file>.sig
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/FelixBaek/inkism/desktop/internal/appupdate"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "update-sign:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 3 {
		return errors.New("usage: update-sign keygen|sign|verify <key> <file>")
	}
	switch args[0] {
	case "keygen":
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return err
		}
		if err := writeNew(args[1], base64.StdEncoding.EncodeToString(priv)+"\n", 0600); err != nil {
			return err
		}
		return os.WriteFile(args[2], []byte(base64.StdEncoding.EncodeToString(pub)+"\n"), 0644)
	case "sign":
		raw, err := os.ReadFile(args[1])
		if err != nil {
			return err
		}
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil || len(key) != ed25519.PrivateKeySize {
			return errors.New("invalid private key file")
		}
		data, err := os.ReadFile(args[2])
		if err != nil {
			return err
		}
		sig := ed25519.Sign(ed25519.PrivateKey(key), data)
		return os.WriteFile(args[2]+".sig", []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0644)
	case "verify":
		text, err := os.ReadFile(args[1])
		if err != nil {
			return err
		}
		pub, err := appupdate.ParsePublicKey(string(text))
		if err != nil {
			return err
		}
		data, err := os.ReadFile(args[2])
		if err != nil {
			return err
		}
		sig, err := os.ReadFile(args[2] + ".sig")
		if err != nil {
			return err
		}
		if err := appupdate.VerifyManifest(pub, data, sig); err != nil {
			return err
		}
		fmt.Println("signature OK")
		return nil
	}
	return fmt.Errorf("unknown command %q", args[0])
}

func writeNew(path, content string, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, err = f.WriteString(content)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	return err
}
