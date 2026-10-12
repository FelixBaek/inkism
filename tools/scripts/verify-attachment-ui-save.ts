// Verify the attachment chosen by Windows UI against persisted Rust bytes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length !== 3) throw new Error(`expected 3 arguments (ENGINE DATABASE ORIGINAL), got ${args.length}`);
const [engine, db, original] = args;

function run(extra: string[], input = Buffer.alloc(0)) {
  const result = spawnSync(engine, ['--db', db, ...extra], {input, timeout: 30_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`engine exited with ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function request(payload: object) {
  const response = JSON.parse(run([], Buffer.from(JSON.stringify(payload) + '\n')).toString());
  assert.ok(response.ok, JSON.stringify(response));
  return response.data;
}

const notes = request({op: 'list', view: 'all'}).items;
const note = notes.find((n: any) => n.title === 'Windows 첨부 검사');
if (!note) throw new Error('note "Windows 첨부 검사" not found');
const content = request({op: 'get', id: note.id}).content;
const match = /data-attachment-url="\/api\/attachments\/([0-9a-f-]{36})"/.exec(content);
assert.ok(match, content);
assert.ok(content.includes(`href="/api/attachments/${match[1]}"`), content);
assert.ok(run(['--attachment-export', match[1]]).equals(fs.readFileSync(original)));
console.log('PASS: native file selection persisted its card, original link and exact attachment bytes');
