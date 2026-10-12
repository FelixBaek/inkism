#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export RUSTUP_TOOLCHAIN=stable
npm --prefix frontend run build
cargo build --locked --release --manifest-path core/runtime-core/Cargo.toml
cargo build --locked --release --manifest-path core/local-api/Cargo.toml
INKISM_TEST_PREVIEW="${CARGO_TARGET_DIR:-$PWD/core/local-api/target}/release/inkism-local-api" \
INKISM_TEST_ENGINE="${CARGO_TARGET_DIR:-$PWD/core/runtime-core/target}/release/inkism-engine" \
  npm --prefix frontend run test:browser
