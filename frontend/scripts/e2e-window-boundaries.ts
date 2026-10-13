import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47920';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='경계 이동 '+Date.now();
const content=Array.from({length:10000},(_,i)=>`<p><strong>블록 ${i}</strong> 한글😀</p>`).join('');
const note=await rpc('save',{note:{title,content,text:'경계'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const at=offset=>page.waitForFunction(offset=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(offset),offset);
const cursor=async(edge)=>{
 // Establish only the fixture caret here. A native click's deferred selection
 // update can overwrite the transaction before the boundary key is even sent.
 await page.locator('.tiptap-prose').evaluate((el: any,edge)=>{
  const editor=el.editor;editor.view.focus();
  editor.commands.setTextSelection(edge==='start'?1:editor.state.doc.content.size-1);
  editor.view.focus();
 },edge);
 await page.waitForFunction(edge=>{const e=document.querySelector<any>('.tiptap-prose')?.editor;return e?.state.selection.from===(edge==='start'?1:e?.state.doc.content.size-1);},edge);
};
const selectedBlock=()=>page.evaluate(()=>getSelection()?.anchorNode?.parentElement?.closest('p')?.textContent);
const readyCursor=()=>page.waitForFunction(()=>document.activeElement?.classList.contains('tiptap-prose'));
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
try {
 await page.addInitScript(()=>{
   (window as any).boundaryTrace=[];
   for(const type of ['keydown','keyup','pointerdown','pointerup','focusin','selectionchange'])document.addEventListener(type,event=>{
     const body=document.querySelector<any>('.tiptap-prose');
     (window as any).boundaryTrace.push({event:type+('key' in event?':'+event.key:''),time:performance.now(),
       offset:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),
       selection:body?.editor?.state.selection.toJSON(),active:document.activeElement?.className});
     if((window as any).boundaryTrace.length>100)(window as any).boundaryTrace.shift();
   },true);
 });
 if(process.env.INKISM_CPU_RATE)await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.INKISM_CPU_RATE)});
 await page.goto(process.env.INKISM_WINDOWED_FLAG==='1'?base:base+'/?virtual=1'+(process.env.INKISM_LAZY==='1'?'&lazy=1':''));await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await at(0);
 await cursor('end');await page.keyboard.insertText(' 수정');await page.keyboard.press('ArrowRight');await at(32);await readyCursor();await saved();
 assert.ok((await selectedBlock()).startsWith('블록 32'));assert.ok((await rpc('get',{id:note.id})).content.includes(' 수정'));
 await page.keyboard.press('ArrowLeft');await at(0);await readyCursor();assert.ok((await selectedBlock()).startsWith('블록 31'));
 await page.keyboard.press('Control+End');await at(9968);await readyCursor();assert.ok((await selectedBlock()).startsWith('블록 9999'));
 await page.keyboard.insertText(' 마지막');await page.keyboard.press('Control+Home');await at(0);await readyCursor();await saved();assert.ok((await selectedBlock()).startsWith('블록 0'));assert.ok((await rpc('get',{id:note.id})).content.includes(' 마지막'));
 // An arbitrary search/jump offset may require a shorter preceding window.
 await page.getByLabel('이동할 블록 번호').fill('6');await page.getByRole('button',{name:'이동',exact:true}).click();await at(5);
 await cursor('start');await page.keyboard.press('ArrowLeft');await at(0);await readyCursor();assert.equal(await page.locator('.tiptap-prose p').count(),5);assert.ok((await selectedBlock()).startsWith('블록 4'));
 await page.keyboard.press('ArrowRight');await at(5);await readyCursor();assert.ok((await selectedBlock()).startsWith('블록 5'));
 // Rejected save leaves the edited window and cursor in place.
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='document_splice_html'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'offline'})}):route.continue());
 await cursor('end');await page.keyboard.insertText(' 보존');await page.keyboard.press('ArrowRight');await page.locator('.window-error').filter({hasText:'저장하지 못해 현재 구간을 유지합니다.'}).waitFor();await at(5);assert.ok((await page.locator('.tiptap-prose').textContent()).includes(' 보존'));
 await page.unroute('**/api/rpc');await page.keyboard.press('Control+s');await saved();
 const largeTitle='큰 경계 '+Date.now();
 // Two individually bounded blocks exceed the page byte cap. A single
 // oversized block is rejected separately by e2e-lazy-admission.
 const large=Array.from({length:64},(_,i)=>`<p>큰블록 ${i} ${[0,1,32,33].includes(i)?'x'.repeat(265000):'끝'}</p>`).join('');
 await rpc('save',{note:{title:largeTitle,content:large,text:'큰 경계'}});await rpc('wait_index');
 await page.reload();await page.getByRole('button',{name:'노트 열기: '+largeTitle,exact:true}).click();await at(0);
 await cursor('start');await page.keyboard.press('Control+End');await at(63);await readyCursor();assert.ok((await selectedBlock()).startsWith('큰블록 63'));
 await page.getByLabel('이동할 블록 번호').fill('33');await page.getByRole('button',{name:'이동',exact:true}).click();await at(32);
 await cursor('start');await page.keyboard.press('ArrowLeft');await at(31);await readyCursor();assert.ok((await selectedBlock()).startsWith('큰블록 31'));
 assert.deepEqual(errors,[]);console.log('PASS: boundary arrows, cursor restoration, Ctrl+Home/End, short preceding window, flush and failed-save retention');
} catch(e) {console.error(JSON.stringify(await page.evaluate(()=>({trace:(window as any).boundaryTrace,offset:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),error:document.querySelector('.window-error')?.textContent,controls:document.querySelector('.window-controls')?.textContent,selection:getSelection()?.anchorNode?.textContent?.slice(0,70),position:getSelection()?.anchorOffset,editorSelection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),active:document.activeElement?.className,scroll:document.querySelector('.window-scroll')?.scrollTop,paragraphs:document.querySelectorAll('.tiptap-prose p').length})),null,2));throw e;} finally {await browser.close();}
