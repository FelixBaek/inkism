#!/usr/bin/env bash
# Package the sync relay into a new source-versioned directory.
#
# - Builds a static Linux/amd64 binary from ./core/sync-relay (Rust, static glibc).
# - Copies tools/deploy/sync-relay deployment files next to the binary.
# - Records the git source commit in BUILD.txt and file hashes in SHA256SUMS.
# - Refuses to overwrite or delete an existing destination.
#   The package is assembled in a fresh temp directory and moved into place
#   only when the target path is still free.
# - CA_BUNDLE overrides the CA bundle copied into the image
#   (default /etc/ssl/certs/ca-certificates.crt).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

commit="$(git rev-parse HEAD)"
target="${1:-dist/sync-relay-${commit:0:12}}"

if [ -e "$target" ]; then
  echo "error: $target already exists; refusing to overwrite or delete it." >&2
  exit 1
fi

command -v cargo >/dev/null || { echo "error: cargo not found" >&2; exit 1; }
command -v git >/dev/null || { echo "error: git not found" >&2; exit 1; }

mkdir -p "$(dirname "$target")"
staging="$(mktemp -d "$(dirname "$target")/.sync-relay-pkg.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

dirty="$(git status --porcelain)"

rust_target=x86_64-unknown-linux-gnu
cargo_target_dir="${CARGO_TARGET_DIR:-core/sync-relay/target}"
echo "building static relay binary (cargo --release, $rust_target, crt-static)..."
RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}" RUSTFLAGS="-C target-feature=+crt-static" \
  cargo build --release --locked --target "$rust_target" --target-dir "$cargo_target_dir" --manifest-path core/sync-relay/Cargo.toml
cp "$cargo_target_dir/$rust_target/release/inkism-sync-relay" "$staging/inkism-sync-relay"
# ldd exits 1 for a fully static ELF; inspect its output independently of that exit code.
linkage="$(ldd "$staging/inkism-sync-relay" 2>&1 || true)"
if ! grep -Eq 'statically linked|not a dynamic executable' <<< "$linkage"; then
  echo "error: relay binary is dynamically linked" >&2
  exit 1
fi

cp "${CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}" "$staging/ca-certificates.crt"

cp tools/deploy/sync-relay/Dockerfile "$staging/Dockerfile"
cp tools/deploy/sync-relay/compose.yml "$staging/compose.yml"
cp tools/deploy/sync-relay/compose.tailnet.yml "$staging/compose.tailnet.yml"
cp tools/deploy/sync-relay/.env.example "$staging/.env.example"
cp tools/deploy/sync-relay/.dockerignore "$staging/.dockerignore"
cp "$( [ -f .private/tools/deploy/sync-relay/README.md ] && echo .private/tools/deploy/sync-relay/README.md || echo README.md )" "$staging/README.md"
mkdir -p "$staging/state"
cp tools/deploy/sync-relay/state/.keep "$staging/state/.keep"

{
  echo "package: inkism-sync-relay"
  echo "source commit: $commit"
  if [ -n "$dirty" ]; then
    echo "source tree: dirty at build time"
    printf '%s\n' "$dirty" | sed 's/^/  /'
  else
    echo "source tree: clean"
  fi
  echo "built at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "rustc: $(RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}" rustc --version)"
  echo "build: RUSTFLAGS=\"-C target-feature=+crt-static\" cargo build --release --locked --target $rust_target --manifest-path core/sync-relay/Cargo.toml"
} > "$staging/BUILD.txt"

(
  cd "$staging" &&
  find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort |
    xargs sha256sum > SHA256SUMS
)

if [ -e "$target" ]; then
  echo "error: $target appeared during packaging; refusing to overwrite it." >&2
  exit 1
fi

mv -T -n "$staging" "$target"
if [ -e "$staging" ]; then
  echo "error: $target appeared during packaging; refusing to overwrite it." >&2
  exit 1
fi
trap - EXIT

echo "packaged: $target"
cat "$target/SHA256SUMS"
