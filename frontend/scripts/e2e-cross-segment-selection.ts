// Shipped React + Go + Rust. Isolated profile; never personal desktop input.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
// Above both UTF-8 lazy admission and the full-draft UTF-16 size threshold.
const source='<p><strong>'+('한글😀&amp; 선택 '.repeat(25000))+'</strong></p><p>끝 원문 &amp;😀</p>';
const note=await rpc('save',{note:{title:'구간 선택 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
const idle=()=>page.waitForFunction(()=>!document.querySelector('.window-error')&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>waitSaved(page);
const segment=n=>page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),n);
const focus=()=>editor.evaluate((el:any)=>el.editor.view.focus());
const body=async()=>(await rpc('get',{id:note.id})).content;
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();await segment(0);
 const requests=[];
 await page.route('**/api/rpc',route=>{
  const request=route.request().postDataJSON();if(request.id===note.id){requests.push(request.op);if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'unexpected complete body read'}});}
  return route.continue();
 });
 await page.evaluate(()=>navigator.clipboard.writeText(''));
 await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(el.editor.state.doc.content.size-1);el.editor.view.focus();});
 await page.keyboard.press('Shift+ArrowRight');await segment(1);
 await page.locator('.document-selection-status').waitFor();await focus();await page.keyboard.press('Control+c');
 await waitForPredicate(()=>page.evaluate(async()=>(await navigator.clipboard.readText()).length>0),'cross-segment clipboard did not arrive');
 await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.window-controls button:last-child')?.disabled);
 const one=await page.evaluate(()=>navigator.clipboard.readText());
 assert.ok(one.length===1||one.length===2,'one scalar selected across source seam: '+one.length+' '+JSON.stringify(one.slice(0,30)));
 await page.keyboard.press('Delete');await idle();await saved();
 const removed=await body();assert.notEqual(removed,source);assert.ok(removed.endsWith('<p>끝 원문 &amp;😀</p>'));
 await historyKey(page,'undo');await saved();assert.equal(await body(),source);
 await page.reload();await ready();
 if(await page.locator('[data-segment-start]').getAttribute('data-segment-start')!=='0'){
  await focus();await page.keyboard.press('Control+Home');await segment(0);await ready();
 }
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();
 await page.evaluate(()=>navigator.clipboard.writeText(''));
 await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});
 await page.keyboard.press('Shift+ArrowLeft');await segment(0);await page.locator('.document-selection-status').waitFor();
 await focus();await page.keyboard.press('Control+c');await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.window-controls button:last-child')?.disabled);
 const backward=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(backward.length===1||backward.length===2,'backward scalar selection');
 await page.keyboard.press('Escape');assert.equal(await body(),source);
 await focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+i');await idle();await saved();
 const formatted=await body();assert.ok(formatted.includes('<em>'));assert.ok(await page.locator('*').count()<1500);
 assert.ok((await editor.textContent()).length<33000);
 await page.reload();await ready();await historyKey(page,'undo');await saved();assert.equal(await body(),source,'restart undo restores full source from small preview');
 await historyKey(page,'redo');await saved();assert.equal(await body(),formatted);
 await historyKey(page,'undo');await saved();
 await segment(0);await ready();
 await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});
 await page.keyboard.press('Control+Shift+End');await page.locator('[data-window-start="1"]').waitFor();
 await focus();await page.keyboard.press('Control+c');
 await waitForPredicate(()=>page.evaluate(async()=>(await navigator.clipboard.readText()).endsWith('끝 원문 &😀')),'whole-document clipboard did not arrive');
 await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.window-controls button:first-child')?.disabled);
 await page.keyboard.press('Escape');await page.keyboard.press('Control+Home');await segment(0);await ready();
 await focus();await page.keyboard.press('Control+a');
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
 assert.equal(await body(),source,'provisional IME does not write');
 await cdp.send('Input.insertText',{text:'한글😀'});await idle();await saved();
 // The committed composition is the one new block: it gains an identity.
 assertBlockBytes(await body(),'<p><strong>한글😀</strong></p>',{added:1,message:'whole-document IME'});
 await historyKey(page,'undo');await saved();assert.equal(await body(),source);
 assert.deepEqual(errors,[]);assert.ok(requests.includes('document_segments'));
 console.log('PASS cross-segment Shift scalar/delete, whole format/copy/IME, bounded DOM, restart undo/redo, raw outside preservation; lazy='+(process.env.INKISM_LAZY!=='0'));
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,status:document.querySelector('.document-selection-status')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
