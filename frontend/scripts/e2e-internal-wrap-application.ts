// Compare source-piece movement with the complete native paragraph, rather
// than treating each independently wrapped source piece as the oracle.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const shift=process.env.INKISM_WRAP_SHIFT==='1',key=direction=>(shift?'Shift+':'')+(direction==='up'?'ArrowUp':'ArrowDown');
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.ok(v.ok,v.error);return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
// Bounded editing is now on by default; the oracle needs the complete native paragraph,
// so the launch flags are cleared and ?virtual=1/&lazy=1 select the windowed editor again.
await page.route('**/api/info',async route=>{const response=await route.fetch();route.fulfill({response,json:{...await response.json(),windowed_editor:false,lazy_editor:false}});});
const editor=page.locator('.tiptap-prose');
const opened=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>waitSaved(page);
// Native browser selection updates can arrive after keyboard.press resolves.
// Read each oracle position only after that specific key changed its head.
const oracleKey=async(direction)=>{
 const before=await editor.evaluate((el: any)=>el.editor.state.selection.head);
 await page.keyboard.press(key(direction));
 await page.waitForFunction(before=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.head!==before,before);
};
try{
 for(const [label,pattern] of [['word','a'],['spaces','ab cdef ghijkl mno pqrst uvwxyz '],['unicode','한글😀 문단 가나다라마바사 ']]){
  const prefix='<p><strong>',text=pattern.repeat(Math.ceil(600000/pattern.length)),suffix='</strong></p><p>후미 원문 &amp;😀</p>',source=prefix+text+suffix;
  const normal=await rpc('save',{note:{title:'일반 줄바꿈 '+label+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  const first=(await rpc('document_segments',{id:normal.id,revision:1,ordinal:0,offset:0})).segments[0];
  const seam=first.byte_offset+Buffer.byteLength(first.source),origin=Buffer.from(source).subarray(Buffer.byteLength(prefix),seam).toString().length;
  await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+normal.title,exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();await opened();
  await editor.evaluate((el: any,position)=>{const e=el.editor;e.commands.setTextSelection(position);e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());},origin+1);
  await page.keyboard.press(key('down'));await page.waitForFunction(origin=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.parentOffset>origin,origin);
  const oracle=await editor.evaluate((el: any)=>({offset:el.editor.state.selection.$head.parentOffset,x:el.editor.view.coordsAtPos(el.editor.state.selection.head).left}));
  for(let i=0;i<4;i++)await oracleKey('up');
  await page.waitForFunction(origin=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.parentOffset<origin,origin);
  const previous=await editor.evaluate((el: any)=>el.editor.state.selection.$head.parentOffset);
  for(let i=0;i<4;i++)await oracleKey('down');
  await page.waitForFunction(offset=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.parentOffset===offset,oracle.offset);
  const note=await rpc('save',{note:{title:'분할 줄바꿈 '+label+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  const reads=[];await page.route('**/api/rpc',route=>{const v=route.request().postDataJSON();if(v.id===note.id){if(process.env.INKISM_LAZY!=='0'&&['get','revision_body','document_render'].includes(v.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});if(['document_blocks','document_segments'].includes(v.op))reads.push(v);}return route.continue();});
  const actualPoint=async()=>{
   const local=await editor.evaluate((el: any)=>({start:Number(el.closest('[data-segment-byte]').getAttribute('data-segment-byte')),offset:el.editor.state.selection.$head.parentOffset,x:el.editor.view.coordsAtPos(el.editor.state.selection.head).left}));
   return {offset:Buffer.from(source).subarray(Buffer.byteLength(prefix),Math.max(Buffer.byteLength(prefix),local.start)).toString().length+local.offset,x:local.x};
  };
  await editor.evaluate((el: any)=>{const e=el.editor;e.commands.setTextSelection(e.state.doc.content.size-1);e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());});
  assert.equal((await actualPoint()).offset,origin);
  await page.keyboard.press(key('down'));await page.locator('[data-segment-start="1"]').waitFor({timeout:5000});await ready();
  const actual=await actualPoint();assert.equal(actual.offset,oracle.offset,'same next visual row as the complete paragraph: '+label);assert.ok(Math.abs(actual.x-oracle.x)<1,'same full-paragraph column');
  for(let i=0;i<4;i++)await page.keyboard.press(key('up'));
  await waitForPredicate(async()=>{try{return (await actualPoint()).offset===previous;}catch{return false;}},'reverse keys did not reach the native cursor',10000);await ready();
  assert.equal((await actualPoint()).offset,previous,'same native movement through the carried rows and previous window');
  for(let i=0;i<4;i++)await page.keyboard.press(key('down'));
  await waitForPredicate(async()=>{try{return (await actualPoint()).offset===oracle.offset;}catch{return false;}},'forward keys did not reach the native cursor',10000);await ready();assert.equal((await actualPoint()).offset,oracle.offset);
  assert.ok(reads.every(v=>(v.limit??1)<=32));assert.ok((await editor.textContent()).length<66000);assert.ok(await page.locator('*').count()<1500);
  assert.equal((await rpc('get',{id:note.id})).content,source,'navigation does not write');
  if(shift){
   await page.evaluate(()=>navigator.clipboard.writeText(''));await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+c');
   await waitForPredicate(()=>page.evaluate(expected=>navigator.clipboard.readText().then(value=>value===expected),text.slice(origin,oracle.offset)),'wrong full-paragraph clipboard',10000);await ready();
  }
  // The edited giant paragraph gains its identity; every other byte is exact.
  await page.keyboard.type('z');await saved();assertBlockBytes((await rpc('get',{id:note.id})).content,prefix+text.slice(0,shift?origin:oracle.offset)+'z'+text.slice(oracle.offset)+suffix,{added:1,message:'exact full-paragraph insertion'});
  await historyKey(page,'undo');await saved();assert.equal((await rpc('get',{id:note.id})).content,source);
  await page.unroute('**/api/rpc');console.log('PASS full-paragraph wrap, native down/up round trip, exact '+(shift?'clipboard/':'')+'typing/undo, bounded view: '+label+' shift='+shift+' lazy='+process.env.INKISM_LAZY);
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector<any>('.window-error')?.textContent,segment:document.querySelector<any>('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
