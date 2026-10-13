// Shipped React/Go/Rust, isolated profile. No personal desktop automation.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const source='<p><strong>'+('X'.repeat((process.env.INKISM_LARGE_SELECTION==='1'?19:1)*1024*1024))+'</strong></p><p>끝 원문 &amp;😀</p>';
const note=await rpc('save',{note:{title:'짧은 선택 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const end=Buffer.byteLength(source.slice(0,source.indexOf('</strong>')));
const location=await rpc('document_locate',{id:note.id,revision:1,byte_offset:end,bias:'before'});
const last=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:location.offset,limit:1})).segments[0];
const seam=last.byte_offset;
assert.ok(location.offset>2);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],splices=[],reads=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>waitSaved(page);
const body=async()=>(await rpc('get',{id:note.id})).content;
const idle=()=>page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await page.route('**/api/rpc',route=>{
  const request=route.request().postDataJSON();
  if(request.id===note.id){
   if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'whole-body renderer read forbidden'}});
   if(request.op==='document_segments')reads.push(request);
   if(request.op==='document_splice_html')splices.push(request);
  }
  return route.continue();
 });
 const select=async()=>{
  // Ctrl+End first reaches the small trailing paragraph. Move back to the
  // giant block's last internal source piece without stepping through it.
  await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+End');await page.locator('[data-window-start="1"]').waitFor();await ready();
  await editor.evaluate((el: any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),location.offset);await ready();
  await editor.evaluate((el: any)=>{let start;el.editor.state.doc.descendants((node,at)=>{if(start===undefined&&node.isTextblock)start=at+1;});el.editor.commands.setTextSelection(start);el.editor.view.focus();});
  await page.keyboard.press('Shift+ArrowLeft');await page.locator('.document-selection-status').waitFor();await ready();
 };
 await select();reads.length=0;
 await page.keyboard.press('Delete');await idle();await saved();
 const deleted=source.slice(0,seam-1)+source.slice(seam);
 assert.equal(await body(),deleted,'one selected character removed with exact outside bytes');
 assert.ok(reads.length<=2&&reads.every(r=>r.offset>=location.offset-2&&r.limit<=2),'short selection reads only adjacent internal pieces');
 if(process.env.INKISM_LAZY!=='0')assert.ok(splices.length>0&&splices.every(s=>(s.edits??[s.content]).every(edit=>edit.start>0&&Buffer.byteLength(edit.expected)<=65536)),'bounded write range');
 assert.ok((await editor.textContent()).length<33000);assert.ok(await page.locator('*').count()<1500);
 // The next character must land at the actual edit, rather than the start of
 // the prepared source range or a distant preview.
 await page.keyboard.insertText('후속');await saved();
 // Typing in the internal window identifies the giant paragraph around it by
 // one splice of its opening tag; every other byte is exact.
 assertBlockBytes(await body(),source.slice(0,seam-1)+'후속'+source.slice(seam),{added:1,message:'follow-up input retains exact caret'});
 await page.reload();await ready();
 await historyKey(page,'undo');await saved();assert.equal(await body(),deleted,'restart undo follow-up input');
 await historyKey(page,'undo');await saved();assert.equal(await body(),source,'restart undo selected deletion');
 await historyKey(page,'redo');await saved();assert.equal(await body(),deleted,'restart redo selected deletion');
 await historyKey(page,'undo');await saved();
 await page.reload();await ready();await select();
 // A read failure must keep the selection and source for an explicit retry.
 const fail=async route=>route.request().postDataJSON().op==='document_segments'?route.fulfill({status:503,json:{ok:false,error:'unavailable selection cache'}}):route.fallback();
 await page.route('**/api/rpc',fail);await page.keyboard.press('Delete');await page.locator('.window-error').waitFor();
 assert.equal(await body(),source,'failed read retains source');
 await page.unroute('**/api/rpc',fail);await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Delete');await idle();await saved();assert.equal(await body(),deleted,'explicit repeated operation after failure');
 await historyKey(page,'undo');await saved();assert.equal(await body(),source);await page.reload();await ready();await select();
 let entered,release;const held=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const delay=async route=>{if(route.request().postDataJSON().op==='document_segments'){entered();await gate;}return route.fallback();};
 const count=splices.length;
 await page.route('**/api/rpc',delay);await page.keyboard.press('Delete');
 await Promise.race([held,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('selection request did not start')),15000);timer.unref();})]);
 await page.keyboard.press('Escape');release();await page.unroute('**/api/rpc',delay);await page.locator('.window-error').waitFor();await ready();
 assert.equal(await body(),source,'cancelled delayed range read preserves source');assert.equal(splices.length,count,'cancelled selection has no write');
 assert.deepEqual(errors,[]);
 console.log('PASS bounded application selection, limited reads/splice/DOM, exact follow-up caret, failed read/retry, delayed cancellation, restart undo/redo; lazy='+ (process.env.INKISM_LAZY!=='0')+' bytes='+Buffer.byteLength(source));
}finally{await browser.close();}
