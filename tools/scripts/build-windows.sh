#!/usr/bin/env bash
# The default Windows package uses the Rust/Tauri shell.
set -euo pipefail
exec bash "$(dirname "$0")/build-windows-tauri.sh" "$@"
