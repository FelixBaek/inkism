// Check credential persistence through the shipped process, using temporary data.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as sleep} from 'node:timers/promises';

const binary = path.resolve(process.argv[2]);
const key = randomBytes(32).toString('base64');
const token = 'packaged-test-private-token';
const url = 'http://127.0.0.1:9';
const header = Buffer.from('MINDBOX-DPAPI-1\n');
const withSuffix = (file: string, suffix: string) => path.join(path.dirname(file), path.parse(file).name + suffix);

function invoke(db: string, requests: object[], success = true): any[] | undefined {
  const result = spawnSync(binary, ['--db', db], {
    input: Buffer.from(requests.map(r => JSON.stringify(r) + '\n').join('')),
    timeout: 30_000, maxBuffer: Infinity,
  });
  if (result.error) throw result.error;
  for (const secret of [key, token]) {
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), 'credential leaked');
  }
  if (!success) {
    assert.notEqual(result.status, 0, 'corrupt settings must fail startup');
    assert.ok(!result.stdout.length, 'corrupt settings must not serve requests');
    return;
  }
  assert.equal(result.status, 0, result.stderr.toString());
  const lines = result.stdout.toString().split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  const responses = lines.map(line => JSON.parse(line));
  assert.equal(responses.length, requests.length);
  assert.ok(responses.every(r => r.ok), 'request failed');
  return responses.map(r => r.data);
}

type ConfigureOptions = {credential?: string, relay?: string, vaultKey?: string, migration?: boolean,
  success?: boolean, beforeRequest?: () => void, command?: object};

async function configure(db: string, {credential = token, relay = url, vaultKey = key, migration = false, success = true,
  beforeRequest, command}: ConfigureOptions = {}) {
  // Startup starts an automatic sync round. Retry the documented busy response
  // within the same process, without masking any other configuration failure.
  const child = spawn(binary, ['--db', db], {stdio: ['pipe', 'pipe', 'pipe']});
  const stderr: Buffer[] = [];
  child.stderr.on('data', chunk => stderr.push(chunk));
  const exited = new Promise<number | null>(resolve => child.once('close', resolve));
  const timer = setTimeout(() => child.kill(), 30_000);
  const lines = readline.createInterface({input: child.stdout})[Symbol.asyncIterator]();
  const readLine = async () => { const next = await lines.next(); return next.done ? '' : next.value; };
  try {
    if (beforeRequest) {
      child.stdin.write('{"op":"health"}\n');
      assert.ok(JSON.parse(await readLine()).ok);
      beforeRequest();
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = command ?? {op: 'sync_config', server_url: relay,
        token: credential, key: vaultKey, migration};
      child.stdin.write(JSON.stringify(value) + '\n');
      const line = await readLine();
      assert.ok(!line.includes(vaultKey) && !line.includes(credential));
      const response = JSON.parse(line);
      if (!response.ok && ['sync is in progress', '동기화가 진행 중'].some(message => JSON.stringify(response).includes(message))) {
        await sleep(50);
        continue;
      }
      assert.equal(response.ok, success, 'unexpected configuration result');
      if (response.ok) return response.data;
      return response;
    }
    throw new assert.AssertionError({message: 'configuration remained busy'});
  } finally {
    child.stdin.end();
    const code = await exited;
    const diagnostics = Buffer.concat(stderr);
    clearTimeout(timer);
    assert.ok(!diagnostics.includes(vaultKey) && !diagnostics.includes(credential));
    assert.equal(code, 0);
  }
}

function checkEncoding(file: string) {
  const raw = fs.readFileSync(file);
  if (process.platform === 'win32') {
    assert.ok(raw.subarray(0, header.length).equals(header));
    assert.ok(!raw.includes(key) && !raw.includes(token));
  } else {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(raw.toString()).key, key);
  }
  return raw;
}

function journal(db: string) {
  const conn = new DatabaseSync(db);
  try {
    return conn.prepare('SELECT seq,kind,id,deleted FROM sync_journal ORDER BY seq').all();
  } finally {
    conn.close();
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkism-sync-한글-'));
try {
  const db = path.join(root, '동기화.db');
  const states = () => fs.readdirSync(root).filter(name => name.startsWith(path.basename(db) + '.sync-')).map(name => path.join(root, name));
  const config = db + '.sync.json';
  assert.ok((await configure(db)).configured);
  assert.equal(states().length, 1);
  const active = states()[0];
  const original = checkEncoding(config);
  const status = invoke(db, [{op: 'sync_status'}])![0];
  assert.ok(status.configured && status.server_url === url);
  assert.ok(fs.readFileSync(config).equals(original), 'ordinary reopen must not rewrite settings');
  // Same vault without migration:true only succeeds if the old key survived.
  assert.ok((await configure(db, {credential: token + '-rotated'})).configured);
  checkEncoding(config);
  assert.deepEqual(states(), [active], 'token rotation replaced state');

  // Force persistence failure with a directory at the config path. Previous
  // in-memory sync, durable state and queued edits must survive the rejection.
  await configure(db, {command: {op: 'sync_pause', paused: true}});
  const note = invoke(db, [{op: 'save', note: {title: '설정 실패 보존',
    content: '<p>한글😀</p>', text: '미전송 편집'}}])![0];
  const previousConfig = fs.readFileSync(config);
  const previousState = fs.readFileSync(active);
  const journalBefore = journal(db);
  assert.ok(journalBefore.length, 'paused fixture did not retain local edits');
  const backup = withSuffix(config, '.preserved');
  const marker = path.join(config, 'keep');
  const preventPersistence = () => {
    fs.renameSync(config, backup);
    fs.mkdirSync(config);
    fs.writeFileSync(marker, 'unowned');
  };
  await configure(db, {relay: 'http://127.0.0.1:10', migration: true, success: false,
    beforeRequest: preventPersistence});
  assert.equal(fs.readFileSync(marker, 'latin1'), 'unowned');
  assert.ok(fs.readFileSync(active).equals(previousState));
  assert.deepEqual(states(), [active], 'failed candidate remained');
  assert.deepEqual(journal(db), journalBefore);
  fs.unlinkSync(marker);
  fs.rmdirSync(config);
  fs.renameSync(backup, config);
  assert.ok(fs.readFileSync(config).equals(previousConfig));
  assert.deepEqual(invoke(db, [{op: 'get', id: note.id}])![0], note);

  const legacyDb = path.join(root, '기존설정.db');
  const legacy = legacyDb + '.sync.json';
  fs.writeFileSync(legacy, JSON.stringify({version: 1, server_url: url, token, key}), 'utf8');
  if (process.platform !== 'win32') fs.chmodSync(legacy, 0o600);
  assert.ok(invoke(legacyDb, [{op: 'sync_status'}])![0].configured);
  checkEncoding(legacy);
  assert.ok((await configure(legacyDb)).configured);

  // A protected envelope must never be accepted as an empty configuration.
  const broken = Buffer.concat([header, Buffer.from('invalid-ciphertext')]);
  fs.writeFileSync(config, broken);
  invoke(db, [{op: 'sync_status'}], false);
  assert.ok(fs.readFileSync(config).equals(broken));
  fs.writeFileSync(config, previousConfig);
  assert.ok(invoke(db, [{op: 'sync_status'}])![0].configured);

  // A configured generation must never silently become a fresh device.
  const preservedState = withSuffix(active, '.preserved');
  fs.renameSync(active, preservedState);
  invoke(db, [{op: 'sync_status'}], false);
  assert.ok(!fs.existsSync(active));
  fs.writeFileSync(active, '');
  invoke(db, [{op: 'sync_status'}], false);
  assert.equal(fs.readFileSync(active).length, 0);
  fs.unlinkSync(active);
  fs.renameSync(preservedState, active);
  assert.deepEqual(invoke(db, [{op: 'get', id: note.id}])![0], note);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log('PASS: packaged sync credentials, generations, failed transition preservation, restart, token rotation, legacy migration, corrupt/missing/empty state rejection');
