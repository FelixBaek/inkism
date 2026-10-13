import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {historyKey} from './history-keys.ts';
import {waitForPredicate} from './wait-for-predicate.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47912';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const title='구간 실행취소 '+Date.now();
const initial=Array.from({length:10000},(_,i)=>`<p><strong>한글😀 ${i}</strong> 본문</p>`).join('');
const note=await rpc('save',{note:{title,content:initial,text:'한글'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const root=page.locator('.tiptap-prose');
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
const at=offset=>page.waitForFunction(offset=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(offset),offset);
const jump=async offset=>{await page.getByLabel('이동할 블록 번호').fill(String(offset+1));await page.getByRole('button',{name:'이동',exact:true}).click();await at(offset);};
const type=async text=>{await root.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText(text);await page.keyboard.press('Control+s');await saved();};
const undo=()=>historyKey(page,'undo');
const redo=()=>historyKey(page,'redo');
try {
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='1'?'&lazy=1':''));await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await at(0);
 // Delay a requested page while a stale scroll event arrives from the old window.
 let releasePage; let sawPage;
 const requested=new Promise(resolve=>{sawPage=resolve;});
 const release=new Promise(resolve=>{releasePage=resolve;});
 await page.route('**/api/rpc',async route=>{
   const body=route.request().postDataJSON();
   if(body.op==='document_blocks' && body.offset===6400){sawPage();await release;}
   await route.continue();
 });
 await page.getByLabel('이동할 블록 번호').fill('6401');
 await page.getByRole('button',{name:'이동',exact:true}).click();await requested;
 await page.locator('.window-scroll').evaluate(host=>{host.scrollTop=128*48;host.dispatchEvent(new Event('scroll'));});
 await page.waitForTimeout(250);releasePage();await at(6400);
 await page.waitForTimeout(300);assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'),'6400');
 await page.unroute('**/api/rpc');await jump(0);
 await type('첫수정 ');const first=(await rpc('get',{id:note.id})).content;
 await jump(3200);await type('둘째수정 ');const both=(await rpc('get',{id:note.id})).content;
 await jump(6400);await undo();await at(3200);await saved();assert.equal((await rpc('get',{id:note.id})).content,first);
 await root.click();await page.keyboard.press('Control+z');await at(0);await saved();assert.equal((await rpc('get',{id:note.id})).content,initial);
 await redo();await saved();assert.equal((await rpc('get',{id:note.id})).content,first);
 await root.click();await page.keyboard.press('Control+Shift+z');await at(3200);await saved();assert.equal((await rpc('get',{id:note.id})).content,both);
 assert.equal(await root.locator('strong').count(),32);
 // Redo is invalidated by a new branch, even after switching windows.
 await undo();await saved();await jump(128);await type('새분기 ');
 // No redo button any more: Ctrl+Y must be a no-op (no window jump, no body change) after the new branch.
 const baseline=(await rpc('get',{id:note.id})).content;
 await redo();await page.waitForTimeout(500);assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'),'128');
 await page.keyboard.press('Control+s');await saved();assert.equal((await rpc('get',{id:note.id})).content,baseline);assert.ok((await root.textContent()).includes('새분기'));
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='document_splice_html' ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'offline test'})}) : route.continue());
 await root.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('실패보존 ');await page.keyboard.press('Control+s');await page.getByRole('button',{name:'다시 저장',exact:true}).waitFor();
 await undo();assert.equal((await root.textContent()).includes('실패보존'),false);
 await redo();assert.equal((await root.textContent()).includes('실패보존'),true);
 assert.equal((await rpc('get',{id:note.id})).content,baseline);
 await page.unroute('**/api/rpc');await root.click();await page.keyboard.press('Control+s');await saved();assert.ok((await rpc('get',{id:note.id})).content.includes('실패보존'));
 // Structural edits change global block counts and later window offsets.
 const beforeInsert=(await rpc('get',{id:note.id})).content;
 await root.locator('p').first().click();await root.locator('p').first().hover();await page.getByRole('button',{name:'블록 넣기',exact:true}).click();await page.getByRole('option',{name:'블록 삽입: 본문',exact:true}).click();await page.keyboard.press('Control+s');
 // The status can still read saved before the inserted block marks the draft dirty; wait for the body itself.
 await waitForPredicate(async()=>(await rpc('get',{id:note.id})).content!==beforeInsert,'block insert save timeout');await saved();
 const afterInsert=(await rpc('get',{id:note.id})).content;assert.notEqual(afterInsert,beforeInsert);
 await jump(6400);await undo();await at(128);await saved();assert.equal((await rpc('get',{id:note.id})).content,beforeInsert);
 await redo();await saved();assert.equal((await rpc('get',{id:note.id})).content,afterInsert);
 assert.ok((await page.locator('.window-controls').textContent()).includes('/ 10001 블록'));
 assert.deepEqual(errors,[]);console.log('PASS: cross-window undo/redo, exact HTML and marks, keyboard shortcuts, new-branch invalidation, offline local history and retry');
} catch(e) {console.error('page errors',errors);console.error(await page.locator('.window-error').allTextContents());console.error(await page.evaluate(()=>({title:document.querySelector<any>('.title-input')?.value,offset:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),scroll:document.querySelector('.window-scroll')?.scrollTop,controls:document.querySelector('.window-controls')?.textContent,status:document.querySelector('.status-save')?.textContent})));throw e;} finally {await browser.close();}
