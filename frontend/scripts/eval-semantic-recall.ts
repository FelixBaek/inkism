// Recall@k of evidence notes for "내 노트에 묻기": keyword (FTS) only vs hybrid (FTS + semantic, RRF).
// Uses the real engine (JSONL) and a real OpenAI-compatible embeddings server.
// usage: node scripts/eval-semantic-recall.ts   (env: INKISM_ENGINE, EMBED_URL, EMBED_MODEL)
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {build} from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const enginePath = process.env.INKISM_ENGINE || path.join(root, 'core/target-wt/release/inkism-engine');
const embedUrl = process.env.EMBED_URL || 'http://127.0.0.1:8093/v1/embeddings';
const embedModel = process.env.EMBED_MODEL || 'eval-embedder';

const bundled = await build({stdin: {contents: "export * from './lib/note-answer';", resolveDir: path.join(import.meta.dirname, '../src'), loader: 'ts'}, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error'});
const module = {exports: {}};
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const {keywords, candidateQuery, gatherEvidence} = module.exports as typeof import('../src/lib/note-answer');

const NOTES: Record<string, [string, string]> = {
  sourdough: ['사워도우 빵 굽기', '르방을 하루 전에 먹이고, 반죽은 12시간 저온 발효한다. 오븐은 250도로 예열하고 더치오븐 뚜껑을 덮어 20분 굽는다.'],
  cat: ['고양이 건강검진', '나비가 예방접종을 맞았다. 수의사가 체중이 늘었다고 해서 사료를 하루 60g으로 줄이기로 했다.'],
  budget: ['10월 가계부', '월세 85만원, 식비 42만원, 교통비 9만원. 외식을 줄여서 지난달보다 지출이 15% 감소했다.'],
  running: ['마라톤 훈련 기록', '일요일 장거리 21km를 2시간 5분에 달렸다. 무릎 바깥쪽이 아파서 폼롤러로 장경인대를 풀었다.'],
  jeju: ['제주 여행 계획', '첫날 성산일출봉, 둘째 날 우도에서 자전거, 셋째 날 한라산 영실 코스. 렌터카는 공항에서 인수.'],
  sleep: ['수면 습관 개선', '자기 전 휴대폰을 끄고 카페인은 오후 2시 이후 마시지 않는다. 잠드는 데 걸리는 시간이 40분에서 15분으로 줄었다.'],
  rust: ['Rust 소유권 정리', '값은 한 번에 하나의 소유자만 가진다. 빌림은 불변 여러 개 또는 가변 하나만 허용된다. 수명 표기는 참조가 얼마나 오래 유효한지 컴파일러에게 알려 준다.'],
  meeting: ['분기 회의록', '3분기 매출 목표 미달. 신규 고객 유치보다 기존 고객 이탈 방지에 마케팅 예산을 재배정하기로 결정.'],
  plant: ['몬스테라 키우기', '잎 끝이 갈색으로 변하면 과습 신호. 물은 겉흙이 마르면 주고, 간접광이 드는 창가에 둔다.'],
  kimchi: ['김장 레시피', '배추 20포기를 소금물에 8시간 절인다. 양념은 고춧가루, 젓갈, 마늘, 생강, 무채를 섞는다.'],
  car: ['자동차 정비', '엔진오일을 8천km에 교체했다. 브레이크 패드 마모가 70%라 다음 점검 때 교체 예정.'],
  book: ['독서 노트: 사피엔스', '인지 혁명으로 허구를 믿는 능력이 생겼고, 이것이 대규모 협력을 가능하게 했다는 주장이 인상적이다.'],
  coffee: ['핸드드립 커피', '원두 15g에 물 250ml, 물 온도는 92도. 30초 뜸 들인 뒤 세 번에 나눠 붓는다.'],
  moving: ['이사 체크리스트', '전입신고는 14일 이내, 인터넷 이전 신청, 도시가스 전출 정산, 관리비 정산 확인.'],
  health: ['건강검진 결과', 'LDL 콜레스테롤이 높게 나왔다. 포화지방을 줄이고 주 3회 유산소 운동을 권고받았다.'],
  english: ['영어 공부 방법', '매일 팟캐스트를 20분 듣고 섀도잉한다. 모르는 표현은 문장 단위로 단어장에 적는다.'],
  tax: ['연말정산 준비', '의료비, 교육비, 기부금 영수증을 모으고 신용카드 사용액이 총급여의 25%를 넘는지 확인.'],
  guitar: ['기타 연습', 'F 코드 바레가 계속 버징이 난다. 검지를 살짝 옆으로 눕혀 뼈 쪽으로 누르니 소리가 깨끗해졌다.'],
  family: ['조카 돌잔치', '11월 9일 토요일 낮 12시, 강남 뷔페. 선물은 금반지 대신 현금으로 하기로.'],
  server: ['서버 장애 회고', '디스크가 가득 차서 데이터베이스 쓰기가 실패했다. 로그 순환 설정을 추가하고 용량 70% 경보를 걸었다.'],
  camping: ['캠핑 장비', '동계 캠핑용 침낭은 영하 10도 컴포트 등급, 난로는 일산화탄소 경보기와 함께 사용.'],
  photo: ['사진 보정 팁', '역광 사진은 섀도를 올리고 하이라이트를 내린 뒤 화이트 밸런스를 살짝 따뜻하게.'],
  stock: ['투자 원칙', '한 종목 비중 10% 이하, 분기마다 리밸런싱, 단기 뉴스에 따라 매매하지 않는다.'],
  dentist: ['치과 치료', '어금니 충치로 신경치료 3회차. 크라운은 지르코니아로 하기로 했고 비용은 45만원.'],
};
// [question, expected note, shares a keyword with the note?]
const QUESTIONS: [string, string, boolean][] = [
  ['빵 반죽은 얼마나 오래 숙성시켜?', 'sourdough', true],
  ['우리 고양이 밥 양을 얼마로 바꿨지?', 'cat', true],
  ['지난달 돈을 어디에 제일 많이 썼어?', 'budget', false],
  ['달리기하다 다리 통증이 생겼을 때 뭘 했지?', 'running', false],
  ['섬 여행에서 자전거 탄 곳은?', 'jeju', true],
  ['밤에 빨리 잠들려면 어떻게 하기로 했어?', 'sleep', false],
  ['참조가 유효한 기간을 컴파일러에 알려주는 문법은?', 'rust', true],
  ['마케팅 돈을 어디로 옮기기로 했나?', 'meeting', true],
  ['화분 잎이 누렇게 타들어가는 이유', 'plant', false],
  ['배추 절이는 시간', 'kimchi', true],
  ['차 브레이크는 언제 갈아야 해?', 'car', true],
  ['인류가 큰 집단으로 협동할 수 있었던 이유에 대한 책 내용', 'book', false],
  ['아침에 마시는 따뜻한 음료 내리는 비율', 'coffee', false],
  ['새 집으로 옮긴 뒤 관공서에 해야 할 일', 'moving', false],
  ['혈액 검사에서 나쁜 수치가 나온 뒤 받은 조언', 'health', false],
  ['외국어 듣기 실력 키우는 루틴', 'english', false],
  ['세금 돌려받으려고 모아야 할 서류', 'tax', false],
  ['현악기 코드 잡을 때 잡음 줄이는 법', 'guitar', false],
  ['저장 공간 부족으로 생긴 사고 대응', 'server', false],
  ['추운 날 텐트에서 자는 데 필요한 것', 'camping', false],
];

const dir = mkdtempSync(path.join(os.tmpdir(), 'inkism-eval-'));
const engine = spawn(enginePath, ['--db', path.join(dir, 'notes.db')], {stdio: ['pipe', 'pipe', 'ignore']});
const lines = readline.createInterface({input: engine.stdout!})[Symbol.asyncIterator]();
async function call(op: string, args = {}) {
  engine.stdin!.write(JSON.stringify({op, ...args}) + '\n');
  const reply = JSON.parse((await lines.next()).value);
  assert.equal(reply.ok, true, op + ': ' + JSON.stringify(reply));
  return reply.data;
}
async function embed(input: string[]): Promise<number[][]> {
  const response = await fetch(embedUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model: embedModel, input})});
  assert.ok(response.ok, 'embeddings server ' + response.status);
  return (await response.json()).data.map((d: {embedding: number[]}) => d.embedding);
}

try {
  const ids: Record<string, string> = {};
  for (const [key, [title, text]] of Object.entries(NOTES)) ids[key] = (await call('save', {note: {title, content: text, content_format: 'text'}})).id;
  const keyOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  await call('wait_index');
  for (let batch = await call('semantic_pending', {model: embedModel, limit: 16}); batch.items.length; batch = await call('semantic_pending', {model: embedModel, limit: 16})) {
    for (const note of batch.items) await call('semantic_put', {note_id: note.id, revision: note.revision, model: embedModel, offset: note.offset, vectors: await embed(note.chunks.map((c: {text: string}) => c.text))});
  }
  const load = async (n: {id: string}) => (await call('get', {id: n.id})).content as string;
  const K = [1, 3, 5];
  const hits = {fts: K.map(() => 0), hybrid: K.map(() => 0)};
  const paraphrase = {fts: 0, hybrid: 0, total: 0};
  for (const [question, expected, shared] of QUESTIONS) {
    const words = keywords(question);
    const notes = words.length ? (await call('list', {view: 'all', limit: 50, query: candidateQuery(words)})).items : [];
    const [vector] = await embed([question]);
    const semantic = (await call('semantic_search', {model: embedModel, vector, limit: 20})).items;
    const runs = {fts: await gatherEvidence(notes, words, load), hybrid: await gatherEvidence(notes, words, load, {semantic})};
    for (const mode of ['fts', 'hybrid'] as const) {
      const ranked = [...new Set(runs[mode].map(e => keyOf[e.note.id]))];
      K.forEach((k, i) => { if (ranked.slice(0, k).includes(expected)) hits[mode][i]++; });
      if (!shared && ranked.slice(0, 5).includes(expected)) paraphrase[mode]++;
    }
    if (!shared) paraphrase.total++;
  }
  const n = QUESTIONS.length, pct = (x: number, d = n) => (100 * x / d).toFixed(1) + '%';
  console.log(`notes=${Object.keys(NOTES).length} questions=${n} (paraphrase, no shared keyword: ${paraphrase.total}) model=${embedModel} @ ${embedUrl}`);
  for (const mode of ['fts', 'hybrid'] as const) console.log(`${mode.padEnd(6)} ${K.map((k, i) => `recall@${k}=${pct(hits[mode][i])}`).join('  ')}  paraphrase recall@5=${pct(paraphrase[mode], paraphrase.total)}`);
} finally {
  engine.stdin!.end();
  engine.kill();
  rmSync(dir, {recursive: true, force: true});
}
