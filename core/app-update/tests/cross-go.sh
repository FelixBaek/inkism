#!/usr/bin/env bash
# Cross-checks key, signature and feed compatibility between the Go
# desktop/cmd/update-sign and the Rust inkism-update-sign with throwaway keys.
set -euo pipefail
crate=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$crate/../.." && pwd)
work="$crate/target/cross-go"
rm -rf "$work" && mkdir -p "$work"
export RUSTUP_TOOLCHAIN=${RUSTUP_TOOLCHAIN:-stable}

(cd "$repo/desktop" && go build -o "$work/go-sign" ./cmd/update-sign)
cargo build -q --manifest-path "$crate/Cargo.toml" --bin inkism-update-sign
go="$work/go-sign" rs="$crate/target/debug/inkism-update-sign"

fail() { echo "FAIL: $*" >&2; exit 1; }
for keygen in go rs; do
  d="$work/$keygen-key" && mkdir -p "$d/go" "$d/rs"
  "${!keygen}" keygen "$d/priv.key" "$d/pub.key"
  for signer in go rs; do
    printf '{"version":"0.2.0","notes":"새 기능 %s"}' "$keygen-$signer" >"$d/$signer/latest.json"
    "${!signer}" sign "$d/priv.key" "$d/$signer/latest.json"
    for verifier in go rs; do
      "${!verifier}" verify "$d/pub.key" "$d/$signer/latest.json" >/dev/null || fail "$keygen key, $signer sign, $verifier verify"
      echo "ok: $keygen keygen -> $signer sign -> $verifier verify"
    done
  done
  # ed25519 is deterministic: both signers must emit identical .sig bytes.
  cp "$d/go/latest.json" "$d/rs/same.json" && cp "$d/go/latest.json" "$d/go/same.json"
  "$go" sign "$d/priv.key" "$d/go/same.json" && "$rs" sign "$d/priv.key" "$d/rs/same.json"
  cmp "$d/go/same.json.sig" "$d/rs/same.json.sig" || fail "$keygen key: signatures differ"
  echo "ok: $keygen key, Go and Rust .sig bytes identical"
  printf 'x' >>"$d/go/latest.json"
  for verifier in go rs; do
    ! "${!verifier}" verify "$d/pub.key" "$d/go/latest.json" 2>/dev/null || fail "$verifier accepted tampered file"
  done
  echo "ok: $keygen key, tampered file rejected by both"
done

# End to end: a Python-built package (like tools/scripts/publish-update.sh), Go-signed, read by the Rust updater.
feed="$work/feed" && mkdir -p "$feed"
python3 - "$feed" <<'PY'
import hashlib, json, pathlib, sys, zipfile
feed = pathlib.Path(sys.argv[1]); name = 'Inkism-0.2.0-windows-x64.zip'
with zipfile.ZipFile(feed / name, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('Inkism/Inkism.exe', 'cross-shell'); z.writestr('Inkism/inkism-engine.exe', 'cross-engine')
    z.writestr('Inkism/BUILD.txt', '{}')
sha = hashlib.sha256((feed / name).read_bytes()).hexdigest()
(feed / 'latest.json').write_text(json.dumps({'version': '0.2.0', 'commit': 'abc', 'zip': name, 'sha256': sha,
    'notes': '새 기능', 'published_at': '2026-10-11T00:00:00Z'}, ensure_ascii=False, indent=2) + '\n')
PY
"$go" keygen "$work/feed-priv.key" "$feed/pub.key"
"$go" sign "$work/feed-priv.key" "$feed/latest.json"
INKISM_CROSS_FEED_DIR="$feed" cargo test -q --manifest-path "$crate/Cargo.toml" --lib cross_go_signed_feed -- --ignored
echo "ok: Go-signed feed checked and prepared by the Rust updater"
