import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../src/lib/csv.ts';
import { bodySplice, windowBodySplice } from '../src/lib/body-splice.ts';
import { WindowHistory, type WindowEdit } from '../src/lib/window-history.ts';
import { finishEditWork, scheduleEditWork } from '../src/lib/edit-work.ts';

const edit = (overrides: Partial<WindowEdit> = {}): WindowEdit => ({
  from: 0, offset: 0, before: 'a', after: 'b', beforeCount: 1, afterCount: 1,
  session: 1, group: 1, time: 0, ...overrides,
});
const restore = (entry: unknown) => WindowHistory.restore({ done: [entry], undone: [] });

// 빈 셀, 불완전한 따옴표, CR 단독 줄바꿈도 기존 CSV 파서 계약대로 읽는다.
test('CSV: 빈 셀과 따옴표 경계', () => {
  for (const [input, expected] of [
    ['""', [['']]], ['\uFEFF""', [['']]], ['a\n""', [['a'], ['']]],
    ['""\n', [['']]], ['"",""', [['', '']]], ['""\n""', [[''], ['']]],
    [',', [['', '']]], ['\r', [['']]], ['a\rb', [['a'], ['b']]],
    ['"a', [['a']]], ['a"b', [['a"b']]], ['""""', [['"']]],
    ['"a\r\nb",c', [['a\r\nb', 'c']]], ['\uFEFF', []],
  ] as const) assert.deepEqual(parseCsv(input), expected, input);
});

// 문자열 계약을 어긴 값은 묵시적으로 변환하지 않고 TypeError로 거부한다.
test('CSV: null과 잘못된 입력 타입', () => {
  for (const input of [null, undefined, 1, NaN, Infinity, [], {}]) {
    assert.throws(() => parseCsv(input as unknown as string), TypeError);
  }
});

// 긴 필드와 많은 행이 잘리거나 숫자로 변환되지 않는다.
test('CSV: 긴 필드와 극단적인 숫자 문자열', () => {
  const large = '한글'.repeat(50_000);
  const rows = parseCsv(`${large},9007199254740993,-1e309\n${'x,y\n'.repeat(1000)}`);
  assert.deepEqual(rows[0], [large, '9007199254740993', '-1e309']);
  assert.equal(rows.length, 1001);
  assert.deepEqual(rows.at(-1), ['x', 'y']);
});

// UTF-8 바이트 위치와 서로 다른 이모지의 서로게이트 경계를 직접 검증한다.
test('bodySplice: 삽입·삭제·교체와 이모지 경계', () => {
  for (const [before, after, expected] of [
    ['', '한', { start: 0, expected: '', replacement: '한' }],
    ['한', '', { start: 0, expected: '한', replacement: '' }],
    ['한a끝', '한b끝', { start: 3, expected: 'a', replacement: 'b' }],
    ['a😀z', 'a😁z', { start: 1, expected: '😀', replacement: '😁' }],
    ['a😀z', 'a🨀z', { start: 1, expected: '😀', replacement: '🨀' }],
    ['same', 'same', { start: 4, expected: '', replacement: '' }],
    ['', '', { start: 0, expected: '', replacement: '' }],
  ] as const) assert.deepEqual(bodySplice(before, after), expected);
  assert.throws(() => bodySplice(null as unknown as string, ''), TypeError);
  assert.throws(() => bodySplice('', null as unknown as string), TypeError);
});

// 캐시의 원문 또는 동일 창에서 이어진 편집에만 기존 바이트 위치를 재사용한다.
test('windowBodySplice: 원문과 연속 편집의 출처 검증', () => {
  const current = { source: '한abc끝', from: 1, to: 4, byteStart: 3, html: '다음' };
  assert.equal(windowBodySplice({ content: current.source }), null);
  assert.deepEqual(windowBodySplice({ content: current.source }, current),
    { start: 3, expected: 'abc', replacement: '다음' });
  const prior = { ...current, html: '이전' };
  assert.deepEqual(windowBodySplice({ content: '한이전끝', windowEdit: prior }, current),
    { start: 3, expected: '이전', replacement: '다음' });
  assert.equal(windowBodySplice({ content: '다른 원문' }, current), null);
  for (const patch of [{ source: '다름' }, { from: 0 }, { to: 2 }, { byteStart: 0 }]) {
    assert.equal(windowBodySplice({ content: '한이전끝', windowEdit: { ...prior, ...patch } }, current), null);
  }
});

// 저장 데이터의 최상위 구조나 필수 필드가 깨지면 빈 기록으로 복구한다.
test('WindowHistory.restore: 잘못된 구조와 필수 필드', () => {
  for (const value of [null, undefined, '', 1, [], {}, { done: [], undone: null }, { done: {}, undone: [] }]) {
    assert.deepEqual(WindowHistory.restore(value).serialize(), { done: [], undone: [] });
  }
  for (const entry of [null, edit({ before: null as never }), edit({ after: 1 as never }),
    ...['from', 'offset', 'beforeCount', 'afterCount'].flatMap(key =>
      [null, '1', NaN, Infinity, 0.5].map(value => ({ ...edit(), [key]: value }))),
    edit({ from: -1 }), edit({ offset: -1 })]) {
    assert.equal(restore(entry).canUndo, false, JSON.stringify(entry));
  }
});

// 미리보기의 숫자 범위, HTML, 원문 타입을 검증하고 상대 위치의 음수는 허용한다.
test('WindowHistory.restore: 미리보기 입력 경계', () => {
  const preview = { html: '<p>a</p>', count: 1, raw: 'a', offset: 0, byteStart: 0, relativeFrom: -10 };
  assert.equal(restore(edit({ beforePreview: preview, afterPreview: preview })).canUndo, true);
  for (const patch of [{ html: null }, { raw: 1 }, { relativeFrom: 0.5 },
    { relativeFrom: Number.MAX_SAFE_INTEGER + 1 }, { count: 0.5 },
    ...['offset', 'byteStart'].flatMap(key => [-1, Infinity, '0', Number.MAX_SAFE_INTEGER + 1].map(value => ({ [key]: value })))]) {
    for (const side of ['beforePreview', 'afterPreview']) {
      assert.equal(restore({ ...edit(), [side]: { ...preview, ...patch } }).canUndo, false);
    }
  }
});

// 내부 창 문맥은 유효한 태그와 최대 128개 프레임만 복구한다.
test('WindowHistory.restore: 내부 창 문맥 검증', () => {
  const frame = { tag: 'p', open: '<p>', prelude: '앞' };
  const internal = { ordinal: 0, total: 1, byte_offset: 0, start_context: [frame], end_context: [{ tag: 'h1', open: '<h1>' }] };
  const withInternal = (value: unknown) => restore(edit({ beforePreview: { html: 'a', count: 1, internal: value as never } }));
  assert.equal(withInternal(internal).canUndo, true);
  assert.equal(withInternal({ ...internal, start_context: Array(128).fill(frame) }).canUndo, true);
  for (const patch of [{ ordinal: -1 }, { ordinal: 0.5 }, { total: 0 }, { total: Infinity },
    { byte_offset: -1 }, { byte_offset: Number.MAX_SAFE_INTEGER + 1 },
    { start_context: null }, { end_context: {} }, { start_context: Array(129).fill(frame) },
    ...[null, { tag: 'DIV', open: '<DIV>' }, { tag: 'x-y', open: '' }, { tag: 'p', open: 1 }, { ...frame, prelude: 1 }]
      .map(value => ({ start_context: [value] }))]) {
    assert.equal(withInternal({ ...internal, ...patch }).canUndo, false, JSON.stringify(patch));
  }
});

// 선택 영역은 전체 선택 또는 양 끝점이 완전한 범위 선택이어야 한다.
test('WindowHistory.restore: 선택 영역 좌표 검증', () => {
  const point = { block: 0, position: 1, byte: 0, within: 1 };
  const range = { kind: 'range', anchor: point, head: point };
  for (const selection of [{ kind: 'all' }, range,
    { kind: 'range', anchor: { block: 0, position: 0 }, head: { block: 1, position: 0 } }]) {
    assert.equal(restore({ ...edit(), beforeDocumentSelection: selection, afterDocumentSelection: selection }).canUndo, true);
  }
  for (const selection of [{ kind: 'unknown' }, { ...range, anchor: null }, { ...range, head: null },
    ...['block', 'position', 'byte', 'within'].flatMap(key => [-1, 0.5, Infinity, '0', Number.MAX_SAFE_INTEGER + 1]
      .map(value => ({ ...range, anchor: { ...point, [key]: value } }))),
    { ...range, anchor: { block: 0, position: 1, byte: 0 } }]) {
    assert.equal(restore({ ...edit(), beforeDocumentSelection: selection }).canUndo, false);
    assert.equal(restore({ ...edit(), afterDocumentSelection: selection }).canUndo, false);
  }
});

// 여러 교체를 가진 기록은 2~130개의 안전한 좌표·문자열 교체만 허용한다
// (블록 이동 2개, 큰 블록 안 편집은 바깥 여는 태그마다 1개 + 구간 1개).
test('WindowHistory.restore: 다중 교체 입력 검증', () => {
  const splice = { start: 0, expected: 'a', replacement: 'b' };
  assert.equal(restore(edit({ edits: [splice, splice] })).canUndo, true);
  assert.equal(restore(edit({ edits: [splice, splice, splice] })).canUndo, true);
  for (const edits of [null, {}, [], [splice], Array(131).fill(splice), [null, splice],
    ...[{ start: -1 }, { start: Infinity }, { start: Number.MAX_SAFE_INTEGER + 1 }, { expected: null }, { replacement: 1 }]
      .map(patch => [{ ...splice, ...patch }, splice])]) {
    assert.equal(restore({ ...edit(), edits }).canUndo, false);
  }
});

// 복구된 양쪽 스택은 새 편집 세션과 합쳐지지 않고 되돌리기 방향을 보존한다.
test('WindowHistory.restore: 완료·취소 기록 복구', () => {
  const history = WindowHistory.restore({ done: [edit()], undone: [edit({ before: 'b', after: 'c' })] });
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, true);
  assert.equal(history.serialize().done[0].session, -1);
  assert.equal(history.serialize().undone[0].session, -1);
  assert.equal(history.apply('redo', 'b')?.content, 'c');
  assert.equal(history.apply('undo', 'c')?.content, 'b');
});

// 저장 기록의 100개·8MiB 경계값을 확인하고 단 하나의 초대형 새 편집은 유지한다.
test('WindowHistory: 기록 개수와 메모리 상한', () => {
  assert.equal(WindowHistory.restore({ done: Array(100).fill(edit()), undone: [] }).serialize().done.length, 100);
  assert.equal(WindowHistory.restore({ done: Array(100).fill(edit()), undone: [edit()] }).canUndo, false);
  const limit = 8 * 1024 * 1024;
  const overhead = restore(edit({ before: '', after: '' })).byteSize;
  const exact = edit({ before: '', after: 'x'.repeat((limit - overhead) / 2) });
  assert.equal(restore(exact).byteSize, limit);
  assert.equal(restore({ ...exact, after: exact.after + 'x' }).canUndo, false);
  const history = new WindowHistory();
  history.record(edit());
  history.record({ ...exact, after: exact.after + 'x', session: 2 });
  assert.equal(history.serialize().done.length, 1);
  assert.ok(history.byteSize > limit);
  assert.equal(history.apply('undo', exact.after + 'x')?.content, '');
});

// 빈 기록과 실제 변경이 없는 편집은 기록을 소비하거나 새 그룹을 만들지 않는다.
test('WindowHistory: 빈 기록과 동일 내용', () => {
  const history = new WindowHistory();
  assert.equal(history.prepare('undo'), null);
  assert.equal(history.apply('redo', ''), null);
  history.record(edit({ before: 'a', after: 'a' }));
  history.record(edit({ before: 'a', after: 'a', edits: [{ start: 0, expected: 'a', replacement: 'a' }] }));
  assert.equal(history.byteSize, 0);
  assert.equal(history.canUndo, false);
});

// 500ms 미만의 같은 그룹만 병합하며 마지막 선택·미리보기를 보존한다.
test('WindowHistory: 편집 병합의 시간·출처 경계', () => {
  const first = edit();
  const second = edit({ before: 'b', after: 'c', time: 499, afterCount: 2,
    afterSelection: { cursor: 3 }, afterDocumentSelection: { kind: 'all' }, afterPreview: { html: 'c', count: 2 } });
  const history = new WindowHistory();
  history.record(first); history.record(second);
  assert.equal(history.serialize().done.length, 1);
  assert.deepEqual(history.prepare('undo')?.edit.afterPreview, second.afterPreview);
  assert.equal(history.apply('undo', 'c')?.content, 'a');
  const redo = history.prepare('redo')!;
  assert.deepEqual(redo.selection, second.afterSelection);
  assert.deepEqual(redo.documentSelection, second.afterDocumentSelection);
  assert.equal(redo.countDelta, 1);
  for (const patch of [{ time: 500 }, { group: 2 }, { session: 2 }, { from: 1 }, { before: 'z' },
    { edits: [{ start: 0, expected: 'b', replacement: 'c' }] }]) {
    const separate = new WindowHistory(); separate.record(first); separate.record({ ...second, ...patch });
    assert.equal(separate.serialize().done.length, 2, JSON.stringify(patch));
  }
});

// 오래된 준비 결과나 음수·범위 밖·불일치 위치로 실패해도 기록은 그대로 남는다.
test('WindowHistory: 오래된 커밋과 적용 실패는 기록 보존', () => {
  const history = new WindowHistory(); history.record(edit());
  const old = history.prepare('undo')!.edit;
  history.record(edit({ before: 'b', after: 'c', session: 2 }));
  const snapshot = JSON.stringify(history.serialize());
  assert.throws(() => history.commit('undo', old), /기록이 변경/);
  assert.equal(JSON.stringify(history.serialize()), snapshot);
  for (const [from, source] of [[-1, 'b'], [5, 'b'], [0, 'z']] as const) {
    const mismatch = new WindowHistory(); mismatch.record(edit({ from }));
    const before = JSON.stringify(mismatch.serialize());
    assert.throws(() => mismatch.apply('undo', source), /문서 내용이 변경/);
    assert.equal(JSON.stringify(mismatch.serialize()), before);
  }
});

// 외부 타이머와 시계를 모킹하여 최초 대기와 8ms 작업 분할을 결정론적으로 확인한다.
test('edit-work: 비동기 작업 분할과 동기 실행 결과', async (t) => {
  const delays: number[] = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => { delays.push(delay); callback(); return 0; });
  const times = [0, 8, 9, 10];
  t.mock.method(performance, 'now', () => times.shift() ?? 10);
  let checks = 0;
  const seen: string[] = [];
  function* work() {
    yield;
    yield { runSync() { seen.push('sync'); }, async runAsync(check: () => void) { check(); seen.push('async'); } };
    return 42;
  }
  assert.equal(await scheduleEditWork(work(), () => { checks++; }), 42);
  assert.deepEqual(delays, [0, 0]);
  assert.deepEqual(seen, ['async']);
  assert.ok(checks >= 5);
  assert.equal(finishEditWork(work()), 42);
  assert.deepEqual(seen, ['async', 'sync']);
});

// 실패가 복구되지 않으면 동일 오류를 전달하며 취소는 생성기의 복구 분기로 들어가지 않는다.
test('edit-work: 작업 실패·취소·완료 직전 취소', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { callback(); return 0; });
  t.mock.method(performance, 'now', () => 0);
  const failure = new Error('작업 실패');
  function* broken() { throw failure; yield; }
  assert.throws(() => finishEditWork(broken()), error => error === failure);
  await assert.rejects(scheduleEditWork(broken(), () => {}), error => error === failure);
  let finished = false;
  function* ending() { finished = true; return 'done'; }
  await assert.rejects(scheduleEditWork(ending(), () => { if (finished) throw failure; }), error => error === failure);
  let recovered = false;
  let canceled = false;
  function* canceledWork() {
    try { yield { runSync() {}, async runAsync() { canceled = true; } }; }
    catch { recovered = true; }
  }
  await assert.rejects(scheduleEditWork(canceledWork(), () => { if (canceled) throw failure; }), error => error === failure);
  assert.equal(recovered, false);
});

// 큰 블록 안 편집이 바깥 여는 태그에 식별자를 붙인 기록(edits)은 같은 입력
// 묶음(IME 조합 직후 부여)의 직전 편집을 흡수해 실행 취소 한 번으로 둘 다 되돌린다.
test('WindowHistory.recordSpliced: 조합 직후 식별자 부여를 한 단계로 합친다', () => {
  const tag = { start: 0, expected: '<p>', replacement: '<p id="x">' };
  const spliced = (overrides: Partial<WindowEdit> = {}) => ({
    ...edit({ from: 0, before: '', after: '', time: 100, beforePreview: { html: 'b', count: 1, relativeFrom: 10 }, ...overrides }),
    edits: [tag, { start: 18, expected: 'b', replacement: 'b' }],
  });
  const merged = new WindowHistory();
  merged.record(edit({ from: 11, before: 'a', after: 'b', time: 0, beforePreview: { html: 'a', count: 1 }, beforeSelection: { anchor: 1 } }));
  merged.recordSpliced(spliced(), 11);
  const step = merged.prepare('undo')!;
  assert.equal(merged.serialize().done.length, 1, 'the composition and its identity are one undo step');
  assert.deepEqual(step.edits, [{ start: 18, expected: 'b', replacement: 'a' }, { start: 0, expected: '<p id="x">', replacement: '<p>' }]);
  assert.deepEqual(step.preview, { html: 'a', count: 1, raw: 'a', relativeFrom: 10 });
  assert.deepEqual(step.selection, { anchor: 1 });
  // Another group, a stale time, another window or a changed window keep separate steps.
  for (const [previous, from] of [
    [{ group: 2 }, 11], [{ time: -1000 }, 11], [{}, 12], [{ after: 'c' }, 11],
  ] as const) {
    const history = new WindowHistory();
    history.record(edit({ from: 11, before: 'a', after: 'b', time: 0, ...previous }));
    history.recordSpliced(spliced(), from);
    assert.equal(history.serialize().done.length, 2);
    assert.deepEqual(history.prepare('undo')!.edits?.at(0), { start: 18, expected: 'b', replacement: 'b' });
  }
});
