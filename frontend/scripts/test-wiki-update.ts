import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ stdin: { contents: "export * from './lib/wiki-update';", resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { wikiPassages, wikiPrompt, cleanOutput } = module.exports as typeof import('../src/lib/wiki-update');

const sources = [{ id: 'a', title: 'A', revision: 3 }, { id: 'b', title: 'B', revision: 1 }];
const passages = wikiPassages(sources, new Map([['a', ' alpha '], ['b', 'x'.repeat(50)]]), 40);
assert.deepEqual(passages.map(p => [p.n, p.text.length]), [[1, 5], [2, 20]], 'numbered in engine order, budget split per source');
const prompt = wikiPrompt({ content: '# Wiki\n', content_format: 'markdown' }, passages);
assert.match(prompt.instruction, /as Markdown/);
assert.ok(prompt.source.startsWith('<current>\n# Wiki\n\n</current>') && prompt.source.includes('[1] A\nalpha') && prompt.source.includes('[2] B\n'));
assert.match(wikiPrompt({ content: '<p>x</p>' }, []).instruction, /as HTML/);
assert.equal(cleanOutput('```markdown\n# Wiki\nnew [1]\n```', '# Wiki\n'), '# Wiki\nnew [1]\n');
assert.equal(cleanOutput('  <p>x</p>\n', '<p>y</p>'), '<p>x</p>');
assert.equal(cleanOutput('```', 'z'), '```', 'a lone fence is kept as text');
console.log('PASS wiki update prompt: numbered bounded passages, format kept, fence stripped');
