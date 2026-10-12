// Shipped application + Go bridge + current Rust runtime. Synthetic profile only.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47890';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const source='<p><strong>'+'한글😀&amp; 경계 '.repeat(50000)+'</strong></p><p>마지막 문단</p>';
const note=await rpc('save',{note:{title:'내부 이동 '+Date.now(),content:source,text:'한글'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],reads=[],edits=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/rpc',async route=>{
 const request=route.request().postDataJSON();
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
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
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
 await cursor(1);await page.keyboard.insertText('보존검사😀 ');await page.keyboard.press('Control+s');await saved();
 let expected=Buffer.concat([Buffer.from(source).subarray(0,initial.byte_offset),Buffer.from('보존검사😀 '),Buffer.from(source).subarray(initial.byte_offset)]).toString();
 assert.equal(await body(),expected,'one internal insertion leaves every outside byte unchanged');
 assert.ok(edits.length>=1);const edit=edits.at(-1).edits?.[0]??edits.at(-1).content;
 assert.equal(edit.start,initial.byte_offset);assert.equal(edit.expected,'');assert.equal(edit.replacement,'보존검사😀 ');
 assert.ok(Buffer.byteLength(edit.expected)<32769);
 const selection=await editor.evaluate((el: any)=>el.editor.state.selection.toJSON());
 await page.reload();await ready();await segment(2);
 assert.deepEqual(await editor.evaluate((el: any)=>el.editor.state.selection.toJSON()),selection,'byte cursor survives reindex and reload');
 await historyKey(page,'undo');await saved();assert.equal(await body(),source,'restart undo restores exact raw source');
 await historyKey(page,'redo');await saved();assert.equal(await body(),expected);
 await cursor('end');await page.keyboard.press('ArrowRight');await segment(3);await ready();
 await cursor(1);await page.keyboard.press('ArrowLeft');await segment(2);await ready();
 // Saving fails before navigation: the live input and original range remain.
 const offline=route=>route.request().postDataJSON().op==='document_splice_html'?route.fulfill({status:503,json:{ok:false,error:'synthetic offline'}}):route.fallback();
 await page.route('**/api/rpc',offline);
 await cursor(1);await page.keyboard.insertText('실패보존 ');await page.getByRole('button',{name:'다음 구간',exact:true}).click();
 await page.locator('.window-error').filter({hasText:'현재 구간을 유지'}).waitFor();await segment(2);assert.ok((await editor.textContent()).includes('실패보존 '));assert.equal(await body(),expected);
 await page.unroute('**/api/rpc',offline);await page.keyboard.press('Control+s');await saved();assert.ok((await body()).includes('실패보존 '));
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
