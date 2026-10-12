// A subprocess fixture: fails copy if the RPC child still owns the library.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// runningSuffix marks the library as owned by the RPC child.
const runningSuffix = ".running"

func main() {
	source := os.Args[2]
	if len(os.Args) > 3 {
		if _, err := os.Stat(source + runningSuffix); err == nil {
			os.Exit(21)
		}
		destination := os.Args[4]
		_ = os.WriteFile(source+".copying", []byte("started"), 0600)
		for {
			if _, err := os.Stat(source + ".release"); err == nil {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if filepath.Base(destination) == "fail" {
			fmt.Fprintln(os.Stderr, "fixture copy failure")
			os.Exit(22)
		}
		if err := os.Mkdir(destination, 0700); err != nil {
			os.Exit(23)
		}
		body, _ := os.ReadFile(source)
		_ = os.WriteFile(filepath.Join(destination, "notes.db"), body, 0600)
		return
	}
	marker, err := os.OpenFile(source+runningSuffix, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(24)
	}
	_ = marker.Close()
	defer os.Remove(source + runningSuffix)
	scan := bufio.NewScanner(os.Stdin)
	for scan.Scan() {
		var request struct {
			Op string `json:"op"`
		}
		_ = json.Unmarshal(scan.Bytes(), &request)
		if request.Op == "get" {
			body, _ := os.ReadFile(source)
			out, _ := json.Marshal(map[string]any{"ok": true, "data": string(body)})
			fmt.Println(string(out))
		} else {
			fmt.Println(`{"ok":true,"data":{}}`)
		}
	}
}
