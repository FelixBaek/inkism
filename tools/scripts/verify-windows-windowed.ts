// Seed/verify an isolated 10000-block HTML document around native mid-document typing.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length !== 4) throw new Error(`expected 4 arguments (ENGINE DATABASE FIXTURE seed|verify), got ${args.length}`);
const [engine, db, file, mode] = args;
const block = (i: number) => 'nativeblock' + String(i).padStart(5, '0');
function rpc(req: object) {
  const r = spawnSync(engine, ['--db', db], {input: Buffer.from(JSON.stringify(req) + '\n'), timeout: 60_000, maxBuffer: Infinity});
  if (r.error) throw r.error;
  assert.equal(r.status, 0, r.stderr.toString());
  const v = JSON.parse(r.stdout.toString());
  assert.ok(v.ok, JSON.stringify(v));
  return v.data;
}
if (mode === 'seed') {
  const content = Array.from({length: 10000}, (_, i) => `<p>${block(i)} original paragraph</p>`).join('');
  const note = rpc({op: 'save', note: {title: 'Native 10000 blocks', content, content_format: 'html'}});
  rpc({op: 'wait_index'}); rpc({op: 'workspace_set', ids: [note.id], active: note.id, locations: {}});
  fs.writeFileSync(file, JSON.stringify({id: note.id, content}), 'utf8');
  console.log('PASS seeded isolated 10000-block HTML document');
} else {
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  const note = rpc({op: 'get', id: expected.id});
  const content: string = note.content, marker = 'chunk_typed';
  const count = (s: string) => content.split(s).length - 1;
  assert.equal(count(marker), 1, String(count(marker)));
  assert.ok(content.replace(marker, '') === expected.content, 'Unrelated source changed');
  const idx = content.indexOf(marker);
  const start = content.slice(0, idx).lastIndexOf('<p>'), end = content.indexOf('</p>', idx);
  const found = content.slice(start, end); // Same negative-index semantics as Python slicing.
  assert.ok(Array.from({length: 32}, (_, i) => 5000 + i).some(i => found.includes(block(i))), found);
  assert.equal(count('<p>'), 10000);
  assert.ok(note.revision >= 2);
  console.log('PASS native mid-document insertion remains within blocks 5001-5032; all 10000 original blocks preserved after close/restart');
}
