// Shipped application + Go bridge + current Rust runtime. Synthetic profile only.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
import {waitSaved,waitSaveState} from './save-state.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47890';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const source='<p><strong>'+'한글😀&amp; 경계 '.repeat(50000)+'</strong></p><p>마지막 문단</p>';
const note=await rpc('save',{note:{title:'내부 이동 '+Date.now(),content:source,text:'한글'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],reads=[],edits=[],saves=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/rpc',async route=>{
 const request=route.request().postDataJSON();
 if((request.id??request.note?.id)===note.id&&['save','document_splice_html'].includes(request.op))saves.push(request.op);
 if(request.id===note.id){
  reads.push(request.op);
  if(['get','revision_body','document_render'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'unexpected whole-body renderer read'}});
  if(request.op==='document_blocks')assert.equal(request.max_block_bytes,65536);
  if(request.op==='document_splice_html')edits.push(request);
 }
 await route.continue();
});
const editor=page.locator('.tiptap-prose');
const segment=n=>page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),n);
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
// Settled "saved" indicator plus a save RPC sent after `since`: a stale indicator
// from an earlier save cannot satisfy it, and a failed save fails with its reason.
const saved=async(since:number)=>{await waitSaved(page);assert.ok(saves.length>since,'save RPC reached the backend');};
const saveState=()=>page.locator('.status-save').getAttribute('data-save-state');
const cursor=async position=>{await editor.evaluate((el: any,position)=>{el.editor.commands.setTextSelection(position==='end'?el.editor.state.doc.content.size-1:position);el.editor.view.focus();},position);};
const body=async()=> (await rpc('get',{id:note.id})).content;
try{
 await page.goto(base+'/?virtual=1&lazy=1');await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await segment(0);await ready();
 assert.equal(await body(),source,'mount preserves the exact whole source');
 assert.ok((await editor.textContent()).length<33000,'only a bounded part is mounted');
 assert.ok(await page.locator('*').count()<1500);
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(2);await ready();
 const initial=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:2})).segments[0];
 let since=saves.length;await cursor(1);await page.keyboard.insertText('보존검사😀 ');await page.keyboard.press('Control+s');await saved(since);
 let expected=Buffer.concat([Buffer.from(source).subarray(0,initial.byte_offset),Buffer.from('보존검사😀 '),Buffer.from(source).subarray(initial.byte_offset)]).toString();
 // The giant paragraph enclosing this window is the edited block: it gains an
 // identity although its opening tag lies far before the window. Only that
 // tag is spliced (the id inserted), every other outside byte is unchanged.
 const [paragraphId]=assertBlockBytes(await body(),expected,{added:1,message:'one internal insertion leaves every outside byte unchanged'});
 const tag=` id="${paragraphId}"`,shift=Buffer.byteLength(tag);
 expected='<p'+tag+expected.slice(2);assert.equal(await body(),expected,'the enclosing paragraph tag carries the identity');
 assert.ok(edits.length>=1);const sent=edits.at(-1).edits??[edits.at(-1).content];
 assert.deepEqual(sent.map(edit=>[edit.start,edit.expected,edit.replacement]),[[2,'',tag],[initial.byte_offset+shift,'','보존검사😀 ']],'a bounded tag splice and the window splice');
 // The caret is saved as a source byte. The id grew the block, so the reindexed
 // segment 2 may start at a different byte: compare the text at the caret.
 const caret=()=>editor.evaluate((el: any)=>{const {state}=el.editor,{from,empty}=state.selection;return {empty,before:state.doc.textBetween(Math.max(0,from-12),from,'\n','\ufffc')};});
 const selection=await caret();assert.ok(selection.empty&&selection.before.endsWith('보존검사😀 '));
 await page.reload();await ready();await segment(2);
 const restored=await caret();assert.ok(restored.empty&&restored.before.endsWith('보존검사😀 '),'byte cursor survives reindex and reload');
 since=saves.length;await historyKey(page,'undo');await saved(since);assert.equal(await body(),source,'restart undo restores exact raw source');
 since=saves.length;await historyKey(page,'redo');await saved(since);assert.equal(await body(),expected);
 await cursor('end');await page.keyboard.press('ArrowRight');await segment(3);await ready();
 await cursor(1);await page.keyboard.press('ArrowLeft');await segment(2);await ready();
 // Saving fails before navigation: the live input and original range remain.
 // Routes run newest first, so the rejecting route records its own save attempts.
 const offline=route=>{if(route.request().postDataJSON().op!=='document_splice_html')return route.fallback();saves.push('rejected');return route.fulfill({status:503,json:{ok:false,error:'synthetic offline'}});};
 await page.route('**/api/rpc',offline);
 // Type right before the earlier insertion (its segment start moved with the reindex).
 await editor.evaluate((el: any)=>{let at=-1;el.editor.state.doc.descendants((node,pos)=>{if(at<0&&node.isText&&node.text.includes('보존검사'))at=pos+node.text.indexOf('보존검사');});el.editor.commands.setTextSelection(at);el.editor.view.focus();});
 await page.keyboard.insertText('실패보존 ');await page.getByRole('button',{name:'다음 구간',exact:true}).click();
 await page.locator('.window-error').filter({hasText:'현재 구간을 유지'}).waitFor();await segment(2);assert.ok((await editor.textContent()).includes('실패보존 '));assert.equal(await body(),expected);
 assert.notEqual(await saveState(),'saved','a failed save is never shown as saved');
 // An explicit save that the backend rejects shows the error state, keeps the input and leaves storage untouched.
 since=saves.length;await page.keyboard.press('Control+s');
 for(const deadline=Date.now()+30000;saves.length===since;await new Promise(resolve=>setTimeout(resolve,50)))assert.ok(Date.now()<deadline,'explicit save sent a save RPC');
 assert.equal(saves.at(-1),'rejected');const failed=await waitSaveState(page,'error');
 assert.match(failed.text,/synthetic offline/);assert.ok((await editor.textContent()).includes('실패보존 보존검사😀 '));assert.equal(await body(),expected);
 await page.unroute('**/api/rpc',offline);since=saves.length;await page.keyboard.press('Control+s');await saved(since);
 const retried=Buffer.concat([Buffer.from(expected).subarray(0,initial.byte_offset+shift),Buffer.from('실패보존 '),Buffer.from(expected).subarray(initial.byte_offset+shift)]).toString();
 assert.equal(await body(),retried,'retried save stores the kept input with every other byte unchanged');
 await page.reload();await ready();await segment(2);assert.ok((await editor.textContent()).includes('실패보존 보존검사😀 '),'reload shows the stored input');
 await cursor('end');await page.keyboard.press('Control+End');await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='1');await ready();
 assert.equal(await editor.textContent(),'마지막 문단');
 await page.keyboard.press('Control+Home');await segment(0);await ready();
 // A scrollbar jump inside one giant block loads another bounded part.
 await page.locator('.window-scroll').evaluate((el: any)=>{el.scrollTop=el.scrollHeight*0.5;});
 await page.waitForFunction(()=>Number(document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'))>3);
 assert.ok((await editor.textContent()).length<33000);
 assert.deepEqual(errors,[]);assert.ok(reads.includes('document_locate'));assert.ok(!reads.some(op=>['get','revision_body','document_render'].includes(op)));
 console.log('PASS: application internal navigation/buttons/arrows/scroll, bounded reads/DOM, exact source splice, cursor reload, restart undo/redo and failed-save retention');
}catch(error){console.error({errors,reads:reads.slice(-20),edits:edits.length});console.error(await page.evaluate(()=>({body:document.body.innerText.slice(-1400),segment:document.querySelector<any>('[data-segment-start]')?.outerHTML.slice(0,300),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
