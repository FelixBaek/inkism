// Production React + actual Go/Rust runtime, using a dedicated synthetic DB.
// Run against the current built preview; this does not verify native Windows IME.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48285';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],ops=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().endsWith('/api/rpc')){try{ops.push(request.postDataJSON().op);}catch{}}});
const rich=()=>page.locator('.tiptap-prose');
const source=()=>page.locator('.cm-content');
const until=async(check,message)=>{for(let i=0;i<100;i++){if(await check())return;await page.waitForTimeout(75);}throw Error(message);};
const open=async note=>{
 if(page.url().startsWith(base)){
  await rpc('wait_index');
  await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(note.title);
  await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();
 }else{
  await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 }
 await until(async()=>await page.getByRole('textbox',{name:'노트 제목',exact:true}).inputValue()===note.title,'note opened');
};
const view=async mode=>{await page.getByRole('button',{name:mode,exact:true}).click();};
const saved=()=>until(async()=>await page.locator('.status-save').evaluate(element=>element.classList.contains('ok')),'saved');
const startCopy=async()=>{
 await page.getByRole('button',{name:'서식 편집 사본 만들기',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'서식 편집 사본 만들기',exact:true});await dialog.waitFor();return dialog;
};
try{
 const original=await rpc('save',{note:{title:'Rich view '+Date.now(),content:'<p>원래 <strong>서식</strong></p>',content_format:'html',tags:[]}});
 // HTML notes open in the rich (텍스트) view by default; HTML source is an explicit choice.
 await open(original);await rich().waitFor();
 const buttons=await page.getByRole('group',{name:'편집 모드',exact:true}).getByRole('button').allTextContents();
 assert.deepEqual(buttons.map(value=>value.trim()),['텍스트','HTML','MARKDOWN']);
 const conversions=ops.filter(op=>op==='convert_content').length;
 await view('텍스트');await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'true');
 assert.deepEqual(await rpc('get',{id:original.id}),original,'viewing rich never normalizes source or revision');
 await rich().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 새 입력');
 await page.keyboard.press('Control+s');await saved();
 let current=await rpc('get',{id:original.id});assert.ok(current.content.includes(' 새 입력'));assert.match(current.content,/<strong>서식(?: 새 입력)?<\/strong>/);assert.equal(current.content_format,'html');
 await view('HTML');await source().waitFor();const beforeView=await rpc('get',{id:original.id});
 assert.equal(ops.filter(op=>op==='convert_content').length,conversions,'HTML/rich view toggles do not convert format');
 await source().click();await page.keyboard.press('Control+End');await page.keyboard.insertText('<p>원문 추가</p>');await page.keyboard.press('Control+s');await saved();
 await view('텍스트');await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'true');
 current=await rpc('get',{id:original.id});assert.equal(current.content,beforeView.content+'<p>원문 추가</p>');
 await until(async()=>(await rpc('workspace_get')).locations?.[original.id]?.kind==='rich','rich view remembered');
 await page.reload();await rich().waitFor();assert.equal(await page.getByRole('button',{name:'텍스트',exact:true}).getAttribute('aria-pressed'),'true');

 // A failed write blocks mode/navigation changes and keeps the new rich input.
 const beforeFailure=await rpc('get',{id:original.id});
 await page.route('**/api/rpc',route=>{
  const op=route.request().postDataJSON().op;
  return ['save','document_splice_source'].includes(op)?route.fulfill({json:{ok:false,error:'synthetic rich write failure'}}):route.continue();
 });
 await rich().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 실패 보관');await page.keyboard.press('Control+s');
 await until(async()=>(await page.locator('.status-save').innerText()).includes('저장 실패'),'write failure shown');
 await view('HTML');assert.equal(await source().count(),0);assert.ok((await rich().innerText()).includes('실패 보관'));
 assert.equal((await rpc('get',{id:original.id})).content,beforeFailure.content);
 await page.unroute('**/api/rpc');await page.keyboard.press('Control+s');await saved();assert.ok((await rpc('get',{id:original.id})).content.includes('실패 보관'));

 // Unsupported source stays read-only; cancel/failure/copy preserve original bytes.
 const raw='\ufeff<!--원문 주석-->\r\n<script>(window as any).richInjected=1</script><x-unknown data-value="x">원문 보존</x-unknown>';
 const unknown=await rpc('save',{note:{title:'Unknown '+Date.now(),content:raw,content_format:'html',tags:['원본']}});
 await open(unknown);await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'false');
 assert.equal(await page.evaluate(()=>(window as any).richInjected),undefined);
 await rich().click();await page.keyboard.insertText('덮어쓰기');await page.keyboard.press('Control+s');
 assert.deepEqual(await rpc('get',{id:unknown.id}),unknown);
 let dialog=await startCopy();await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.deepEqual(await rpc('get',{id:unknown.id}),unknown);
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='save'?route.fulfill({json:{ok:false,error:'synthetic copy failure'}}):route.continue());
 dialog=await startCopy();await dialog.getByRole('button',{name:'사본 만들기',exact:true}).click();
 await page.getByRole('dialog',{name:'서식 사본 만들기 실패',exact:true}).waitFor();assert.deepEqual(await rpc('get',{id:unknown.id}),unknown);
 await page.getByRole('dialog',{name:'서식 사본 만들기 실패',exact:true}).getByRole('button').click();await page.unroute('**/api/rpc');
 dialog=await startCopy();await dialog.getByRole('button',{name:'사본 만들기',exact:true}).click();
 await until(async()=>await page.getByRole('textbox',{name:'노트 제목',exact:true}).inputValue()===unknown.title+' (서식 편집 사본)','copy opened');
 await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'true');
 const copyId=(await rpc('workspace_get')).active;
 const copied=await rpc('get',{id:copyId});assert.notEqual(copyId,unknown.id);assert.equal(copied.content_format,'html');assert.deepEqual(copied.tags,['원본']);
 assert.ok(copied.content.includes('원문 보존'));assert.equal(copied.content.includes('<script>'),false);assert.deepEqual(await rpc('get',{id:unknown.id}),unknown);

 for(const [format,rawBody] of [['text','\ufeff字 <script>(window as any).richInjected=2</script>\r\n**원문**'],['markdown','\ufeff# 제목\r\n\n<!--주석--> **내용**\r\n']]){
  const note=await rpc('save',{note:{title:format+' raw '+Date.now(),content:rawBody,content_format:format,tags:[]}});
  await open(note);if(format==='markdown'){await source().waitFor();await view('텍스트');}
  await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'false');assert.deepEqual(await rpc('get',{id:note.id}),note);
  dialog=await startCopy();await dialog.getByRole('button',{name:'사본 만들기',exact:true}).click();
  await until(async()=>await page.getByRole('textbox',{name:'노트 제목',exact:true}).inputValue()===note.title+' (서식 편집 사본)','source copy opened');
  await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'true');assert.deepEqual(await rpc('get',{id:note.id}),note);
  assert.equal(await page.evaluate(()=>(window as any).richInjected),undefined);
 }

 // A metadata edit while the asynchronous render is pending cancels copy creation.
 await open(unknown);await view('HTML');await source().waitFor();await view('텍스트');await rich().waitFor();
 let release,started;const held=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);let copySaves=0;
 await page.route('**/api/rpc',async route=>{
  const data=route.request().postDataJSON();if(data.op==='save'&&data.note?.id!==unknown.id)copySaves++;
  if(data.op!=='document_render')return route.continue();
  const response=await route.fetch();started();await held;return route.fulfill({response});
 });
 dialog=await startCopy();await dialog.getByRole('button',{name:'사본 만들기',exact:true}).click();await seen;
 await page.getByRole('textbox',{name:'노트 제목',exact:true}).fill('변경된 원본 제목');release();
 await page.getByRole('dialog',{name:'서식 사본 만들기 실패',exact:true}).waitFor();assert.equal(copySaves,0);
 await page.getByRole('dialog',{name:'서식 사본 만들기 실패',exact:true}).getByRole('button').click();await page.unroute('**/api/rpc');await page.keyboard.press('Control+s');await saved();
 assert.equal((await rpc('get',{id:unknown.id})).content,raw);assert.equal((await rpc('get',{id:unknown.id})).title,'변경된 원본 제목');

 // New notes are genuinely rich, and their canonical HTML survives immediate save.
 await page.keyboard.press('Control+n');await until(async()=>await page.getByRole('textbox',{name:'노트 제목',exact:true}).inputValue()==='','new note');
 await rich().waitFor();assert.equal(await rich().getAttribute('contenteditable'),'true');
 await page.getByRole('textbox',{name:'노트 제목',exact:true}).fill('새 서식 노트');await rich().click();await page.keyboard.insertText('한글 새 노트');
 await page.keyboard.press('Control+s');await saved();
 // The workspace may briefly report no active note while the new one is stored.
 let freshId='';await until(async()=>{const active=(await rpc('workspace_get')).active;if(active&&active!==unknown.id){freshId=active;}return freshId!=='';},'new note workspace');
 const fresh=await rpc('get',{id:freshId});assert.equal(fresh.content_format,'html');assert.ok(fresh.content.includes('한글 새 노트'));
 await page.reload();await rich().waitFor();assert.ok((await rich().innerText()).includes('한글 새 노트'));
 assert.deepEqual(errors,[]);
 console.log('PASS actual React/Go/Rust: TEXT is rich, HTML is source, view switching preserves format/revision, source-rich edits/reload, failed save blocks view change, unknown/BOM/CRLF/text/Markdown originals preserved, readonly guard, copy cancel/failure/success/race, new canonical rich note and immediate save. Windows/native IME/large rich virtualization remain separate.');
}finally{await browser.close();}
