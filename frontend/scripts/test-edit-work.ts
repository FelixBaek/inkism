import assert from 'node:assert/strict';
import {finishEditWork,scheduleEditWork} from '../src/lib/edit-work.ts';
const failure=Error('step failed');
const step=run=>({runSync:run,runAsync:async()=>run()});
for(const drive of [work=>finishEditWork(work),work=>scheduleEditWork(work,()=>{})]){
 const seen=[];
 function* recover(){
  try{yield step(()=>{throw failure;});}
  catch(error){assert.equal(error,failure);yield step(()=>seen.push('fallback'));}
  yield step(()=>seen.push('after'));
  return 'done';
 }
 assert.equal(await drive(recover()),'done');
 assert.deepEqual(seen,['fallback','after']);
 await assert.rejects(async()=>drive((function*(){yield step(()=>{throw failure;});})()),error=>error===failure);
}
const canceled=Error('source canceled');let stale=false,recovered=false;
function* cancellation(){
 try{yield step(()=>{stale=true;throw failure;});}
 catch{recovered=true;return 'fallback';}
}
await assert.rejects(scheduleEditWork(cancellation(),()=>{if(stale)throw canceled;}),error=>error===canceled);
assert.equal(recovered,false);
let advanced=false;
await assert.rejects(scheduleEditWork((function*(){advanced=true;yield;})(),()=>{throw canceled;}),error=>error===canceled);
assert.equal(advanced,false);
console.log('PASS edit work error recovery and cancellation');
