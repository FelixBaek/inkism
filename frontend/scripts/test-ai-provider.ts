import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ stdin: { contents: "export * from './lib/ai-provider';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { modelsUrl, aiFailure, listModels, configureAI, completeAI } = module.exports as typeof import('../src/lib/ai-provider');

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
const user = new AbortController();
globalThis.fetch = (async (_: any, init: any) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as any;
const pending = completeAI('x', 'y', user.signal); user.abort();
await assert.rejects(pending, (e: Error) => e.name === 'AbortError', 'user cancel stays a cancel, not a failure message');
console.log('PASS ai-provider: models URL derivation, failure classification with status, model listing, key never in errors');
