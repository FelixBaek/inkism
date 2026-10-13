import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47882';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='블록 동작 '+Date.now();
// The table is seeded in Tiptap's serialized shape: HTML that would not round-trip exactly opens read-only by design (lossless admission).
const note=await rpc('save',{note:{title,content:'<p><strong>첫 문단</strong></p><p>둘째 문단</p><details open><summary>접기 제목</summary><div data-type="detailsContent"><p>접기 안쪽 본문</p></div></details><table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup><tbody><tr><th><p>머리</p></th></tr><tr><td><p>한글 셀</p></td></tr></tbody></table><p>마지막 문단</p>',text:'첫 문단 둘째 문단 접기 제목 접기 안쪽 본문 머리 한글 셀 마지막 문단',tags:[]}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const root=page.locator('.tiptap-prose');
// HTML 노트는 기본으로 텍스트(리치) 보기로 열린다. 다른 보기가 기억돼 있으면 텍스트로 바꾼다.
const openRich=async(name)=>{await page.getByRole('button',{name:'노트 열기: '+name,exact:true}).click();const text=page.locator('.mode-btn',{hasText:'텍스트'});await text.waitFor();if(!(await text.getAttribute('class')).includes('is-active'))await text.click();await root.waitFor();await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isEditable);};
const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const texts=()=>root.locator(':scope > *').allTextContents();
// 블록 손잡이: 커서가 있는 블록에 마우스를 올려 손잡이를 띄운 뒤 메뉴를 쓴다. 이동은 Alt+Shift+↑/↓.
const hoverBlock=async()=>{await page.waitForTimeout(100);const p=await page.locator('.tiptap-prose').first().evaluate((el:any)=>{const {state,view}=el.editor,$f=state.selection.$from,pos=$f.depth?$f.before(1):state.selection.from,b=view.nodeDOM(pos).getBoundingClientRect();return {x:b.left+Math.min(40,b.width/2),y:b.top+Math.min(8,b.height/2)};});await page.mouse.move(p.x-2,p.y);await page.mouse.move(p.x,p.y);await page.locator('.block-handle').waitFor({state:'visible'});};
// A click's selection reaches ProseMirror through the async selectionchange; let it land before the shortcut.
const action=async(name)=>{await frame();await blockAction(name);await frame();};
const blockAction=async(name)=>{
 if(name==='위로 이동'||name==='아래로 이동'){await page.locator('.tiptap-prose').first().evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press(name==='위로 이동'?'Alt+Shift+ArrowUp':'Alt+Shift+ArrowDown');return;}
 await hoverBlock();
 if(name==='아래에 문단 추가'){await page.getByRole('button',{name:'블록 넣기',exact:true}).click();await page.getByRole('option',{name:'블록 삽입: 본문',exact:true}).click();return;}
 await page.getByRole('button',{name:'블록 동작',exact:true}).click();await page.getByRole('menuitem',{name:{'블록 복제':'복제','블록 삭제':'삭제'}[name]??name,exact:true}).click();
};
const undo=async()=>{await historyKey(page,'undo');await frame();};
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
try{
 await page.goto(base);await openRich(title);await root.waitFor();
 await root.locator('p').first().click();await action('아래로 이동');assert.equal((await texts())[0],'둘째 문단');assert.equal((await texts())[1],'첫 문단');assert.equal(await root.locator('strong').textContent(),'첫 문단');
 await undo();assert.equal((await texts())[0],'첫 문단');
 await historyKey(page,'redo');await frame();assert.equal((await texts())[0],'둘째 문단');
 await action('위로 이동');assert.equal((await texts())[0],'첫 문단');
 await action('블록 복제');assert.equal(await root.locator('strong').count(),2);
 await action('블록 삭제');assert.equal(await root.locator('strong').count(),1);await undo();assert.equal(await root.locator('strong').count(),2);await undo();assert.equal(await root.locator('strong').count(),1);
 await root.locator('summary').click();await action('아래로 이동');let order=await texts();assert.ok(order.findIndex(x=>x.includes('한글 셀'))<order.findIndex(x=>x.includes('접기 제목')));assert.ok(await root.locator('[data-type="detailsContent"]').textContent()==='접기 안쪽 본문');await undo();
 await root.locator('td').click();await action('위로 이동');order=await texts();assert.ok(order.findIndex(x=>x.includes('한글 셀'))<order.findIndex(x=>x.includes('접기 제목')));await undo();
 await root.locator(':scope > p').last().click();await action('아래에 문단 추가');await page.keyboard.insertText('새 한글 블록');await frame();assert.equal((await texts()).at(-1),'새 한글 블록');await saved();
 await page.reload();await openRich(title);await root.waitFor();assert.equal((await texts()).at(-1),'새 한글 블록');assert.equal(await root.locator('strong').textContent(),'첫 문단');assert.equal(await root.locator('td').textContent(),'한글 셀');
 // A real pointer drag via the official handle, not a mocked transaction.
 const first=root.locator(':scope > p').first();await first.hover();const handle=page.getByRole('button',{name:'블록 끌어서 이동',exact:true});await handle.waitFor({state:'visible'});
 const from=await handle.boundingBox(),to=await root.locator(':scope > p').last().boundingBox();assert.ok(from&&to);await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+10,from.y+from.height/2+10,{steps:5});await page.mouse.move(to.x+40,to.y+to.height-1,{steps:25});await page.mouse.up();await frame();assert.notEqual((await texts())[0],'첫 문단');assert.equal(await root.locator('strong').count(),1);await undo();assert.equal((await texts())[0],'첫 문단');await historyKey(page,'redo');await frame();assert.notEqual((await texts())[0],'첫 문단');await saved();
 const stored=await rpc('get',{id:note.id});assert.ok(stored.content.includes('<strong>첫 문단</strong>'));assert.ok(stored.content.includes('한글 셀'));assert.ok(stored.content.includes('접기 안쪽 본문'));
 // Multi-block selections must not silently act on only their first block.
 await root.click();await page.keyboard.press('Control+a');const whole=await texts();
 for(const key of ['Alt+Shift+ArrowUp','Alt+Shift+ArrowDown','Control+d']){await page.keyboard.press(key);await frame();assert.deepEqual(await texts(),whole,key);}
 // Deleting the only paragraph keeps a valid, editable document, and undo recovers its marks.
 const onlyTitle='하나뿐인 블록 '+Date.now();await rpc('save',{note:{title:onlyTitle,content:'<p><strong>보존할 한글</strong></p>',text:'보존할 한글',tags:[]}});
 await page.reload();await openRich(onlyTitle);await root.locator('strong').click();await action('블록 삭제');assert.equal(await root.textContent(),'');assert.ok(await root.locator('p').count()>=1);await undo();assert.equal(await root.locator('strong').textContent(),'보존할 한글');
 assert.deepEqual(errors,[]);console.log('PASS: block move/duplicate/delete/insert, undo/redo, table/details/marks retained, Korean save/reopen and real pointer drag');
}finally{await browser.close();}
