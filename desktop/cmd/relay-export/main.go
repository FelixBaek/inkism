// Command relay-export dumps a Go relay's bbolt relay.db as JSON lines so the
// Rust relay can import it (`inkism-sync-relay --import-bolt-dump`). The
// database is opened read-only; stop the relay first so the dump is complete.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	bolt "go.etcd.io/bbolt"
)

type line struct {
	Type     string  `json:"type"`
	Name     string  `json:"name,omitempty"`
	Sequence *uint64 `json:"sequence,omitempty"`
	Bucket   string  `json:"bucket,omitempty"`
	Key      string  `json:"key,omitempty"`
	Value    *string `json:"value,omitempty"`
	Buckets  *int    `json:"buckets,omitempty"`
	Entries  *int    `json:"entries,omitempty"`
}

func main() {
	dbPath := flag.String("db", "", "bbolt relay database to read")
	out := flag.String("out", "-", "dump file (- for stdout)")
	flag.Parse()
	if *dbPath == "" {
		fmt.Fprintln(os.Stderr, "relay-export: -db is required")
		os.Exit(2)
	}
	if err := run(*dbPath, *out); err != nil {
		fmt.Fprintln(os.Stderr, "relay-export:", err)
		os.Exit(1)
	}
}

func run(dbPath, out string) error {
	if _, err := os.Stat(dbPath); err != nil {
		return err
	}
	db, err := bolt.Open(dbPath, 0600, &bolt.Options{ReadOnly: true, Timeout: time.Second})
	if err != nil {
		return err
	}
	defer db.Close()

	var w io.Writer = os.Stdout
	var f *os.File
	if out != "-" {
		f, err = os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		defer f.Close()
		w = f
	}
	bw := bufio.NewWriter(w)
	enc := json.NewEncoder(bw)
	b64 := base64.StdEncoding.EncodeToString
	buckets, entries := 0, 0
	err = db.View(func(tx *bolt.Tx) error {
		return tx.ForEach(func(name []byte, b *bolt.Bucket) error {
			seq := b.Sequence()
			if err := enc.Encode(line{Type: "bucket", Name: b64(name), Sequence: &seq}); err != nil {
				return err
			}
			buckets++
			return b.ForEach(func(k, v []byte) error {
				if v == nil {
					return errors.New("nested bucket in " + string(name) + ": not supported")
				}
				value := b64(v)
				entries++
				return enc.Encode(line{Type: "entry", Bucket: b64(name), Key: b64(k), Value: &value})
			})
		})
	})
	if err != nil {
		return err
	}
	if err := enc.Encode(line{Type: "end", Buckets: &buckets, Entries: &entries}); err != nil {
		return err
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	if f != nil {
		return f.Sync()
	}
	return nil
}
