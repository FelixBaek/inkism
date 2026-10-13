// Real application/Rust with an isolated profile. Never personal PC input.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
let source='<p><strong>'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12000))+'</strong></p><p>끝 원문 &amp;😀</p>';
let note=await rpc('save',{note:{title:'경계 삭제 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],splices=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const segment=n=>page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),n);
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
const body=async()=>(await rpc('get',{id:note.id})).content;
const cursor=async edge=>editor.evaluate((el: any,edge)=>{const positions=[];el.editor.state.doc.descendants((node,at)=>{if(node.isTextblock)positions.push({start:at+1,end:at+1+node.content.size});});el.editor.commands.setTextSelection(edge==='start'?positions[0].start:positions.at(-1).end);el.editor.view.focus();},edge);
const undo=async()=>{await historyKey(page,'undo');await saved();};
const firstSegment=async()=>{await ready();if(await page.locator('[data-segment-start]').getAttribute('data-segment-start')!=='0'){await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+Home');await segment(0);await ready();}};
const waitRequest=promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('boundary request did not start')),15000);timer.unref();})]);
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();await segment(0);
 await page.route('**/api/rpc',route=>{
  const request=route.request().postDataJSON();
  if(request.id===note.id){
   if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'whole-body read forbidden'}});
   if(request.op==='document_splice_html')splices.push(request);
  }
  return route.continue();
 });
 const first=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:0})).segments[0];
 const seam=first.byte_offset+Buffer.byteLength(first.source);
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();await cursor('start');
 await page.keyboard.press('Backspace');await saved();
 const backward=source.slice(0,seam-1)+source.slice(seam);
 assert.equal(await body(),backward,'backspace removes exactly the preceding source character');
 assert.ok((await editor.textContent()).length<33000);assert.ok(await page.locator('*').count()<1500);
 await page.reload();await ready();await undo();assert.equal(await body(),source,'restart undo restores exact source');
 await historyKey(page,'redo');await saved();assert.equal(await body(),backward);await undo();
 console.log('PASS backward deletion/restart history');
 await page.reload();await ready();
 if(await page.locator('[data-segment-start]').getAttribute('data-segment-start')!=='0'){await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+Home');await segment(0);await ready();}
 await cursor('end');await page.keyboard.press('Delete');await saved();assert.equal(await body(),source.slice(0,seam)+source.slice(seam+1),'forward removes exactly following character');await undo();
 console.log('PASS forward deletion');
 // Repeated keys arrive while the Rust read is deliberately held. Every key
 // must be applied after the new editor mounts, with no whole-body renderer read.
 await page.reload();await ready();
 if(await page.locator('[data-segment-start]').getAttribute('data-segment-start')!=='0'){await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+Home');await segment(0);await ready();}
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();await cursor('start');
 let release,entered;const held=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const delayed=async route=>{const request=route.request().postDataJSON();if(request.id===note.id&&request.op==='document_locate'){entered();await gate;}return route.fallback();};
 const batchStart=splices.length;
 await page.route('**/api/rpc',delayed);await page.keyboard.press('Backspace');await waitRequest(held);
 for(let i=0;i<7;i++)await page.keyboard.press('Backspace');release();await page.unroute('**/api/rpc',delayed);await saved();
 assert.equal(await body(),source.slice(0,seam-8)+source.slice(seam),'queued key repeat removes eight characters exactly');
 assert.equal(splices.length-batchStart,1,'held repeated keys use a single bounded source edit');
 await page.reload();await ready();await undo();assert.equal(await body(),source,'one restart undo restores all eight repeated keys');
 console.log('PASS delayed eight keys/single restart undo');
 // A failed read preserves all pending keys until the existing retry control
 // is used. It must not write a partial edit or silently drop seven keys.
 await page.reload();await firstSegment();await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();await cursor('start');
 let failRelease,failEntered;const failHeld=new Promise(resolve=>failEntered=resolve),failGate=new Promise(resolve=>failRelease=resolve);
 const failRead=async route=>{const request=route.request().postDataJSON();if(request.id===note.id&&request.op==='document_locate'){failEntered();await failGate;return route.fulfill({status:503,json:{ok:false,error:'synthetic unavailable boundary cache'}});}return route.fallback();};
 await page.route('**/api/rpc',failRead);await page.keyboard.press('Backspace');await waitRequest(failHeld);
 for(let i=0;i<7;i++)await page.keyboard.press('Backspace');failRelease();
 await page.locator('.window-error').waitFor();assert.equal(await body(),source,'failed cache read preserves the complete source');
 await page.unroute('**/api/rpc',failRead);await page.getByRole('button',{name:'다시 시도',exact:true}).click();await saved();
 assert.equal(await body(),source.slice(0,seam-8)+source.slice(seam),'retry preserves all eight queued keys');await undo();assert.equal(await body(),source);
 console.log('PASS failed-read eight-key preservation/retry');
 const openSource=async(value,label)=>{
  source=value;note=await rpc('save',{note:{title:'경계 '+label+' '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();await segment(0);
 };
 // Both directions at an ordinary paragraph adjoining a giant paragraph.
 const large='<p><strong>'+('ABCDE한글😀'.repeat(36000))+'</strong></p>';
 for(const direction of ['backward','forward']){
  await openSource(large+'<p>뒤 문단😀</p>','문단 '+direction);
  if(direction==='backward'){
   await page.getByRole('textbox',{name:'이동할 블록 번호',exact:true}).fill('2');await page.getByRole('button',{name:'이동',exact:true}).click();await page.locator('[data-window-start="1"]').waitFor();await ready();await cursor('start');
  }else{
   await cursor('end');await page.keyboard.press('Control+End');await ready();await cursor('start');await page.keyboard.press('ArrowLeft');await page.locator('[data-window-start="0"]').waitFor();await ready();await cursor('end');
  }
  await page.keyboard.press(direction==='backward'?'Backspace':'Delete');await saved();
  const joined=large.slice(0,-4)+'뒤 문단😀</p>';assert.equal(await body(),joined,'large/small paragraph join '+direction);
  assert.ok((await editor.textContent()).length<33000);await page.reload();await ready();await undo();assert.equal(await body(),source,'restart join undo '+direction);
  await historyKey(page,'redo');await saved();assert.equal(await body(),joined);await undo();
  console.log('PASS paragraph join '+direction);
 }
 const tableSeed=await rpc('save',{note:{title:'표 경계 스키마 '+Date.now(),content:'<table><tbody><tr><td><p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p></td></tr></tbody></table>',content_format:'html'}});
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+tableSeed.title,exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
 const tableTemplate=await editor.evaluate((el: any)=>el.editor.getHTML());
 for(const [label,value] of [
  ['목록','<ol start="4">'+Array.from({length:9000},(_,i)=>'<li><p>항목 '+i+' ABCDEFGHIJKLMNOPQRSTUVWXYZ</p></li>').join('')+'</ol>'],
  ['표 셀',tableTemplate.replace('ABCDEFGHIJKLMNOPQRSTUVWXYZ','ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12000))],
 ])for(const direction of ['backward','forward']){
  await openSource(value,label+direction);
  if(direction==='backward'){await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();await cursor('start');}else await cursor('end');
  const before=splices.length;await page.keyboard.press(direction==='backward'?'Backspace':'Delete');await saved();
  const actual=await body();assert.notEqual(actual,source,label+' boundary changes content');
  const change=splices[before]?.edits?.[0]??splices[before]?.content;assert.ok(change,label+' source splice');
  const bytes=Buffer.from(source),end=change.start+Buffer.byteLength(change.expected);
  assert.equal(bytes.subarray(change.start,end).toString(),change.expected);
  assert.equal(actual,bytes.subarray(0,change.start).toString()+change.replacement+bytes.subarray(end).toString(),label+' exact outside bytes');
  assert.ok(await page.locator('*').count()<2000,label+' bounded DOM');
  await page.reload();await ready();await undo();assert.equal(await body(),source,label+' restart undo');
  await historyKey(page,'redo');await saved();assert.equal(await body(),actual);await undo();
  console.log('PASS '+label+' '+direction);
 }
 const atomParagraph='<p>'+('ABCDE'.repeat(70000))+'</p>';
 for(const direction of ['backward','forward']){
  await openSource(atomParagraph+'<hr>'+atomParagraph,'구분선 '+direction);
  if(direction==='backward'){
   await page.getByRole('textbox',{name:'이동할 블록 번호',exact:true}).fill('3');await page.getByRole('button',{name:'이동',exact:true}).click();await page.locator('[data-window-start="2"]').waitFor();await ready();await cursor('start');
  }else{
   const info=await rpc('document_segments',{id:note.id,revision:1,ordinal:0});
   for(let i=1;i<info.total_segments;i++){await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(i);await ready();}
   await cursor('end');
  }
  const key=direction==='backward'?'Backspace':'Delete';await page.keyboard.press(key);await saved();await ready();
  assert.equal(await body(),source.replace('<hr>',''),'atom key removes only the block without a filler paragraph');
  await page.reload();await ready();await undo();assert.equal(await body(),source,'atom restart undo');console.log('PASS atom deletion '+direction);
 }
 if(process.env.INKISM_BOUNDARY_LARGE==='1'){
  assert.notEqual(process.env.INKISM_LAZY,'0','large fixture requires partial-document admission');
  // The engine caps the complete note at 20 MiB. Test near that limit and
  // verify a bounded insertion beyond it is rejected without changing data.
  await openSource('<p>'+('X'.repeat(19*1024*1024))+'</p>','19MiB');
  const rejected=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'document_splice_html',id:note.id,revision:1,content:{start:3,expected:'',replacement:'X'.repeat(2*1024*1024)}})});
  const refusal=await rejected.json();assert.equal(refusal.ok,false);assert.match(refusal.error,/content.*(?:limit|exceed|large)|splice.*(?:limit|large)/i);assert.equal(await body(),source,'over-limit insertion preserves the original note');
  const first=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:0})).segments[0],seam=Buffer.byteLength(first.source);
  await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();await cursor('start');await page.keyboard.press('Backspace');await saved();
  assert.equal(await body(),source.slice(0,seam-1)+source.slice(seam));assert.ok((await editor.textContent()).length<33000);assert.ok(await page.locator('*').count()<1500);
  await page.reload();await ready();await undo();assert.equal(await body(),source);console.log('PASS 19MiB single-block boundary edit with bounded renderer/restart undo and preserved source after over-limit refusal');
 }
 assert.ok(splices.length>0);assert.deepEqual(errors,[]);
 console.log('PASS boundary application: backward/forward exact deletion, repeated delayed keys and failed-read retry, paragraph/list/table boundaries, bounded renderer, restart undo/redo; lazy='+(process.env.INKISM_LAZY!=='0'));
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,status:document.querySelector('.status-save')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
