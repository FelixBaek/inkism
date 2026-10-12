import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['frontend/src/lib/paged-edit-queue.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {PagedEditQueue}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const bytes=s=>Buffer.byteLength(s);
const apply=(source,batch)=>{
 let data=Buffer.from(source);
 for(const e of batch.edits){const end=e.start+bytes(e.expected);assert.equal(data.subarray(e.start,end).toString(),e.expected);data=Buffer.concat([data.subarray(0,e.start),Buffer.from(e.replacement),data.subarray(end)]);}
 return data.toString();
};
const a='<p>한글😀</p>',a1='<p>한글😀 첫째</p>',a2='<p>한글😀 첫째 둘째</p>',b='<p>뒤</p>',b1='<p>수정한 뒤</p>';
let server=a+b;const q=new PagedEditQueue(1,bytes(server));
q.append({start:0,expected:a,replacement:a1});const first=q.begin();
assert.throws(()=>q.begin());assert.equal(Object.isFrozen(first.edits[0]),true);
q.append({start:0,expected:a1,replacement:a2});
q.append({start:bytes(a2),expected:b,replacement:b1});
server=apply(server,first);q.acknowledge(first,2);assert.equal(q.dirty,true);
const second=q.begin();assert.equal(second.revision,2);assert.equal(apply(server,second),a2+b1);
q.failed(second);assert.equal(q.dirty,true);assert.equal(q.revision,2);
const retry=q.begin();assert.throws(()=>q.acknowledge(second,3));assert.equal(q.saving,true);
server=apply(server,retry);q.acknowledge(retry,3);assert.equal(q.dirty,false);assert.equal(q.totalBytes,bytes(server));
// Unsent typing and its undo cancel without submitting a body change.
q.append({start:0,expected:a2,replacement:a1});q.append({start:0,expected:a1,replacement:a2});assert.equal(q.dirty,false);
const metadata=q.begin();assert.equal(metadata.edits.length,0);
q.append({start:0,expected:a2,replacement:a1});q.acknowledge(metadata,4);assert.equal(q.dirty,true);
assert.throws(()=>q.append({start:-1,expected:'',replacement:'x'}));
// A saved prefix never discards changes beyond the protocol's 128-edit limit.
const many=new PagedEditQueue(1,260);let text='a'.repeat(260);
for(let i=0;i<260;i++)many.append({start:i,expected:'a',replacement:'b'});
let revision=1;while(many.dirty){const batch=many.begin();assert.ok(batch.edits.length<=128);text=apply(text,batch);many.acknowledge(batch,++revision);}
assert.equal(text,'b'.repeat(260));assert.equal(revision,4);
console.log('PASS: frozen save prefix, UTF-8 suffix typing, failed retry, stale ack, metadata race, undo coalescing and bounded batches');

const offline=new PagedEditQueue(1,bytes(a));let before=a;
for(let i=0;i<100;i++){
 const next=`<p>한글😀 ${i}</p>`;offline.append({start:0,expected:before,replacement:next});
 const attempt=offline.begin();const after=next.replace('</p>',' 추가</p>');
 offline.append({start:0,expected:next,replacement:after});offline.failed(attempt);before=after;
}
assert.equal(offline.snapshot().edits.length,1);
const finalAttempt=offline.begin();assert.equal(apply(a,finalAttempt),before);
console.log('PASS: repeated failed saves retain one combined window instead of growing pending snapshots');
