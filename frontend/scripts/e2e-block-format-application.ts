// Shipped React/Go/Rust. No personal profile or Google authentication.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitSaved} from './save-state.ts';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const idle=()=>page.waitForFunction(()=>!document.querySelector('.window-error')&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>waitSaved(page);
const focus=()=>editor.evaluate((el:any)=>el.editor.view.focus());
const open=async note=>{await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();};
const toggle=()=>editor.evaluate((el:any)=>el.editor.chain().focus().toggleHeading({level:2}).run());
try{
 // Exceed both the UTF-8 lazy admission and full-draft UTF-16 thresholds.
 const mixed=Array.from({length:10000},(_,i)=>i<32?'<h2>제목 '+i+'</h2>':'<p>본문 '+i+' 한글😀 '.repeat(8)+'</p>').join('');
 const note=await rpc('save',{note:{title:'혼합 제목 '+Date.now(),content:mixed,content_format:'html'}});await rpc('wait_index');
 await open(note);assert.equal(await page.locator('.tiptap-prose h2').count(),32);
 await focus();await page.keyboard.press('Control+a');
 await toggle();await idle();await saved();
 const expected=mixed.replaceAll('<p>','<h2>').replaceAll('</p>','</h2>');
 assert.equal((await rpc('get',{id:note.id})).content,expected,'toggle decision uses hidden paragraphs');
 assert.equal(await page.locator('.tiptap-prose h2').count(),32,'mounted DOM stays bounded');
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,mixed);
 const prefix='<p>앞 raw&#128512;</p>',body='<p><strong>'+'X'.repeat(1024*1024)+'</strong></p>',suffix='<p>뒤 raw&#128512;</p>',source=prefix+body+suffix;
 const long=await rpc('save',{note:{title:'긴 문단 제목 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
 const end=Buffer.byteLength((prefix+body).slice(0,(prefix+body).indexOf('</strong>')));
 const location=await rpc('document_locate',{id:long.id,revision:1,byte_offset:end,bias:'before'});
 await open(long);
 const reads=[],writes=[];
 await page.route('**/api/rpc',route=>{
  const r=route.request().postDataJSON();
  if(r.id===long.id){
   if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(r.op))return route.fulfill({status:403,json:{ok:false,error:'whole-body renderer read forbidden'}});
   if(r.op==='document_segments')reads.push(r);
   if(r.op==='document_splice_html')writes.push(r);
  }
  return route.continue();
 });
 const select=async()=>{
  await focus();await page.keyboard.press('Control+End');await page.locator('[data-window-start="2"]').waitFor();await ready();
  await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),location.offset);await ready();
  await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});await page.keyboard.press('Shift+ArrowLeft');
  await page.locator('.document-selection-status').waitFor();await ready();
 };
 await select();reads.length=0;
 const beforeChecks=reads.length;
 await editor.evaluate((el:any)=>el.editor.can().toggleHeading({level:2}));
 assert.equal(reads.length,beforeChecks,'can check has no selection reads');
 await toggle();await idle();await saved();
 const changed=prefix+body.replace(/^<p>/,'<h2>').replace(/<\/p>$/,'</h2>')+suffix;
 assert.equal((await rpc('get',{id:long.id})).content,changed,'whole giant paragraph format and exact outside bytes');
 assert.ok(reads.length>1&&reads.every(r=>r.limit<=8),'complete block uses bounded segment pages');
 assert.ok((await editor.textContent()).length<33000,'bounded live text');
 assert.ok(await page.locator('*').count()<1500,'bounded live DOM');
 await page.reload();await ready();
 await historyKey(page,'undo');await saved();assert.equal((await rpc('get',{id:long.id})).content,source,'restart undo');
 await historyKey(page,'redo');await saved();assert.equal((await rpc('get',{id:long.id})).content,changed,'restart redo');
 await historyKey(page,'undo');await saved();await page.reload();await ready();await select();
 const fail=route=>route.request().postDataJSON().op==='document_segments'?route.fulfill({status:503,json:{ok:false,error:'unavailable format cache'}}):route.fallback();
 await page.route('**/api/rpc',fail);await toggle();await page.locator('.window-error').waitFor();
 assert.equal((await rpc('get',{id:long.id})).content,source,'failed read keeps source');
 await page.unroute('**/api/rpc',fail);await toggle();await idle();await saved();assert.equal((await rpc('get',{id:long.id})).content,changed,'explicit retry');
 await historyKey(page,'undo');await saved();await page.reload();await ready();await select();
 let release,entered;const held=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const delayed=async route=>{if(route.request().postDataJSON().op==='document_segments'){entered();await gate;}return route.fallback();};
 await page.route('**/api/rpc',delayed);const count=writes.length;
 await toggle();await Promise.race([held,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('format read did not start')),15000);timer.unref();})]);
 await page.keyboard.press('Escape');release();await page.unroute('**/api/rpc',delayed);await page.locator('.window-error').waitFor();await ready();
 await waitForPredicate(async()=>(await rpc('get',{id:long.id})).content===source,'cancelled format changed body');
 assert.equal(writes.length,count,'cancelled format has no splice');
 assert.deepEqual(errors,[]);
 console.log('PASS block-format application: mixed 10,000 blocks, native command chain/can, whole 1MiB paragraph, exact outside source, bounded reads/DOM, restart undo/redo, failed read/retry, cancellation; lazy='+ (process.env.INKISM_LAZY!=='0'));
}catch(e){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selected:document.querySelector('.document-selection-status')?.textContent,save:document.querySelector('.status-save')?.textContent})));throw e;}
finally{await browser.close();}
