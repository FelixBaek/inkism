// Exercise package routing without cross-compiling or publishing to a real feed.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const repo = path.resolve(import.meta.dirname, '../..');
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'inkism-rust-build-'));
  const scripts = path.join(root, 'tools/scripts');
  const bin = path.join(root, 'bin');
  mkdirSync(scripts, {recursive: true});
  mkdirSync(bin);
  mkdirSync(path.join(root, 'feed'));
  for (const name of ['build-windows.sh', 'build-windows-tauri.sh', 'publish-update.sh']) {
    copyFileSync(path.join(repo, 'tools/scripts', name), path.join(scripts, name));
    chmodSync(path.join(scripts, name), 0o755);
  }
  writeFileSync(path.join(root, 'README.md'), 'fixture');
  writeFileSync(path.join(root, 'signing.key'), 'fixture key');
  const stub = (name: string, body: string) => writeFileSync(path.join(bin, name), '#!/bin/sh\nset -eu\n' + body, {mode: 0o755});
  stub('npm', 'exit 0\n');
  stub('git', '[ "$1" != rev-parse ] || printf fixture-commit\n');
  stub('go', 'echo "unexpected Go command" >&2; exit 99\n');
  stub('cargo', `printf '%s|version=%s|feed=%s\\n' "$*" "\${INKISM_APP_VERSION:-}" "\${INKISM_APP_UPDATE_FEED:-}" >> "$BUILD_CALLS"
[ "\${FAIL_CARGO:-}" != 1 ] || exit 42
if [ "$1" = build ]; then
  out="$CARGO_TARGET_DIR/x86_64-pc-windows-gnu/release"
  mkdir -p "$out"
  case "$*" in
    *desktop-tauri*) printf rust-shell > "$out/inkism.exe"; printf loader > "$out/WebView2Loader.dll" ;;
    *) printf rust-engine > "$out/inkism-engine.exe" ;;
  esac
fi
if [ "$1" = run ]; then
  while [ "$1" != -- ]; do shift; done
  shift
  if [ "$1" = sign ]; then printf signature > "$3.sig"; fi
fi
`);
  const env = {...process.env, PATH: bin + path.delimiter + process.env.PATH,
    CARGO_TARGET_DIR: path.join(root, 'custom-target'), BUILD_CALLS: path.join(root, 'calls'),
    INKISM_UPDATE_SIGNING_KEY: path.join(root, 'signing.key'), INKISM_UPDATE_DIR: path.join(root, 'feed'),
    INKISM_APP_UPDATE_FEED: 'https://updates.example.test/'};
  const run = (name: string, args: string[], extra = {}) => spawnSync('bash', [path.join(scripts, name), ...args], {cwd: root, env: {...env, ...extra}, encoding: 'utf8'});
  return {root, run, calls: () => readFileSync(env.BUILD_CALLS, 'utf8')};
}

test('default Windows build uses Tauri and honors the shared Cargo target', () => {
  const f = fixture();
  try {
    const result = f.run('build-windows.sh', ['--version', '1.2.3-rc.1', '--build-only']);
    assert.equal(result.status, 0, result.stderr);
    const app = path.join(f.root, 'dist/windows-tauri');
    assert.equal(readFileSync(path.join(app, 'Inkism.exe'), 'utf8'), 'rust-shell');
    assert.equal(readFileSync(path.join(app, 'WebView2Loader.dll'), 'utf8'), 'loader');
    const metadata = JSON.parse(readFileSync(path.join(app, 'BUILD.txt'), 'utf8'));
    assert.equal(metadata.shell, 'tauri');
    assert.equal(metadata.version, '1.2.3-rc.1');
    assert.ok(metadata.sha256['WebView2Loader.dll']);
    assert.match(f.calls(), /desktop-tauri.*version=1\.2\.3-rc\.1/);
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});

test('update package uses the Rust signer and includes the Tauri loader', () => {
  const f = fixture();
  try {
    const result = f.run('publish-update.sh', ['1.2.3']);
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(readFileSync(path.join(f.root, 'dist/windows-tauri/BUILD.txt'), 'utf8'));
    assert.equal(metadata.shell, 'tauri');
    assert.ok(metadata.sha256['WebView2Loader.dll']);
    assert.match(f.calls(), /desktop-tauri.*feed=https:\/\/updates\.example\.test\//);
    assert.match(f.calls(), /inkism-update-sign -- sign/);
    assert.match(f.calls(), /inkism-update-sign -- verify/);
    assert.ok(existsSync(path.join(f.root, 'feed/latest.json.sig')));
    const zip = spawnSync('python3', ['-c', 'import sys,zipfile; assert "Inkism/WebView2Loader.dll" in zipfile.ZipFile(sys.argv[1]).namelist()', path.join(f.root, 'feed/Inkism-1.2.3-windows-x64.zip')], {encoding: 'utf8'});
    assert.equal(zip.status, 0, zip.stderr);
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});

test('a Rust build failure prevents update publication', () => {
  const f = fixture();
  try {
    assert.equal(f.run('publish-update.sh', ['1.2.3'], {FAIL_CARGO: '1'}).status, 42);
    assert.equal(existsSync(path.join(f.root, 'feed/latest.json')), false);
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});

test('an unset feed builds and signs locally without publishing', () => {
  const f = fixture();
  try {
    const result = f.run('publish-update.sh', ['0.3.99'], {INKISM_UPDATE_DIR: ''});
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(f.root, 'dist/update-tauri/0.3.99/latest.json.sig')));
    assert.equal(existsSync(path.join(f.root, 'feed/latest.json')), false);
    assert.match(result.stdout, /not published/);
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});
