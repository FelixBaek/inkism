import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47932';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='경계 병합 '+Date.now();const block=i=>`<p><strong>한글😀 ${i}</strong> 본문</p>`;
const html=Array.from({length:10000},(_,i)=>block(i)).join('');
const note=await rpc('save',{note:{title,content:html,text:'검사'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const at=offset=>page.waitForFunction(offset=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(offset),offset);
const jump=async offset=>{await page.getByLabel('이동할 블록 번호').fill(String(offset+1));await page.getByRole('button',{name:'이동',exact:true}).click();await at(offset);};
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
const undo=()=>historyKey(page,'undo');
const merged=html.replace(block(31)+block(32),block(31).slice(0,-4)+block(32).slice(3));
// The edited (joined) block gains exactly one ink-block id; everything else stays byte-identical.
const joined=async()=>{const content=(await rpc('get',{id:note.id})).content,ids=content.match(/ id="ink-block-[0-9a-f-]{36}"/g)||[];assert.equal(ids.length,1,content.slice(0,200));assert.equal(content.replace(ids[0],''),merged);};
try {
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='1'?'&lazy=1':''));await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await at(0);
 await jump(32);await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.from===1);await page.keyboard.press('Backspace');await at(31);await page.waitForFunction(()=>document.querySelectorAll('.tiptap-prose p').length===1);await saved();
 await joined();assert.equal(await page.locator('.tiptap-prose p').count(),1);
 await undo();await saved();assert.equal((await rpc('get',{id:note.id})).content,html);
 await historyKey(page,'redo');await saved();await joined();
 await undo();await saved();await jump(0);
 await page.locator('.tiptap-prose p').last().click();await page.keyboard.press('End');await page.waitForFunction(()=>{const e=document.querySelector<any>('.tiptap-prose')?.editor;return e?.state.selection.from===e?.state.doc.content.size-1;});await page.keyboard.press('Delete');await at(31);await page.waitForFunction(()=>document.querySelectorAll('.tiptap-prose p').length===1);await saved();
 await joined();
 assert.ok((await page.locator('.window-controls').textContent()).includes('/ 9999 블록'));
 await page.reload();await at(31);await joined();
 assert.deepEqual(errors,[]);console.log('PASS: cross-window Backspace/Delete paragraph joins, exact formatting/body, undo/redo, block counts and reopen');
} catch(e) {console.error(await page.evaluate(()=>({offset:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),error:document.querySelector('.window-error')?.textContent,controls:document.querySelector('.window-controls')?.textContent,selection:getSelection()?.anchorNode?.textContent?.slice(0,70),position:getSelection()?.anchorOffset,scroll:document.querySelector('.window-scroll')?.scrollTop,paragraphs:document.querySelectorAll('.tiptap-prose p').length})));throw e;} finally {await browser.close();}
