import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({stdin:{contents:"export * from './lib/portable-sync'; export {sha256} from './lib/portable-library';",resolveDir:new URL('../src/',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'error',loader:{'.css':'empty'}});
const m={exports:{} as any};new Function('module','exports',out.outputFiles[0].text)(m,m.exports);const {sha256,planFolderChanges,applyFolderChanges,readFolderHandle}=m.exports;
const hash=async(s:string)=>sha256(new TextEncoder().encode(s));
const id='12345678-1234-1234-1234-123456789012',aid='22345678-1234-1234-1234-123456789012',newAid='32345678-1234-1234-1234-123456789012';
const body='\ufeff# Original\r\n![photo](/api/attachments/'+aid+')';const portable=body.replace('/api/attachments/'+aid,'../attachments/'+aid+'.png');
const note={id,title:'Original',content:body,revision:3,content_format:'markdown',tags:[],notebook_id:null};
const baseline={title:'Original',tags:[],notebook_id:null};
const entry={id,path:`notes/${id}.md`,revision:3,format:'markdown',source_sha256:await hash(body),portable_sha256:await hash(portable),metadata:{...baseline},baseline_metadata:{...baseline}};
const manifest={version:1,notes:[entry],attachments:[{id:aid,path:`attachments/${aid}.png`,sha256:await hash('image'),size:5}]};
const f=(path:string,content:string)=>{const file=new File([content],path.split('/').pop()!);Object.defineProperty(file,'webkitRelativePath',{value:'folder/'+path});return file;};
const files=(text=portable,meta=manifest)=>[f('.inkism-portable.json',JSON.stringify(meta)),f(entry.path,text),f(`attachments/${aid}.png`,'image')];
const get=async()=>note;
let p=await planFolderChanges(files(),get);assert.equal(p.unchanged,1);assert.equal(p.changes.length,0);
p=await planFolderChanges([...files(),f('notes/New.md','# New')],get);assert.equal(p.changes[0].kind,'create');let payload:any;await applyFolderChanges(p,new Set([p.changes[0].key]),{save:async(n:any)=>{payload=n;return n;},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');}});assert.equal(payload.require_absent,true);assert.equal(payload.title,'New');
const renamed=files();renamed[1]=f('notes/Renamed.md',portable);p=await planFolderChanges(renamed,get);assert.equal(p.changes[0].kind,'rename');assert.equal(p.changes[0].key,id);assert.equal(p.changes[0].title,'Renamed');
const deletion=files().filter(x=>!x.webkitRelativePath.includes('/notes/'));p=await planFolderChanges(deletion,get);assert.equal(p.changes[0].kind,'delete');let trashed=false;await applyFolderChanges(p,new Set([id]),{save:()=>{throw Error('unexpected');},patch:async(key:string,revision:number)=>{assert.equal(key,id);assert.equal(revision,3);trashed=true;return{id,revision:4};},upload:()=>{throw Error('unexpected');}});assert.ok(trashed);
const editedMeta=structuredClone(manifest);editedMeta.notes[0].metadata.title='Changed title';p=await planFolderChanges(files(portable,editedMeta),get);assert.equal(p.changes[0].title,'Changed title');assert.equal(p.changes[0].content,portable);
const changedAsset=files();changedAsset[2]=f(`attachments/${aid}.png`,'new image');p=await planFolderChanges(changedAsset,get);assert.equal(p.changes[0].assets.length,1);let uploadCount=0;await applyFolderChanges(p,new Set([id]),{save:async(n:any)=>{payload=n;return n;},patch:()=>{throw Error('unexpected');},upload:async()=>{uploadCount++;return{id:newAid};}});assert.equal(uploadCount,1);assert.equal(payload.content,body.replace(aid,newAid));assert.equal(payload.expected_source_sha256,entry.source_sha256);assert.equal(payload.require_existing,true);
p=await planFolderChanges(files(portable+' edit'),async()=>({...note,revision:4}));assert.equal(p.changes.length,0);assert.equal(p.conflicts.length,1);
p=await planFolderChanges(deletion,async()=>({...note,readonly:true}));assert.equal(p.changes.length,0);
p=await planFolderChanges(files(portable+' edit'),get);const late=await applyFolderChanges(p,new Set([id]),{save:async()=>{throw Error('late race');},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');}});assert.equal(late.saved,0);assert.match(late.errors[0],/late race/);
await assert.rejects(()=>planFolderChanges([...files(),f('../escape.md','bad')],get),/경로/);
await assert.rejects(()=>planFolderChanges([...files(),f(entry.path,'duplicate')],get),/경로/);
p=await planFolderChanges([...files(),f('notes/A.md','[B](B.md)'),f('notes/B.md','B')],get);const a=p.changes.find((c:any)=>c.title==='A');const refused=await applyFolderChanges(p,new Set([a.key]),{save:()=>{throw Error('should not save');},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');}});assert.match(refused.errors[0],/반영에 실패/);
// Folder scanner bounds and actual relative paths, without persistent permissions.
const handle={name:'root',kind:'directory',async *values(){yield{name:'notes',kind:'directory',async *values(){yield{name:'x.md',kind:'file',getFile:async()=>new File(['x'],'x.md')};}};}};
const read=await readFolderHandle(handle);assert.equal(read[0].webkitRelativePath,'root/notes/x.md');
const big={name:'root',kind:'directory',async *values(){yield{name:'too-big',kind:'file',getFile:async()=>({size:64*1024*1024+1})};}};await assert.rejects(()=>readFolderHandle(big),/64 MiB/);
console.log('PASS portable sync: create CAS, rename identity, safe trash, metadata, immutable attachments, conflicts, selection dependencies and folder bounds');

// Failure of a new target must prevent storing a link to a nonexistent ID.
p=await planFolderChanges([...files(),f('notes/A.md','[B](B.md)'),f('notes/B.md','B')],get);
const attempted:string[]=[];const dependencyFailure=await applyFolderChanges(p,new Set(p.changes.map((c:any)=>c.key)),{save:async(n:any)=>{attempted.push(n.title);throw Error('target failed');},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');}});assert.deepEqual(attempted,['B']);assert.equal(dependencyFailure.errors.length,2);
const repeated=await planFolderChanges([...files(),f('notes/A.md','[B](B.md)'),f('notes/B.md','B')],get);assert.deepEqual(repeated.changes.map((c:any)=>c.key),p.changes.map((c:any)=>c.key),'reconnecting an old folder retains create IDs');
console.log('PASS new-file dependency failures are blocked, and re-preview cannot generate duplicate IDs');
p=await planFolderChanges([...files(),f('notes/A.md','[B](B.md)'),f('notes/B.md','[A](A.md)')],get);const cycle=await applyFolderChanges(p,new Set(p.changes.map((c:any)=>c.key)),{save:async()=>{throw Error('must not save cycle');},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');}});assert.equal(cycle.saved,0);assert.ok(cycle.errors.every((e:string)=>e.includes('순환 링크')));
p=await planFolderChanges([...files(),f('notes/Self.md','[self](Self.md)')],get);let self:any;await applyFolderChanges(p,new Set(p.changes.map((c:any)=>c.key)),{save:async(n:any)=>{self=n;return n;},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');}});assert.equal(self.content,`[self](note://${self.id})`);
p=await planFolderChanges([...files(),f('notes/Missing.md','![missing](../attachments/no.png)')],get);assert.equal(p.changes.length,0);assert.match(p.conflicts[0],/첨부파일/);
console.log('PASS portable new-note cycles refused, self-links preserved, missing assets rejected in preview');

// HTML note exported as Markdown with informational front matter: strip it, restore links, convert back.
const hid='42345678-1234-1234-1234-123456789012',html='<p>Rich <a href="note://'+id+'">md</a> <a href="note://locked-1">x</a></p>';
const hfile=`---\nid: "${hid}"\ntitle: "Rich: \\"q\\""\nproperties:\n  "rating": 4\n---\nRich [md](${id}.md) [x](inkism://note/locked-1)\n`;
const hentry={id:hid,path:`notes/${hid}.md`,revision:2,format:'html',file_format:'markdown',source_sha256:await hash(html),portable_sha256:await hash(hfile),metadata:{title:'Rich'},baseline_metadata:{title:'Rich'}};
const hmanifest={...manifest,notes:[entry,hentry]};const hnote={id:hid,title:'Rich',content:html,revision:2,content_format:'html',tags:[],notebook_id:null};
const hget=async(x:string)=>x===hid?hnote:note;
p=await planFolderChanges([...files(portable,hmanifest),f(hentry.path,hfile)],hget);assert.equal(p.unchanged,2);
p=await planFolderChanges([...files(portable,hmanifest),f(hentry.path,hfile.replace('Rich [','Edited ['))],hget);assert.equal(p.changes.length,1);assert.equal(p.changes[0].content,`Edited [md](${id}.md) [x](inkism://note/locked-1)\n`);
let converted:any;await applyFolderChanges(p,new Set([hid]),{save:async(n:any)=>{converted=n;return n;},patch:()=>{throw Error('unexpected');},upload:()=>{throw Error('unexpected');},fromMarkdown:async(md:string,format:string)=>`<${format}>${md}`});
assert.equal(converted.content,`<html>Edited [md](note://${id}) [x](note://locked-1)\n`);assert.equal(converted.content_format,'html');assert.equal(converted.expected_source_sha256,hentry.source_sha256);
const hrenamed=[...files(portable,hmanifest),f('notes/Rich title.md',hfile)];p=await planFolderChanges(hrenamed,hget);assert.equal(p.changes[0].kind,'rename');assert.equal(p.changes[0].key,hid);
await assert.rejects(()=>planFolderChanges(files(portable,{...manifest,notes:[{...entry,file_format:'html'}]}),get),/목록/);
console.log('PASS portable Markdown copies: front matter stripped, links restored, HTML/text notes converted back, renames by file format');
