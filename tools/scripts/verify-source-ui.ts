// Verify synthetic native-source acceptance artifacts using the real runtime.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {assertBlockBytes} from '../../frontend/scripts/block-identity-bytes.ts';

const args = process.argv.slice(2);
if (args.length !== 3) throw new Error(`expected 3 arguments (ENGINE DATABASE EXPECTED_JSON), got ${args.length}`);
const [engine, database, expectedFile] = args;
const identityFile = expectedFile + '.block-ids.json';
const identities: Record<string,string[]> = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile,'utf8')) : {};
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
  if (testCase.block_ids !== undefined) {
    identities[testCase.title] = assertBlockBytes(note.content, testCase.content, {added: testCase.block_ids, ids: identities[testCase.title], message: testCase.title + ' rich UTF-8'});
  } else assert.equal(note.content, testCase.content, `raw UTF-8 differs ${testCase.title} ${JSON.stringify(note.content)} ${JSON.stringify(testCase.content)}`);
  assert.ok(note.revision >= 1);
}
fs.writeFileSync(identityFile, JSON.stringify(identities));
console.log(`PASS: ${expected.length} source notes preserve exact UTF-8 and explicit format after native close`);
