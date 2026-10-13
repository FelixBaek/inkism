#!/usr/bin/env bash
# Build the Tauri Windows app, sign an update package, and optionally copy it into the feed folder.
#   INKISM_UPDATE_NOTES="..." tools/scripts/publish-update.sh 0.3.2
# Output: dist/update-tauri/<version>/ (zip, latest.json, latest.json.sig).
# Optional env:
#   INKISM_UPDATE_SIGNING_KEY  private key (default: ~/.config/mindbox-update/signing.key)
#   INKISM_UPDATE_DIR          feed folder to copy into, e.g. /srv/mindbox-updates/inkism (skipped when unset)
#   INKISM_APP_UPDATE_FEED     HTTPS feed baked into the exe (default: the one in desktop-tauri main.rs)
#   INKISM_UPDATE_NOTES        release notes shown in the app
set -euo pipefail
cd "$(dirname "$0")/../.."
version="${1:-}"
if [[ $# -ne 1 || ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: tools/scripts/publish-update.sh <x.y.z>" >&2; exit 2
fi
key="${INKISM_UPDATE_SIGNING_KEY:-$HOME/.config/mindbox-update/signing.key}"
dest="${INKISM_UPDATE_DIR:-}"
zip="Inkism-$version-windows-x64.zip"
out="dist/update-tauri/$version"
[[ -r "$key" ]] || { echo "signing key not readable: $key" >&2; exit 1; }
[[ -z "$dest" || -d "$dest" ]] || { echo "feed folder missing: $dest" >&2; exit 1; }
[[ -z "$dest" || ! -e "$dest/$zip" ]] || { echo "refusing to overwrite $dest/$zip" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "working tree is dirty; commit first" >&2; exit 1; }
export RUSTUP_TOOLCHAIN=stable

tools/scripts/build-windows-tauri.sh --version "$version"
rm -rf "$out" && mkdir -p "$out"
cp dist/Inkism-windows-x64-tauri-unvalidated.zip "$out/$zip"
python3 - "$out" "$version" "$zip" "${INKISM_UPDATE_NOTES:-}" <<'PY'
import datetime, hashlib, json, pathlib, subprocess, sys
out, version, name, notes = sys.argv[1:]
root = pathlib.Path(out)
(root / 'latest.json').write_text(json.dumps({'version': version,
  'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'zip': name,
  'sha256': hashlib.sha256((root / name).read_bytes()).hexdigest(), 'notes': notes,
  'published_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')},
  ensure_ascii=False, indent=2) + '\n')
PY
cargo run --locked --manifest-path core/app-update/Cargo.toml --bin inkism-update-sign -- sign "$key" "$out/latest.json"
cargo run --locked --manifest-path core/app-update/Cargo.toml --bin inkism-update-sign -- verify core/app-update/pubkey.txt "$out/latest.json"
if [[ -z "$dest" ]]; then
  echo "built $out (INKISM_UPDATE_DIR unset; not published)"; exit 0
fi
# Zip first; the manifest pair goes last so clients never see a manifest without its zip.
cp "$out/$zip" "$dest/$zip"
cp "$out/latest.json.sig" "$dest/.latest.json.sig.tmp" && cp "$out/latest.json" "$dest/.latest.json.tmp"
mv -f "$dest/.latest.json.sig.tmp" "$dest/latest.json.sig" && mv -f "$dest/.latest.json.tmp" "$dest/latest.json"
echo "published $version to $dest"
