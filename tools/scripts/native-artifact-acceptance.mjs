// Run shipped historical artifacts on disposable runners, without rebuilding the app.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const artifacts = {
  ios: {id: 11794547739, run: 38359921462, head: '8659edcf55adfe40341dd2b8d0d2eb8b13f6fa42', sha256: '62bbae2ff4aedf3d845973b900756f62e020bb5b238c4603de495861944c737b'},
  macos: {id: 11795360405, run: 38359921462, head: '8659edcf55adfe40341dd2b8d0d2eb8b13f6fa42', sha256: '44356b443be2f5ed8680f1c0b525ec05399a75d7e6bbd08f71e7cebf3ac99587'},
  android: {id: 11796506259, run: 38364470879, head: '7bd617ccb5ddc69c42650b9d5d28608263e2bcb1', sha256: '67e789f8fc5a4ef5b41058dc5f1e6c5dc9e9bca0b36ce65f9c25550099ec293e'},
};
const args = process.argv.slice(2);
const option = name => {const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1];};
const platform = option('--platform'), prepareOnly = args.includes('--prepare-only');
assert.ok(Object.hasOwn(artifacts, platform ?? ''), 'Choose --platform ios|macos|android');
assert.ok(option('--output'), '--output is required');
const output = path.resolve(option('--output'));
fs.mkdirSync(output, {recursive: true});
const expected = artifacts[platform], bundleId = 'dev.felixbaek.inkism';
const evidence = {platform, harnessHead: process.env.GITHUB_SHA ?? null, runner: {platform: process.platform, architecture: process.arch, release: os.release()}, artifact: expected, startedAt: new Date().toISOString(), checks: [], result: 'running'};
const hash = value => createHash('sha256').update(value).digest('hex');
const save = () => fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
const check = (name, details = {}) => {evidence.checks.push({name, ...details}); save(); console.log(`PASS ${platform}: ${name}`);};
function run(command, argv, options = {}) {
  const started = Date.now(), diagnostic = {command, arguments: argv, startedAt: new Date(started).toISOString(), timeoutMs: options.timeout ?? 60_000};
  const log = path.join(output, 'commands.log');
  fs.appendFileSync(log, JSON.stringify({event: 'start', ...diagnostic}) + '\n');
  const result = spawnSync(command, argv, {encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...options});
  const completed = {...diagnostic, elapsedMs: Date.now() - started, status: result.status, signal: result.signal};
  fs.appendFileSync(log, JSON.stringify({event: 'complete', ...completed, error: result.error?.message, stderr: result.status === 0 ? undefined : String(result.stderr ?? '').slice(-3000)}) + '\n');
  if (result.error || result.status !== 0) {
    const error = new Error(`${command} ${argv.slice(0, 3).join(' ')} failed: ${result.error?.message ?? `exit ${result.status}: ${String(result.stderr).slice(-3000)}`}`);
    error.nativeCommand = completed;
    throw error;
  }
  return result.stdout;
}
async function until(predicate, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 250));}
  throw new Error(message);
}
function files(root) {
  const found = [], pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const name = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Unexpected symlink in acceptance input');
      if (entry.isDirectory()) pending.push(name); else found.push(name);
      assert.ok(found.length + pending.length < 20_000, 'Acceptance input is too large');
    }
  }
  return found;
}
const alive = pid => {try {process.kill(pid, 0); return true;} catch (error) {if (error.code === 'ESRCH') return false; throw error;}};
let device, mounted, child, helper;
const nativeChildren = new Map();
function swift(command, ...argv) {return JSON.parse(run(helper, [command, ...argv]));}
function processIdentity(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], {encoding: 'utf8', timeout: 5000});
  return result.status === 0 ? result.stdout.trim() : undefined;
}
function collectSidecars(parent) {
  const descendants = spawnSync('pgrep', ['-P', String(parent)], {encoding: 'utf8', timeout: 5000}).stdout ?? '';
  for (const pid of descendants.trim().split(/\s+/).map(Number).filter(pid => pid > 1)) {
    const identity = processIdentity(pid);
    // Record only this app's packaged engine with one of our disposable DBs.
    // The parent is checked by pgrep here. Launch time and full command must
    // still match before cleanup, including an engine orphaned by a failed app.
    if (identity?.includes('inkism-engine') && identity.includes(path.join(output, 'profiles')))
      nativeChildren.set(pid, identity);
  }
}

function prepare() {
  const repository = process.env.GITHUB_REPOSITORY ?? 'FelixBaek/inkism';
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const endpoint = `repos/${repository}/actions/artifacts/${expected.id}`;
  const metadata = JSON.parse(run('gh', ['api', endpoint]));
  assert.equal(metadata.id, expected.id);
  assert.equal(metadata.workflow_run?.id, expected.run);
  assert.equal(metadata.workflow_run?.head_sha, expected.head);
  assert.equal(metadata.expired, false, 'Historical artifact expired; rebuild is outside this acceptance');
  evidence.artifact = {...expected, name: metadata.name, archiveDigest: metadata.digest};
  const zipped = run('gh', ['api', `${endpoint}/zip`], {encoding: null, timeout: 180_000, maxBuffer: 300 * 1024 * 1024});
  assert.equal(`sha256:${hash(zipped)}`, metadata.digest, 'Artifact archive digest mismatch');
  const archive = path.join(output, 'artifact.zip'), directory = path.join(output, 'artifact');
  fs.writeFileSync(archive, zipped);
  fs.mkdirSync(directory, {recursive: true});
  // Validate paths and preserve the ZIP's actual permission bits, including
  // the simulator executable. No resigning or guessed executable modes.
  run('python3', ['-c', `import sys,zipfile,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert all(not pathlib.PurePosixPath(i.filename).is_absolute() and '..' not in pathlib.PurePosixPath(i.filename).parts and (i.external_attr>>16)&0o170000 != 0o120000 for i in z.infolist()), 'unsafe artifact path'
 z.extractall(sys.argv[2])
 for item in z.infolist():
  mode=(item.external_attr>>16)&0o777
  if mode: pathlib.Path(sys.argv[2],item.filename).chmod(mode)
`, archive, directory], {timeout: 180_000});
  const all = files(directory);
  const matches = all.filter(file => platform === 'android' ? file.endsWith('.apk') : platform === 'macos' ? file.endsWith('.dmg') : path.basename(file) === 'Info.plist' && path.dirname(file).endsWith('.app'));
  assert.equal(matches.length, 1, 'Expected exactly one platform artifact');
  const input = platform === 'ios' ? path.dirname(matches[0]) : matches[0];
  const binary = platform === 'ios' ? path.join(input, 'inkism') : input;
  assert.equal(hash(fs.readFileSync(binary)), expected.sha256, 'Platform artifact binary checksum mismatch');
  fs.writeFileSync(path.join(output, 'artifact-path.txt'), input + '\n');
  check('exact historical artifact downloaded and verified', {sourceHead: expected.head});
  return input;
}

function compileHelper() {
  helper = path.join(output, 'native-observation');
  const source = fileURLToPath(new URL('./native-artifact-acceptance.swift', import.meta.url));
  run('xcrun', ['swiftc', source, '-o', helper], {timeout: 120_000});
}
function appScreen(image, expectedText) {
  const observed = swift('ocr', image), text = observed.lines.join(' ').toLowerCase().replace(/\s+/g, ' ');
  assert.ok(observed.width >= 400 && observed.height >= 300, 'Native screenshot is too small');
  assert.ok(expectedText.some(label => text.includes(label.toLowerCase())), `Native frontend not recognized in ${path.basename(image)}: ${text}`);
  assert.ok(!/보관함을 열 수|안전 복구 안내|storage recovery/.test(text), 'Storage recovery screen is not successful startup');
  check('actual frontend recognized in native screenshot', {image: path.basename(image), width: observed.width, height: observed.height, recognizedText: observed.lines});
}
function encryptedLibrary(container) {
  const root = fs.realpathSync(container), matches = files(root).filter(file => path.basename(file) === 'notes.db');
  assert.equal(matches.length, 1, 'Expected one encrypted library in the installed app container');
  const db = matches[0], marker = db + '.mobile-key', bytes = fs.readFileSync(db), identity = fs.readFileSync(marker);
  assert.ok(fs.realpathSync(db).startsWith(root + path.sep), 'Library escaped the app data container');
  assert.ok(bytes.length >= 4096 && !bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')), 'Mobile library is missing or plaintext');
  assert.ok(/^INKISM-MOBILE-KEY-1\n[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(identity.toString()), 'Invalid mobile key identity marker');
  assert.equal(fs.statSync(marker).mode & 0o077, 0, 'Key identity marker is not private');
  return {relativePath: path.relative(root, db), bytes: bytes.length, encryptedHeaderHash: hash(bytes.subarray(0, 16)), identityHash: hash(identity)};
}
async function ios(input) {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64', 'Artifact is arm64 simulator code');
  const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(input, 'Info.plist')]));
  assert.equal(info.CFBundleIdentifier, bundleId);
  assert.deepEqual(info.CFBundleSupportedPlatforms, ['iPhoneSimulator']);
  fs.accessSync(path.join(input, info.CFBundleExecutable), fs.constants.X_OK);
  assert.ok(run('lipo', ['-archs', path.join(input, info.CFBundleExecutable)]).trim().split(/\s+/).includes('arm64'));
  const runtimes = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes.filter(runtime => runtime.isAvailable && runtime.identifier.includes('iOS'));
  const version = runtime => {const parts = runtime.version.split('.').map(Number); return parts[0] * 1_000_000 + (parts[1] ?? 0) * 1000 + (parts[2] ?? 0);};
  runtimes.sort((a, b) => version(b) - version(a));
  assert.ok(runtimes.length, 'No installed iOS simulator runtime; no runtime download or app rebuild is attempted');
  const types = JSON.parse(run('xcrun', ['simctl', 'list', 'devicetypes', '--json'])).devicetypes;
  const supported = runtimes[0].supportedDeviceTypes?.map(type => type.identifier);
  const candidates = types.filter(type => type.name.includes('iPad') && (!supported || supported.includes(type.identifier))).reverse();
  assert.ok(candidates.length, 'No installed iPad simulator device type');
  let type;
  for (const candidate of candidates.slice(0, 3)) {
    const created = spawnSync('xcrun', ['simctl', 'create', `Inkism artifact acceptance ${process.pid}`, candidate.identifier, runtimes[0].identifier], {encoding: 'utf8', timeout: 30_000});
    if (created.status === 0) {device = created.stdout.trim(); type = candidate; break;}
  }
  assert.ok(device, 'Installed device types are incompatible with the installed iOS runtime');
  assert.match(device, /^[0-9a-f-]{36}$/i);
  check('fresh matching simulator created', {runtime: runtimes[0].version, deviceType: type.name, appSDK: info.DTSDKName});
  run('xcrun', ['simctl', 'boot', device]);
  run('xcrun', ['simctl', 'bootstatus', device, '-b'], {timeout: 240_000});
  run('xcrun', ['simctl', 'install', device, input], {timeout: 120_000});
  const container = run('xcrun', ['simctl', 'get_app_container', device, bundleId, 'data']).trim();
  assert.ok(path.isAbsolute(container));
  let previous;
  for (const stage of ['first', 'restart']) {
    check('request installed simulator app launch', {stage});
    const launch = run('xcrun', ['simctl', 'launch', device, bundleId, '-AppleLanguages', '(en)', '-AppleLocale', 'en_US']);
    const pid = Number(launch.match(/:\s*(\d+)\s*$/)?.[1]);
    assert.ok(pid > 0, 'Simulator did not report the launched app process');
    check('installed simulator app process launched', {stage, pid});
    await until(() => {assert.ok(alive(pid), 'Simulator app exited during startup'); try {encryptedLibrary(container); return true;} catch {return false;}}, 'Encrypted private library was not initialized');
    const image = path.join(output, `ios-${stage}.png`);
    await until(() => {assert.ok(alive(pid), 'Simulator app exited before rendering'); run('xcrun', ['simctl', 'io', device, 'screenshot', image]); try {appScreen(image, ['new note', 'no notes yet', 'select a note', 'all notes', '새 노트', '아직 노트가 없습니다']); return true;} catch {return false;}}, 'Installed iOS frontend did not render its note UI', 60_000);
    const storage = encryptedLibrary(container);
    if (previous) {
      assert.equal(storage.identityHash, previous.identityHash, 'Key identity changed on process restart');
      assert.equal(storage.relativePath, previous.relativePath, 'Library path changed on process restart');
      assert.equal(storage.encryptedHeaderHash, previous.encryptedHeaderHash, 'Encrypted library was recreated on process restart');
    }
    previous = storage;
    check('encrypted app-container library opened', {stage, ...storage, osKeyValuesLogged: false});
    const termination = {stage, pid, requestedAt: new Date().toISOString(), aliveBefore: alive(pid), commandReturned: false};
    evidence.simulatorTerminations ??= [];
    evidence.simulatorTerminations.push(termination); save();
    try {
      run('xcrun', ['simctl', 'terminate', device, bundleId]);
      termination.commandReturned = true;
    } finally {
      termination.aliveAfterCommand = alive(pid); termination.observedAt = new Date().toISOString(); save();
    }
    await until(() => !alive(pid), 'Simulator app did not terminate');
    check('installed simulator app process terminated', {stage, pid});
  }
  evidence.limitations = ['Historical artifact, not current harness HEAD', 'Simulator Keychain APIs and process restart; no physical Secure Enclave, lock-state, installation signing, IME or migration claim', 'No mobile note-edit, touch or separate external WebViewer acceptance'];
}

function engineRequest(engine, database, request) {
  const reply = JSON.parse(run(engine, ['--db', database], {input: JSON.stringify(request) + '\n', timeout: 30_000}).trim());
  assert.equal(reply.ok, true, `Packaged engine rejected ${request.op}`);
  return reply.data;
}
async function macos(input) {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64', 'Artifact is aarch64 macOS code');
  const mount = path.join(output, 'mounted'); fs.mkdirSync(mount);
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, input]); mounted = mount;
  const bundles = fs.readdirSync(mount).filter(name => name.endsWith('.app'));
  assert.equal(bundles.length, 1, 'Expected one application in the DMG');
  const app = path.join(output, 'installed', bundles[0]); fs.mkdirSync(path.dirname(app), {recursive: true});
  run('ditto', [path.join(mount, bundles[0]), app]);
  run('hdiutil', ['detach', mount]); mounted = undefined;
  const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents', 'Info.plist')]));
  assert.equal(info.CFBundleIdentifier, bundleId);
  const binary = path.join(app, 'Contents', 'MacOS', info.CFBundleExecutable), engine = path.join(path.dirname(binary), 'inkism-engine');
  for (const executable of [binary, engine]) {fs.accessSync(executable, fs.constants.X_OK); assert.ok(run('lipo', ['-archs', executable]).trim().split(/\s+/).includes('arm64'));}
  check('DMG mounted read-only and app/sidecar copied with matching architecture');
  const profiles = {};
  for (const name of ['A', 'B']) {
    const database = path.join(output, 'profiles', name, 'notes.db'); fs.mkdirSync(path.dirname(database), {recursive: true});
    const note = engineRequest(engine, database, {op: 'save', note: {title: `Native profile ${name}`, content: `<p>Native acceptance profile ${name}</p>`, content_format: 'html', tags: []}});
    engineRequest(engine, database, {op: 'workspace_set', ids: [note.id], active: note.id, locations: {}});
    profiles[name] = {database, note};
  }
  for (const [index, name] of ['A', 'B', 'A'].entries()) {
    const profile = profiles[name], log = fs.openSync(path.join(output, `macos-${index}-${name}.log`), 'w');
    child = spawn(binary, ['--db', profile.database], {stdio: ['ignore', log, log]}); fs.closeSync(log);
    let exit; child.once('exit', (code, signal) => {exit = {code, signal};}); child.once('error', error => {exit = {error: error.message};});
    let window;
    await until(() => {assert.ok(!exit, `Native app exited during startup: ${JSON.stringify(exit)}`); try {window = swift('window', String(child.pid)); return !!window.windowId;} catch {return false;}}, 'Installed macOS application did not open a visible native window');
    const image = path.join(output, `macos-${index}-${name}.png`);
    collectSidecars(child.pid);
    await until(() => {assert.ok(!exit, 'Native app exited before rendering'); run('screencapture', ['-x', '-l', String(window.windowId), image]); try {appScreen(image, [`native profile ${name}`, `native acceptance profile ${name}`]); return true;} catch {return false;}}, `Native window did not display isolated profile ${name}`, 60_000);
    assert.equal(swift('terminate', String(child.pid)).requested, true, 'macOS refused the native quit request');
    await until(() => !!exit, 'Native app did not finish a normal quit', 20_000);
    assert.equal(exit.code, 0, 'Native application quit failed'); child = undefined;
    const current = engineRequest(engine, profile.database, {op: 'get', id: profile.note.id});
    assert.equal(current.content, profile.note.content); assert.equal(current.revision, profile.note.revision);
    assert.equal(current.title, profile.note.title);
    check('native startup, requested quit and unchanged library content', {stage: index, profile: name});
  }
  evidence.limitations = ['Historical unsigned test DMG; no Gatekeeper/notarization, updater, real-user installation or physical IME claim', 'A/B library paths selected by --db, not separate WebViewer cookie/data-store isolation', 'Native display and quit with saved fixtures; no new text input or pending-write close-save claim'];
}

async function cleanup() {
  const errors = [];
  if (child) {
    if (child.pid) collectSidecars(child.pid);
    try {child.kill('SIGTERM'); await until(() => !alive(child.pid), 'App survived cleanup', 5000);} catch {try {child.kill('SIGKILL');} catch {}}
  }
  for (const [pid, identity] of nativeChildren) {
    try {
      if (processIdentity(pid) !== identity) continue;
      process.kill(pid, 'SIGTERM');
      try {await until(() => !alive(pid), 'Owned sidecar survived cleanup', 5000);} catch {
        if (processIdentity(pid) === identity) process.kill(pid, 'SIGKILL');
      }
    } catch (error) {if (error.code !== 'ESRCH') errors.push(error.message);}
  }
  if (mounted) {try {run('hdiutil', ['detach', mounted]);} catch (error) {errors.push(error.message);}}
  if (device) {
    try {run('xcrun', ['simctl', 'shutdown', device]);} catch (error) {errors.push(error.message);}
    try {run('xcrun', ['simctl', 'delete', device]);} catch (error) {errors.push(error.message);}
  }
  if (errors.length) {evidence.cleanupErrors = errors; throw new Error('Native acceptance cleanup failed');}
}
try {
  save(); const input = prepare();
  if (!prepareOnly) {assert.notEqual(platform, 'android', 'Android runtime acceptance is owned by native-artifact-android.py'); compileHelper(); await (platform === 'ios' ? ios(input) : macos(input));}
  evidence.result = prepareOnly ? 'prepared' : 'success';
} catch (error) {
  evidence.result = 'failure'; evidence.error = error.message;
  if (error.nativeCommand) evidence.failedCommand = error.nativeCommand;
  process.exitCode = 1; console.error(error.message);
} finally {
  try {await cleanup();} catch (error) {evidence.result = 'failure'; process.exitCode = 1; console.error(error.message);}
  evidence.finishedAt = new Date().toISOString(); save();
}
