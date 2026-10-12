import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'inkism-history-unit-'));
(globalThis as any).window={addEventListener(){}};
let stored=[],failLoad=false,writeCount=0,lastWireBytes=0;
(globalThis as any).fetch=async(_url,options)=>{
 const request=JSON.parse(options.body);
 if(request.op==='editor_history_get'){
  if(failLoad){failLoad=false;throw new Error('temporary load failure');}
  return {ok:true,json:async()=>({ok:true,data:stored})};
 }
 if(request.op==='editor_history_set'){
  writeCount++;lastWireBytes=Buffer.byteLength(options.body);
  stored=Object.entries(request.values).map(([kind,value])=>({id:request.id,revision:request.revision,format:request.format,kind,value}));
  return {ok:true,json:async()=>({ok:true,data:{saved:true}})};
 }
 throw new Error(request.op);
};
try{
 const code=await build({stdin:{contents:"export * from './src/lib/persistent-history.ts';export * from './src/lib/source-history-cache.ts';export {EditorState,Text} from '@codemirror/state';export {history,historyField,undo,redo,isolateHistory} from '@codemirror/commands';",resolveDir:resolve(import.meta.dirname,'..'),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false});
 const file=join(dir,'history.mjs');await writeFile(file,code.outputFiles[0].text);
 const fresh=async suffix=>import(pathToFileURL(file).href+'?'+suffix);
 const first=await fresh('first'),original='first\r\nsecond\ronly\n😀끝';
 let state=first.EditorState.create({doc:first.Text.of(original.split('\n')),extensions:[first.history(),first.EditorState.lineSeparator.of('\n')]});
 const cached=first.acquireSourceHistory('note-a',1,original,'markdown');
 first.observeSourceHistory(cached.handle,()=>state,true);
 state=state.update({changes:{from:state.doc.length,insert:' appended'}}).state;
 first.advanceSourceHistory('note-a',1,2);
 await first.persistHistory('note-a',2);
 assert.equal(stored[0].format,'markdown');
 const second=await fresh('second');failLoad=true;await assert.rejects(second.loadHistories());await second.loadHistories();
 const restored=second.acquireSourceHistory('note-a',2,original+' appended','markdown');assert.ok(restored.value);
 let reopened=second.EditorState.create({doc:second.Text.of((original+' appended').split('\n')),extensions:[second.history(),second.historyField.init(()=>restored.value),second.EditorState.lineSeparator.of('\n')]});
 assert.equal(second.undo({state:reopened,dispatch:tr=>{reopened=tr.state;}}),true);assert.equal(reopened.doc.toString(),original);
 assert.equal(second.redo({state:reopened,dispatch:tr=>{reopened=tr.state;}}),true);assert.equal(reopened.doc.toString(),original+' appended');
 const third=await fresh('third');await third.loadHistories();
 assert.equal(third.acquireSourceHistory('note-a',2,original+' appended','text').value,undefined,'same text with wrong syntax must not restore');
 const fourth=await fresh('fourth');await fourth.loadHistories();
 assert.equal(fourth.acquireSourceHistory('note-a',2,original.replaceAll('\r','')+' appended','markdown').value,undefined,'CR removal changes positions');
 // Bound close flush: iteration must finish rather than reinserting visited Map keys forever.
 await first.flushHistories();assert.equal(writeCount,2);
 const measurements=[];
 for(const mib of [1,5,10]){
  const raw='x'.repeat(mib*1024*1024),client=await fresh('large-'+mib);
  let large=client.EditorState.create({doc:client.Text.of(raw.split('\n')),extensions:[client.history(),client.EditorState.lineSeparator.of('\n')]});
  const handle=client.acquireSourceHistory('large-'+mib,1,raw,'markdown');
  client.observeSourceHistory(handle.handle,()=>large,true);
  large=large.update({changes:{from:large.doc.length,insert:'한글😀'}}).state;
  client.advanceSourceHistory('large-'+mib,1,2);
  await client.persistHistory('large-'+mib,2);
  assert.ok(lastWireBytes<4096,'large original document must not enter undo payload');
  measurements.push({sourceBytes:Buffer.byteLength(raw),historyRequestBytes:lastWireBytes});
  const reopenedClient=await fresh('large-reopen-'+mib);await reopenedClient.loadHistories();
  const restoredLarge=reopenedClient.acquireSourceHistory('large-'+mib,2,raw+'한글😀','markdown');assert.ok(restoredLarge.value);
  let after=reopenedClient.EditorState.create({doc:reopenedClient.Text.of((raw+'한글😀').split('\n')),extensions:[reopenedClient.history(),reopenedClient.historyField.init(()=>restoredLarge.value),reopenedClient.EditorState.lineSeparator.of('\n')]});
  assert.equal(reopenedClient.undo({state:after,dispatch:tr=>{after=tr.state;}}),true);assert.equal(after.doc.toString(),raw);
  // One undo group containing the entire oversized replaced source is evicted,
  // while save/flush remain successful and never send an oversized request.
  large=large.update({changes:{from:0,to:large.doc.length,insert:'replacement'},annotations:client.isolateHistory.of('full')}).state;
  client.advanceSourceHistory('large-'+mib,2,3);await client.persistHistory('large-'+mib,3);await client.flushHistories();
  assert.ok(lastWireBytes<16*1024*1024);
  assert.equal(stored.some(entry=>entry.kind==='source'),mib<=5,'encoded deltas below 8 MiB persist; oversized deltas are omitted');

  assert.equal(client.undo({state:large,dispatch:tr=>{large=tr.state;}}),true,'active editor undo must survive persistence eviction');
  assert.equal(large.doc.toString(),raw+'한글😀');

 }
 console.log('MEASUREMENTS',JSON.stringify(measurements));
 console.log('PASS: exact CRLF/CR/emoji undo redo, format mismatch, source mismatch, failed-load retry, bounded close flush');
}finally{await rm(dir,{recursive:true,force:true});}
