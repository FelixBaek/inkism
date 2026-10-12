#!/bin/sh
# Regenerates tests/fixtures/go-expected.json from the Go sanitizer.
# The oracle is overlaid into desktop/internal/webcontent for one `go test`
# run; nothing is written under desktop/. Needs Go and the module cache.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
crate=$(cd "$here/../.." && pwd)
repo=$(cd "$crate/../.." && pwd)
mkdir -p "$crate/target"
overlay="$crate/target/oracle-overlay.json"
printf '{"Replace":{"%s":"%s"}}\n' \
  "$repo/desktop/internal/webcontent/zz_oracle_test.go" "$here/oracle_test.go.txt" > "$overlay"
cd "$repo"
ORACLE_CASES="$crate/tests/fixtures/cases.json" \
ORACLE_OUT="$crate/tests/fixtures/go-expected.json" \
GOPROXY=off \
  go test -count=1 -overlay "$overlay" -run '^TestWriteOracle$' ./desktop/internal/webcontent
