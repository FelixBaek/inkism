import {waitForPredicate} from './wait-for-predicate.ts';
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47972';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 const initialPending=(await rpc('draft_journal_status')).pending;
 const title='파일 복구 '+Date.now(),original='<p>기준😀</p><p>뒤쪽</p>';
 const note=await rpc('save',{note:{title,content:original,text:'기준😀 뒤쪽'}});
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await page.locator('.title-input').waitFor();
 const baseFile={format:'inkism-draft',version:1,note:{id:note.id,title,notebook_id:null,tags:['복구']},
 body:{kind:'partial',revision:note.revision,offset_encoding:'utf-8',edit_order:'sequential',
 edits:[{start:0,expected:'<p>기준😀</p>',replacement:'<p>내편집😀</p>'}]}};
 // 가져오기 도구는 설정 창의 '가져오기' 항목 안에 있다. 결과 안내도 그 창에 보인다.
 const settingsOpen=async()=>(await page.locator('dialog.settings-dialog[open]').count())>0;
 const closeSettings=async()=>{if(await settingsOpen())await page.getByRole('button',{name:'설정 닫기',exact:true}).click();};
 const upload=async data=>{if(!(await settingsOpen())){await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'가져오기',exact:true}).click();}
  await page.getByLabel('편집 보관 파일',{exact:true}).setInputFiles({
  name:'recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))
 });};
 for(const mode of ['complete','partial','missing']){
  const data:any=structuredClone(baseFile);data.note.title=title+' '+mode;
  if(mode==='complete')data.body={kind:'complete',revision:1,content:'\ufeff<p>완전한 본문😀</p>\r\n<x-private>원문</x-private>\r끝'};
  if(mode==='missing')data.body.revision=999;
  await upload(data);
  if(mode==='missing')await page.getByRole('button',{name:'편집 구간 복구',exact:true}).click();
  const restoredTitle=data.note.title+(mode==='missing'?' (편집 구간 복구)':' (편집 복구)');
  await page.getByText('새 노트로 복구했습니다: '+restoredTitle,{exact:true}).waitFor();
  const list=await rpc('list',{view:'all'});
  const summary=list.items.find(n=>n.title===restoredTitle);assert.ok(summary);
  assert.notEqual(summary.id,note.id);
  const restored=await rpc('get',{id:summary.id});
  assert.deepEqual(restored.tags,['복구']);
  if(mode==='complete')assert.equal(restored.content,data.body.content);
  if(mode==='partial')assert.equal(restored.content,'<p>내편집😀</p><p>뒤쪽</p>');
  if(mode==='missing'){
   assert.ok(restored.content.includes('편집한 구간만 복구'));
   assert.ok(restored.content.includes('내편집😀'));
   assert.equal(restored.content.includes('뒤쪽'),false);
  }
  assert.equal((await rpc('get',{id:note.id})).content,original);
  assert.equal(await page.locator('.title-input').inputValue(),title,'import must preserve the active editor');
 }
 const before=await rpc('stats');
 for(const invalid of [{...baseFile,version:2},{...baseFile,body:{...baseFile.body,revision:0}}]){
  await upload(invalid);
  await page.getByText('올바른 inkism 편집 보관 파일이 아닙니다.',{exact:true}).waitFor();
  assert.deepEqual(await rpc('stats'),before,'invalid file makes no writes');
  await page.getByRole('button',{name:'확인',exact:true}).click();
 }
 const missing=structuredClone(baseFile);missing.body.revision=999;
 await upload(missing);
 await page.getByRole('button',{name:'취소',exact:true}).click();
 assert.deepEqual(await rpc('stats'),before);
 await page.route('**/api/rpc',async route=>{
  if(route.request().postDataJSON().op==='revision_body')
   return route.fulfill({status:503,json:{ok:false,error:'연결 실패 검사'}});
  await route.continue();
 });
 await upload(baseFile);
 await page.getByText('연결 실패 검사',{exact:true}).waitFor();
 assert.deepEqual(await rpc('stats'),before);
 await page.getByRole('button',{name:'확인',exact:true}).click();
 await page.unroute('**/api/rpc');
 // Rescue a real never-saved draft through the shipped download/import UI.
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='save'
  ?route.fulfill({status:503,json:{ok:false,error:'new note write unavailable'}}):route.continue());
 await closeSettings();await page.locator('.topbar-new-note').click();
 const newTitle='첫 저장 실패 복구 '+Date.now();
 await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.split-primary .cm-content').waitFor();
 await page.locator('.title-input').fill(newTitle);
 // Browser native insertText normalizes input line breaks. CR/BOM source
 // round-trip is independently checked by the complete-file case above.
 const raw='\ufeff<p>새 노트 <strong>한글😀</strong></p>\n<x-private>원문</x-private>\n끝';
 await page.locator('.split-primary .cm-content').click();await page.keyboard.insertText(raw);
 await page.keyboard.press('Control+s');
 await page.getByRole('button',{name:'미저장 편집 파일로 보관',exact:true}).waitFor();
 const downloaded=page.waitForEvent('download');
 await page.getByRole('button',{name:'미저장 편집 파일로 보관',exact:true}).click();
 const file=await downloaded;
 const {readFile}=await import('node:fs/promises');
 const snapshot=JSON.parse(await readFile(await file.path(),'utf8'));
 assert.equal(snapshot.body.kind,'complete');assert.equal(snapshot.body.revision,0);
 assert.equal(snapshot.body.content,raw);assert.equal(snapshot.note.title,newTitle);
 const originalResponse=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'get',id:snapshot.note.id})})).json();
 assert.equal(originalResponse.ok,false,'failed first save never creates an original');
 await page.unroute('**/api/rpc');
 await upload(snapshot);
 await page.getByText('새 노트로 복구했습니다: '+newTitle+' (편집 복구)',{exact:true}).waitFor();
 const recovered=(await rpc('list',{view:'all'})).items.find(n=>n.title===newTitle+' (편집 복구)');
 assert.ok(recovered);assert.notEqual(recovered.id,snapshot.note.id);
 const restored=await rpc('get',{id:recovered.id});assert.equal(restored.content,raw);
 assert.equal(restored.content_format,snapshot.note.content_format);
 assert.deepEqual(restored.tags,snapshot.note.tags);
 assert.equal(await page.locator('.title-input').inputValue(),newTitle,'recovery keeps unsaved original open');
 assert.ok((await page.locator('.split-primary .cm-content').innerText()).includes('한글😀'));
 assert.equal((await rpc('get',{id:note.id})).content,original);
 assert.deepEqual(errors,[]);
 // After verifying that import leaves the unresolved original visible, finish
 // this fixture with a real save. Its new durable journal must not be mistaken
 // for an abandoned draft when the Go fixture reopens the library.
 await closeSettings();await page.locator('.split-primary .cm-content').click();await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 // The browser regression pipeline shares its synthetic library. Earlier
 // failure fixtures intentionally leave their own durable drafts behind.
 // Clear this fixture's saved draft while preserving those other records.
 await waitForPredicate(async()=>(await rpc('draft_journal_status')).pending===initialPending,
  '수동 복구 검사 초안 정리와 기존 보관 항목 보존을 기다리는 시간이 초과됐습니다.');
 console.log('PASS: full/partial/missing-baseline recovery creates separate notes; original and active draft preserved; invalid file makes no writes; failed first-save download/import restores exact revision-0 draft');
}finally{await browser.close();}
