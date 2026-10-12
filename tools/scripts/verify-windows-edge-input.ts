// Check exact source after native document-edge typing in an isolated fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as fixture from './verify-windows-windowed-ime.ts';

function verify() {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Error(`expected 4 arguments (ENGINE DATABASE FIXTURE start|both), got ${args.length}`);
  const [engine, db, file, mode] = args;
  assert.ok(mode === 'start' || mode === 'both', 'Unknown verification mode');
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  const note = fixture.rpc(engine, db, {op: 'get', id: expected.id});
  let body = expected.content.replace('<p>', '<p>edge_start');
  if (mode === 'both') body = body.slice(0, -4) + 'edge_end</p>';
  assert.ok(note.content === body, 'Edge input position or original source changed');
  fixture.metaUnchanged(note, expected);
  console.log('PASS: native immediate edge input, exact 10000-block source and metadata:', mode);
}

try {
  verify();
} catch (error) {
  // Failures go to stdout like the original traceback, so the caller's log keeps them.
  console.log(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
