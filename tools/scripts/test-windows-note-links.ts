// Synthetic closed-library setup/check for the native Windows warm-link gate.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const [mode,engine,db,manifest,sourceTitle] = process.argv.slice(2);
assert.ok(['seed','verify'].includes(mode) && engine && db && manifest && sourceTitle, 'Expected seed|verify ENGINE DATABASE MANIFEST SOURCE_TITLE');
function rpc(request:object) {
 const result=spawnSync(engine,['--db',db],{input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
 if(result.error)throw result.error;
 assert.equal(result.status,0,result.stderr);
 const reply=JSON.parse(result.stdout);assert.ok(reply.ok,reply.error);return reply.data;
}
if(mode==='seed') {
 assert.ok(!fs.existsSync(manifest),'Fixture manifest must be fresh');
 const matches=rpc({op:'list',view:'all'}).items.filter((note:any)=>note.title===sourceTitle);
 assert.equal(matches.length,1,'Expected the single native rich test note');
 const source=rpc({op:'get',id:matches[0].id});
 const created=rpc({op:'save',note:{title:sourceTitle+' 링크 대상',content:'<p>링크 이동 뒤에도 &amp; 😀 원본 보존</p>',text:'링크 이동 뒤에도 & 😀 원본 보존'}});
 const target=rpc({op:'get',id:created.id});
 fs.writeFileSync(manifest,JSON.stringify({source,target}));
} else {
 const saved=JSON.parse(fs.readFileSync(manifest,'utf8'));
 for(const before of [saved.source,saved.target]) {
  const after=rpc({op:'get',id:before.id});
  assert.equal(after.title,before.title);
  assert.equal(after.content,before.content,'Warm note navigation must preserve exact UTF-8 and existing block IDs');
  assert.equal(after.content_format,before.content_format);
  assert.equal(after.revision,before.revision,'Warm note navigation must not create an edit revision');
 }
}
console.log(`PASS: native warm note-link fixture ${mode}; two distinct notes and exact source/IDs/revisions`);
