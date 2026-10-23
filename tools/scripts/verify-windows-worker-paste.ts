// Read-only checks for the synthetic native WebView2 large clipboard fixture.
import assert from 'node:assert/strict';
import {assertBlockBytes} from '../../frontend/scripts/block-identity-bytes.ts';
import fs from 'node:fs';
import * as ime from './verify-windows-windowed-ime.ts';

const TEXT = 'P'.repeat(2 * 1024 * 1024) + ' NATIVE_PASTE_MARKER';
const PASTE = '<p><em>' + TEXT + '</em></p>';
const FOLLOW = '<p><em>' + TEXT + '_native_follow</em></p>';

function main() {
  if (process.argv.length !== 6) {
    console.error('사용법: ENGINE DATABASE FIXTURE pasted|undo|original');
    process.exitCode = 1;
    return;
  }
  const [engine, db, file, mode] = process.argv.slice(2);
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  const indexed = ime.rpc(engine, db, {op: 'wait_index'});
  assert.equal(indexed.pending, 0, '색인 지연');
  const note = ime.rpc(engine, db, {op: 'get', id: expected.id});
  ime.metaUnchanged(note, expected);
  assert.ok(note.revision > expected.revision, '네이티브 편집 리비전 미증가');
  let query: string;
  if (mode === 'pasted') {
    assertBlockBytes(note.content, FOLLOW, {added: 1, message: 'native clipboard and follow-up typing'});
    query = 'NATIVE_PASTE_MARKER';
  } else if (mode === 'original') {
    assert.ok(note.content === expected.content, '원문 10000문단 복원 불일치');
    query = 'nativeimeblock09999';
  } else if (mode === 'undo') {
    if (note.content === expected.content) {
      console.log('STATE=original');
      return;
    }
    assertBlockBytes(note.content, PASTE, {added: 1, message: 'native clipboard after undoing follow-up typing'});
    console.log('STATE=paste');
    return;
  } else {
    throw new Error(mode);
  }
  const hits = ime.rpc(engine, db, {op: 'list', view: 'all', query}).items;
  assert.ok(hits.some((item: any) => item.id === expected.id), '큰 서식 편집 검색 불일치');
  console.log(`PASS ${mode}: 정확 원문/서식/메타/검색/리비전 보존`);
}

main();
