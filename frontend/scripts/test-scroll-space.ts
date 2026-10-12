import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['frontend/src/lib/scroll-space.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {scrollSpace,MAX_SPACER_HEIGHT}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
for(const total of [480000,4800000,48000000,480000000]) {
 const start=total/2,end=start+1536,live=2000;
 const space=scrollSpace(total,start,end);
 assert.ok(space.before+space.after<=MAX_SPACER_HEIGHT+0.01);
 assert.equal(space.logicalAt(space.before,live),start);
 assert.equal(space.logicalAt(space.before+100,live),start+100);
 assert.ok(Math.abs(space.logicalAt(space.before/2,live)-start/2)<0.001);
 assert.ok(Math.abs(space.logicalAt(space.before+live+space.after,live)-total)<0.001);
}
assert.equal(scrollSpace(480000,0,1536).scale,1);
assert.equal(scrollSpace(48000000,48000000-1536,48000000).after,0);
console.log('PASS: bounded offscreen spacers and pixel mapping before, within and after the live editor');
