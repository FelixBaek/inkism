import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(path){
 const result=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {draftRecovery}=await load('frontend/src/lib/draft-recovery.ts');
const {PagedEditQueue}=await load('frontend/src/lib/paged-edit-queue.ts');
const content='<p>한글😀</p>';
const draft={id:'note-id',title:'보관',tags:['태그'],notebook_id:null,revision:1,content};
const complete=draftRecovery(draft);
assert.equal(complete.body.kind,'complete');
assert.equal(complete.body.content,content);
const queue=new PagedEditQueue(1,Buffer.byteLength(content));
queue.append({start:0,expected:content,replacement:'<p>추가😀</p>'});
const partial=draftRecovery({...draft,content:'',paged:queue});
const encoded=JSON.stringify(partial);
draft.tags.push('후속');
queue.append({start:0,expected:'<p>추가😀</p>',replacement:'<p>후속😀</p>'});
assert.equal(JSON.stringify(partial),encoded,'export snapshot must not mutate with later edits');
const batch=queue.begin();
assert.throws(()=>draftRecovery({...draft,paged:queue}),/저장 응답/);
queue.failed(batch);
assert.equal(draftRecovery({...draft,paged:queue}).body.edits[0].replacement,'<p>후속😀</p>');
console.log('PASS: exact full body, detached partial snapshot, in-flight rejection and failed-save retention');
const {parseDraftRecovery}=await load('frontend/src/lib/draft-recovery.ts');
const valid={...complete,note:{...complete.note,id:'11111111-1111-1111-1111-111111111111'}};
assert.deepEqual(parseDraftRecovery(JSON.stringify(valid)),valid);
for(const snapshot of [valid,{...partial,note:valid.note}]){
 const legacy={...snapshot,format:'mindbox-draft'};
 assert.deepEqual(parseDraftRecovery(JSON.stringify(legacy)),snapshot,'legacy complete/partial import normalizes to inkism-draft');
}
for(const [format,content] of [
 ['html','<p>새 노트 <strong>한글😀</strong></p>'],
 ['text','\ufeff그대로\r\n한글😀\r끝'],
 ['markdown','\ufeff# 새 노트\r\n**한글😀**\r끝'],
]){
 const snapshot=draftRecovery({...valid.note,content,content_format:format,revision:0,isNew:true});
 assert.deepEqual(parseDraftRecovery(JSON.stringify(snapshot)),snapshot,'never-saved complete draft round-trip: '+format);
}

for(const bad of [
 {...valid,version:2},
 {...valid,format:'inkism-draft2'},
 {...valid,format:'mindbox-draft2'},
 {...valid,format:null},
 {...valid,note:{...valid.note,id:'../notes'}},
 {...valid,note:{...valid.note,tags:'wrong'}},
 {...valid,body:{...valid.body,revision:-1}},
 {...valid,body:{...valid.body,revision:0.5}},
 {...valid,body:{kind:'partial',revision:0,offset_encoding:'utf-8',edit_order:'sequential',edits:[]}},
 {...valid,body:{kind:'partial',revision:1,offset_encoding:'utf-16',edit_order:'sequential',edits:[]}},
 {...valid,body:{kind:'partial',revision:1,offset_encoding:'utf-8',edit_order:'sequential',edits:[{start:-1,expected:'',replacement:'x'}]}},
]){
 assert.throws(()=>parseDraftRecovery(JSON.stringify(bad)));
}
console.log('PASS: supported version and metadata validation; new unsaved complete drafts round-trip; partial revision 0, malformed positions and encoding rejected');
