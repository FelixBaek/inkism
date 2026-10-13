// No editor query flags: exercise the application's default large-note policy.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes,blockIds,withoutBlockIds} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.ok(value.ok,value.error);return value.data;
};
const info=await (await fetch(base+'/api/info')).json();
assert.equal(info.windowed_editor,true,'normal app launch must enable bounded rich editing');
assert.equal(info.lazy_editor,true,'normal app launch must enable partial body reads');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],reads=[];
page.on('pageerror',error=>errors.push(error.message));
const root=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
// Exact source, except the identity the editor gives each block it edited
// (`added` new ink-block ids; `ids` requires the same identities again).
const stored=async(id,content,added=0,ids?)=>{
 let actual='';
 const message='default editor failed to preserve exact source';
 try{await waitForPredicate(async()=>{actual=(await rpc('get',{id})).content;return withoutBlockIds(actual)===withoutBlockIds(content)&&blockIds(actual).length>=blockIds(content).length+added;},message,15000);}
 catch(error){assertBlockBytes(actual,content,{added,ids,message});throw error;}
 return assertBlockBytes(actual,content,{added,ids,message});
};
const largeIds=new Set();
try{
 await page.route('**/api/rpc',route=>{
  const request=route.request().postDataJSON();
  if(largeIds.has(request.id)){
   reads.push(request);
   if(['get','revision_body','document_render'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden in rich mode'}});
  }
  return route.continue();
 });
 const paragraphs=Array.from({length:10000},(_,index)=>'<p><b>원문 블록 '+index+' &amp; 😀</b></p>');
 const oracle=await rpc('save',{note:{title:'표 스키마 기준 '+Date.now(),content:'<p>기준</p>',content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+oracle.title,exact:true}).click();
 await page.getByRole('button',{name:'텍스트',exact:true}).click();await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
 // Use the schema's real column/row attributes. An imported table with missing
 // schema structure is deliberately read-only and is not this editable fixture.
 const table=await root.evaluate((el: any)=>{
  el.editor.commands.setContent('<table><tbody><tr><td><p>표 셀 SEED 한글😀 &amp; 내용 보존</p></td><td><p>옆 셀 SEED</p></td></tr></tbody></table>');
  return el.editor.getHTML().replace(/<p><\/p>$/,'');
 }).then(withoutBlockIds);// setContent is an edit there; the fixture must not repeat its generated ids
 const row=table.match(/<tbody>([\s\S]*)<\/tbody>/)?.[1];assert.ok(row&&row.includes('SEED'));
 const giantTable=table.replace(row,Array.from({length:2500},(_,index)=>row.replaceAll('SEED',String(index))).join(''))+'<p>후미 보존</p>';
 await page.keyboard.press('Control+s');await waitSaved(page);
 const quoteBoundary=[...paragraphs];quoteBoundary[31]='<blockquote><p>경계 인용</p></blockquote>';
 const fixtures=[['paragraphs',paragraphs.join('')],['quote-boundary',quoteBoundary.join('')],['giant-table',giantTable]];
 for(const [kind,content] of fixtures){
  assert.ok(Buffer.byteLength(content)>200*1024);
  const note=await rpc('save',{note:{title:'기본 구간 편집 '+kind+' '+Date.now(),content,content_format:'html'}});largeIds.add(note.id);await rpc('wait_index');
  await page.goto(base+'/');assert.equal(new URL(page.url()).search,'');
  await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  assert.equal(await page.getByRole('button',{name:'텍스트',exact:true}).getAttribute('aria-pressed'),'true');
  assert.ok(await root.locator(':scope > *').count()<=32);
  assert.ok((await root.textContent()).length<66000);assert.ok(await page.locator('*').count()<1800);
  assert.equal((await rpc('get',{id:note.id})).content,content,'opening must not rewrite source');
  const target=kind==='giant-table'?root.locator('td p').first():root.locator('p').first();
  await target.click();await page.keyboard.press('Home');await page.keyboard.insertText('입력보존 ');await page.keyboard.press('Control+s');
  // Tiptap serializes the edited block canonically. Every other raw block must
  // retain its original b alias and entity spelling, including mounted peers.
  const edited=kind==='giant-table'?content.replace('표 셀 0','입력보존 표 셀 0'):
    '<p><strong>입력보존 원문 블록 0 &amp; 😀</strong></p>'+content.slice(paragraphs[0].length);
  // Only the edited block gains an identity. In a giant table the edited cell
  // paragraph and its enclosing cell, row and table are the touched blocks (as
  // in the full editor): 4 identities, every other byte exact.
  const touched=kind==='giant-table'?4:1;
  const editedIds=await stored(note.id,edited,touched);await ready();
  await page.reload();await ready();
  await historyKey(page,'undo');await stored(note.id,content);await ready();
  await historyKey(page,'redo');await stored(note.id,edited,touched,editedIds);await ready();
  if(kind==='paragraphs'){
   await historyKey(page,'undo');await stored(note.id,content);await ready();
   await root.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('재입력 ');await page.keyboard.press('Control+s');
   await stored(note.id,'<p><strong>재입력 원문 블록 0 &amp; 😀</strong></p>'+paragraphs.slice(1).join(''),1);
  }
 }
 assert.ok(reads.some(request=>request.op==='document_info'));
 assert.ok(reads.every(request=>!['get','revision_body','document_render'].includes(request.op)));
 assert.ok(reads.filter(request=>request.op==='document_blocks').every(request=>(request.limit??32)<=32));
 await page.unroute('**/api/rpc');
 // Unknown imported table structure already requires explicit source editing.
 // Default paging must keep its bytes and leave that existing escape available.
 // A plain table without a colgroup is admitted for rich editing since 498e265
 // (only Tiptap's derived colgroup may be added); an unknown table attribute
 // still cannot round-trip and keeps the table source-protected.
 const imported='<table data-unknown="keep"><tbody>'+Array.from({length:4000},()=>'<tr><td><p>가져온 표의 알 수 없는 속성</p></td></tr>').join('')+'</tbody></table>';
 const unsupported=await rpc('save',{note:{title:'미지원 표 보존 '+Date.now(),content:imported,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+unsupported.title,exact:true}).click();
 await page.locator('.window-error').waitFor();assert.equal((await rpc('get',{id:unsupported.id})).content,imported);
 await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-content').waitFor();
 assert.equal((await rpc('get',{id:unsupported.id})).content,imported);
 // Small rich documents and explicit source editing retain their existing modes.
 const small=await rpc('save',{note:{title:'기본 작은 노트 '+Date.now(),content:'<p>작은 문서</p>',content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+small.title,exact:true}).click();
 await page.getByRole('button',{name:'텍스트',exact:true}).click();await root.waitFor();
 assert.equal(await page.locator('.window-controls').count(),0);assert.equal(await root.textContent(),'작은 문서');
 await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-content').waitFor();
 assert.equal((await rpc('get',{id:small.id})).content,'<p>작은 문서</p>');
 assert.deepEqual(errors,[]);
 console.log('PASS normal launch without flags: bounded lazy rich paragraphs/quote boundary/giant table, untouched source and typing after restored undo; unsupported imported bytes, small rich and explicit HTML preserved');
}catch(error){
 console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),body:document.body.innerText.slice(-500)})).catch(()=>null));
 throw error;
}finally{await browser.close();}
