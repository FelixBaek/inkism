import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['frontend/src/lib/version-diff.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {diffLines}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const d=diffLines(['제목','출처를 붙인다','일주일에 한 번'],['제목','항상 출처 줄을 붙인다','하루 한 번','새 줄']);
assert.deepEqual(d.rows.map(r=>[r.kind,r.left,r.right]),[
 ['same','제목','제목'],
 ['change','출처를 붙인다','항상 출처 줄을 붙인다'],
 ['change','일주일에 한 번','하루 한 번'],
 ['change',null,'새 줄'],
]);
assert.equal(d.removed,Array.from('출처를 붙인다일주일에 한 번').length);
assert.equal(d.added,Array.from('항상 출처 줄을 붙인다하루 한 번새 줄').length);
assert.deepEqual(diffLines(['a','b'],['a','b']).rows.every(r=>r.kind==='same'),true);
assert.deepEqual(diffLines(Array(3000).fill('x'),Array(3000).fill('y')),{tooLarge:true});
console.log('PASS version-diff');
