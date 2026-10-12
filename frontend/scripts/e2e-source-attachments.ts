import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.INKISM_URL||'http://127.0.0.1:48123';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const editor=()=>page.locator('.cm-content');const fileInput=()=>page.getByLabel('첨부할 파일 선택',{exact:true});
const until=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await page.waitForTimeout(50)}throw Error('condition timeout')};
const saved=id=>rpc('get',{id});
const hash=b=>createHash('sha256').update(b).digest('hex');
const marker='\ufeff보존 <unknown> & 원문😀\r\n끝';
// HTML notes open in the rich view; the source editor is the explicit HTML view (Markdown notes open in source).
const source=async format=>{if(format==='html'){await page.getByLabel('노트 제목',{exact:true}).waitFor();const html=page.getByRole('button',{name:'HTML',exact:true});if(await html.getAttribute('aria-pressed')!=='true')await html.click();}await editor().waitFor();};
async function open(format){const note=await rpc('save',{note:{title:'Source attach '+format+' '+Date.now(),content:marker,content_format:format}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await source(format);await editor().click();await page.keyboard.press('Control+End');return note}
const payload={name:'한글 [a] <tag> &.txt',mimeType:'text/plain',buffer:Buffer.from('첨부 원본\0😀\r\n')};
try{
 // TEXT is now the rich view; raw preservation is exercised here in both source modes.
 for(const format of ['html','markdown']){
  const note=await open(format);await fileInput().setInputFiles(payload);
  await until(async()=>(await saved(note.id)).content.includes('/api/attachments/'));
  const content=(await saved(note.id)).content;assert.ok(content.startsWith(marker));
  if(format==='html')assert.match(content,/<a href="\/api\/attachments\/[^"]+" download>한글 \[a\] &lt;tag&gt; &amp;\.txt<\/a>$/);
  if(format==='markdown')assert.ok(content.includes('[한글 \\[a\\] \\<tag\\> \\&.txt](/api/attachments/'));
  await page.getByRole('button',{name:'첨부 링크 목록',exact:true}).click();
  const link=page.getByRole('link',{name:'첨부파일 1 다운로드',exact:true});const url=await link.getAttribute('href');assert.match(url,/^\/api\/attachments\/[0-9a-f-]{36}$/);assert.equal(url.includes('?'),false);
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);assert.equal(hash(await fs.readFile(await download.path())),hash(payload.buffer));
  await page.getByRole('button',{name:'첨부 링크 1 제거',exact:true}).click();await until(async()=>(await saved(note.id)).content===marker);
  await editor().focus();await page.keyboard.press('Control+z');await until(async()=>(await saved(note.id)).content===content);
  await page.reload();await source(format);assert.equal((await saved(note.id)).content,content);
  assert.equal(hash(Buffer.from(await (await fetch(base+url)).arrayBuffer())),hash(payload.buffer));
  console.log('PASS '+format+' chooser/link escaping/exact download/remove/undo/reopen/source preservation');
 }
 const note=await open('html');
 // Delayed real upload response; type while transfer is active. An 8MiB
 // synthetic file exercises actual upload/storage/download bytes without 1GiB UI cost.
 let release,entered;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);let requests=0;
 await page.route('**/api/attachments',async route=>{requests++;const response=await route.fetch();entered();await gate;try{await route.fulfill({response})}catch{}});
 await fileInput().setInputFiles({name:'large.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(8*1024*1024,73)});await arrived;
 await page.getByRole('button',{name:'첨부 취소',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'파일 첨부',exact:true}).isDisabled(),true);
 await editor().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 추가입력');release();await page.unroute('**/api/attachments');
 await until(async()=>(await saved(note.id)).content.includes('/api/attachments/'));assert.ok((await saved(note.id)).content.startsWith(marker+' 추가입력'));assert.equal(requests,1);
 const largeUrl=(await saved(note.id)).content.match(/\/api\/attachments\/[0-9a-f-]{36}/)[0];
 assert.equal(hash(Buffer.from(await (await fetch(base+largeUrl)).arrayBuffer())),hash(Buffer.alloc(8*1024*1024,73)));
 console.log('PASS 8MiB transfer and download hash, status, disabled repeated chooser, concurrent typing mapped insertion');
 // Synthetic file paste/drop invokes the actual CodeMirror handlers and API.
 for(const event of ['paste','drop']){
  await editor().evaluate((element,event)=>{const data=new DataTransfer();data.items.add(new File([event],event+'.txt',{type:'text/plain'}));const ev=event==='paste'?new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}):new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data});element.dispatchEvent(ev)},event);
  await until(async()=>((await saved(note.id)).content.match(/\/api\/attachments\//g)||[]).length===(event==='paste'?2:3));
 }
 console.log('PASS file paste and drop handlers upload and insert source');
 const prior=(await saved(note.id)).content;let unblock,started;const hold=new Promise(r=>unblock=r),pending=new Promise(r=>started=r);requests=0;
 await page.route('**/api/attachments',async route=>{requests++;const response=await route.fetch();started();await hold;try{await route.fulfill({response})}catch{}});
 await fileInput().setInputFiles([{...payload,name:'cancel1.txt'},{...payload,name:'cancel2.txt'}]);await pending;await page.getByRole('button',{name:'첨부 취소',exact:true}).click();
 await until(async()=>!(await page.getByRole('button',{name:'파일 첨부',exact:true}).isDisabled()));unblock();await page.unroute('**/api/attachments');await page.waitForTimeout(400);assert.equal((await saved(note.id)).content,prior);assert.equal(requests,1);
 let count=0;await page.route('**/api/attachments',route=>++count===1?route.fulfill({status:500,contentType:'application/json',body:'{"ok":false,"error":"synthetic failure"}'}):route.continue());
 await fileInput().setInputFiles([{...payload,name:'fail.txt'},{...payload,name:'retry.txt'}]);await page.getByRole('dialog',{name:'첨부하지 못한 파일',exact:true}).waitFor();assert.match(await page.getByRole('dialog',{name:'첨부하지 못한 파일',exact:true}).innerText(),/fail.txt.*synthetic failure/s);await page.getByRole('dialog',{name:'첨부하지 못한 파일',exact:true}).getByRole('button',{name:'확인',exact:true}).click();await page.unroute('**/api/attachments');await until(async()=>((await saved(note.id)).content.match(/\/api\/attachments\//g)||[]).length===4);
 console.log('PASS cancel stops remaining batch and late response; partial failure continues and reports error');
 const stable=(await saved(note.id)).content;
 let finish,arrive;const late=new Promise(r=>finish=r),seen=new Promise(r=>arrive=r);
 await page.route('**/api/attachments',async route=>{const response=await route.fetch();arrive();await late;try{await route.fulfill({response})}catch{}});
 await fileInput().setInputFiles({...payload,name:'late-navigation.txt'});await seen;
 await editor().evaluate(element=>{const data=new DataTransfer();data.items.add(new File(['repeat'],'repeat.txt'));element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))});
 await page.getByRole('dialog',{name:'첨부 진행 중',exact:true}).waitFor();assert.match(await page.getByRole('dialog',{name:'첨부 진행 중',exact:true}).innerText(),/첨부 진행 중/);await page.getByRole('dialog',{name:'첨부 진행 중',exact:true}).getByRole('button',{name:'확인',exact:true}).click();
 const other=await rpc('save',{note:{title:'Navigation target '+Date.now(),content:'other raw',content_format:'html'}});
 await rpc('wait_index');await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(other.title);await page.getByRole('button',{name:'노트 열기: '+other.title,exact:true}).click();await until(async()=>await page.getByLabel('노트 제목',{exact:true}).inputValue()===other.title);finish();await page.unroute('**/api/attachments');await page.waitForTimeout(400);
 assert.equal((await saved(note.id)).content,stable);assert.equal((await saved(other.id)).content,'other raw');
 console.log('PASS repeated file paste refused, navigation during delayed upload preserves both notes');
 assert.deepEqual(errors,[]);
}finally{await browser.close()}
