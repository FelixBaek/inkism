# Atelier Felix - inkism

[한국어](README.ko.md)

An encrypted, local-first note app for Windows.

**Status:** early Windows build. Not a stable release, and the Windows build is not code-signed.

## Features

- Notebooks, tags, favorites, pins, archive, trash, autosave, themes
- Rich text editor (React/Tiptap) plus raw HTML / Markdown editing that keeps the original source
- Attachments, ZIP backup with attachments, edit history and undo across restarts
- Fast with large notes: only the needed part of a long note is loaded and edited
- Full-text search with AND / OR / NOT and phrases
- Reminders with Windows notifications, web clipper, public share copies
- Local storage encrypted with SQLCipher; the key is protected by Windows DPAPI
- End-to-end encrypted sync between devices through a small relay server
- Optional app lock with Google sign-in

## Folders

| Folder | What's inside |
|---|---|
| `frontend/` | The UI (React/Tiptap) |
| `core/` | Rust engines: `storage-core` (database, encryption), `engine` (notes, search), `sync-core` (sync), `runtime-core` (the bundle the app runs) |
| `desktop-tauri/` | Windows app shell (Rust/Tauri); build with `tools/scripts/build-windows-tauri.sh` |
| `tools/` | Build and test scripts, Windows installer, relay deployment, web clipper |

## Build

You need Rust stable and Node.js 22.
The encrypted build also needs `perl`, `make` and a C compiler.
Cross-building for Windows on Linux needs mingw-w64 and `rustup target add x86_64-pc-windows-gnu`.

Build the frontend first. The Rust preview server serves `frontend/dist`.

```sh
npm --prefix frontend ci
npm --prefix frontend run build
cargo build --release --manifest-path core/runtime-core/Cargo.toml
cargo run --locked --manifest-path core/local-api/Cargo.toml -- --engine "$PWD/core/runtime-core/target/release/inkism-engine"
```

Windows Tauri package (from Linux):

```sh
bash tools/scripts/build-windows-tauri.sh --version X.Y.Z
```

Writes `dist/windows-tauri/` and `dist/Inkism-windows-x64-tauri-unvalidated.zip`.
Windows native/UI/installer acceptance is still required before delivery.
`tools/scripts/build-windows.sh` runs the same Tauri build.

## Test

```sh
cargo test --locked --manifest-path core/local-api/Cargo.toml
cargo test --locked --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo test --manifest-path core/engine/Cargo.toml        # same for storage-core, sync-core, runtime-core
npm --prefix frontend run test:unit
```

Add `--features encrypted-storage` to the Rust tests to cover encrypted storage.
Browser tests use Playwright Chromium: `tools/scripts/test-browser.sh`.
Browser checks exercise the paths declared by each script. Physical IME, OS key storage and installation are verified on the target platform.

## Sync relay

`bash tools/scripts/package-sync-relay.sh` builds a container package in `dist/`.
In that folder, copy `.env.example` to `.env`, set a random `INKISM_RELAY_TOKEN` (32+ characters),
then run `docker compose -p inkism-sync up -d --build`.

The relay is the Rust crate `core/sync-relay` and stores data in SQLite. It no longer
opens or converts a `relay.db` from the earlier Go (bbolt) relay. The one-time migration
tools (`desktop/cmd/relay-export` and `inkism-sync-relay --import-bolt-dump`) remain in
git history at commit `6958e78`; package that commit (it also needs the Go toolchain)
to convert an old database once.

## License

[MIT](LICENSE). Bundled third-party files keep their own licenses:
IBM Plex and Noto Emoji fonts (OFL, `frontend/public/fonts/`), Unicode data (`frontend/public/licenses/`).
