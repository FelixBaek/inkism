import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ stdin: { contents: "export * from './lib/note-answer';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { keywords, candidateQuery, gatherEvidence, answerPrompt, answerParts } = module.exports as typeof import('../src/lib/note-answer');

assert.deepEqual(keywords('임베딩은 무엇이고 RAG에서 어떻게 쓰여?'), ['임베딩', 'RAG', '쓰여']);
assert.deepEqual(keywords('what is AND or OR? title:x "q"'), ['title', 'q'].filter(w => w.length >= 2));
assert.equal(candidateQuery(['임베딩', 'RAG']), '임베딩 OR RAG');
assert.ok(keywords('a b c d e f g h i j k l m n o p q r s t'.split(' ').map(x => x + x + x).join(' ')).length <= 8);

const note = (id: string, title: string, extra = {}) => ({ id, title, tags: [], trashed: false, ...extra }) as any;
const bodies: Record<string, string> = {
  a: '서론\n' + 'x'.repeat(800) + '\n임베딩은 텍스트를 벡터로 바꾼다. RAG는 임베딩으로 근거를 찾는다.\n' + 'y'.repeat(800),
  b: '관계없는 메모',
  locked: '임베딩 비밀',
  trashed: '임베딩 휴지통',
  gone: '',
};
const loaded: string[] = [];
const load = async (n: any) => { loaded.push(n.id); if (n.id === 'gone') throw new Error('changed'); return bodies[n.id]; };
const notes = [note('b', '임베딩 개요'), note('a', '검색 노트'), note('locked', 'L', { locked: true }), note('trashed', 'T', { trashed: true }), note('gone', 'G')];
const evidence = await gatherEvidence(notes, ['임베딩', 'RAG'], load);
assert.ok(!loaded.includes('locked') && !loaded.includes('trashed'), 'locked and trashed notes are never read');
assert.deepEqual(evidence.map(e => e.note.id), ['a', 'b'], 'best passage first; title-only match included; failed loads skipped');
assert.ok(evidence[0].text.includes('RAG는 임베딩으로') && evidence[0].text.length < 1000, 'passage is a bounded window around the match');
assert.equal(bodies.a.slice(evidence[0].hit.index, evidence[0].hit.index + 3), '임베딩');
assert.equal(evidence[0].hit.occurrence, 0);
assert.deepEqual(evidence.map(e => e.n), [1, 2]);

const tight = await gatherEvidence([note('a', 'A')], ['임베딩'], load, { maxChars: 100 });
assert.equal(tight.length, 0, 'passages over the budget are not sent');

const prompt = answerPrompt('임베딩이 뭐야?', evidence);
assert.ok(prompt.instruction.includes('only the numbered sources') && prompt.instruction.endsWith('임베딩이 뭐야?'));
assert.ok(prompt.source.startsWith('[1] 검색 노트\n') && prompt.source.includes('\n\n[2] 임베딩 개요\n'));
assert.ok(!prompt.source.includes('비밀') && !prompt.source.includes('휴지통'));

const parts = answerParts('벡터 표현이다 [1]. 출처 없음 [9]. 끝[2]', evidence);
assert.deepEqual(parts.map(p => 'cite' in p ? p.cite.n : p.text), ['벡터 표현이다 ', 1, '. 출처 없음 [9]. 끝', 2]);
console.log('PASS note answer: keyword extraction, locked/trashed exclusion, bounded passages, budget, numbered prompt, citation parsing');
