/* Synthetic 10000-block IME fixture for native Windows windowed-editor typing checks.

Usage: ENGINE DATABASE FIXTURE seed|typed|committed|original
Speaks only to the engine CLI through spawnSync against a throwaway test
database; no network and no UI. The document body is fully synthetic
(nativeimeblock##### original paragraph), so nothing user data is involved.
*/
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const TITLE = 'Native 10000 block IME';
const TAGS = ['ime-fixture'];
const ORIGINAL = Array.from({length: 10000}, (_, i) => `<p>nativeimeblock${String(i).padStart(5, '0')} original paragraph</p>`).join('');
const COMMITTED = '<p>가나다 </p>';

export function rpc(engine: string, db: string, request: {op: string, [key: string]: unknown}) {
  const wire = Buffer.from(JSON.stringify(request) + '\n');
  const result = spawnSync(engine, ['--db', db], {input: wire, timeout: 120_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `엔진 CLI 실패 op=${request.op} rc=${result.status}`);
  const reply = JSON.parse(result.stdout.toString());
  assert.ok(reply.ok, `엔진 거부 op=${request.op}`);
  return reply.data;
}

export function metaUnchanged(note: any, expected: any) {
  assert.equal(note.title, expected.title, '제목 변형');
  assert.deepEqual(note.tags, expected.tags, '태그 변형');
  assert.equal(note.content_format, 'html', '형식 변형');
}

function main() {
  if (process.argv.length !== 6) {
    console.error('사용법: ENGINE DATABASE FIXTURE seed|typed|committed|original');
    process.exitCode = 1;
    return;
  }
  const [engine, db, fixture, mode] = process.argv.slice(2);
  if (mode === 'seed') {
    const note = rpc(engine, db, {op: 'save', note: {title: TITLE, content: ORIGINAL,
      tags: TAGS, content_format: 'html'}});
    assert.equal(note.revision, 1, '시드 리비전 예상 밖');
    rpc(engine, db, {op: 'wait_index'});
    rpc(engine, db, {op: 'workspace_set', ids: [note.id],
      active: note.id, locations: {}});
    fs.writeFileSync(fixture, JSON.stringify({id: note.id, content: ORIGINAL,
      title: TITLE, tags: TAGS,
      revision: note.revision}), 'utf8');
    console.log(`PASS 시드: 합성 10000문단 원문 저장/색인/작업공간 등록, fixture 기록 id=${note.id}`);
  } else if (mode === 'committed' || mode === 'typed') {
    const expected = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    const body = mode === 'committed' ? COMMITTED : '<p>native_typed</p>';
    const query = mode === 'committed' ? '가나다' : 'native_typed';
    const indexed = rpc(engine, db, {op: 'wait_index'});
    assert.equal(indexed.pending, 0, '색인 지연');
    const hits = rpc(engine, db, {op: 'list', view: 'all', query}).items;
    assert.ok(hits.some((item: any) => item.id === expected.id), '입력 검색 불일치');
    const note = rpc(engine, db, {op: 'get', id: expected.id});
    assert.ok(note.content === body, '커밋 본문 불일치');
    metaUnchanged(note, expected);
    assert.ok(note.revision > expected.revision, '리비전 미증가');
    console.log(`PASS ${mode}: 본문 정확, 메타 불변, ` +
      `리비전 ${expected.revision}→${note.revision}, 입력 검색 일치`);
  } else if (mode === 'original') {
    const expected = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    const indexed = rpc(engine, db, {op: 'wait_index'});
    assert.equal(indexed.pending, 0, '색인 지연');
    const hits = rpc(engine, db, {op: 'list', view: 'all',
      query: 'nativeimeblock09999'}).items;
    assert.ok(hits.some((item: any) => item.id === expected.id), 'nativeimeblock09999 검색 불일치');
    const note = rpc(engine, db, {op: 'get', id: expected.id});
    assert.ok(note.content === expected.content, '원문 본문 불일치');
    metaUnchanged(note, expected);
    assert.ok(note.revision >= expected.revision, '리비전 예상 밖');
    console.log(`PASS 원문: 전체 10000문단 원문 정확 복원, 메타 불변, ` +
      `nativeimeblock09999 검색 일치 (리비전 ${note.revision})`);
  } else {
    throw new Error(mode);
  }
}

// Node resolves the entry module through realpath; compare the same way.
if (import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
