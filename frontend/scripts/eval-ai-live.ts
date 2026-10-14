// Opt-in live eval of the two AI features against a real OpenAI-compatible chat server (not part of CI).
// Runs the app's own prompt builders, completeAI and parsers; only note storage is in memory.
// usage: INKISM_LIVE_AI_ENDPOINT=…/v1/chat/completions INKISM_LIVE_AI_MODEL=… [INKISM_LIVE_AI_RUNS=3] node scripts/eval-ai-live.ts
import {build} from 'esbuild';
import path from 'node:path';

const endpoint = process.env.INKISM_LIVE_AI_ENDPOINT, model = process.env.INKISM_LIVE_AI_MODEL;
if (!endpoint || !model) {
  console.log('SKIP eval-ai-live: set INKISM_LIVE_AI_ENDPOINT and INKISM_LIVE_AI_MODEL to run against a real model.');
  process.exit(0);
}
const runs = Number(process.env.INKISM_LIVE_AI_RUNS || 3);

// Browser globals the app modules expect (preferences in localStorage, change events on window).
const store = new Map<string, string>();
Object.assign(globalThis, {window: new EventTarget(), localStorage: {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v)}});
const bundled = await build({stdin: {contents: "export * from './lib/note-answer'; export * from './lib/wiki-update'; export * from './lib/ai-provider';", resolveDir: path.join(import.meta.dirname, '../src'), loader: 'ts'}, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error'});
const module = {exports: {}};
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(module, module.exports, (await import('node:module')).createRequire(import.meta.url));
type App = typeof import('../src/lib/note-answer') & typeof import('../src/lib/wiki-update') & typeof import('../src/lib/ai-provider');
const app = module.exports as App;
await app.configureAI({endpoint, model, enabled: true}, process.env.INKISM_LIVE_AI_KEY ?? '');

type Edge = import('../src/lib/knowledge').RelationEdge;
type Note = {id: string; title: string; body: string};
const summary = (n: Note) => ({id: n.id, title: n.title, tags: [], trashed: false}) as unknown as import('../src/types').Summary;

// ---- 1. Answers that need a typed relation ------------------------------------------------------
const NOTES: Note[] = [
  {id: 'sapiens', title: '독서 노트: 사피엔스', body: '인지 혁명으로 허구를 믿는 능력이 생겼고, 이것이 대규모 협력을 가능하게 했다는 주장이 인상적이다. 농업 혁명은 사기였다는 장이 특히 기억에 남는다.'},
  {id: 'harari', title: '유발 하라리', body: '이스라엘의 역사학자. 예루살렘 히브리 대학교에서 세계사를 가르친다. 옥스퍼드에서 중세 전쟁사로 박사 학위를 받았다.'},
  {id: 'proj', title: '프로젝트 오로라', body: '사내 검색 개편 프로젝트. 2분기에 시작했고 목표는 검색 만족도 20% 개선이다.'},
  {id: 'kim', title: '김민지', body: '백엔드 팀 리드. 연락은 사내 메신저로 하고, 금요일 오후에는 재택 근무한다.'},
  {id: 'cafe', title: '연남동 카페 메모', body: '라떼가 진하고 창가 자리가 넓다. 원두는 자체 로스팅.'},
  {id: 'roaster', title: '모모스 커피', body: '부산 영도에 본점이 있는 로스터리. 2019년 월드 바리스타 챔피언을 배출했다.'},
  {id: 'trip', title: '교토 여행 일정', body: '둘째 날 아침 일찍 후시미 이나리 신사에 가고, 오후에는 기온 거리를 걷는다.'},
  {id: 'hotel', title: '호텔 그란비아 교토', body: '교토역 건물 안에 있다. 체크인은 오후 3시, 조식은 15층 레스토랑에서 6시 30분부터.'},
  {id: 'drug', title: '아빠 혈압약', body: '아침 식후 한 알. 처방은 3개월 단위로 받는다.'},
  {id: 'clinic', title: '서울내과의원', body: '담당 의사는 박정우 원장. 토요일은 오후 1시까지 진료한다.'},
  {id: 'tower', title: '한빛타워', body: '강남역 3번 출구 앞 건물. 주차는 지하 2층, 엘리베이터는 로비 왼쪽.'},
  {id: 'paper', title: 'Attention Is All You Need', body: 'Introduces the Transformer, which replaces recurrence with self-attention. Trained on WMT 2014 English-German.'},
  {id: 'lab', title: 'Google Brain', body: 'Research team at Google, merged with DeepMind in April 2023 to form Google DeepMind.'},
  {id: 'garden', title: '베란다 텃밭', body: '상추와 방울토마토를 키운다. 토마토는 지지대를 세워야 한다.'},
  {id: 'tomato', title: '방울토마토 품종: 미니찰', body: '당도가 높은 편이고 열매가 터지는 일이 적다. 물은 2~3일에 한 번 준다.'},
  {id: 'filler1', title: '10월 가계부', body: '월세 85만원, 식비 42만원, 교통비 9만원.'},
  {id: 'filler2', title: '마라톤 훈련 기록', body: '일요일 장거리 21km를 2시간 5분에 달렸다.'},
];
const byId = new Map(NOTES.map(n => [n.id, n]));
const rel = (source: string, property: string, target: string): Edge => ({source, target, source_title: byId.get(source)!.title, target_title: byId.get(target)!.title, kind: 'relation', property, direction: 'out', from: source, hop: 1, evidence: null});
const EDGES = [rel('sapiens', '저자', 'harari'), rel('proj', '담당자', 'kim'), rel('cafe', '원두', 'roaster'), rel('trip', '숙소', 'hotel'), rel('drug', '처방', 'clinic'), rel('clinic', '위치', 'tower'), rel('paper', 'organization', 'lab'), rel('garden', '품종', 'tomato')];
const QUESTIONS: {q: string; expect: RegExp; target: string}[] = [
  {q: '사피엔스 저자는 어느 대학교에서 가르쳐?', expect: /히브리/, target: 'harari'},
  {q: '프로젝트 오로라 담당자는 금요일 오후에 어디서 일해?', expect: /재택|집/, target: 'kim'},
  {q: '연남동 카페 원두는 어느 지역 로스터리야?', expect: /부산|영도/, target: 'roaster'},
  {q: '교토 여행 숙소 체크인은 몇 시야?', expect: /(오후\s*)?3\s*시|15:00|3 ?PM/i, target: 'hotel'},
  {q: '아빠 혈압약 처방받는 병원 담당 의사는 누구야?', expect: /박정우/, target: 'clinic'},
  {q: '아빠 혈압약 처방 병원이 있는 건물의 주차장은 어디야?', expect: /지하\s*2\s*층|B2/, target: 'tower'},
  {q: 'Which organization behind Attention Is All You Need merged with DeepMind, and when?', expect: /2023/, target: 'lab'},
  {q: '베란다 텃밭 방울토마토 품종은 물을 얼마나 자주 줘?', expect: /2\s*[~∼-]\s*3\s*일/, target: 'tomato'},
  {q: '사피엔스 저자의 박사 학위는 어디서 받았어?', expect: /옥스퍼드|Oxford/i, target: 'harari'},
  {q: '교토 숙소 조식은 몇 층에서 먹어?', expect: /(15|십오)\s*층/, target: 'hotel'},
  {q: '사피엔스를 쓴 사람은 누구이고 어느 나라 역사학자야?', expect: /하라리[^]*이스라엘|이스라엘[^]*하라리/, target: 'harari'},
  {q: '프로젝트 오로라 목표와 담당자를 알려줘', expect: /20\s*%[^]*김민지|김민지[^]*20\s*%/, target: 'kim'},
];

/** Same steps as NoteAnswer's retrieve(): keyword candidates, evidence, typed hops, evidence again. */
async function retrieve(question: string) {
  const words = app.keywords(question), lower = words.map(w => w.toLocaleLowerCase());
  // shortcut: substring match stands in for the engine's FTS OR query; the eval targets the model, not ranking.
  const candidates = NOTES.filter(n => lower.some(w => (n.title + ' ' + n.body).toLocaleLowerCase().includes(w))).map(summary);
  const load = async (n: {id: string}) => byId.get(n.id)!.body;
  const evidence = await app.gatherEvidence(candidates, words, load);
  const edgesOf = (id: string) => [...EDGES.filter(e => e.source === id), ...EDGES.filter(e => e.target === id).map(e => ({...e, direction: 'in' as const, from: id}))];
  const loaders = {
    relations: async (id: string) => edgesOf(id),
    summary: async (id: string) => summary(byId.get(id)!),
  };
  const related = await app.relatedNotes(evidence, candidates, loaders);
  if (!related.notes.length) return {evidence, edges: related.edges};
  const more = await app.gatherEvidence([...related.notes, ...candidates], words, load, {maxNotes: 20 + related.notes.length, related: related.hops});
  return {evidence: more, edges: related.edges};
}

// shortcut: "after a particle or at a sentence start" stands in for "no noun before it"; a name ending in 은/인 would false-positive.
const CITATION_AS_WORD = /(^|[는은인의에가를을]\s|[.,]\s)(\[\d{1,3}(,\s*\d{1,3})*\])+([가-힣]| 기준)/m;
// Self-check of the scorer: citations after a name pass, citations in place of a name fail.
for (const [text, bad] of [['숙소는 [1]이며', true], ['[2]에 연결된 숙소', true], ['숙소인 [1] 기준', true], ['숙소는 [2]에서 [1] 호텔', true], ['연결되며, [2]에 따르면', true], ['하라리[1][2]이며', false], ['유발 하라리 [1]이고', false], ['베란다 텃밭 [1]에서', false], ['가르친다 [1].', false], ['연결되고 [1][2], 모모스', false]] as const) {
  if (CITATION_AS_WORD.test(text) !== bad) throw new Error('scorer self-check failed: ' + text);
}
type Result = {ok: boolean; fails: string[]; reply: string; source?: string};
async function scoreAnswer(c: typeof QUESTIONS[number]): Promise<Result> {
  const {evidence, edges} = await retrieve(c.q);
  const fails: string[] = [];
  if (!evidence.some(e => e.note.id === c.target)) fails.push('retrieval: target note not sent');
  const prompt = app.answerPrompt(c.q, evidence, edges);
  const answer = await app.completeAI(prompt.instruction, prompt.source), reply = answer;
  const parts = app.answerParts(answer, evidence);
  const cited = parts.flatMap(p => 'cite' in p ? [p.cite] : []);
  const numbers = [...answer.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)].flatMap(m => m[1].split(',').map(Number));
  if (!c.expect.test(answer)) fails.push('fact missing');
  if (!cited.length) fails.push('no valid [n] citation');
  if (numbers.some(n => !evidence.some(e => e.n === n))) fails.push('invented citation number');
  if (!cited.some(e => e.note.id === c.target)) fails.push('target source not cited');
  if (/<\/?think>|```/.test(answer)) fails.push('leaked think/fence');
  // A citation standing in for a name ("숙소는 [1]이며") hides the fact behind a button.
  if (CITATION_AS_WORD.test(answer)) fails.push('citation used as a word');
  if (/Relations?\s*block|Relations?[을를이의에]|Relations 블록|관계 블록/i.test(answer)) fails.push('prompt mechanics leaked');
  return {ok: !fails.length, fails, reply, source: prompt.source};
}

// ---- 2. Wiki update proposals --------------------------------------------------------------------
type WikiCase = {name: string; content: string; format: 'markdown' | 'html'; sources: {title: string; text: string}[]; keep: string[]; add: RegExp; off?: RegExp};
const WIKI: WikiCase[] = [
  {name: 'md-ko-person', format: 'markdown', content: '# 김민지\n\n- 백엔드 팀 리드\n- 금요일 오후 재택 근무\n',
    sources: [{title: '10월 조직 개편 회의록', text: '김민지 리드가 11월부터 검색 플랫폼 팀으로 옮긴다. 백엔드 팀 리드는 이준호가 맡는다.'}],
    keep: ['김민지', '재택'], add: /검색 플랫폼/},
  {name: 'md-en-project', format: 'markdown', content: '# Project Aurora\n\nInternal search revamp started in Q2.\n\n## Goals\n- Improve search satisfaction by 20%\n',
    sources: [{title: 'Weekly sync 10/07', text: 'Aurora beta launched to 500 employees on October 7. Early survey shows satisfaction up 12%.'}, {title: 'Lunch ideas', text: 'Try the new ramen place near the office.'}],
    keep: ['Q2', '20%'], add: /beta|500/i, off: /ramen/i},
  {name: 'html-ko-recipe', format: 'html', content: '<h1>사워도우</h1><p>르방을 하루 전에 먹인다.</p><p>오븐은 250도로 예열한다.</p>',
    sources: [{title: '굽기 실험 3회차', text: '반죽을 12시간 저온 발효하니 기공이 훨씬 고르게 나왔다. 앞으로 저온 발효 12시간을 기본으로 한다.'}],
    keep: ['르방', '250'], add: /12\s*시간/},
  {name: 'md-ko-travel', format: 'markdown', content: '# 교토 여행\n\n## 숙소\n호텔 그란비아 교토, 교토역 건물 안.\n\n## 일정\n- 둘째 날: 후시미 이나리\n',
    sources: [{title: '항공권 예약 확인', text: '대한항공 KE723, 11월 3일 오전 9시 10분 인천 출발, 간사이 공항 11시 5분 도착.'}, {title: '호텔 메일', text: '체크인은 오후 3시부터 가능합니다.'}],
    keep: ['그란비아', '후시미'], add: /KE723|9시 10분/},
  {name: 'html-en-glossary', format: 'html', content: '<h2>Embedding</h2><p>A vector representation of text.</p><ul><li>Used for semantic search</li></ul>',
    sources: [{title: 'RAG reading notes', text: 'Embeddings let retrieval-augmented generation find passages by meaning; cosine similarity is the usual distance.'}],
    keep: ['vector representation', 'semantic search'], add: /cosine/i},
  {name: 'md-ko-health', format: 'markdown', content: '# 아빠 혈압약\n\n아침 식후 한 알. 처방은 3개월 단위.\n',
    sources: [{title: '서울내과 진료 기록 10/10', text: '혈압이 안정되어 같은 약을 유지하고, 다음 진료는 2027년 1월 10일로 잡았다.'}],
    keep: ['아침 식후', '3개월'], add: /1월\s*10일|2027/},
  {name: 'html-ko-long-team', format: 'html', content: '<h1>검색 플랫폼 팀</h1><p>사내 검색과 추천을 맡는 팀. 2024년에 만들어졌다.</p><h2>구성원</h2><ul><li>이서연: 팀장</li><li>박도윤: 랭킹 모델</li><li>최하은: 색인 파이프라인</li></ul><h2>운영 규칙</h2><ul><li>배포는 화요일과 목요일 오전</li><li>장애 대응 당번은 주 단위로 돌아간다</li><li>분기마다 검색 품질 리뷰를 연다</li></ul><h2>주요 지표</h2><p>클릭률, 무응답 검색 비율, 평균 응답 시간 200ms 이하 유지.</p>',
    sources: [{title: '10월 조직 개편 회의록', text: '김민지 리드가 11월부터 검색 플랫폼 팀으로 옮겨 검색 인프라를 맡는다. 백엔드 팀 리드는 이준호가 맡는다.'}, {title: '점심 메뉴 투표', text: '금요일 점심은 쌀국수로 정했다.'}, {title: '검색 품질 리뷰 3분기', text: '무응답 검색 비율이 4.1%에서 2.8%로 줄었다. 다음 분기 목표는 2% 이하.'}],
    keep: ['이서연', '200ms', '화요일'], add: /김민지[^]*2\.8|2\.8[^]*김민지/, off: /쌀국수|점심/},
];

const numbersIn = (s: string) => new Set(s.match(/\d+/g) ?? []);
async function scoreWiki(c: WikiCase): Promise<Result> {
  const sources = c.sources.map((s, i) => ({id: `s${i}`, title: s.title, revision: 1}));
  const passages = app.wikiPassages(sources, new Map(c.sources.map((s, i) => [`s${i}`, s.text])));
  const prompt = app.wikiPrompt({content: c.content, content_format: c.format}, passages);
  const reply = await app.completeAI(prompt.instruction, prompt.source, undefined, app.WIKI_TIMEOUT);
  const out = app.cleanOutput(reply, c.content), fails: string[] = [];
  const first = c.format === 'html' ? /^<[a-z]/i : new RegExp('^' + c.content.split('\n')[0].replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  if (!first.test(out) || /<\/?(think|current|document)>|```/.test(out)) fails.push('format: not a bare note body');
  if (c.keep.some(k => !out.includes(k))) fails.push('dropped existing fact');
  if (!c.add.test(out)) fails.push('new fact missing');
  if (c.off?.test(out)) fails.push('irrelevant source pulled in');
  const cites = [...out.matchAll(/\[(\d{1,3})\]/g)].map(m => Number(m[1]));
  if (!cites.length) fails.push('no citation');
  if (cites.some(n => n < 1 || n > passages.length)) fails.push('invalid citation number');
  // Simple invention check: every number in the reply must come from the note, a source or a citation.
  const known = new Set([...numbersIn(c.content), ...c.sources.flatMap(s => [...numbersIn(s.title + ' ' + s.text)]), ...cites.map(String)]);
  const invented = [...numbersIn(out)].filter(n => !known.has(n));
  if (invented.length) fails.push('invented numbers ' + invented.join(','));
  return {ok: !fails.length, fails, reply, source: prompt.source};
}

// ---- runner --------------------------------------------------------------------------------------
type Timed = Result & {ms: number};
async function attempt(task: () => Promise<Result>): Promise<Timed> {
  const start = Date.now();
  try {return {...await task(), ms: Date.now() - start};} catch (e) {return {ok: false, fails: ['error: ' + (e instanceof Error ? e.message : String(e))], reply: '', ms: Date.now() - start};}
}
const verbose = process.env.INKISM_LIVE_AI_VERBOSE;
const totals = {answer: [0, 0], wiki: [0, 0]}, slowest = {answer: 0, wiki: 0};
const tally = new Map<string, number>();
async function each<T>(cases: T[], score: (c: T) => Promise<Result>) {
  const results: Timed[] = [];
  // One request at a time, like the app; a flooded server times out instead of answering.
  for (const c of cases) results.push(await attempt(() => score(c))); // NOSONAR: sequential on purpose to match app load
  return results;
}
function report(run: number, kind: 'answer' | 'wiki', names: string[], results: Timed[]) {
  results.forEach((r, i) => {
    totals[kind][1]++;
    if (r.ok) totals[kind][0]++;
    slowest[kind] = Math.max(slowest[kind], r.ms);
    for (const f of r.fails) tally.set(`${kind}: ${f}`, (tally.get(`${kind}: ${f}`) ?? 0) + 1);
    console.log(`run ${run} ${kind} ${r.ok ? 'PASS' : 'FAIL'} ${(r.ms / 1000).toFixed(1)}s ${names[i]}${r.fails.length ? ' — ' + r.fails.join('; ') : ''}`);
    if (verbose === '2' || (verbose && !r.ok)) console.log('  reply: ' + JSON.stringify(r.reply.slice(0, 800)) + '\n  source: ' + JSON.stringify(r.source?.slice(0, 1500)));
  });
}
for (let run = 1; run <= runs; run++) {
  report(run, 'answer', QUESTIONS.map(c => c.q), await each(QUESTIONS, scoreAnswer)); // NOSONAR: runs are sequential on purpose
  report(run, 'wiki', WIKI.map(c => c.name), await each(WIKI, scoreWiki)); // NOSONAR: runs are sequential on purpose
}
const rate = ([ok, all]: number[]) => `${ok}/${all} (${Math.round(ok * 100 / Math.max(1, all))}%)`;
const secs = (ms: number) => (ms / 1000).toFixed(0) + 's';
console.log(`\nmodel ${model}, ${runs} run(s)\nrelation answers: ${rate(totals.answer)}, slowest ${secs(slowest.answer)}\nwiki proposals:   ${rate(totals.wiki)}, slowest ${secs(slowest.wiki)}`);
for (const [f, n] of [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`  ${n}× ${f}`);
