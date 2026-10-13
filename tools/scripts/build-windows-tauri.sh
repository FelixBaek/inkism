#!/usr/bin/env bash
# Cross-builds the Tauri shell for Windows (x86_64-pc-windows-gnu) on Linux.
#
#   tools/scripts/build-windows-tauri.sh [--version x.y.z] [--build-only]
#
# Output: dist/windows-tauri/ (Inkism.exe, inkism-engine.exe, WebView2Loader.dll, README.md,
# BUILD.txt) and dist/Inkism-windows-x64-tauri-unvalidated.zip. The package
# keeps the core/app-update layout. Nothing is copied to another machine.
# INKISM_APP_UPDATE_FEED (optional) is compiled in as the update feed.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="0.0.0-dev" BUILD_ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --build-only) BUILD_ONLY=1; shift ;;
    *) echo "Usage: tools/scripts/build-windows-tauri.sh [--version x.y.z] [--build-only]" >&2; exit 2 ;;
  esac
done
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "--version x.y.z expected" >&2; exit 2; }
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
SHELL_MANIFEST=desktop-tauri/src-tauri/Cargo.toml

npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run build
if [ -z "$BUILD_ONLY" ]; then
  cargo test --locked --manifest-path core/engine/Cargo.toml
  cargo test --locked --manifest-path core/local-api/Cargo.toml
  cargo test --locked --manifest-path "$SHELL_MANIFEST"
fi
cargo build --locked --features encrypted-storage --release --target x86_64-pc-windows-gnu --manifest-path core/runtime-core/Cargo.toml
# The version is compiled into the exe twice: the updater's current version and the file resource.
RESOURCE_VERSION="${VERSION%%-*}"
INKISM_APP_VERSION="$VERSION" INKISM_APP_COMMIT="$(git rev-parse HEAD)" INKISM_APP_UPDATE_FEED="${INKISM_APP_UPDATE_FEED:-}" \
  TAURI_CONFIG="{\"version\":\"$RESOURCE_VERSION\"}" \
  cargo build --locked --release --target x86_64-pc-windows-gnu --manifest-path "$SHELL_MANIFEST"

OUT=dist/windows-tauri
rm -rf "$OUT" && mkdir -p "$OUT"
cp "${CARGO_TARGET_DIR:-$PWD/desktop-tauri/src-tauri/target}/x86_64-pc-windows-gnu/release/inkism.exe" "$OUT/Inkism.exe"
cp "${CARGO_TARGET_DIR:-$PWD/core/runtime-core/target}/x86_64-pc-windows-gnu/release/inkism-engine.exe" "$OUT/inkism-engine.exe"
cp "$( [ -f .private/docs/windows.md ] && echo .private/docs/windows.md || echo README.md )" "$OUT/README.md"
# The windows-gnu shell imports WebView2Loader.dll; it ships beside the exe.
cp "${CARGO_TARGET_DIR:-$PWD/desktop-tauri/src-tauri/target}/x86_64-pc-windows-gnu/release/WebView2Loader.dll" "$OUT/"
python3 - "$OUT" "$VERSION" "${BUILD_ONLY:+--build-only}" <<'PY'
import zipfile, pathlib, subprocess, datetime, json, hashlib, sys
root, version, build_only = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3] == '--build-only'
metadata = {
  'application': 'Inkism', 'shell': 'tauri', 'version': version,
  'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
  'source_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip()),
  'built_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'target': 'x86_64-pc-windows-gnu',
  'unit_checks': 'NOT RUN' if build_only else 'PASS',
  'validation': 'UNVALIDATED: Windows native/UI/installer acceptance must be run separately',
  'sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.iterdir()) if p.suffix in ('.exe', '.dll')},
}
(root / 'BUILD.txt').write_text(json.dumps(metadata, indent=2) + '\n')
with zipfile.ZipFile('dist/Inkism-windows-x64-tauri-unvalidated.zip', 'w', compression=zipfile.ZIP_DEFLATED) as z:
  for path in sorted(root.iterdir()):
    if path.is_file():
      z.write(path, 'Inkism/' + path.name)
PY
sha256sum dist/Inkism-windows-x64-tauri-unvalidated.zip > dist/Inkism-windows-x64-tauri-unvalidated.zip.sha256
echo "built $OUT (not delivered)"
