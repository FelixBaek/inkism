/* Synthetic native version-restore fixture; never restores through the CLI.

Usage: seed|cancel|restored ENGINE DATABASE MANIFEST encrypted|plaintext
The UI must perform cancellation and restoration between verifier calls.
*/
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 5) throw new Error(`expected 5 arguments (seed|cancel|restored ENGINE DATABASE MANIFEST encrypted|plaintext), got ${args.length}`);
const [mode, engine, database, manifest, storage] = args;

function rpc(request: object, initialize = false) {
  const argv = ['--db', database];
  if (initialize) argv.push('--initialize-encrypted');
  const result = spawnSync(engine, argv, {input: Buffer.from(JSON.stringify(request) + '\n'), timeout: 45_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  const reply = JSON.parse(result.stdout.toString());
  assert.ok(reply.ok, String(reply.error));
  return reply.data;
}

if (mode === 'seed') {
  assert.ok(!fs.existsSync(database), 'fixture requires a fresh database');
  const entries = [];
  for (const [index, [format, old, current]] of [
    ['html', '<p>이전원본 &amp; 한글</p>\r\n<!-- 보존 -->',
      '<p>현재원본 <strong>한글</strong></p>\r\n<!-- 최신 -->'],
    ['text', '이전원본\r\n<p>그대로 & 한글\r\n', '현재원본\r\n<b>원문 & 한글\r\n'],
    ['markdown', '# 이전원본\r\n\r\n- **한글** <!-- 보존 -->\r\n',
      '# 현재원본\r\n\r\n- `한글` <!-- 최신 -->\r\n'],
  ].entries()) {
    const title = 'history-native-' + path.basename(path.dirname(path.resolve(manifest))) + '-' + format;
    const oldNote = rpc({op: 'save', note: {title, content_format: format,
      content: old, tags: ['history-fixture']}},
    index === 0 && storage === 'encrypted');
    const newNote = rpc({op: 'save', note: {id: oldNote.id, revision: 1,
      content_format: format, content: current}});
    assert.equal(newNote.revision, 2);
    const history = rpc({op: 'history', id: oldNote.id});
    assert.equal(history.length, 1);
    entries.push({id: oldNote.id, title, format,
      old, new: current, history_id: history[0].id});
  }
  assert.deepEqual(rpc({op: 'storage_status'}), {encrypted: storage === 'encrypted'});
  fs.writeFileSync(manifest, JSON.stringify(entries), 'utf8');
} else if (mode === 'cancel' || mode === 'restored') {
  const entries = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const entry of entries) {
    const note = rpc({op: 'get', id: entry.id});
    const expected = mode === 'restored' ? entry.old : entry.new;
    assert.equal(note.content, expected, `${entry.format} exact source`);
    assert.equal(note.content_format, entry.format);
    assert.ok(note.title === entry.title);
    assert.deepEqual(note.tags, ['history-fixture']);
    assert.equal(note.revision, mode === 'restored' ? 3 : 2, 'unexpected revision');
    const history = rpc({op: 'history', id: entry.id});
    assert.equal(history.length, mode === 'restored' ? 2 : 1);
    assert.ok(history.some((item: any) => item.id === entry.history_id));
    if (mode === 'restored') {
      const previous = rpc({op: 'revision_body', id: entry.id, revision: 2});
      assert.equal(previous.content, entry.new, 'pre-restore version lost');
      assert.equal(previous.content_format, entry.format);
    }
  }
} else {
  throw new Error(mode);
}
console.log(`PASS: native history fixture ${mode}; exact sources, formats, tags and revisions`);
