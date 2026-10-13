import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.ok(v.ok,v.error);return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const root=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const drag=async(from,to)=>{
 await root.locator(':scope > *').nth(from).hover();const handle=page.getByRole('button',{name:'블록 끌어서 이동',exact:true});await handle.waitFor({state:'visible'});
 const a=await handle.boundingBox(),b=await root.locator(':scope > *').nth(to).boundingBox();assert.ok(a&&b);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+12,a.y+a.height/2+12,{steps:6});await page.mouse.move(b.x+40,b.y+b.height-1,{steps:25});await page.mouse.up();
};
let note;
try{
 const blocks=Array.from({length:10000},(_,i)=>'<p><b>블록 '+i+' &amp; 😀</b></p>'),body=blocks.join('');
 note=await rpc('save',{note:{title:'원문 블록 끌기 '+Date.now(),content:body,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 const reads=[];await page.route('**/api/rpc',route=>{const v=route.request().postDataJSON();if(v.id===note.id){if(process.env.INKISM_LAZY!=='0'&&['get','revision_body','document_render'].includes(v.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});if(['document_blocks','document_segments','document_block_window'].includes(v.op))reads.push(v);}return route.continue();});
 await drag(0,3);const moved=[...blocks];
 // A drop just before the lower border of block 3 belongs after that block.
 moved.splice(0,moved.length,...blocks.slice(1,4),blocks[0],...blocks.slice(4));
 await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content===moved.join('')),'pointer drag must move the complete source block without normalizing untouched HTML',10000);await ready();
 await historyKey(page,'undo');await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content===body),'drag undo failed');await ready();
 await historyKey(page,'redo');await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content===moved.join('')),'drag redo failed');await ready();
 await waitForPredicate(async()=>((await rpc('workspace_get')).locations?.[note.id]?.selection?.headByte===Buffer.byteLength(moved.slice(0,4).join(''))),'whole mounted block selection was not persisted',10000);
 await page.reload();await ready();await root.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.insertText('선택한 블록 교체');
 const replaced=[...moved];replaced[3]='<p><strong>선택한 블록 교체</strong></p>';
 await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content===replaced.join('')),'restored block selection must replace that block and preserve its unselected neighbour',10000);await ready();
 await historyKey(page,'undo');await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content===moved.join('')),'restored block replacement undo failed');await ready();
 assert.ok(reads.every(v=>v.op==='document_block_window'?v.limit<=65536:(v.limit??1)<=32));await page.unroute('**/api/rpc');
 const huge='<p><b>'+('한글😀 &amp; '.repeat(30000))+'</b></p>',others=Array.from({length:70},(_,i)=>'<p><b>이웃 '+i+' &amp; 😀</b></p>'),original=huge+others.join(''),largeMoved=others.join('')+huge;
 note=await rpc('save',{note:{title:'화면 밖 전체 문단 끌기 '+Date.now(),content:original,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await page.evaluate(()=>{(window as any).dragEvents=[];for(const type of ['dragstart','dragend','drop'])window.addEventListener(type,(e: any)=>(window as any).dragEvents.push({type,phase:(window as any).dragPhase,target:e.target?.className,connected:e.target?.isConnected,width:e.target?.getBoundingClientRect()?.width,height:e.target?.getBoundingClientRect()?.height,visibility:getComputedStyle(e.target).visibility,types:[...(e.dataTransfer?.types??[])]}),true);});
 const bounded=[];await page.route('**/api/rpc',route=>{const v=route.request().postDataJSON();if(v.id===note.id){if(process.env.INKISM_LAZY!=='0'&&['get','revision_body','document_render'].includes(v.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});if(['document_blocks','document_segments','document_block_window'].includes(v.op))bounded.push(v);}return route.continue();});
 const start=async()=>{
  await root.locator(':scope > *').filter({hasText:'한글😀'}).first().hover({position:{x:25,y:10}});const handle=page.getByRole('button',{name:'블록 끌어서 이동',exact:true});await handle.waitFor({state:'visible'});const b=await handle.boundingBox();assert.ok(b);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2+15,{steps:6});
 };
 const stored=async(expected)=>{await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content===expected),'complete paragraph move/undo did not preserve source',10000);await ready();};
 await page.evaluate(()=>(window as any).dragPhase='start');await start();await page.evaluate(()=>(window as any).dragPhase='scroll');await page.locator('.window-scroll').evaluate((el: any)=>el.scrollTop=el.scrollHeight);await page.locator('[data-window-start="39"]').waitFor();await ready();await page.evaluate(()=>(window as any).dragPhase='drop');
 await root.locator(':scope > *').last().scrollIntoViewIfNeeded();
 let edge=await root.locator(':scope > *').last().boundingBox();assert.ok(edge);await page.mouse.move(edge.x+40,edge.y+edge.height-2,{steps:20});await page.mouse.up();await stored(largeMoved);
 assert.ok((await root.textContent()).length<66000);assert.ok(await page.locator('*').count()<1500);
 await waitForPredicate(async()=>((await rpc('workspace_get')).locations?.[note.id]?.selection?.headByte===Buffer.byteLength(largeMoved)),'full block selection was not persisted',10000);
 await page.reload();await ready();await root.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.insertText('이동한 전체 블록 교체');
 await stored(others.join('')+'<p><strong>이동한 전체 블록 교체</strong></p>');
 await historyKey(page,'undo');await stored(largeMoved);
 await page.getByRole('textbox',{name:'이동할 블록 번호',exact:true}).fill('71');await page.getByRole('button',{name:'이동',exact:true}).click();await page.locator('[data-window-start="70"]').waitFor();await ready();
 await start();await page.locator('.window-scroll').evaluate((el: any)=>el.scrollTop=0);await page.locator('[data-window-start="0"]').waitFor();await ready();
 await root.locator(':scope > *').first().scrollIntoViewIfNeeded();edge=await root.locator(':scope > *').first().boundingBox();assert.ok(edge);await page.mouse.move(edge.x+40,edge.y+2,{steps:20});await page.mouse.up();await stored(original);
 await historyKey(page,'undo');await stored(largeMoved);
 await historyKey(page,'redo');await stored(original);
 assert.ok(bounded.every(v=>v.op==='document_block_window'?v.limit<=65536:(v.limit??1)<=32));
 const revision=(await rpc('get',{id:note.id})).revision;await start();const inside=await root.boundingBox();assert.ok(inside);await page.mouse.move(inside.x+60,Math.max(inside.y+30,400),{steps:10});await page.mouse.up();await ready();assert.equal((await rpc('get',{id:note.id})).revision,revision,'dropping inside the same whole paragraph must not move a piece');
 await page.unroute('**/api/rpc');
 const raceBlocks=blocks.map(value=>value.replace('<b>','<strong>').replace('</b>','</strong>'));
 note=await rpc('save',{note:{title:'끌기 중 입력 보존 '+Date.now(),content:raceBlocks.join(''),content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 let release,blocked=false;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/rpc',async route=>{const v=route.request().postDataJSON();if(!blocked&&v.id===note.id&&v.op==='document_blocks'&&v.offset===0&&v.limit===1){blocked=true;await gate;}return route.continue();});
 try{
  await drag(0,3);await waitForPredicate(async()=>blocked,'the move source read did not start',10000);
  await root.evaluate((el: any)=>{el.editor.commands.setTextSelection(2);el.editor.view.focus();});await page.keyboard.insertText('입력보존');
 }finally{release();}
 const withInput=[...raceBlocks];withInput[0]=withInput[0].replace('블록 0','블입력보존록 0');
 // The typed block acquires its permanent ID; every other byte stays exact.
 await waitForPredicate(async()=>((await rpc('get',{id:note.id})).content.replace(/^(<p) id="ink-block-[0-9a-f-]{36}"/,'$1')===withInput.join('')),'typing during a drag must survive the cancelled move',10000);await ready();await page.locator('.window-error').waitFor();
 assert.match(await page.locator('.window-error').textContent(),/변경|충돌|revision|version/i);
 await page.unroute('**/api/rpc');assert.deepEqual(errors,[]);console.log('PASS real pointer block drag across windows, giant paragraph both directions, exact HTML, restart selection/input, undo/redo, self drop, typing cancellation and bounded reads; lazy='+process.env.INKISM_LAZY);
}catch(e){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),events:(window as any).dragEvents})));if(note){const saved=await rpc('get',{id:note.id});console.error(saved.content.slice(0,250));}throw e;}finally{await browser.close();}
