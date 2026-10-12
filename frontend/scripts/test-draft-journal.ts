import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(path){
 const result=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {DraftJournal}=await load('frontend/src/lib/draft-journal.ts');
const {bodySplice}=await load('frontend/src/lib/body-splice.ts');
const {PagedEditQueue}=await load('frontend/src/lib/paged-edit-queue.ts');
const {checkpointDraftRecovery,draftRecovery}=await load('frontend/src/lib/draft-recovery.ts');
const id='11111111-1111-4111-8111-111111111111';
const draft=content=>({id,title:'한글😀',content,content_format:'html',revision:0,notebook_id:null,tags:['태그']});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

// A waiting checkpoint coalesces, but a saving checkpoint remains immutable.
{
 const requests=[],gates=[deferred(),deferred()],stored=new Map();
 const send=async(op,args)=>{
  if(op==='draft_journal_put'){
   const at=requests.length;requests.push(structuredClone(args));await gates[at].promise;
   stored.set(args.draft.note.id,args);return {saved:true};
  }
  const value=stored.get(args.id),cleared=value?.token===args.token;
  if(cleared)stored.delete(args.id);return {cleared};
 };
 const journal=new DraftJournal(send,async(a,b)=>bodySplice(a,b));
 const a=journal.stage(draft('<p>처음😀</p>'),null);const first=journal.persist(a);
 await tick();
 const b=journal.stage(draft('<p>중간😀</p>'),null),c=journal.stage(draft('<p>마지막😀</p>'),null);
 const middle=journal.persist(b);gates[0].resolve();await first;await tick();
 assert.equal(requests.length,2);assert.equal(requests[0].draft.body.content,'<p>처음😀</p>');
 assert.equal(requests[1].draft.body.content,'<p>마지막😀</p>');
 let middleDone=false;void middle.then(()=>{middleDone=true;});await tick();assert.equal(middleDone,false);
 gates[1].resolve();await middle;await journal.persist(c);await journal.flush();
 await journal.clear(a);assert.equal(stored.get(id).token,c.token,'old acknowledgement must preserve later input');
 await journal.clear(c);assert.equal(stored.size,0);
}

// A failure rejects every affected waiter, retains the last snapshot, and retries.
{
 const failure=deferred(),calls=[];let fail=true;
 const journal=new DraftJournal(async(op,args)=>{
  calls.push(args);if(fail){await failure.promise;throw new Error('disk full');}return {saved:true};
 },async(a,b)=>bodySplice(a,b));
 const first=journal.stage(draft('first'),null),waitFirst=journal.persist(first);
 await tick();const second=journal.stage(draft('second'),null),waitSecond=journal.persist(second);
 const checked=Promise.all([assert.rejects(waitFirst,/disk full/),assert.rejects(waitSecond,/disk full/)]);
 failure.resolve();await checked;await assert.rejects(journal.flush(),/disk full/);
 fail=false;await journal.flush();assert.equal(calls.at(-1).draft.body.content,'second');
}

// Large complete documents send a small source splice, not the whole body.
{
 const content='<p>'+('한글😀'.repeat(60000))+'</p>',baseline={...draft(content),revision:1};
 const next={...baseline,content:content.replace('</p>',' 입력</p>')},calls=[];
 let diffs=0;
 const journal=new DraftJournal(async(op,args)=>{calls.push({op,args});return {saved:true};},async(a,b)=>{diffs++;return bodySplice(a,b);});
 await journal.persist(journal.stage(next,baseline));
 const body=calls[0].args.draft.body;
 assert.equal(body.kind,'partial');assert.equal(body.revision,1);assert.equal(diffs,1);
 assert.ok(JSON.stringify(calls[0]).length<1000);assert.equal(body.edits[0].replacement,' 입력');
 assert.equal(body.edits[0].start,Buffer.byteLength(content.slice(0,-4)));
}

// In-flight paged snapshots use the old revision and contain the frozen prefix
// plus the subsequently typed suffix. Manual downloads still reject that state.
{
 const source='<p>한글😀</p>',queue=new PagedEditQueue(1,Buffer.byteLength(source));
 queue.append({start:3,expected:'한글',replacement:'시작'});const batch=queue.begin();
 queue.append({start:3,expected:'시작',replacement:'후속'});
 const value={...draft(''),revision:1,paged:queue};
 assert.throws(()=>draftRecovery(value),/저장 응답/);
 const checkpoint=checkpointDraftRecovery(value),encoded=JSON.stringify(checkpoint);
 assert.equal(checkpoint.body.edits.length,2);assert.equal(checkpoint.body.revision,1);
 queue.acknowledge(batch,2);assert.equal(JSON.stringify(checkpoint),encoded);
 assert.equal(checkpointDraftRecovery(value).body.revision,2);
}

// Discard clears only captured tokens, even when the user resumes typing
// before the old request completes.
{
 const gate=deferred(),stored=new Map();let puts=0;
 const journal=new DraftJournal(async(op,args)=>{
  if(op==='draft_journal_put'){
   if(++puts===1)await gate.promise;stored.set(id,args);return {saved:true};
  }
  if(stored.get(id)?.token===args.token)stored.delete(id);return {};
 },async(a,b)=>bodySplice(a,b));
 const old=journal.stage(draft('discard'),null),oldWait=journal.persist(old);await tick();
 const discard=journal.discard(id),newer=journal.stage(draft('keep new input'),null);
 gate.resolve();await oldWait;await discard;await journal.persist(newer);await journal.flush();
 assert.equal(stored.get(id).token,newer.token);assert.equal(stored.get(id).draft.body.content,'keep new input');
}
// A stalled transport must not keep a normal save waiting forever. Keep the
// one original writer alive so a late response cannot reorder newer writes.
{
 const never=new Promise(()=>{}),journal=new DraftJournal(async()=>never,async(a,b)=>bodySplice(a,b),20);
 const checkpoint=journal.stage(draft('transport stalled'),null);
 await assert.rejects(journal.persist(checkpoint),/시간이 초과/);
 await assert.rejects(journal.clear(checkpoint),/시간이 초과/);
}
// Normal save frees a coalesced body behind a stalled request, and a delayed
// older request is conditionally cleared once it finishes.
{
 const gate=deferred(),stored=new Map(),puts=[];
 const journal=new DraftJournal(async(op,args)=>{
  if(op==='draft_journal_put'){puts.push(args);await gate.promise;stored.set(id,args);return {};}
  if(stored.get(id)?.token===args.token)stored.delete(id);return {};
 },async(a,b)=>bodySplice(a,b));
 const older=journal.stage(draft('old flight'),null),wait=journal.persist(older);await tick();
 const saved=journal.stage(draft('normally saved'),null);await journal.clear(saved);
 gate.resolve();await wait;await journal.flush();await tick();
 assert.equal(puts.length,1);assert.equal(stored.size,0);
}
// Teardown cancels the old transport and rejects all waiting checkpoints.
// It does not send a clear that would discard the durable recovery record.
{
 const operations=[];
 const journal=new DraftJournal(async(op,args,options)=>{
  operations.push(op);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
 },async(a,b)=>bodySplice(a,b));
 const one=journal.persist(journal.stage(draft('flight'),null));await tick();
 const two=journal.persist(journal.stage(draft('pending'),null));
 const checks=Promise.all([assert.rejects(one),assert.rejects(two)]);journal.stop();await checks;
 assert.equal(journal.stopped,true);assert.throws(()=>journal.stage(draft('closed'),null),/닫혔/);
 assert.deepEqual(operations,['draft_journal_put']);
}
console.log('PASS: coalesced/in-flight checkpoints, bounded save/clear deadline, failed-write waiters/retry, bounded source splice, paged in-flight capture, discard/input race, saved-body cleanup and teardown cancellation');
