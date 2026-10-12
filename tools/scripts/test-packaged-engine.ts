// Run the packaged binary against isolated Unicode paths, never user data.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const binary = path.resolve(process.argv[2]);

function run(db: string, requests: object[]): any[] {
  const wire = '\n\r\n' + requests.map(r => JSON.stringify(r)).join('\n\n');
  const result = spawnSync(binary, ['--db', db], {input: Buffer.from(wire), timeout: 90_000, maxBuffer: Infinity});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  const lines = result.stdout.toString().split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  const output = lines.map(line => JSON.parse(line));
  assert.equal(output.length, requests.length, JSON.stringify(output));
  for (const response of output) assert.ok(response.ok, JSON.stringify(response));
  return output.map(response => response.data);
}

// Python's default json.dumps (ASCII escapes, ", " and ": "), kept for the response-size bound.
function pyJson(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  if (typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => pyJson(k) + ': ' + pyJson(x)).join(', ') + '}';
  return JSON.stringify(v).replace(/[\u007f-￿]/g, c => String.raw`\u` + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkism-한글 테스트-'));
try {
  const db = path.join(root, '노트.db');
  const note = run(db, [{op: 'save', note: {
    title: '윈도우 저장 검사', content: '<p>재시작보존검증</p>',
    text: '재시작보존검증', tags: ['확인']}}])[0];
  const [saved, status, indexed, listed] = run(db, [
    {op: 'get', id: note.id}, {op: 'sync_status'},
    {op: 'wait_index'}, {op: 'list', view: 'all', query: '재시작보존검증'},
    {op: 'export', path: path.join(root, '백업.json')},
  ]);
  assert.equal(saved.content, '<p>재시작보존검증</p>');
  assert.ok(!status.configured);
  assert.equal(indexed.pending, 0);
  assert.equal(listed.items[0].id, note.id);
  const restored = run(path.join(root, '복원.db'), [
    {op: 'import', path: path.join(root, '백업.json')},
    {op: 'list', view: 'all'},
  ]);
  assert.equal(restored[0].imported, 1);
  const importedId = restored[1].items[0].id;
  assert.notEqual(importedId, note.id); // Import appends independent copies.
  const imported = run(path.join(root, '복원.db'), [{op: 'get', id: importedId}])[0];
  assert.equal(imported.content, saved.content);
  assert.deepEqual(imported.tags, saved.tags);
  const blocks = Array.from({length: 1000}, (_, i) => `<p><strong>한글 블록 ${i}</strong></p>`);
  const paged = run(db, [{op: 'save', note: {
    title: '블록 구간 검사', content: blocks.join(''), text: '한글 블록'}}])[0];
  const [ready, page] = run(db, [
    {op: 'wait_index'},
    {op: 'document_blocks', id: paged.id, revision: paged.revision, offset: 991, limit: 64, include_summary: true},
  ]);
  assert.equal(ready.pending, 0);
  assert.ok(page.ready && page.total_blocks === 1000);
  assert.equal(page.next_offset, null);
  assert.deepEqual(page.blocks.map((b: any) => b.html), blocks.slice(991));
  assert.equal(page.summary.id, paged.id);
  assert.ok(!('content' in page.summary) && !('text' in page.summary));
  let offset = Buffer.byteLength(blocks.slice(0, 991).join(''));
  for (const block of page.blocks) {
    assert.equal(block.byte_offset, offset);
    offset += Buffer.byteLength(block.html);
  }
  const changed = run(db, [{op: 'document_splice', id: paged.id, revision: paged.revision,
    content: {start: page.blocks[0].byte_offset, expected: blocks[991], replacement: '<p>수정한 블록😀</p>'},
    text: {start: 0, expected: '한글 블록', replacement: '수정한 블록😀'}}])[0];
  assert.equal(changed.revision, paged.revision + 1);
  assert.ok(!('content' in changed) && !('text' in changed));
  const reopened = run(db, [{op: 'get', id: paged.id}])[0];
  assert.equal(reopened.content, blocks.slice(0, 991).join('') + '<p>수정한 블록😀</p>' + blocks.slice(992).join(''));
  assert.equal(reopened.text, '수정한 블록😀');
  const derived = run(db, [{op: 'document_splice_html', id: paged.id, revision: changed.revision,
    content: {start: 0, expected: blocks[0], replacement: '<p>검색파생검증 &amp; 😀</p>'}}])[0];
  assert.equal(derived.revision, changed.revision + 1);
  const [fresh, indexedAgain, search] = run(db, [{op: 'get', id: paged.id}, {op: 'wait_index'},
    {op: 'list', view: 'all', query: '검색파생검증'}]);
  assert.ok(fresh.content.startsWith('<p>검색파생검증 &amp; 😀</p>'));
  assert.ok(fresh.text.startsWith('검색파생검증 & 😀'));
  assert.ok(fresh.text.includes('한글 블록 999'));
  assert.ok(indexedAgain.pending === 0 && search.items[0].id === paged.id);
  const matches = run(db, [{op: 'document_find', id: paged.id, revision: derived.revision, query: '한글 블록 999'}])[0];
  assert.ok(matches.ready && matches.items[0].ordinal === 999);
  assert.ok(matches.items[0].snippet.includes('한글 블록 999'));
  assert.ok(Buffer.byteLength(pyJson(page)) < 5000);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
console.log('PASS: packaged engine, Unicode paths, restart, Korean search, sync API, backup restore, revision-consistent block paging');
