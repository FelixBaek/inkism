// Actual application table fragments, exact raw bytes and failed projection.
import assert from 'node:assert/strict';
import {assertBlockBytes} from './block-identity-bytes.ts';
import {chromium} from './browser-env.ts';
import {trackSaves} from './save-state.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47890';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose'),ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
const saves=trackSaves(page),saved=()=>saves.saved();
try{
 const seed=await rpc('save',{note:{title:'표 스키마 '+Date.now(),content:'<table><tbody><tr><td><p>셀😀&amp;</p></td><td><p>옆</p></td></tr></tbody></table>',text:'표'}});
 await page.goto(base+'/?virtual=1&lazy=1');await page.getByRole('button',{name:'노트 열기: '+seed.title,exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();await ready();
 const rowTemplate=await editor.evaluate((el:any)=>el.editor.getHTML()),row=/<tbody>([\s\S]*)<\/tbody>/.exec(rowTemplate)[1];
 const source=rowTemplate.replace(row,row.repeat(10000));
 const note=await rpc('save',{note:{title:'긴 표 '+Date.now(),content:source,text:'표'}});await rpc('wait_index');
 const requests=[];
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(request.id===note.id){
   if(['get','document_render','revision_body'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'full body forbidden'}});
   if(request.op==='document_splice_html')requests.push(request);
  }
  await route.continue();
 });
 await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(note.title);await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')==='0');await ready();
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')==='1');await ready();
 assert.ok(await editor.locator('tr').count()<1000);
 await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(5);el.editor.view.focus();});await page.keyboard.insertText('표수정');await page.keyboard.press('Control+s');await saved();
 // The edited cell paragraph, its cell, row and the table are the touched
 // blocks (as in the full editor). Row/cell/paragraph open inside the window;
 // the table opens before it, so its identity is a separate splice of exactly
 // its opening tag. Splices are sequential; every other byte is unchanged.
 const changes=requests.at(-1).edits??[requests.at(-1).content];let bytes=Buffer.from(source);
 for(const change of changes){
  assert.equal(bytes.subarray(change.start,change.start+Buffer.byteLength(change.expected)).toString(),change.expected);
  bytes=Buffer.concat([bytes.subarray(0,change.start),Buffer.from(change.replacement),bytes.subarray(change.start+Buffer.byteLength(change.expected))]);
 }
 const expected=bytes.toString(),edit=changes.at(-1);
 assert.equal(changes.length,2,'one table tag splice and one window splice');
 assert.deepEqual([changes[0].expected,changes[0].replacement.replace(/ink-block-[0-9a-f-]{36}/,'ID')],['',' id="ID"'],'the table tag splice only adds an id');
 assert.ok(changes[0].start<Buffer.byteLength('<table style="min-width: 50px;">'),'the table tag lies before the window');
 assert.equal(expected.split('표수정').length,2);
 assertBlockBytes(expected.replace('셀표수정','셀'),source,{added:4,message:'table/row/cell/paragraph identities'});
 assert.equal((await rpc('get',{id:note.id})).content,expected);assert.ok(edit.replacement.includes('표수정'));assert.ok(!edit.replacement.includes('<table'));
 // The caret is saved as a source byte. The table tag grew before the window,
 // so reindexed segments may start at another row: compare the text at the caret.
 const caret=()=>editor.evaluate((el:any)=>{const {state}=el.editor,{from,empty}=state.selection;return {empty,before:state.doc.textBetween(Math.max(0,from-8),from,'\n','\ufffc')};});
 const selected=await caret();assert.ok(selected.empty&&selected.before.endsWith('셀표수정'));
 await page.reload();await ready();const restored=await caret();assert.ok(restored.empty&&restored.before.endsWith('셀표수정'),'byte cursor survives reindex and reload');
 // A column change needs a wider range. The visible change stays recoverable;
 // it must not enter the canonical body or let navigation discard input.
 await editor.evaluate((el:any)=>{el.editor.view.focus();el.editor.commands.addColumnAfter();});await page.locator('.window-error').waitFor();
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();assert.equal(await page.locator('[data-segment-start]').getAttribute('data-segment-start'),'1');assert.equal((await rpc('get',{id:note.id})).content,expected);
 await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press('Control+z');await page.waitForFunction(()=>!document.querySelector('.window-error'));await saves.unchanged();assert.equal((await rpc('get',{id:note.id})).content,expected);
 await historyKey(page,'undo');await saved();assert.equal((await rpc('get',{id:note.id})).content,source);
 assert.deepEqual(errors,[]);console.log('PASS: application 10k-row table fragments, exact cell splice, cursor reload, rejected column change input retention/native undo, persisted undo and unchanged outside bytes');
}catch(error){console.error({errors});console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),rows:document.querySelectorAll('.tiptap-prose tr').length})));throw error;}
finally{await browser.close();}
