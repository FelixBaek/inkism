// Actual application table fragments, exact raw bytes and failed projection.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47890';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose'),ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
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
 const edit=requests.at(-1).edits?.[0]??requests.at(-1).content,bytes=Buffer.from(source);
 assert.equal(bytes.subarray(edit.start,edit.start+Buffer.byteLength(edit.expected)).toString(),edit.expected);
 const expected=Buffer.concat([bytes.subarray(0,edit.start),Buffer.from(edit.replacement),bytes.subarray(edit.start+Buffer.byteLength(edit.expected))]).toString();
 assert.equal((await rpc('get',{id:note.id})).content,expected);assert.ok(edit.replacement.includes('표수정'));assert.ok(!edit.replacement.includes('<table'));
 const selected=await editor.evaluate((el:any)=>el.editor.state.selection.toJSON());
 await page.reload();await ready();assert.deepEqual(await editor.evaluate((el:any)=>el.editor.state.selection.toJSON()),selected);
 // A column change needs a wider range. The visible change stays recoverable;
 // it must not enter the canonical body or let navigation discard input.
 await editor.evaluate((el:any)=>{el.editor.view.focus();el.editor.commands.addColumnAfter();});await page.locator('.window-error').waitFor();
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();assert.equal(await page.locator('[data-segment-start]').getAttribute('data-segment-start'),'1');assert.equal((await rpc('get',{id:note.id})).content,expected);
 await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press('Control+z');await page.waitForFunction(()=>!document.querySelector('.window-error'));await saved();assert.equal((await rpc('get',{id:note.id})).content,expected);
 await historyKey(page,'undo');await saved();assert.equal((await rpc('get',{id:note.id})).content,source);
 assert.deepEqual(errors,[]);console.log('PASS: application 10k-row table fragments, exact cell splice, cursor reload, rejected column change input retention/native undo, persisted undo and unchanged outside bytes');
}catch(error){console.error({errors});console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),rows:document.querySelectorAll('.tiptap-prose tr').length})));throw error;}
finally{await browser.close();}
