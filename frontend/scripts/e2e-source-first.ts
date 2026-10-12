import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48176';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const raw='\ufeff# 원문\r\n<script>(window as any).sourceInjected=1</script>\n<x-unknown data-x="y">보존</x-unknown>\r끝';
const note=await rpc('save',{note:{title:'Source contract '+Date.now(),content:raw,content_format:'html',tags:[]}});
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:900}}),errors=[],ops=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/api/rpc')){try{ops.push(JSON.parse(r.postData()).op)}catch{}}});
const body=()=>p.locator('.cm-content');
const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await p.waitForTimeout(100)}throw Error('condition timed out')};
try{
 // HTML notes open in the rich (텍스트) view by default; the source editor is an explicit choice.
 await p.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await p.goto(base);await p.locator('.ProseMirror').first().waitFor();assert.equal(await p.getByRole('button',{name:'텍스트',exact:true}).getAttribute('aria-pressed'),'true');
 await p.getByRole('button',{name:'HTML',exact:true}).click();await body().waitFor();assert.equal(await p.getByRole('button',{name:'HTML',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await p.evaluate(()=>(window as any).sourceInjected),undefined);
 assert.equal((await rpc('get',{id:note.id})).content,raw);
 await p.getByRole('button',{name:'MARKDOWN',exact:true}).click();await until(async()=>await p.getByRole('button',{name:'MARKDOWN',exact:true}).getAttribute('aria-pressed')==='true');assert.equal(await p.getByRole('dialog',{name:'원문 형식 변경'}).count(),0);assert.equal((await rpc('get',{id:note.id})).content_format,'html');
 // MARKDOWN on an HTML note is a view only; format conversion stays an engine op.
 const cur=await rpc('get',{id:note.id});await rpc('convert_content',{id:note.id,revision:cur.revision,content_format:'markdown'});assert.equal((await rpc('get',{id:note.id})).content,raw);assert.ok((await rpc('history',{id:note.id})).length>0);
 await p.reload();await until(async()=>await p.getByRole('button',{name:'MARKDOWN',exact:true}).getAttribute('aria-pressed')==='true'&&await body().getAttribute('aria-label')==='노트 본문 (Markdown 원문 편집기)');
 await body().click();await p.keyboard.press('Control+End');await p.keyboard.insertText(' 수정');await until(async()=>(await rpc('get',{id:note.id})).content===raw+' 수정');assert.ok(ops.includes('document_splice_source'));assert.equal(ops.includes('document_render'),false);
 await p.getByRole('button',{name:'자동 줄바꿈',exact:true}).click();await body().focus();await p.keyboard.press('Control+z');await until(async()=>(await rpc('get',{id:note.id})).content===raw);await p.reload();await body().waitFor();assert.equal(await p.getByRole('button',{name:'자동 줄바꿈',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await p.getByRole('button',{name:'MARKDOWN',exact:true}).getAttribute('aria-pressed'),'true');
 const large='# 큰 문서\n'+('그대로 **보존** [링크](javascript:alert(1))\n'.repeat(15000));const huge=await rpc('save',{note:{title:'Large markdown '+Date.now(),content:large,content_format:'markdown',tags:[]}});await rpc('workspace_set',{ids:[huge.id],active:huge.id,locations:{}});await p.reload();await body().waitFor();await body().click();await p.keyboard.press('Control+End');await p.keyboard.insertText('추가');await until(async()=>(await rpc('get',{id:huge.id})).content===large+'추가');assert.ok(await p.locator('.cm-line').count()<200);assert.equal(await p.evaluate(()=>(window as any).sourceInjected),undefined);
 await p.route('**/api/rpc',async route=>{const data=route.request().postDataJSON();if(['save','document_splice_source'].includes(data.op))await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic write failure'})});else await route.continue()});await body().click();await p.keyboard.press('Control+End');await p.keyboard.insertText(' 보관');await p.waitForTimeout(1300);assert.equal((await rpc('get',{id:huge.id})).content,large+'추가');assert.match(await body().innerText(),/보관/);await p.unroute('**/api/rpc');
 assert.deepEqual(errors,[]);console.log('PASS source-first: exact raw BOM/CRLF/unknown HTML, no execution, format cancel/change snapshot, source splice save, wrap undo/reload, >256KiB Markdown virtualization, failed write preserves editor');
}finally{await b.close()}
