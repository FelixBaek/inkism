// Verify synthetic native-source acceptance artifacts using the real runtime.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 3) throw new Error(`expected 3 arguments (ENGINE DATABASE EXPECTED_JSON), got ${args.length}`);
const [engine, database, expectedFile] = args;
const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8').replace(/^﻿/, ''));

function rpc(request: object) {
  const result = spawnSync(path.resolve(engine), ['--db', path.resolve(database)],
    {input: Buffer.from(JSON.stringify(request) + '\n'), timeout: 45_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  const value = JSON.parse(result.stdout.toString());
  assert.ok(value.ok, JSON.stringify(value));
  return value.data;
}

const items = rpc({op: 'list', view: 'all'}).items;
for (const testCase of expected) {
  const matching = items.filter((item: any) => item.title === testCase.title);
  assert.equal(matching.length, 1, `missing/duplicate title ${testCase.title} ${matching.length}`);
  const note = rpc({op: 'get', id: matching[0].id});
  assert.equal(note.content_format, testCase.format, `${testCase.title} ${note.content_format}`);
  // Blocks edited in the rich editor gain a random ink-block id; every other byte must match.
  const content = testCase.format === 'html' ? note.content.replace(/ id="ink-block-[0-9a-f-]{36}"/g, '') : note.content;
  assert.equal(content, testCase.content, `raw UTF-8 differs ${testCase.title} ${JSON.stringify(note.content)} ${JSON.stringify(testCase.content)}`);
  assert.ok(note.revision >= 1);
}
console.log(`PASS: ${expected.length} source notes preserve exact UTF-8 and explicit format after native close`);
