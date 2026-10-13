// Block menus must act on complete canonical blocks, including outside the
// current view. No complete body may be requested by the lazy editor.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const root=page.locator('.tiptap-prose');
let lastNote;
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
// 블록 손잡이: 커서가 있는 블록에 마우스를 올려 손잡이를 띄운 뒤 메뉴를 쓴다. 이동은 Alt+Shift+↑/↓.
const hoverBlock=async()=>{await page.waitForTimeout(100);const p=await page.locator('.tiptap-prose').first().evaluate((el: any)=>{const {state,view}=el.editor,$f=state.selection.$from,pos=$f.depth?$f.before(1):state.selection.from,b=view.nodeDOM(pos).getBoundingClientRect();return {x:b.left+Math.min(40,b.width/2),y:b.top+Math.min(8,b.height/2)};});await page.mouse.move(p.x-2,p.y);await page.mouse.move(p.x,p.y);await page.locator('.block-handle').waitFor({state:'visible'});};
const action=async(name)=>{
 if(name==='위로 이동'||name==='아래로 이동'){await page.locator('.tiptap-prose').first().evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press(name==='위로 이동'?'Alt+Shift+ArrowUp':'Alt+Shift+ArrowDown');return;}
 await hoverBlock();
 if(name==='아래에 문단 추가'){await page.getByRole('button',{name:'블록 넣기',exact:true}).click();await page.getByRole('option',{name:'블록 삽입: 본문',exact:true}).click();return;}
 await page.getByRole('button',{name:'블록 동작',exact:true}).click();await page.getByRole('menuitem',{name:{'블록 복제':'복제','블록 삭제':'삭제'}[name]??name,exact:true}).click();
};
// Edited blocks acquire permanent IDs; every other source byte must still match.
const withoutIds=html=>html.replace(/ id="ink-block-[0-9a-f-]{36}"/g,'');
const stored=async(id,expected)=>{await waitForPredicate(async()=>(withoutIds((await rpc('get',{id})).content)===expected),'block action did not preserve complete source',10000);await ready();};
// Undo to the untouched note restores it exactly, without any acquired ID.
const restored=async(id,expected)=>{await waitForPredicate(async()=>((await rpc('get',{id})).content===expected),'undo did not restore the exact source',10000);await ready();};
try{
 const target='<p><strong>'+('한글😀&amp; '.repeat(30000))+'</strong></p>',prefix='<p>선행 원문 &amp;</p>',tail='<p>후미 원문</p>',source=prefix+target+tail;
 const nativeTarget='<p><strong>짧은 원문</strong></p>';
 // Isolate the replaced block's inline formatting. Native DOM insertion on a
 // paragraph NodeSelection can join the following paragraph; a bounded global
 // replacement deliberately preserves that unselected neighbour.
 const native=await rpc('save',{note:{title:'일반 블록 선택 '+Date.now(),content:prefix+nativeTarget,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+native.title,exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
 await root.locator('strong').click();await action('블록 복제');await page.keyboard.insertText('블록 전체 교체');
 await waitForPredicate(async()=>((await rpc('get',{id:native.id})).content.includes('블록 전체 교체')),'native block replacement was not saved');
 const nativeSource=withoutIds((await rpc('get',{id:native.id})).content);
 assert.ok(nativeSource.startsWith(prefix+nativeTarget),nativeSource);
 const nativeReplacement=nativeSource.slice((prefix+nativeTarget).length);
 assert.equal(nativeReplacement,'<p><strong>블록 전체 교체</strong></p>');
 const note=await rpc('save',{note:{title:'전체 블록 동작 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
 lastNote=note.id;
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await page.getByRole('textbox',{name:'이동할 블록 번호',exact:true}).fill('2');await page.getByRole('button',{name:'이동',exact:true}).click();await page.locator('[data-window-start="1"]').waitFor();await ready();
 const reads=[];await page.route('**/api/rpc',route=>{const v=route.request().postDataJSON();if(v.id===note.id){if(process.env.INKISM_LAZY!=='0'&&['get','revision_body','document_render'].includes(v.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});if(['document_blocks','document_segments','document_block_window'].includes(v.op))reads.push(v);}return route.continue();});
 await root.evaluate((el: any)=>{el.editor.commands.setTextSelection(10);el.editor.view.focus();});
 await action('블록 복제');await stored(note.id,prefix+target+target+tail);
 assert.ok((await root.textContent()).length<66000);assert.ok(await page.locator('*').count()<1500);
 await page.keyboard.insertText('블록 전체 교체');await stored(note.id,prefix+target+nativeReplacement+tail);
 await historyKey(page,'undo');await stored(note.id,prefix+target+target+tail);
 await historyKey(page,'undo');await restored(note.id,source);
 await historyKey(page,'redo');await stored(note.id,prefix+target+target+tail);
 await historyKey(page,'undo');await restored(note.id,source);
 await action('위로 이동');await stored(note.id,target+prefix+tail);
 await historyKey(page,'undo');await restored(note.id,source);
 await action('아래로 이동');await stored(note.id,prefix+tail+target);
 await historyKey(page,'undo');await restored(note.id,source);
 await action('아래에 문단 추가');await stored(note.id,prefix+target+'<p></p>'+tail);
 await page.keyboard.insertText('새 블록');await stored(note.id,prefix+target+'<p>새 블록</p>'+tail);
 await historyKey(page,'undo');await stored(note.id,prefix+target+'<p></p>'+tail);
 await historyKey(page,'undo');await restored(note.id,source);
 await action('블록 삭제');await stored(note.id,prefix+tail);
 await historyKey(page,'undo');await restored(note.id,source);
 assert.ok(reads.every(v=>v.op==='document_block_window'?v.limit<=65536:(v.limit??1)<=32));
 await page.unroute('**/api/rpc');
 const openWindow=async(note)=>{lastNote=note.id;await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();};
 const jump=async(ordinal)=>{await page.getByRole('textbox',{name:'이동할 블록 번호',exact:true}).fill(String(ordinal+1));await page.getByRole('button',{name:'이동',exact:true}).click();await page.locator('[data-window-start="'+ordinal+'"]').waitFor();await ready();};
 const undo=()=>historyKey(page,'undo');
 const blocks=Array.from({length:70},(_,i)=>'<p><b>원문 '+i+' &amp; 😀 '+('a'.repeat(4000))+'</b></p>'),body=blocks.join('');
 const boundary=await rpc('save',{note:{title:'블록 경계 '+Date.now(),content:body,content_format:'html'}});await rpc('wait_index');await openWindow(boundary);
 await jump(32);await root.evaluate((el: any)=>{el.editor.commands.setTextSelection(2);el.editor.view.focus();});
 await action('위로 이동');const movedUp=[...blocks];[movedUp[31],movedUp[32]]=[movedUp[32],movedUp[31]];await stored(boundary.id,movedUp.join(''));await undo();await restored(boundary.id,body);
 await jump(0);await root.evaluate((el: any)=>{const e=el.editor;let pos=0;for(let i=0;i<31;i++)pos+=e.state.doc.child(i).nodeSize;e.commands.setNodeSelection(pos);e.view.focus();});
 await action('아래로 이동');const movedDown=[...blocks];[movedDown[31],movedDown[32]]=[movedDown[32],movedDown[31]];await stored(boundary.id,movedDown.join(''));
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 await page.reload();await ready();await undo();await restored(boundary.id,body);
 assert.equal(await root.evaluate((el: any)=>el.editor.state.selection.from),0,'node selection restored relative to the one-block preview');
 await historyKey(page,'redo');await stored(boundary.id,movedDown.join(''));await undo();await restored(boundary.id,body);
 await jump(69);await root.evaluate((el: any)=>{el.editor.commands.setTextSelection(2);el.editor.view.focus();});await action('블록 삭제');await stored(boundary.id,blocks.slice(0,-1).join(''));await undo();await restored(boundary.id,body);
 const single=await rpc('save',{note:{title:'유일한 구간 블록 '+Date.now(),content:target,content_format:'html'}});await rpc('wait_index');await openWindow(single);
 await root.evaluate((el: any)=>{el.editor.commands.setTextSelection(2);el.editor.view.focus();});await action('블록 삭제');await stored(single.id,'<p></p>');await undo();await restored(single.id,target);
 assert.deepEqual(errors,[]);console.log('PASS full-block duplicate/move/insert/delete, exact source/undo/redo, bounded view/read; lazy='+process.env.INKISM_LAZY);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));if(lastNote){const stored=await rpc('get',{id:lastNote});console.error({length:stored.content.length,first:stored.content.slice(0,100),last:stored.content.slice(-200)});}throw error;}
finally{await browser.close();}
