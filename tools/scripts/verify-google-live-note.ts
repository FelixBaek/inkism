// Verify synthetic note/key preservation; never read Google account bindings.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length !== 4) throw new Error(`expected 4 arguments (baseline|verify ENGINE DATABASE MANIFEST), got ${args.length}`);
const [mode, engine, db, manifest] = args;

function rpc(request: object) {
  const result = spawnSync(engine, ['--db', db], {input: Buffer.from(JSON.stringify(request) + '\n'), timeout: 45_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'runtime process failed');
  const reply = JSON.parse(result.stdout.toString());
  assert.ok(reply.ok, 'runtime request failed');
  return reply.data;
}

const items = rpc({op: 'list', view: 'all'}).items;
assert.ok(items.length === 1 && items[0].title === 'Google 합성 노트');
const note = rpc({op: 'get', id: items[0].id});
assert.equal(note.content, '<p>google_live_saved</p>');
assert.ok(rpc({op: 'storage_status'}).encrypted);
const keyHash = createHash('sha256').update(fs.readFileSync(db + '.storage-key')).digest('hex');
const actual = {note, key_hash: keyHash};
if (mode === 'baseline') {
  assert.ok(!fs.existsSync(manifest), 'fresh synthetic manifest required');
  fs.writeFileSync(manifest, JSON.stringify(actual), 'utf8');
} else if (mode === 'verify') {
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(manifest, 'utf8')), 'note/key changed');
} else {
  throw new Error(mode);
}
console.log('PASS: synthetic original note bytes, metadata/revision and encrypted storage key ' + mode);
