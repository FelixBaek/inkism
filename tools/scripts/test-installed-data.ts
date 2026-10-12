/* Synthetic installed-app data fixture: seed, encrypted copy, byte-exact reopen.

Usage: node test-installed-data.ts seed|verify ENGINE_EXE FIXTURE_DIRECTORY

seed creates a fresh plaintext library holding three exact synthetic originals
(html / literal text / markdown source; Korean, CRLF, comments, escapes), one
synthetic-byte attachment, and an encrypted copy in a NEW subfolder produced by
the same ENGINE_EXE via --copy-encrypted-to. Both libraries are re-read through
the engine and recorded in expected.json with recursive file hashes.

verify first compares every fixture file against that manifest BEFORE opening
the engine (install/upgrade/removal must not touch the synthetic data), then
reopens both libraries and re-checks exact notes, search, attachment metadata
and decrypted attachment bytes. The manifest itself is the only file excluded
from hashing; sensitive values and key material are never printed.
*/
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 3) throw new Error(`expected 3 arguments (seed|verify ENGINE_EXE FIXTURE_DIRECTORY), got ${args.length}`);
const [mode, executable, directory] = args;
const engine = path.resolve(executable);
const root = path.resolve(directory);
const db = path.join(root, 'notes.db');
const manifest = path.join(root, 'expected.json');
const encryptedDir = path.join(root, '암호화 사본');
const encryptedDb = path.join(encryptedDir, 'notes.db');
const payload = Buffer.from(Array.from({length: 256 * 1025}, (_, i) => i % 256));
const sqliteHeader = Buffer.from('SQLite format 3\0', 'latin1');
const keyMagic = Buffer.from('MINDBOX-LOCAL-KEY-1\n');
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// Three distinct exact originals: markup vs literal text vs markdown source,
// with Korean, CRLF endings, comments and escapes preserved verbatim. Explicit
// source-format saves derive the stored `text` from the exact source, even HTML.
// `query` is a distinctive FTS probe proving decryption-backed search.
const NOTES = [
  {title: '설치 검증 HTML', content: '<p>설치보존 &amp; 업그레이드 <strong>원본</strong></p>',
    tags: ['installer-test'],
    content_format: 'html', query: '설치보존'},
  {title: '설치 검증 TEXT',
    content: '첫째 줄 텍스트원본\r\n둘째 줄 <p>이스케이프 없음 & 그대로\r\n#주석 줄',
    tags: ['installer-test', '텍스트보존'], content_format: 'text',
    query: '텍스트원본'},
  {title: '설치 검증 MARKDOWN',
    content: '# 마크다운원본\r\n\r\n- 항목 `코드` <!-- 주석 --> & 특수문자\r\n',
    tags: ['installer-test', '마크다운보존'], content_format: 'markdown',
    query: '마크다운원본'},
];
const FIELDS = ['id', 'title', 'content', 'text', 'tags', 'content_format', 'revision'];

function call(target: string, extra: string[] = [], input = Buffer.alloc(0)): Buffer {
  const result = spawnSync(engine, ['--db', target, ...extra], {input, timeout: 90_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function rpc(target: string, request: object) {
  const result = JSON.parse(call(target, [], Buffer.from(JSON.stringify(request) + '\n')).toString());
  assert.ok(result.ok, result.error ?? 'rpc failed');
  return result.data;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() ? [full] : [];
  });
}

/** Recursive fixture hashes; the manifest itself is the only exclusion. */
function hashes(): Record<string, string> {
  const files = walk(root).filter(p => p !== manifest).sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(files.map(p => [path.relative(root, p), sha256(fs.readFileSync(p))]));
}

/** Shared seed/verify re-read through the engine only: exact originals,
 * content_format/tags/revision, decryption-backed search, attachment
 * metadata and exact attachment bytes. */
function checkLibrary(target: string, encrypted: boolean, entries: any[], attachment: any) {
  const status = rpc(target, {op: 'storage_status'});
  assert.deepEqual(status, {encrypted}, JSON.stringify(status));
  for (const expected of entries) {
    const note = rpc(target, {op: 'get', id: expected.id});
    for (const field of FIELDS) assert.deepEqual(note[field], expected[field], `${expected.id} ${field}`);
  }
  rpc(target, {op: 'wait_index'});
  for (const expected of entries) {
    const found = rpc(target, {op: 'list', view: 'all', query: expected.query});
    assert.ok(found.items.some((item: any) => item.id === expected.id), `search missing ${expected.query}`);
  }
  const info = JSON.parse(call(target, ['--attachment-info', attachment.id]).toString());
  assert.deepEqual(info, attachment, 'attachment metadata changed');
  const exported = call(target, ['--attachment-export', attachment.id]);
  assert.equal(exported.length, attachment.size, 'attachment size changed');
  assert.equal(sha256(exported), attachment.sha256, 'attachment bytes changed');
}

if (mode === 'seed') {
  fs.mkdirSync(root);
  const entries = [];
  for (const source of NOTES) {
    const {query, ...request} = source;
    const saved = rpc(db, {op: 'save', note: request});
    assert.equal(saved.revision, 1, 'new note revision');
    const entry: any = {id: saved.id, title: source.title, content: source.content,
      text: source.content, tags: source.tags,
      content_format: source.content_format, revision: saved.revision,
      query: source.query};
    for (const field of FIELDS) assert.deepEqual(saved[field], entry[field], `${saved.id} ${field}`);
    entries.push(entry);
  }
  const attachment = JSON.parse(call(db, ['--attachment-import', '--attachment-name', 'fixture.bin'], payload).toString());
  assert.equal(attachment.size, payload.length, 'attachment import size');
  assert.equal(attachment.sha256, sha256(payload), 'attachment import sha');
  rpc(db, {op: 'wait_index'});
  const before = hashes();
  const copied = JSON.parse(call(db, ['--copy-encrypted-to', encryptedDir]).toString());
  assert.ok(copied.ok, 'encrypted copy failed');
  const after = hashes();
  const sourceAfter = Object.fromEntries(Object.entries(after).filter(([k]) => {
    const rel = path.relative(encryptedDir, path.join(root, k));
    return rel.startsWith('..') || path.isAbsolute(rel);
  }));
  // SQLite's read-only copy connection may create/remove WAL/SHM sidecars.
  // Persistent source files must remain byte-identical; both libraries are
  // also reopened below. The installer manifest still hashes ALL sidecars.
  const sidecars = new Set(['notes.db', 'notes.db.search', 'notes.db.attachments']
    .flatMap(name => ['-wal', '-shm'].map(suffix => name + suffix)));
  const changed = [...new Set([...Object.keys(before), ...Object.keys(sourceAfter)])].sort((a, b) => a.localeCompare(b))
    .filter(k => !sidecars.has(k) && before[k] !== sourceAfter[k]);
  assert.ok(!changed.length, `copy changed the plaintext source: ${JSON.stringify(changed)}`);
  const keyPath = path.join(encryptedDir, 'notes.db.storage-key');
  const keyBytes = fs.readFileSync(keyPath);
  assert.ok(keyBytes.subarray(0, keyMagic.length).equals(keyMagic), 'missing local key envelope');
  assert.ok(!fs.existsSync(path.join(encryptedDir, 'notes.db.migration-incomplete')),
    'incomplete copy marker left behind');
  for (const name of ['notes.db', 'notes.db.search', 'notes.db.attachments']) {
    assert.ok(fs.readFileSync(path.join(root, name)).subarray(0, 16).equals(sqliteHeader), `plaintext ${name}`);
    assert.ok(!fs.readFileSync(path.join(encryptedDir, name)).subarray(0, 16).equals(sqliteHeader),
      `encrypted ${name} is plaintext`);
  }
  checkLibrary(db, false, entries, attachment);
  checkLibrary(encryptedDb, true, entries, attachment);
  const expected = {notes: entries, attachment,
    storage_key_sha256: sha256(keyBytes),
    hashes: hashes()};
  fs.writeFileSync(manifest, JSON.stringify(expected), 'utf8');
} else if (mode === 'verify') {
  const expected = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  // Compare the whole tree BEFORE the engine can touch a single file.
  const current = hashes();
  const changed = [...new Set([...Object.keys(current), ...Object.keys(expected.hashes)])].sort((a, b) => a.localeCompare(b))
    .filter(k => current[k] !== expected.hashes[k]);
  assert.ok(!changed.length, `fixture files changed before reopen: ${JSON.stringify(changed)}`);
  const keyBytes = fs.readFileSync(path.join(encryptedDir, 'notes.db.storage-key'));
  assert.ok(keyBytes.subarray(0, keyMagic.length).equals(keyMagic), 'missing local key envelope');
  assert.equal(sha256(keyBytes), expected.storage_key_sha256, 'key envelope changed');
  checkLibrary(db, false, expected.notes, expected.attachment);
  checkLibrary(encryptedDb, true, expected.notes, expected.attachment);
  // Read-only reopen may create/remove SQLite sidecars. Snapshot for next phase.
  expected.hashes = hashes();
  fs.writeFileSync(manifest, JSON.stringify(expected), 'utf8');
} else {
  throw new Error(mode);
}
console.log(`PASS: installer fixture ${mode}; three originals, encrypted copy, attachment bytes`);
