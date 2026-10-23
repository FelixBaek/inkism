import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({
 stdin:{contents:"export * from './lib/semantic-index';",resolveDir:new URL('../src/',import.meta.url).pathname,loader:'ts'},
 bundle:true,write:false,format:'cjs',platform:'node',logLevel:'error',
 plugins:[{name:'index-boundaries',setup(build){
  build.onLoad({filter:/[/\\]api\.ts$/},()=>({contents:'export const api=globalThis.__indexTest.api; export class RpcError extends Error {}',loader:'ts'}));
  build.onLoad({filter:/[/\\]ai-provider\.ts$/},()=>({contents:'export const aiConfig=()=>globalThis.__indexTest.config??({endpoint:"https://test.local/v1/chat/completions",embedModel:"test",enabled:true}); export const embeddingsReady=()=>true; export const aiConfigVersion=()=>globalThis.__indexTest.version??0; export const onAIConfigChange=f=>{globalThis.__indexTest.changed=f;return()=>{globalThis.__indexTest.changed=undefined;};}; export const embeddingsUrl=c=>c.replace("chat/completions","embeddings"); export const embedTexts=(texts,...args)=>texts[0]==="Inkism semantic index"?Promise.resolve([[1,0]]):globalThis.__indexTest.embed(texts,...args);',loader:'ts'}));
 }}],
});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
const note={id:'a',revision:1,offset:0,chunks:[{text:'passage'}]};

for(const boundary of ['pending','embedding','put'] as const){
 const entered=deferred(),release=deferred(),calls:string[]=[];
 let pending=0;
 (globalThis as any).__indexTest={api:{
  semanticPending:async()=>{calls.push('pending');if(pending++)return {items:[]};if(boundary==='pending'){entered.resolve();await release.promise;}return {items:[note]};},
  semanticPut:async()=>{calls.push('put');if(boundary==='put'){entered.resolve();await release.promise;}},
  semanticStatus:async()=>{calls.push('status');return {indexed:1,pending:0};},
  semanticReset:async()=>{calls.push('reset');},
 },embed:async()=>{calls.push('embedding');if(boundary==='embedding'){entered.resolve();await release.promise;}return [[1,0]];}};
 const m={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(m,m.exports);
 const index=m.exports as typeof import('../src/lib/semantic-index');
 const states:boolean[]=[];index.onSemanticIndex(state=>states.push(state.running));
 const first=index.runSemanticIndex();await entered.promise;
 const rebuilding=index.rebuildSemanticIndex();
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(!calls.includes('reset'),'reset waits for the old in-flight operation: '+boundary);
 release.resolve();await first;await rebuilding;
 const beforeReset=calls.slice(0,calls.indexOf('reset'));
 assert.deepEqual(beforeReset,boundary==='pending'?['pending']:boundary==='embedding'?['pending','embedding']:['pending','embedding','put'],'cancelled run does no more IO: '+boundary);
 assert.equal(calls.filter(c=>c==='reset').length,1);
 assert.equal(states.at(-1),false);
}
delete (globalThis as any).__indexTest;
console.log('PASS semantic cancellation: delayed reads, embeddings and writes finish before rebuild resets the index');

// Timer/kick events and repeated rebuild clicks must not start work during reset.
{
 const entered=deferred(),release=deferred(),calls:string[]=[];
 (globalThis as any).__indexTest={api:{
  semanticPending:async()=>{calls.push('pending');return {items:[]};},
  semanticStatus:async()=>({indexed:0,pending:0}),
  semanticReset:async()=>{calls.push('reset');entered.resolve();await release.promise;},
 },embed:async()=>{throw Error('unexpected embedding');}};
 const m={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(m,m.exports);
 const index=m.exports as typeof import('../src/lib/semantic-index');
 const first=index.rebuildSemanticIndex();await entered.promise;
 const repeated=index.rebuildSemanticIndex(),poll=index.runSemanticIndex(true);
 assert.equal(repeated,first,'repeated rebuild shares the existing work');
 assert.deepEqual(calls,['reset']);
 release.resolve();await Promise.all([first,repeated,poll]);
 assert.deepEqual(calls,['reset','pending'],'one reset and one new run');
 delete (globalThis as any).__indexTest;
}
console.log('PASS semantic rebuild excludes polling and repeated resets');

const fresh=()=>{const m={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(m,m.exports);return m.exports as typeof import('../src/lib/semantic-index');};
const config={endpoint:'https://first.test/v1/chat/completions',embedModel:'same',enabled:true,model:'chat'};
{
 (globalThis as any).__indexTest={};
 const index=fresh(),base=await index.semanticSpace(config,2);
 assert.equal(base,await index.semanticSpace({...config,model:'other-chat'},2),'chat model does not change vector identity');
 for(const other of [await index.semanticSpace({...config,endpoint:'https://second.test/v1/chat/completions'},2),await index.semanticSpace({...config,endpoint:'https://first.test/other/chat/completions'},2),await index.semanticSpace({...config,embedModel:'different'},2),await index.semanticSpace(config,3)])assert.notEqual(base,other);
 assert.ok(base.length<200&&!base.includes('first.test'),'engine key is bounded and does not store server URLs');
}
for(const boundary of ['embedding','search'] as const){
 const entered=deferred(),release=deferred();let searches=0;
 const fixture=(globalThis as any).__indexTest={config,version:0,api:{semanticSearch:async()=>{searches++;if(boundary==='search'){entered.resolve();await release.promise;}return {items:[{note:{id:'old'}}]};}},embed:async()=>{if(boundary==='embedding'){entered.resolve();await release.promise;}return [[1,0]];}};
 const index=fresh(),pending=index.semanticHits('question');await entered.promise;
 fixture.version++;fixture.config={...config,endpoint:'https://second.test/v1/chat/completions'};
 release.resolve();assert.deepEqual(await pending,[],'old query result discarded after settings change: '+boundary);
 assert.equal(searches,boundary==='embedding'?0:1);
}
for(const boundary of ['pending','embedding','put'] as const){
 const entered=deferred(),release=deferred();let puts=0,statuses=0;
 const fixture=(globalThis as any).__indexTest={config,version:0,api:{
  semanticPending:async()=>{if(boundary==='pending'){entered.resolve();await release.promise;}return {items:[note]};},
  semanticPut:async()=>{puts++;if(boundary==='put'){entered.resolve();await release.promise;}},
  semanticStatus:async()=>{statuses++;return {indexed:1,pending:0};},
 },embed:async()=>{if(boundary==='embedding'){entered.resolve();await release.promise;}return [[1,0]];}};
 const index=fresh(),pending=index.runSemanticIndex();await entered.promise;fixture.version++;
 release.resolve();await pending;
 assert.equal(puts,boundary==='put'?1:0,'no late writes after change: '+boundary);
 assert.equal(statuses,0,'old progress never published after settings changed');
}
{
 let puts=0;
 (globalThis as any).__indexTest={config,api:{semanticPending:async()=>({items:[note]}),semanticPut:async()=>{puts++;}},embed:async()=>[[1,0,0]]};
 const index=fresh();let error='';index.onSemanticIndex(s=>{error=s.error;});await index.runSemanticIndex();
 assert.equal(puts,0,'dimension changes inside an indexing run cannot corrupt its namespace');assert.ok(error);
}
delete (globalThis as any).__indexTest;
console.log('PASS semantic identity: server, path, model and dimension isolation; settings changes during reads, embeddings, writes and search; dimension mismatch rejected');

{
 (globalThis as any).window=new EventTarget();
 const entered=deferred(),release=deferred(),finished=deferred();
 const pending=new Set<string>(),puts:string[]=[];
 let first=true;
 const fixture:any=(globalThis as any).__indexTest={config,version:0,api:{
  semanticPending:async(model:string)=>{if(pending.has(model))return {items:[]};pending.add(model);return {items:[note]};},
  semanticPut:async(_id:string,_revision:number,model:string)=>{puts.push(model);if(first){first=false;entered.resolve();await release.promise;}},
  semanticStatus:async()=>{finished.resolve();return {indexed:1,pending:0};},
 },embed:async()=>[[1,0]]};
 const index=fresh(),stop=index.startSemanticIndexer();
 try{
  await entered.promise;fixture.version++;fixture.config={...config,endpoint:'https://second.test/v1/chat/completions'};fixture.changed();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(puts.length,1,'new run waits for old write to finish');
  release.resolve();await finished.promise;
  await index.stopSemanticIndex();
  assert.equal(puts.length,2);assert.notEqual(puts[0],puts[1],'settings notification automatically starts a new isolated index');
 }finally{stop();delete (globalThis as any).__indexTest;}
}
console.log('PASS semantic settings notification waits for old writes and restarts in the new server namespace');
