import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ stdin: { contents: "export * from './lib/ai-provider';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { modelsUrl, embeddingsUrl, embedTexts, aiFailure, listModels, configureAI, completeAI } = module.exports as typeof import('../src/lib/ai-provider');

assert.equal(modelsUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/models');
assert.equal(modelsUrl('https://openrouter.ai/api/v1/chat/completions/'), 'https://openrouter.ai/api/v1/models');
assert.equal(modelsUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1/models');
assert.equal(modelsUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1/models');
assert.equal(modelsUrl('https://x.test/v1/completions'), 'https://x.test/v1/models');
assert.equal(modelsUrl('https://x.test/v1/models'), 'https://x.test/v1/models');
assert.equal(modelsUrl('https://x.test/openai/v1/chat/completions?api-version=1#h'), 'https://x.test/openai/v1/models?api-version=1');

const ep = 'https://api.example.test/v1/chat/completions';
const cases: [Parameters<typeof aiFailure>[0], RegExp][] = [['network', /api\.example\.test.*CORS/], ['timeout', /제시간/], ['shape', /응답 형식/], [401, /401.*API 키/], [403, /403.*API 키/], [404, /404.*모델/], [429, /429.*한도/], [500, /500.*서버 쪽/], [503, /503.*서버 쪽/], [400, /400.*거절/]];
for (const [cause, re] of cases) assert.match(aiFailure(cause, ep), re, String(cause));

const store = new Map<string, string>();
(globalThis as any).window = new EventTarget();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
let seen: any;
const respond = (r: () => Response | Promise<Response>) => { globalThis.fetch = (async (url: any, init: any) => { seen = { url: String(url), init }; return r(); }) as any; };
respond(() => new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })));
assert.deepEqual(await listModels(ep, 'sk-secret'), ['a', 'b']);
assert.equal(seen.url, 'https://api.example.test/v1/models'); assert.equal(seen.init.headers.Authorization, 'Bearer sk-secret'); assert.equal(seen.init.credentials, 'omit');
respond(() => new Response(JSON.stringify({ models: [{ name: 'llama3' }] })));
assert.deepEqual(await listModels(ep), ['llama3']);
respond(() => new Response('<html>', { status: 200 }));
await assert.rejects(listModels(ep), /응답 형식/);
respond(() => { throw new TypeError('Failed to fetch'); });
await assert.rejects(listModels(ep, 'sk-secret'), (e: Error) => /연결하지 못했습니다/.test(e.message) && !e.message.includes('sk-secret'));

configureAI({ endpoint: ep, model: 'm', enabled: true }, 'sk-secret');
for (const status of [401, 404, 429, 502]) { respond(() => new Response('{}', { status })); await assert.rejects(completeAI('x', 'y'), (e: Error) => e.message.includes(String(status)) && !e.message.includes('sk-secret')); }
respond(() => new Response(JSON.stringify({ choices: [] })));
await assert.rejects(completeAI('x', 'y'), /응답 형식/);
respond(() => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })));
assert.equal(await completeAI('x', 'y'), 'OK');
respond(() => new Response(JSON.stringify({ choices: [{ message: { content: '\n<think>\nplan [1]\n</think>\n\n답 [1]' } }] })));
assert.equal((await completeAI('x', 'y')).trim(), '답 [1]', 'a leading think block is dropped');
respond(() => new Response(JSON.stringify({ choices: [{ message: { content: '<think>only thinking</think>' } }] })));
await assert.rejects(completeAI('x', 'y'), /텍스트가 없습니다/, 'thinking alone is not an answer');
respond(() => new Response(JSON.stringify({ choices: [{ message: { content: 'a <think>kept</think>' } }] })));
assert.equal(await completeAI('x', 'y'), 'a <think>kept</think>', 'only a leading block is reasoning');
globalThis.fetch = (async (_: any, init: any) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as any;
await assert.rejects(completeAI('x', 'y', undefined, 20), /제시간/, 'caller-chosen timeout');
const user = new AbortController();
globalThis.fetch = (async (_: any, init: any) => new Promise((_, reject) => { const stop = () => reject(new DOMException('aborted', 'AbortError')); if (init.signal.aborted) stop(); else init.signal.addEventListener('abort', stop); })) as any;
const pending = completeAI('x', 'y', user.signal); user.abort();
await assert.rejects(pending, (e: Error) => e.name === 'AbortError', 'user cancel stays a cancel, not a failure message');
assert.equal(embeddingsUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/embeddings');
assert.equal(embeddingsUrl('http://127.0.0.1:8093/v1/embeddings'), 'http://127.0.0.1:8093/v1/embeddings');
await assert.rejects(embedTexts(['a']), /임베딩 모델/, 'off until an embedding model is set');
configureAI({ endpoint: ep, model: 'm', enabled: true, embedModel: 'e5' }, 'sk-secret');
const batches: string[][] = [];
globalThis.fetch = (async (url: any, init: any) => { const body = JSON.parse(init.body); assert.equal(String(url), 'https://api.example.test/v1/embeddings'); assert.equal(body.model, 'e5'); batches.push(body.input); return new Response(JSON.stringify({ data: body.input.map((_: string, i: number) => ({ index: i, embedding: [i, 1] })).reverse() })); }) as any;
const texts = Array.from({ length: 35 }, (_, i) => 't' + i);
const vectors = await embedTexts(texts);
assert.deepEqual(batches.map(b => b.length), [16, 16, 3], 'at most 16 inputs per request');
assert.deepEqual(vectors[17], [1, 1], 'results follow index order, not response order');
respond(() => new Response(JSON.stringify({ data: [{ embedding: [1, Number.NaN] }] })));
await assert.rejects(embedTexts(['a']), /응답 형식/);
respond(() => new Response(JSON.stringify({ data: [] })));
await assert.rejects(embedTexts(['a']), /응답 형식/, 'count must match inputs');
respond(() => new Response('{}', { status: 401 }));
await assert.rejects(embedTexts(['a']), (e: Error) => e.message.includes('401') && !e.message.includes('sk-secret'));
console.log('PASS ai-provider: embeddings URL, batching, shape and failure classification');

// Key persistence. A fresh bundle evaluation stands in for an app restart.
const fresh = () => { const m = { exports: {} }; new Function('module', 'exports', bundled.outputFiles[0].text)(m, m.exports); return m.exports as typeof import('../src/lib/ai-provider'); };
const bearerSent = async (ai: ReturnType<typeof fresh>) => { respond(() => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))); await ai.completeAI('x', 'y'); return seen.init.headers.Authorization; };
let app = fresh();
await app.restoreAIKey();
await app.configureAI({ endpoint: ep, model: 'm', enabled: true }, 'sk-memory');
assert.deepEqual(await app.aiKeyState(), { kept: false, saved: true }, 'no host store: memory only');
assert.ok(![...store.values()].some(v => v.includes('sk-')), 'key never in prefs');
assert.equal(await bearerSent(fresh()), undefined, 'memory-only key is gone after restart');
let vault: { origin: string; key: string } | null = { origin: 'https://api.example.test', key: 'sk-saved' };
const calls: string[] = [];
(globalThis as any).__TAURI__ = { core: { invoke: async (command: string, a: { action: string; origin: string; key: string }) => {
 assert.equal(command, 'ai_key'); calls.push(a.action + ' ' + a.origin);
 if (a.action === 'load') return vault?.origin === a.origin ? vault.key : '';
 vault = a.action === 'save' ? { origin: a.origin, key: a.key } : null; return '';
} } };
app = fresh(); void app.restoreAIKey();
assert.equal(await bearerSent(app), 'Bearer sk-saved', 'completeAI waits for the restore');
assert.deepEqual(await app.aiKeyState(), { kept: true, saved: true }, 'restored on restart');
await app.configureAI({ endpoint: ep, model: 'm2', enabled: true }, '');
assert.deepEqual(vault, { origin: 'https://api.example.test', key: 'sk-saved' }, 'same server keeps the key');
await app.configureAI({ endpoint: ep, model: 'm2', enabled: true }, 'sk-new');
assert.deepEqual(vault, { origin: 'https://api.example.test', key: 'sk-new' });
respond(() => new Response(JSON.stringify({ data: [] })));
await app.listModels('https://other.example.test/v1/chat/completions');
assert.equal(seen.init.headers.Authorization, undefined, 'saved key never sent to another server');
await app.configureAI({ endpoint: 'https://other.example.test/v1/chat/completions', model: 'm', enabled: true }, '');
assert.equal(vault, null, 'new server origin drops the saved key');
assert.equal(await bearerSent(app), undefined);
await app.configureAI({ endpoint: ep, model: 'm', enabled: true }, 'sk-again');
await app.clearAI();
assert.equal(vault, null, 'disconnect deletes the saved key');
assert.deepEqual(await app.aiKeyState(), { kept: true, saved: false });
assert.deepEqual(calls, ['load https://api.example.test', 'save https://api.example.test', 'save https://api.example.test', 'clear https://other.example.test', 'save https://api.example.test', 'clear ']);
delete (globalThis as any).__TAURI__;
console.log('PASS ai-provider: key restored from the host store, memory-only without it, cleared on disconnect, dropped on server change');
console.log('PASS ai-provider: models URL derivation, failure classification with status, model listing, key never in errors');

// A delayed desktop key load must not restore an old server's key after switching
// servers or disconnecting. No real credentials or network are used here.
async function delayedRestore(action: 'switch' | 'clear' | 'replace' | 'keep' | 'cli') {
 store.set('inkism.ai.config', JSON.stringify({ endpoint: ep, model: 'm', enabled: true }));
 let release!: (key: string) => void;
 const writes: { action: string; origin: string; key: string }[] = [];
 (globalThis as any).__TAURI__ = { core: { invoke: (_: string, args: any) => {
  if (args.action === 'load') return new Promise<string>(resolve => { release = resolve; });
  writes.push(args); return Promise.resolve('');
 } } };
 const ai = fresh();
 const loading = ai.restoreAIKey();
 const changed = action === 'clear' ? ai.clearAI() : ai.configureAI({
  endpoint: action === 'switch' ? 'https://other.example.test/v1/chat/completions' : ep,
  model: 'm2', enabled: true, cli: action === 'cli' ? 'codex' : undefined,
 }, action === 'replace' ? 'sk-replacement' : '');
 release('sk-old-origin');
 await loading; await changed;
 if (action === 'clear' || action === 'cli') {
  assert.deepEqual(await ai.aiKeyState(), { kept: true, saved: false }, 'disconnect wins over a late key restore');
 } else {
  assert.equal(await bearerSent(ai), action === 'switch' ? undefined : action === 'replace' ? 'Bearer sk-replacement' : 'Bearer sk-old-origin', 'key stays bound to its original server');
 }
 assert.equal(writes.length, 1, 'settings change is persisted even while host availability is still loading');
 assert.equal(writes[0].action, action === 'switch' || action === 'clear' || action === 'cli' ? 'clear' : 'save');
}
for (const action of ['switch', 'clear', 'replace', 'keep', 'cli'] as const) await delayedRestore(action);
delete (globalThis as any).__TAURI__;
console.log('PASS delayed AI key restore: server switch, disconnect, replacement and same-server retention');

await configureAI({ endpoint: ep, model: 'm', enabled: true, embedModel: 'e5' }, '');
for (const data of [
 [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }],
 [{ index: -1, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }],
 [{ index: 0, embedding: [1, 0] }, { index: 2, embedding: [0, 1] }],
 [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0] }],
 [{ index: 0.5, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }],
 [{ embedding: [1, 0] }, { embedding: [0, 1] }],
]) {
 respond(() => new Response(JSON.stringify({ data })));
 await assert.rejects(embedTexts(['first', 'second']), /응답 형식/, 'malformed indices or dimensions must not assign vectors to the wrong passages');
}
console.log('PASS embeddings reject duplicate, missing, fractional, out-of-range indices and mixed dimensions');

await configureAI({ endpoint: '', model: '', cli: 'codex', enabled: true }, '');
let requests = 0;
globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
 requests++;
 return new Promise((_, reject) => {
  const abort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
 });
}) as typeof fetch;
const cliCancel = new AbortController(); cliCancel.abort();
await assert.rejects(completeAI('x', 'y', cliCancel.signal), { name: 'AbortError' });
assert.equal(requests, 0, 'already cancelled CLI calls never reach the host');
const cliRunning = new AbortController();
const cliReply = completeAI('x', 'y', cliRunning.signal); cliRunning.abort();
await assert.rejects(cliReply, { name: 'AbortError' });
await assert.rejects(completeAI('x', 'y', undefined, 10), { name: 'AbortError' });
respond(() => new Response(JSON.stringify({ ok: true, data: { text: 'CLI result' } })));
assert.equal(await completeAI('x', 'y'), 'CLI result');
console.log('PASS CLI: late key restore invalidated, no dispatch after cancellation, active HTTP cancelled, timeout, success');
