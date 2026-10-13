// Exercise package routing without cross-compiling or publishing to a real feed.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, copyFileSync, cpSync, chmodSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
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
  for (const name of ['build-windows.sh', 'build-windows-tauri.sh', 'publish-update.sh', 'package-sync-relay.sh']) {
    copyFileSync(path.join(repo, 'tools/scripts', name), path.join(scripts, name));
    chmodSync(path.join(scripts, name), 0o755);
  }
  cpSync(path.join(repo, 'tools/deploy/sync-relay'), path.join(root, 'tools/deploy/sync-relay'), {recursive: true});
  writeFileSync(path.join(root, 'ca-certificates.crt'), 'fixture CA');
  writeFileSync(path.join(root, 'README.md'), 'fixture');
  writeFileSync(path.join(root, 'signing.key'), 'fixture key');
  const stub = (name: string, body: string) => writeFileSync(path.join(bin, name), '#!/bin/sh\nset -eu\n' + body, {mode: 0o755});
  stub('npm', 'exit 0\n');
  stub('git', '[ "$1" != rev-parse ] || printf fixture-commit\n');
  stub('ldd', '[ \"${DYNAMIC_RELAY:-}\" != 1 ] || { echo \"libc.so.6 => /lib/libc.so.6\"; exit 0; }\n' + 'echo \"not a dynamic executable\"; exit 1\n');
  stub('go', 'echo "unexpected Go command" >&2; exit 99\n');
  stub('cargo', `printf '%s|version=%s|feed=%s\\n' "$*" "\${INKISM_APP_VERSION:-}" "\${INKISM_APP_UPDATE_FEED:-}" >> "$BUILD_CALLS"
[ "\${FAIL_CARGO:-}" != 1 ] || exit 42
if [ "$1" = build ]; then
  case "$*" in
    *core/sync-relay*) out="$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release" ;;
    *) out="$CARGO_TARGET_DIR/x86_64-pc-windows-gnu/release" ;;
  esac
  mkdir -p "$out"
  case "$*" in
    *core/sync-relay*) printf rust-relay > "$out/inkism-sync-relay" ;;
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
    CA_BUNDLE: path.join(root, 'ca-certificates.crt'),
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

test('relay package honors the Cargo target and accepts ldd status 1 for a static binary', () => {
  const f = fixture();
  try {
    const result = f.run('package-sync-relay.sh', ['dist/relay-test']);
    assert.equal(result.status, 0, result.stderr);
    const app = path.join(f.root, 'dist/relay-test');
    assert.equal(readFileSync(path.join(app, 'inkism-sync-relay'), 'utf8'), 'rust-relay');
    assert.equal(readFileSync(path.join(app, 'ca-certificates.crt'), 'utf8'), 'fixture CA');
    assert.match(readFileSync(path.join(app, 'SHA256SUMS'), 'utf8'), /inkism-sync-relay/);
    assert.equal(f.run('package-sync-relay.sh', ['dist/relay-test']).status, 1);
    assert.equal(readFileSync(path.join(app, 'inkism-sync-relay'), 'utf8'), 'rust-relay');
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});

test('relay package rejects a dynamically linked binary before publishing files', () => {
  const f = fixture();
  try {
    const result = f.run('package-sync-relay.sh', ['dist/relay-test'], {DYNAMIC_RELAY: '1'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dynamically linked/);
    assert.equal(existsSync(path.join(f.root, 'dist/relay-test')), false);
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});

function androidArtifactFixture() {
  const root=mkdtempSync(path.join(os.tmpdir(),'inkism-android-artifact-'));
  const bin=path.join(root,'bin'), ndk=path.join(root,'Android NDK');
  const tools=path.join(ndk,'toolchains/llvm/prebuilt/linux-x86_64/bin');
  mkdirSync(bin,{recursive:true});mkdirSync(tools,{recursive:true});
  mkdirSync(path.join(root,'frontend/dist'),{recursive:true});
  mkdirSync(path.join(root,'tools'),{recursive:true});
  mkdirSync(path.join(root,'desktop-tauri/src-tauri'),{recursive:true});
  writeFileSync(path.join(root,'frontend/dist/index.html'),'fixture');
  copyFileSync(path.join(repo,'tools/platform-build.mjs'),path.join(root,'tools/platform-build.mjs'));
  cpSync(path.join(repo,'desktop-tauri/installer/android'),path.join(root,'desktop-tauri/installer/android'),{recursive:true});
  writeFileSync(path.join(tools,'llvm-ranlib'),'#!/bin/sh\nprintf "NDK_RANLIB_SELECTED\\n"\n',{mode:0o755});
  writeFileSync(path.join(bin,'npm'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.ARTIFACT_CALLS,JSON.stringify({args,ranlib:process.env.RANLIB_aarch64_linux_android,path:process.env.PATH})+'\\n');
if(args.includes('init')) {
 const dir=path.resolve('src-tauri/gen/android/app/src/main');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'AndroidManifest.xml'),'<manifest><application android:allowBackup="true"></application></manifest>');
}
if(args.includes('build')) {
 const result=cp.spawnSync(process.env.RANLIB_aarch64_linux_android,['--version'],{encoding:'utf8'});
 if(result.status!==0||result.stdout.trim()!=='NDK_RANLIB_SELECTED')process.exit(88);
}
`,{mode:0o755});
  const calls=path.join(root,'calls');
  const env={...process.env,NDK_HOME:ndk,PATH:bin+path.delimiter+process.env.PATH,ARTIFACT_CALLS:calls};
  const run=(extra={})=>spawnSync(process.execPath,[path.join(root,'tools/platform-build.mjs'),'android'],{cwd:root,env:{...env,...extra},encoding:'utf8'});
  return {root,tools,run,calls};
}

test('Android artifact build selects the NDK ranlib through real child processes and keeps key backup protections', {skip:process.platform!=='linux'}, () => {
  const f=androidArtifactFixture();
  try {
    const result=f.run();assert.equal(result.status,0,result.stderr);
    const calls=readFileSync(f.calls,'utf8').trim().split('\n').map(value=>JSON.parse(value));
    const build=calls.find(value=>value.args.includes('build'));
    assert.ok(build,'must execute the Android build');
    assert.equal(build.ranlib,'llvm-ranlib');
    assert.equal(build.path.split(path.delimiter)[0],f.tools);
    const manifest=readFileSync(path.join(f.root,'desktop-tauri/src-tauri/gen/android/app/src/main/AndroidManifest.xml'),'utf8');
    assert.match(manifest,/android:allowBackup="false"/);
    assert.match(manifest,/android:dataExtractionRules="@xml\/inkism_data_extraction_rules"/);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('Android artifact build fails before invoking tools when the NDK ranlib is missing', {skip:process.platform!=='linux'}, () => {
  const f=androidArtifactFixture();
  try {
    const result=f.run({NDK_HOME:path.join(f.root,'missing NDK')});
    assert.notEqual(result.status,0);assert.match(result.stderr,/NDK llvm-ranlib is missing/);
    assert.equal(existsSync(f.calls),false,'must not start a partial build');
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
