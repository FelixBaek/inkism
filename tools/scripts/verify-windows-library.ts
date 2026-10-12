// Prepare/check synthetic plain/encrypted libraries; switching is performed by UI.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 4) throw new Error(`expected 4 arguments (seed|verify ENGINE DATABASE MANIFEST), got ${args.length}`);
const [mode, engine, db, manifest] = args;
const targetDir = path.join(path.dirname(db), '암호화 대상');
const target = path.join(targetDir, 'notes.db');
const payload = Buffer.from(Array.from({length: 256 * 1025}, (_, i) => i % 256));
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function call(library: string, extra: string[] = [], input = Buffer.alloc(0)): Buffer {
  const result = spawnSync(engine, ['--db', library, ...extra], {input, timeout: 90_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function rpc(library: string, request: object) {
  const reply = JSON.parse(call(library, [], Buffer.from(JSON.stringify(request) + '\n')).toString());
  assert.ok(reply.ok, String(reply.error));
  return reply.data;
}

if (mode === 'seed') {
  assert.ok(!fs.existsSync(db) && !fs.existsSync(targetDir), 'fixture requires fresh paths');
  const source = rpc(db, {op: 'save', note: {title: '원본 저장소 확인',
    content: '<p>원본 저장소 본문</p>', text: '원본 저장소 본문',
    tags: ['native-library']}});
  const attachment = JSON.parse(call(db, ['--attachment-import', '--attachment-name', 'library.bin'], payload).toString());
  const result = JSON.parse(call(db, ['--copy-encrypted-to', targetDir]).toString());
  assert.ok(result.ok);
  const destination = rpc(target, {op: 'save', note: {id: source.id, revision: 1,
    title: '암호화 대상 확인', content: '<p>암호화 대상 본문</p>',
    text: '암호화 대상 본문'}});
  const key = fs.readFileSync(target + '.storage-key');
  fs.writeFileSync(manifest, JSON.stringify({source_id: source.id, target_id: destination.id,
    target, attachment,
    key_hash: sha256(key)}), 'utf8');
} else if (mode === 'verify') {
  const expected = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const [library, id, title, body, encrypted] of [
    [db, expected.source_id, '원본 저장소 확인', '<p>원본 저장소 본문switch_saved</p>', false],
    [target, expected.target_id, '암호화 대상 확인', '<p>암호화 대상 본문</p>', true],
  ]) {
    const note = rpc(library, {op: 'get', id});
    assert.equal(note.content, body, 'library source changed or unsaved input lost');
    assert.ok(note.title === title);
    assert.deepEqual(note.tags, ['native-library']);
    assert.equal(note.content_format, 'html');
    assert.deepEqual(rpc(library, {op: 'storage_status'}), {encrypted});
    const attachment = expected.attachment;
    assert.deepEqual(JSON.parse(call(library, ['--attachment-info', attachment.id]).toString()), attachment);
    assert.ok(call(library, ['--attachment-export', attachment.id]).equals(payload));
  }
  assert.equal(sha256(fs.readFileSync(target + '.storage-key')), expected.key_hash);
} else {
  throw new Error(mode);
}
console.log(`PASS: native library fixture ${mode}; distinct libraries, original bytes, attachments and key`);
