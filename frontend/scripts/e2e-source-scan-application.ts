// Bundled Worker failure/retry, shipped React/Go/Rust, isolated browser.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.ok(v.ok,v.error);return v.data;};
const original='<p><strong>'+'X'.repeat(1024*1024)+'</strong></p><p>끝 &amp;😀</p>',html='<p><em>'+'P'.repeat(2*1024*1024)+'</em></p>';
const note=await rpc('save',{note:{title:'worker failure '+Date.now(),content:original,content_format:'html'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1048,height:780}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>waitSaved(page);
const body=async()=>(await rpc('get',{id:note.id})).content;let failed=0;
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+a');await page.locator('.document-selection-status').waitFor();
 const expected=await editor.evaluate((el: any,html)=>{
  const schema=el.editor.schema,doc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('old')])]);
  const state=el.editor.state.constructor.create({schema,doc,selection:el.editor.state.selection.constructor.fromJSON(doc,{type:'all'})});
  const view=new el.editor.view.constructor(document.createElement('div'),{state});
  try{view.pasteHTML(html);view.dispatch(view.state.tr.insertText('RETAINED한글😀'));return view.dom.innerHTML;}finally{view.destroy();}
 },html);
 await page.route('**/api/rpc',route=>{
  const q=route.request().postDataJSON();
  if(process.env.INKISM_LAZY!=='0'&&q.id===note.id&&['get','document_render','revision_body'].includes(q.op))return route.fulfill({status:403,json:{ok:false,error:'whole renderer body forbidden'}});
  return route.continue();
 });
 await page.route('**/assets/source-segments.worker-*.js',route=>{if(!failed++){return route.abort();}return route.continue();});
 await editor.evaluate((el: any,html)=>el.editor.view.pasteHTML(html),html);await page.locator('.window-error').waitFor();assert.equal(failed,1,'bundled worker was actually requested and blocked');
 assert.equal(await body(),original,'worker startup failure must keep original unwritten');
 await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.type('RETAINED',{delay:2});await page.keyboard.insertText('한글😀');
 assert.equal(await body(),original,'accepted follow-up remains provisional after worker failure');
 assert.ok((await editor.textContent()).length<40000);assert.ok(await page.locator('*').count()<1500);
 await page.unroute('**/assets/source-segments.worker-*.js');await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.window-error')&&!document.querySelector('.document-selection-status'));await saved();
 // The pasted paragraph replaced the whole document: the one new block gains an identity.
 const ids=assertBlockBytes(await body(),expected,{added:1,message:'worker retry preserves full paste and later keys'});
 await page.unroute('**/api/rpc');await page.reload();await ready();
 await page.waitForTimeout(200);
 const restoredViewport=await editor.evaluate((el: any)=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};const host=document.querySelector('.window-scroll');return {editor:rect(el),host:rect(host),scrollTop:host.scrollTop,scrollHeight:host.scrollHeight,before:host.firstElementChild.getBoundingClientRect().height,focused:document.activeElement===el}});
 console.log('RESTORED_VIEWPORT '+JSON.stringify(restoredViewport));
 if(process.env.INKISM_VIEWPORT_SCREENSHOT)await page.screenshot({path:process.env.INKISM_VIEWPORT_SCREENSHOT});
 assert.ok(Math.min(restoredViewport.editor.bottom,restoredViewport.host.bottom)-Math.max(restoredViewport.editor.y,restoredViewport.host.y)>4,'Restored internal editor must intersect its visible scroll viewport');

 await historyKey(page,'undo');await saved();assert.equal(await body(),original,'one restart undo restores original');
 await historyKey(page,'redo');await saved();assertBlockBytes(await body(),expected,{added:1,ids,message:'restart redo restores worker paste and retained keys'});
 assert.deepEqual(errors,[]);console.log('PASS bundled source Worker failure/retry, exact original/paste/later keys, bounded DOM, restart undo/redo; lazy='+(process.env.INKISM_LAZY!=='0'));
}finally{await browser.close();}
