import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static constructionError: Error | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: {id: number; html: string}[] = [];
  sendError: Error | null = null;
  terminated = false;
  constructor() {
    if (FakeWorker.constructionError) throw FakeWorker.constructionError;
    FakeWorker.instances.push(this);
  }
  postMessage(message: {id: number; html: string}) {
    if (this.sendError) throw this.sendError;
    this.messages.push(message);
  }
  terminate() { this.terminated = true; }
  reply(index: number, text: string, error?: string) {
    this.onmessage?.({data: {id: this.messages[index].id, text, error}});
  }
}

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/plaintext-client.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{
    name: 'fake-plaintext-worker',
    setup(build) {
      build.onResolve({filter: /plaintext\.worker\?worker$/}, () => ({path: 'worker', namespace: 'fake'}));
      build.onLoad({filter: /.*/, namespace: 'fake'}, () => ({contents: 'export default globalThis.__plaintextTestWorker;'}));
    },
  }],
});
(globalThis as any).__plaintextTestWorker = FakeWorker;
const {deriveTextInWorker} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
delete (globalThis as any).__plaintextTestWorker;

const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, {callback: () => void; delay: number}>();
let timerId = 0;
globalThis.setTimeout = ((callback, delay) => {
  const id = ++timerId;
  timers.set(id, {callback, delay});
  return id;
}) as any;
globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as any;
const currentWorker = () => FakeWorker.instances.at(-1)!;
const noTimers = () => assert.equal(timers.size, 0, 'completed requests must release every timer');

try {
  // Constructor failures stay synchronous and do not allocate request timers.
  const constructionError = new Error('worker blocked');
  FakeWorker.constructionError = constructionError;
  assert.throws(() => deriveTextInWorker('blocked'), error => error === constructionError);
  noTimers();
  FakeWorker.constructionError = null;

  // Normal calls reuse a worker and resolve by ID, including empty text and reversed replies.
  const first = deriveTextInWorker('<p>한글😀</p>'), second = deriveTextInWorker('');
  const worker = currentWorker();
  assert.equal(FakeWorker.instances.length, 1);
  assert.deepEqual(worker.messages.map(message => message.html), ['<p>한글😀</p>', '']);
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [8000, 8000]);
  worker.reply(1, '');
  worker.reply(0, '한글😀');
  assert.deepEqual(await Promise.all([first, second]), ['한글😀', '']);
  noTimers();

  // A per-request error preserves the server message and leaves other requests usable.
  const bad = deriveTextInWorker('bad'), good = deriveTextInWorker('good');
  const badCheck = assert.rejects(bad, {message: '추출 실패'});
  worker.reply(2, '', '추출 실패');
  await badCheck;
  assert.equal(timers.size, 1);
  worker.reply(3, 'good');
  assert.equal(await good, 'good');
  assert.equal(worker.terminated, false);
  noTimers();

  // One deadline must not cancel a concurrent request; late and duplicate replies are ignored.
  const timedOut = deriveTextInWorker('slow', 25), timeoutId = timerId;
  const continuing = deriveTextInWorker('still running', 50);
  const timeoutCheck = assert.rejects(timedOut, {message: '검색용 텍스트 추출 시간이 초과되었습니다. 다시 저장해 주세요.'});
  assert.equal(timers.get(timeoutId)!.delay, 25);
  timers.get(timeoutId)!.callback();
  await timeoutCheck;
  worker.reply(4, 'late');
  worker.reply(0, 'duplicate');
  assert.equal(timers.size, 1);
  assert.equal(worker.terminated, false);
  worker.reply(5, 'still running');
  assert.equal(await continuing, 'still running');
  noTimers();

  // Both Worker error events reject all waiters and allow a new Worker to recover.
  for (const event of ['error', 'messageerror']) {
    const one = deriveTextInWorker('one'), two = deriveTextInWorker('two');
    const failed = currentWorker(), staleError = failed.onerror;
    const failure = new Error('worker crashed');
    const matches = event === 'error' ? (error: unknown) => error === failure : /알 수 없는 오류/;
    const checks = Promise.all([assert.rejects(one, matches), assert.rejects(two, matches)]);
    if (event === 'error') failed.onerror!({error: failure, message: failure.message});
    else failed.onmessageerror!();
    await checks;
    noTimers();
    assert.equal(failed.terminated, true);
    assert.equal(failed.onmessage, null);
    const retry = deriveTextInWorker('retry');
    const recovered = currentWorker();
    assert.notEqual(recovered, failed);
    staleError!({error: failure});
    assert.equal(recovered.terminated, false, 'stale errors must not terminate the replacement');
    recovered.reply(0, 'recovered');
    assert.equal(await retry, 'recovered');
    noTimers();
  }

  // A synchronous postMessage failure belongs to its request; other requests still complete.
  const pending = deriveTextInWorker('pending'), failed = currentWorker();
  const sendError = new Error('cannot post');
  failed.sendError = sendError;
  await assert.rejects(deriveTextInWorker('send failure'), error => error === sendError);
  assert.equal(timers.size, 1);
  assert.equal(failed.terminated, false);
  failed.reply(1, 'pending completed');
  assert.equal(await pending, 'pending completed');
  noTimers();
  failed.sendError = null;
  const retry = deriveTextInWorker('retry');
  assert.equal(currentWorker(), failed);
  currentWorker().reply(2, 'sent');
  assert.equal(await retry, 'sent');
  noTimers();
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
console.log('PASS: plaintext worker reuse, out-of-order replies, request errors, isolated deadlines, stale replies, worker failures, send failures, retries and timer cleanup');
