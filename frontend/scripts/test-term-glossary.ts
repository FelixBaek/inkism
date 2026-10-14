import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ stdin: { contents: "export * from './lib/term-glossary';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { termGlossary } = module.exports as typeof import('../src/lib/term-glossary');
let state: any = { version: 0, template_ids: [], daily_template_id: null, views: [], glossary: [] };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(String(options?.body));
  if (request.op === 'knowledge_settings_set') {
    assert.deepEqual(Object.keys(request).sort(), ['glossary', 'op', 'version']);
    assert.equal(request.version, state.version);
    state = { ...state, glossary: request.glossary, version: state.version + 1 };
  }
  return new Response(JSON.stringify({ ok: true, data: state }));
};
try {
  const one = await termGlossary.save({ term: 'Bank', definition: 'Financial institution' });
  const two = await termGlossary.save({ term: 'Bank', definition: 'River edge' });
  assert.notEqual(one.id, two.id, 'homonyms must not overwrite each other');
  assert.equal((await termGlossary.list()).length, 2);
  const updated = await termGlossary.save({ ...one, definition: 'An institution holding money' });
  assert.equal(updated.id, one.id, 'explicit selected identity is reused');
  assert.equal((await termGlossary.list()).length, 2);
  await termGlossary.remove(one.id);
  assert.deepEqual(await termGlossary.list(), [two]);
} finally { globalThis.fetch = originalFetch; }
console.log('term glossary identity and isolated writes passed');
