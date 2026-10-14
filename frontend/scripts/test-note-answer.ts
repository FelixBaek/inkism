import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ stdin: { contents: "export * from './lib/note-answer';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { keywords, candidateQuery, gatherEvidence, answerPrompt, answerParts, relatedNotes, relationLines } = module.exports as typeof import('../src/lib/note-answer');

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
const listed = answerParts('둘 다 [1, 2]. 붙여 [2,1]. 섞임 [1, 9].', evidence);
assert.deepEqual(listed.map(p => 'cite' in p ? p.cite.n : p.text), ['둘 다 ', 1, 2, '. 붙여 ', 2, 1, '. 섞임 [1, 9].'], 'citation lists split; a list with an invented number stays text');
assert.match(prompt.instruction, /placed after the names and facts it supports/);
// Hybrid retrieval with a deterministic fake embedder: concept counts, cosine over one chunk per note.
const CONCEPTS = [['고양이', '냥이', '반려묘'], ['잠', '낮잠', '졸려', '자나'], ['자동차', '차량'], ['예산', '돈']];
const embed = (text: string) => CONCEPTS.map(group => group.reduce((n, w) => n + text.split(w).length - 1, 0));
const cosine = (a: number[], b: number[]) => { const dot = a.reduce((n, x, i) => n + x * b[i], 0), na = Math.hypot(...a), nb = Math.hypot(...b); return na && nb ? dot / (na * nb) : 0; };
const corpus: Record<string, string> = {
  pet: '머리말\n반려묘가 오후 내내 졸려 하며 소파에서 낮잠을 잔다.',
  car: '자동차 보험과 차량 점검 예산',
  kw: '고양이 사료 구매 목록',
  secret: '냥이 낮잠 비밀 일기',
};
const semanticFor = (question: string, notes: any[]) => notes.map(n => ({ note: n, start: corpus[n.id].indexOf('\n') + 1, end: corpus[n.id].length, snippet: corpus[n.id].slice(corpus[n.id].indexOf('\n') + 1), score: cosine(embed(question), embed(corpus[n.id])) })).filter(h => h.score > 0).sort((a, b) => b.score - a.score);
const loadCorpus = async (n: any) => { loaded.push(n.id); return corpus[n.id]; };
const all = [note('pet', '오후'), note('car', '차'), note('kw', '목록'), note('secret', 'S', { locked: true })];
const question = '고양이가 낮에 늘 자나요?';
const hits = semanticFor(question, all);
assert.equal(hits[0].note.id, 'secret', 'fake embedder ranks the locked note first');
loaded.length = 0;
const ftsOnly = await gatherEvidence([all[2]], keywords(question), loadCorpus);
assert.deepEqual(ftsOnly.map(e => e.note.id), ['kw'], 'keywords alone miss the paraphrase');
loaded.length = 0;
const hybrid = await gatherEvidence([all[2]], keywords(question), loadCorpus, { semantic: hits });
assert.ok(!loaded.includes('secret') && hybrid.every(e => e.note.id !== 'secret'), 'locked semantic hits are never read or sent');
assert.deepEqual(hybrid.map(e => e.note.id), ['kw', 'pet'], 'RRF keeps the keyword hit and adds the semantic-only passage');
const pet = hybrid[1];
assert.equal(pet.text, corpus.pet.slice(corpus.pet.indexOf('\n') + 1));
assert.equal(corpus.pet.slice(pet.hit.index).startsWith(pet.hit.matchedText!), true, 'citation points at the chunk start');
assert.equal(pet.hit.index, corpus.pet.indexOf('반려묘'));
// A semantic chunk overlapping a keyword window boosts it instead of duplicating it.
const boosted = await gatherEvidence([all[2], all[1]], ['고양이', '자동차'], loadCorpus, { semantic: [{ note: all[1], start: 0, end: corpus.car.length, snippet: corpus.car, score: 0.9 }] });
assert.deepEqual(boosted.map(e => e.note.id), ['car', 'kw'], 'fused rank puts the doubly matched passage first, once');
// A chunk the loaded text no longer contains still counts, without a precise jump target.
const drifted = await gatherEvidence([], [], loadCorpus, { semantic: [{ note: all[0], start: 3, end: 9, snippet: '없어진 문장', score: 0.5 }] });
assert.equal(drifted[0].text, '없어진 문장'); assert.equal(drifted[0].hit.matchedText, '');
console.log('PASS note answer hybrid: RRF fusion, semantic-only passages, overlap boost, locked hits excluded, precise chunk citations');
console.log('PASS note answer: keyword extraction, locked/trashed exclusion, bounded passages, budget, numbered prompt, citation parsing');

// Typed relation hop: related notes join as candidates and the prompt names the edge between source numbers.
{
  const edge = (source: string, target: string, property: string | null, direction: 'out' | 'in', kind = 'relation') => ({ source, target, source_title: source === 'book' ? '책A' : '사람B', target_title: target === 'book' ? '책A' : '사람B', kind, property, direction, from: 'book', hop: 1, evidence: null }) as any;
  const texts: Record<string, string> = { book: '장편 소설이다.', person: '부산에서 자랐다.', hidden: '비밀' };
  const read = async (n: any) => texts[n.id];
  const candidates = [note('book', 'Qz 책A')];
  const first = await gatherEvidence(candidates, ['Qz'], read);
  const asked: string[] = [];
  const related = await relatedNotes(first, candidates, {
    relations: async id => { asked.push(id); return [edge('book', 'person', '저자', 'out'), edge('book', 'hidden', '저자', 'out'), edge('book', 'person', null, 'out', 'link')]; },
    summary: async id => id === 'hidden' ? note(id, 'H', { locked: true }) : note(id, '사람B'),
  });
  assert.deepEqual(asked, ['book', 'person'], 'second hop expands the related note');
  assert.deepEqual(related.notes.map(n => n.id), ['person'], 'locked related notes are dropped');
  const all = await gatherEvidence([...related.notes, ...candidates], ['Qz'], read, { related: related.hops });
  assert.deepEqual(all.map(e => e.note.id).sort(), ['book', 'person'], 'related note without keywords still yields a passage');
  const n = (id: string) => all.find(e => e.note.id === id)!.n;
  const lines = relationLines(all, related.edges);
  assert.deepEqual(lines, [`[${n('book')}] 책A —저자→ [${n('person')}] 사람B (hop 1)`, `[${n('book')}] 책A —link→ [${n('person')}] 사람B (hop 1)`], 'edges to unsent notes are omitted');
  const p = answerPrompt('Qz 저자는 어디 출신?', all, related.edges);
  assert.ok(p.source.endsWith('\n\nRelations:\n' + lines.join('\n')) && p.instruction.includes('Relations block'));
  assert.ok(!answerPrompt('q', all).source.includes('Relations'), 'no relation block without edges');
  console.log('PASS note answer relations: related candidates, locked exclusion, numbered relation lines');
}

// Multi-hop: breadth-first chains with hop depth, cycles, budgets, cancellation.
{
  const title: Record<string, string> = { book: '책A', person: '사람B', company: '회사C', city: '도시D' };
  const edge = (source: string, target: string, property: string, direction: 'out' | 'in') => ({ source, target, source_title: title[source] ?? source, target_title: title[target] ?? target, kind: 'relation', property, direction, from: direction === 'out' ? source : target, hop: 1, evidence: null }) as any;
  // book —저자→ person —소속→ company —위치→ city, plus person —대표작→ book closing a cycle.
  const graph: Record<string, any[]> = {
    book: [edge('book', 'person', '저자', 'out'), edge('person', 'book', '대표작', 'in')],
    person: [edge('person', 'company', '소속', 'out'), edge('book', 'person', '저자', 'in'), edge('person', 'book', '대표작', 'out')],
    company: [edge('company', 'city', '위치', 'out'), edge('person', 'company', '소속', 'in')],
    city: [edge('company', 'city', '위치', 'in')],
  };
  const texts: Record<string, string> = { book: 'Qz 장편 소설이다.', person: '부산에서 자랐다.', company: '판교에 본사가 있다.', city: '경기도 도시.' };
  const read = async (n: any) => texts[n.id];
  const candidates = [note('book', 'Qz 책A')];
  const first = await gatherEvidence(candidates, ['Qz'], read);
  const calls: string[] = [];
  const loaders = { relations: async (id: string) => { calls.push(id); return graph[id] ?? []; }, summary: async (id: string) => note(id, title[id]) };
  const two = await relatedNotes(first, candidates, loaders);
  assert.deepEqual(two.notes.map(n => n.id), ['person', 'company'], 'default depth reaches the second hop only');
  assert.deepEqual([...two.hops], [['person', 1], ['company', 2]]);
  assert.deepEqual(calls, ['book', 'person'], 'cycle back to the book is not expanded again');
  assert.equal(two.edges.length, 3, 'each edge kept once although seen from both ends');
  const all = await gatherEvidence([...two.notes, ...candidates], ['Qz'], read, { related: two.hops });
  const n = (id: string) => all.find(e => e.note.id === id)!.n;
  assert.ok(n('company') > n('person'), 'deeper hop ranks below the first hop');
  const p = answerPrompt('Qz 저자의 회사는 어디?', all, two.edges);
  assert.ok(p.source.includes(`[${n('book')}] 책A —저자→ [${n('person')}] 사람B (hop 1)\n`) && p.source.endsWith(`[${n('person')}] 사람B —소속→ [${n('company')}] 회사C (hop 2)`), 'chain shown with hop depth');
  calls.length = 0;
  const three = await relatedNotes(first, candidates, loaders, { maxHops: 9 });
  assert.deepEqual(three.hops.get('city'), 3, 'hard cap of three hops');
  assert.deepEqual(calls, ['book', 'person', 'company']);
  // Budgets: a star of 30 neighbours stops at the note cap; a long chain stops at the call cap.
  const star = { relations: async () => Array.from({ length: 30 }, (_, i) => edge('book', `s${i}`, 'x', 'out')), summary: async (id: string) => note(id, id) };
  assert.equal((await relatedNotes(first, candidates, star)).notes.length, 12, 'related note budget');
  calls.length = 0;
  const chain = { relations: async (id: string) => { calls.push(id); return Array.from({ length: 12 }, (_, i) => edge(id, `${id}.${i}`, 'x', 'out')); }, summary: async (id: string) => note(id, id) };
  await relatedNotes(first, candidates, chain, { maxNotes: 50, maxCalls: 5 });
  assert.equal(calls.length, 5, 'relation call budget');
  // Cancelling during the first hop stops every later read.
  const controller = new AbortController(), seen: string[] = [];
  const abortable = { relations: async (id: string) => { seen.push('rel:' + id); controller.abort(); return graph[id]; }, summary: async (id: string) => { seen.push('sum:' + id); return note(id, id); } };
  await assert.rejects(relatedNotes(first, candidates, abortable, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(seen, ['rel:book'], 'no reads after abort');
  console.log('PASS note answer multi-hop: 2-hop chain with hop depth, cycle, 3-hop cap, note and call budgets, abort');
}
