// Real application/Rust with an isolated profile. Never personal PC input.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes,blockIds,withoutBlockIds} from './block-identity-bytes.ts';
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
const saved=()=>waitSaved(page);
const body=async()=>(await rpc('get',{id:note.id})).content;
const cursor=async edge=>editor.evaluate((el: any,edge)=>{const positions=[];el.editor.state.doc.descendants((node,at)=>{if(node.isTextblock)positions.push({start:at+1,end:at+1+node.content.size});});el.editor.commands.setTextSelection(edge==='start'?positions[0].start:positions.at(-1).end);el.editor.view.focus();},edge);
// The edited block gains one persistent identity; every other byte is exact.
const edited=async(expected,message,ids?)=>assertBlockBytes(await body(),expected,{added:1,ids,message});
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
 const backwardIds=await edited(backward,'backspace removes exactly the preceding source character');
 assert.ok((await editor.textContent()).length<33000);assert.ok(await page.locator('*').count()<1500);
 await page.reload();await ready();await undo();assert.equal(await body(),source,'restart undo restores exact source');
 await historyKey(page,'redo');await saved();await edited(backward,'restart redo',backwardIds);await undo();
 console.log('PASS backward deletion/restart history');
 await page.reload();await ready();
 if(await page.locator('[data-segment-start]').getAttribute('data-segment-start')!=='0'){await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+Home');await segment(0);await ready();}
 await cursor('end');await page.keyboard.press('Delete');await saved();await edited(source.slice(0,seam)+source.slice(seam+1),'forward removes exactly following character');await undo();
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
 await edited(source.slice(0,seam-8)+source.slice(seam),'queued key repeat removes eight characters exactly');
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
 await edited(source.slice(0,seam-8)+source.slice(seam),'retry preserves all eight queued keys');await undo();assert.equal(await body(),source);
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
  const before=splices.length;await page.keyboard.press(direction==='backward'?'Backspace':'Delete');await saved();
  // The joined giant paragraph opens outside the bounded region. It still
  // gains its identity: only its opening tag is spliced (bounded), every other
  // byte outside the region is exact.
  const joined=large.slice(0,-4)+'뒤 문단😀</p>';
  const joinedIds=assertBlockBytes(await body(),joined,{added:1,message:'large/small paragraph join '+direction});
  assert.match(await body(),/^<p id="ink-block-[^"]+"><strong>ABCDE/,'the giant paragraph itself carries the identity');
  const sent=splices.slice(before).flatMap(request=>request.edits??[request.content]);
  // The save shrinks each splice to its changed bytes: the tag splice is the
  // inserted id attribute inside `<p>` (byte 2), apart from the region edit.
  assert.deepEqual(sent.filter(edit=>edit.start<3).map(edit=>[edit.start,edit.expected,edit.replacement.replace(/ink-block-[0-9a-f-]{36}/,'ID')]),[[2,'',' id="ID"']],'one bounded opening-tag splice');
  assert.ok(sent.every(edit=>Buffer.byteLength(edit.expected)<=131072),'no giant block is re-sent');
  assert.ok((await editor.textContent()).length<33000);await page.reload();await ready();await undo();assert.equal(await body(),source,'restart join undo '+direction);
  await historyKey(page,'redo');await saved();assertBlockBytes(await body(),joined,{added:1,ids:joinedIds,message:'restart join redo '+direction});
  await page.reload();await ready();assertBlockBytes(await body(),joined,{added:1,ids:joinedIds,message:'reload keeps the join identity'});await undo();
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
  // Sequential splices: opening tags outside the region that received a block
  // identity (each exactly the tag, plus only the new id), then the region.
  const changes=splices.slice(before).flatMap(request=>request.edits??[request.content]);assert.ok(changes.length,label+' source splice');
  let bytes=Buffer.from(source);
  for(const [index,change] of changes.entries()){
   const end=change.start+Buffer.byteLength(change.expected);
   assert.equal(bytes.subarray(change.start,end).toString(),change.expected);
   if(index<changes.length-1){assert.equal(change.expected,'',label+' tag splice keeps the opening tag');assert.match(change.replacement,/^ id="ink-block-[0-9a-f-]{36}"$/,label+' tag splice adds only an identity');}
   bytes=Buffer.concat([bytes.subarray(0,change.start),Buffer.from(change.replacement),bytes.subarray(end)]);
  }
  assert.equal(actual,bytes.toString(),label+' exact outside bytes');
  const actualIds=blockIds(actual);assert.equal(new Set(actualIds).size,actualIds.length,label+' unique identities');
  assert.ok(await page.locator('*').count()<2000,label+' bounded DOM');
  await page.reload();await ready();await undo();assert.equal(await body(),source,label+' restart undo');
  await historyKey(page,'redo');await saved();assert.equal(await body(),actual,label+' redo restores the same identities');await undo();
  console.log('PASS '+label+' '+direction+' ('+(changes.length-1)+' outside tags identified)');
 }
 {
  // A boundary two segments inside one giant table cell: the region starts
  // inside table/row/cell/paragraph, whose opening tags all lie before it.
  // Like an edit in the full editor, each of those blocks gains an identity,
  // written as one bounded splice of its own opening tag; nothing else moves.
  await openSource(tableTemplate.replace('ABCDEFGHIJKLMNOPQRSTUVWXYZ','ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12000)),'표 셀 내부');
  for(let i=1;i<=2;i++){await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(i);await ready();}
  await cursor('start');
  const seam=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:2})).segments[0].byte_offset;
  const before=splices.length;await page.keyboard.press('Backspace');await saved();
  const expected=source.slice(0,seam-1)+source.slice(seam),actual=await body();
  const ids=assertBlockBytes(actual,expected,{added:4,message:'giant cell boundary identifies table, row, cell and paragraph'});
  assert.match(actual,/^<table[^>]* id="ink-block-[^"]+"[^>]*>(?:<colgroup>.*?<\/colgroup>)?<tbody><tr id="ink-block-[^"]+"><td[^>]* id="ink-block-[^"]+"[^>]*><p id="ink-block-[^"]+">ABCDE/,'enclosing opening tags carry the identities');
  const changes=splices.slice(before).flatMap(request=>request.edits??[request.content]);
  assert.equal(changes.length,5,'four tag splices and one region splice');
  assert.ok(changes.slice(0,4).every(change=>change.expected===''&&/^ id="ink-block-[0-9a-f-]{36}"$/.test(change.replacement)),'tag splices only insert an id');
  assert.ok(changes.every(change=>Buffer.byteLength(change.expected)<=131072),'no giant block is re-sent');
  await page.reload();await ready();assertBlockBytes(await body(),expected,{added:4,ids,message:'reload keeps the identities'});
  await undo();assert.equal(await body(),source,'one undo removes the deletion and every identity');
  await historyKey(page,'redo');await saved();assertBlockBytes(await body(),expected,{added:4,ids,message:'redo restores the same identities'});await undo();
  console.log('PASS giant table cell internal boundary identities');
 }
 {
  // IME composition in an internal window two segments into a giant paragraph.
  // The paragraph's identity (its tag lies before the window) is assigned only
  // after the composition ended, and one undo removes both together.
  await openSource('<p>'+('ABCDE'.repeat(70000))+'</p>','조합 내부');
  for(let i=1;i<=2;i++){await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(i);await ready();}
  await cursor('start');
  const seam=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:2})).segments[0].byte_offset;
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
  assert.equal(await editor.evaluate((el: any)=>/ink-block-/.test(el.editor.getHTML())),false,'no identity while composing');
  await cdp.send('Input.insertText',{text:'한글'});
  await page.waitForFunction(()=>/ink-block-/.test(document.querySelector<any>('.tiptap-prose').editor.getHTML()));await saved();
  const expected=source.slice(0,seam)+'한글'+source.slice(seam),actual=await body();
  const ids=assertBlockBytes(actual,expected,{added:1,message:'internal composition identifies the giant paragraph'});
  assert.match(actual,/^<p id="ink-block-[^"]+">ABCDE/);assert.equal(actual.split('한글').length,2,'the composition is inserted once');
  await undo();assert.equal(await body(),source,'one undo removes the composition and the identity');
  await historyKey(page,'redo');await saved();assertBlockBytes(await body(),expected,{added:1,ids,message:'redo restores the composition and identity'});
  await page.reload();await ready();assertBlockBytes(await body(),expected,{added:1,ids,message:'reload keeps them'});await undo();assert.equal(await body(),source);
  await cdp.detach();
  console.log('PASS internal-window composition identity, one undo step');
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
  await edited(source.slice(0,seam-1)+source.slice(seam),'19MiB boundary backspace');assert.ok((await editor.textContent()).length<33000);assert.ok(await page.locator('*').count()<1500);
  await page.reload();await ready();await undo();assert.equal(await body(),source);console.log('PASS 19MiB single-block boundary edit with bounded renderer/restart undo and preserved source after over-limit refusal');
 }
 assert.ok(splices.length>0);assert.deepEqual(errors,[]);
 console.log('PASS boundary application: backward/forward exact deletion, repeated delayed keys and failed-read retry, paragraph/list/table boundaries, bounded renderer, restart undo/redo; lazy='+(process.env.INKISM_LAZY!=='0'));
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,status:document.querySelector('.status-save')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
