// Windows packaged Rust shell, DPAPI reopen and quarantine checks.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const shell = path.resolve(process.argv[2]);
const engine = path.join(path.dirname(shell), 'inkism-engine.exe');

function invoke(binary: string, db: string, args: string[] = [], data = Buffer.alloc(0), success = true) {
  const result = spawnSync(binary, ['--db', db, ...args], {input: data, timeout: 90_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  if (success) assert.equal(result.status, 0, result.stderr.toString());
  else assert.notEqual(result.status, 0, 'unexpected success');
  return result;
}

function request(db: string, value: object) {
  const result = invoke(engine, db, [], Buffer.from(JSON.stringify(value) + '\n'));
  const reply = JSON.parse(result.stdout.toString());
  assert.ok(reply.ok, JSON.stringify(reply));
  return reply.data;
}

const startsWith = (data: Buffer, prefix: string) => data.subarray(0, Buffer.byteLength(prefix, 'latin1')).equals(Buffer.from(prefix, 'latin1'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkism-encrypted-copy-'));
try {
  const source = path.join(root, '원본 & 복사.db');
  const saved = request(source, {op: 'save', note: {
    title: '복사 검증', content: '<p><strong>암호화이전검색어</strong></p>',
    text: '암호화이전검색어', tags: ['보존']}});
  assert.deepEqual(request(source, {op: 'storage_status'}), {encrypted: false});
  const payload = Buffer.from(Array.from({length: 256 * 4096}, (_, i) => i % 256));
  const attachment = JSON.parse(invoke(engine, source,
    ['--attachment-import', '--attachment-name', '첨부.bin'], payload).stdout.toString());
  const before = Object.fromEntries(['', '.search', '.attachments'].map(suffix => [suffix, fs.readFileSync(source + suffix)]));
  // This is the shipped Tauri shell, including its existing .lock launch order.
  const destination = path.join(root, '새 암호화 저장소');
  invoke(shell, source, ['--copy-encrypted-to', destination]);
  const target = path.join(destination, 'notes.db');
  assert.ok(startsWith(fs.readFileSync(path.join(destination, 'notes.db.storage-key')), 'MINDBOX-LOCAL-KEY-1\n'));
  assert.ok(!fs.existsSync(path.join(destination, 'notes.db.migration-incomplete')));
  for (const [suffix, data] of Object.entries(before)) {
    assert.ok(fs.readFileSync(source + suffix).equals(data));
    assert.ok(!startsWith(fs.readFileSync(target + suffix), 'SQLite format 3\0'));
  }
  assert.deepEqual(request(target, {op: 'storage_status'}), {encrypted: true});
  const note = request(target, {op: 'get', id: saved.id});
  assert.equal(note.content, '<p><strong>암호화이전검색어</strong></p>');
  assert.deepEqual(note.tags, ['보존']);
  request(target, {op: 'wait_index'});
  const found = request(target, {op: 'list', view: 'all', query: '암호화이전검색어'});
  assert.equal(found.items[0].id, saved.id);
  const exported = invoke(engine, target, ['--attachment-export', attachment.id]);
  assert.ok(exported.stdout.equals(payload));
  // Never route expected errors through the GUI shell's startup error dialog.
  invoke(engine, source, ['--copy-encrypted-to', destination], Buffer.alloc(0), false);
  const live = spawn(engine, ['--db', source], {stdio: ['pipe', 'pipe', 'pipe']});
  live.stderr.resume();
  const liveExit = new Promise(resolve => live.once('close', resolve));
  try {
    live.stdin.write('{"op":"health"}\n');
    const lines = readline.createInterface({input: live.stdout})[Symbol.asyncIterator]();
    let timer: NodeJS.Timeout | undefined;
    const first = await Promise.race([lines.next(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('health response timed out')), 20_000);
    })]).finally(() => clearTimeout(timer));
    assert.ok(JSON.parse(first.done ? '' : first.value).ok);
    const blocked = path.join(root, 'busy-copy');
    const error = invoke(engine, source, ['--copy-encrypted-to', blocked], Buffer.alloc(0), false);
    assert.ok(error.stderr.includes('library is in use'));
    assert.ok(!fs.existsSync(blocked));
  } finally {
    live.kill();
    const timer = setTimeout(() => { throw new Error('live engine did not exit'); }, 15_000);
    await liveExit;
    clearTimeout(timer);
  }
  // Failed copy creates a quarantine; neither note nor attachment startup may bypass it.
  const broken = path.join(root, 'broken.db');
  request(broken, {op: 'health'});
  fs.writeFileSync(broken + '.attachments', 'corrupt-source');
  const failed = path.join(root, 'failed-copy');
  invoke(engine, broken, ['--copy-encrypted-to', failed], Buffer.alloc(0), false);
  const quarantined = path.join(failed, 'notes.db');
  assert.ok(fs.existsSync(path.join(failed, 'notes.db.migration-incomplete')));
  for (const args of [[], ['--attachment-list']]) {
    const result = invoke(engine, quarantined, args, Buffer.alloc(0), false);
    assert.ok(result.stderr.includes('copy is incomplete'));
  }
  assert.equal(fs.readFileSync(broken + '.attachments', 'latin1'), 'corrupt-source');
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log('PASS: packaged encrypted copy, original preservation, keyed note/search/attachment reopen, busy and failed-copy isolation');
