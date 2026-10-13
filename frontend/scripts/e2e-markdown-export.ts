// Real React menu -> local API -> Rust engine -> portable ZIP, in a synthetic library.
import {noteMenu} from './library-tools.ts';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readZipEntries} from './read-zip.ts';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL||'http://127.0.0.1:48131';
const rpc=async(op:string,args={})=>{
 const res=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const data=await res.json();assert.equal(data.ok,true,JSON.stringify(data));return data.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({acceptDownloads:true});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
let exports=0,downloads=0;page.on('request',r=>{if(r.url().endsWith('/api/export/markdown'))exports++;});page.on('download',()=>downloads++);
await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
const open=async(note:any)=>{
 await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
 await page.goto(base);await page.getByLabel('노트 제목',{exact:true}).waitFor();
};
const command=async()=>{
 await noteMenu(page,'명령창 열기');
 await page.getByRole('option',{name:'Export as',exact:true}).click();
 // 열린 노트의 내보내기는 형식을 고르는 내보내기 창으로 열린다.
 const dialog=page.getByRole('dialog',{name:'내보내기',exact:true});
 await dialog.getByRole('radio',{name:'Markdown + 첨부 ZIP',exact:true}).check();
 await dialog.getByRole('button',{name:'Markdown + 첨부 ZIP 내보내기',exact:true}).click();
};
const readZip=async(download:any)=>{
 const zipPath=await download.path();
 assert.match(download.suggestedFilename(),/\.zip$/);
 return Object.fromEntries([...readZipEntries(await readFile(zipPath))].map(([name,content])=>[name,content.toString('base64')]));
};
const decoded=(zip:any,key:string)=>Buffer.from(zip[key],'base64').toString('utf8');
try {
 const attachmentBytes=Buffer.from('첨부 원본\0한글😀\r\n');
 const form=new FormData();form.append('file',new Blob([attachmentBytes],{type:'text/plain'}),'한글 파일.txt');form.append('size',String(attachmentBytes.length));
 const response=await fetch(base+'/api/attachments',{method:'POST',body:form});
 const attachment=await response.json();assert.equal(attachment.ok,true,JSON.stringify(attachment));
 const id=attachment.data.id;
 const content=`<h2>보관 제목</h2><p><strong>굵게</strong> <span style="color: rgb(233, 30, 99);">색깔</span></p><p><a href="/api/attachments/${id}">한글 파일</a></p>`;
 const note=await rpc('save',{note:{title:'Markdown ZIP 검증',content,content_format:'html',tags:['보관']}});
 const original=await rpc('get',{id:note.id});await open(note);
 const downloadPromise=page.waitForEvent('download');await command();const zip=await readZip(await downloadPromise);
 assert.ok(decoded(zip,'note.md').includes(`attachments/${id}.txt`));
 assert.ok(decoded(zip,'note.md').includes('color: rgb(233, 30, 99)'));
 assert.doesNotMatch(decoded(zip,'note.md'),/\/api\/attachments\//);
 assert.deepEqual(Buffer.from(zip[`attachments/${id}.txt`],'base64'),attachmentBytes);
 assert.deepEqual(JSON.parse(decoded(zip,'note.json')),original);
 assert.deepEqual(await rpc('get',{id:note.id}),original,'export changed canonical note');
 const raw='\ufeff# 원문\r\n<!--주석-->\r\n';
 const native=await rpc('save',{note:{title:'네이티브 Markdown',content:raw,content_format:'markdown'}});await open(native);
 const nativePromise=page.waitForEvent('download');await command();const nativeZip=await readZip(await nativePromise);
 assert.equal(decoded(nativeZip,'note.md'),raw);
 const unsupported=await rpc('save',{note:{title:'손실 금지',content:'<p data-custom="보존">본문</p>',content_format:'html'}});await open(unsupported);
 const before={exports,downloads};await command();
 await page.getByText('이 문서의 서식을 Markdown으로 보존하지 못했습니다. ZIP 백업을 사용해 주세요.',{exact:true}).waitFor();
 assert.equal(exports,before.exports,'lossy conversion reached backend');assert.equal(downloads,before.downloads);
 assert.equal((await rpc('get',{id:unsupported.id})).content,unsupported.content);
 // Backend read after conversion must reject a note that changed meanwhile.
 const stale=await fetch(base+'/api/export/markdown',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({id:note.id,revision:note.revision-1,source:content,markdown:'wrong'})});
 assert.equal(stale.ok,false);assert.match((await stale.json()).error,/버전/);
 assert.deepEqual(errors,[]);
 console.log('PASS real Markdown export: menu/download, mixed formatting, relative paths, exact attachment bytes, metadata/source unchanged, native source preserved, lossy conversion/stale version refused');
} finally {await browser.close()}
