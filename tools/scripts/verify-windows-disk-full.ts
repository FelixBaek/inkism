// Runs only against an explicitly supplied synthetic VHD library; never discovers profiles.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
const [mode,engine,root,manifest]=process.argv.slice(2);
assert.ok(['seed','fail','recover','live'].includes(mode)&&engine&&root&&manifest);
const db=path.join(root,'encrypted','notes.db');
const bytes=Buffer.alloc(1024*1024,0x53);
function call(target:string,args:string[]=[],input:Buffer=Buffer.alloc(0),allowFailure=false){
 const r=spawnSync(engine,['--db',target,...args],{input,timeout:45000,maxBuffer:16*1024*1024});if(r.error&&(!allowFailure||!['EOF','EPIPE'].includes((r.error as NodeJS.ErrnoException).code??'')))throw r.error;if(!allowFailure)assert.equal(r.status,0,r.stderr.toString());return r;
}
function rpc(target:string,value:object){const r=JSON.parse(call(target,[],Buffer.from(JSON.stringify(value)+'\n')).stdout.toString());assert.equal(r.ok,true,r.error);return r.data;}
if(mode==='seed'){
 assert.ok(!fs.existsSync(root));assert.ok(!fs.existsSync(manifest));fs.mkdirSync(root);
 const plain=path.join(root,'source.db');
 const note=rpc(plain,{op:'save',note:{title:'Disk full original',content:'한글 original bytes',content_format:'text'}});
 const asset=JSON.parse(call(plain,['--attachment-import','--attachment-name','original.bin'],bytes).stdout.toString());
 assert.equal(JSON.parse(call(plain,['--copy-encrypted-to',path.join(root,'encrypted')]).stdout.toString()).ok,true);
 assert.equal(rpc(db,{op:'storage_status'}).encrypted,true);
 fs.writeFileSync(manifest,JSON.stringify({note,asset}));
}else if(mode==='fail'){
 const request={op:'save',note:{id:'11111111-2222-4333-8444-555555555555',title:'Must not partially save',content:'X'.repeat(4*1024*1024),content_format:'text'}};
 const r=call(db,[],Buffer.from(JSON.stringify(request)+'\n'),true);
 const output=r.stdout.toString();let reply:any;try{reply=JSON.parse(output);}catch{}
 assert.ok(r.status!==0||reply?.ok===false,'full disk unexpectedly reported successful save');
 assert.match(output+r.stderr.toString(),/full|disk|space|입출력|공간/i,'failure must identify storage problem');
 console.log('PASS full VHD: encrypted save reports failure');
}else if(mode==='live'){
 // PowerShell created and verified this exact synthetic VHD before calling us.
 assert.equal(process.env.INKISM_FULL_TEST_VOLUME,path.parse(path.resolve(root)).root);
 const {note,asset}=JSON.parse(fs.readFileSync(manifest,'utf8'));
 const child=spawn(engine,['--db',db],{stdio:['pipe','pipe','pipe']});
 const stopped=once(child,'close');let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-8192);});
 const lines=createInterface({input:child.stdout});
 let pending:{resolve:(value:any)=>void,reject:(error:Error)=>void}|null=null;
 lines.on('line',line=>{const active=pending;pending=null;if(active){try{active.resolve(JSON.parse(line));}catch(e){active.reject(e as Error);}}});
 child.on('error',e=>pending?.reject(e));child.on('close',code=>pending?.reject(new Error(`Live engine exited ${code}: ${stderr}`)));
 child.stdin.on('error',e=>pending?.reject(e));
 const live=(request:object)=>new Promise<any>((resolve,reject)=>{
  const timer=setTimeout(()=>{pending=null;reject(new Error('Live engine response timed out'));},45000);
  pending={resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
  child.stdin.write(JSON.stringify(request)+'\n');
 });
 const filler=path.join(path.parse(path.resolve(root)).root,'live-synthetic-filler.bin');
 try{
  const before=await live({op:'get',id:note.id});assert.equal(before.ok,true,JSON.stringify(before));assert.equal(before.data.content,note.content);
  const fd=fs.openSync(filler,'wx');let full=false;
  try{const chunk=Buffer.alloc(65536);for(let n=0;n<128*1024*1024;n+=chunk.length){try{fs.writeSync(fd,chunk);fs.fsyncSync(fd);}catch(e){assert.equal((e as NodeJS.ErrnoException).code,'ENOSPC');full=true;break;}}}finally{fs.closeSync(fd);}
  assert.ok(full,'must observe actual Windows ENOSPC');
  const edit={op:'save',note:{id:note.id,revision:note.revision,title:note.title,content:'X'.repeat(4*1024*1024),content_format:'text'}};
  const failed=await live(edit);assert.equal(failed.ok,false,'running engine must report failed edit');assert.match(failed.error,/full|disk|space|공간/i);
  console.log('PASS live engine: Windows ENOSPC produces a structured failed-save response');
  console.log('Removing verified test-only live filler: '+filler);fs.unlinkSync(filler);
  const after=await live({op:'get',id:note.id});assert.equal(after.ok,true,JSON.stringify(after));assert.equal(after.data.content,note.content);assert.equal(after.data.revision,note.revision);
  const retry=await live(edit);assert.equal(retry.ok,true,JSON.stringify(retry));
  const read=await live({op:'get',id:note.id});assert.equal(read.ok,true);assert.equal(read.data.content,edit.note.content);
  child.stdin.end();await stopped;
  assert.equal(rpc(db,{op:'get',id:note.id}).content,edit.note.content);
  assert.deepEqual(call(db,['--attachment-export',asset.id]).stdout,bytes);
  console.log('PASS live engine: failed edit rolled back; same connection retries successfully; restart and original attachment intact');
 }finally{
  if(child.exitCode===null){child.kill();await stopped;}lines.close();
  if(fs.existsSync(filler)){console.log('Removing verified test-only live filler: '+filler);fs.unlinkSync(filler);}
 }
}else{
 const {note,asset}=JSON.parse(fs.readFileSync(manifest,'utf8'));
 const actual=rpc(db,{op:'get',id:note.id});assert.equal(actual.content,note.content);assert.equal(actual.revision,note.revision);
 assert.deepEqual(call(db,['--attachment-export',asset.id]).stdout,bytes);
 assert.ok(!rpc(db,{op:'list',view:'all'}).items.some((n:any)=>n.title==='Must not partially save'));
 const saved=rpc(db,{op:'save',note:{title:'Retry succeeds',content:'Recovered after ENOSPC',content_format:'text'}});
 assert.equal(rpc(db,{op:'get',id:saved.id}).content,'Recovered after ENOSPC');
 assert.equal(rpc(db,{op:'storage_status'}).encrypted,true);
 console.log('PASS full VHD recovery: original note/revision and attachment intact; retry and encrypted restart succeed');
}
