import {chromium} from 'playwright-core';
import {waitSaved} from './save-state.ts';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.INKISM_URL||'http://127.0.0.1:47966';
const rpc=async(op,args={})=>{
 const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 for (const scenario of ["restore","missing","typing"]) {
  const missing=scenario==="missing";
  const title='충돌 복원 '+scenario+' '+Date.now();
  const content=Array.from({length:10000},(_,i)=>`<p>기준😀 ${i} 본문입니다.</p>`).join('');
  const note=await rpc('save',{note:{title,content,text:'기준'}});
  await rpc('wait_index');
  const page=await browser.newPage();
  // Same isolated profile as the other UI tests: Korean UI and the note inspector closed (at 1280px it opens as a modal overlay over the editor).
  await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?virtual=1&lazy=1');
  await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
  await page.locator('[data-window-start="0"]').waitFor();
  // The server changed while the open editor still holds revision 1.
  let remote=note;
  if(missing)remote=await rpc('patch',{id:note.id,revision:note.revision,changes:{favorite:true}});
  remote=await rpc('save',{note:{id:note.id,revision:remote.revision,content:'<p>원격 삽입</p>'+content,text:'원격'}});
  await page.locator('.tiptap-prose p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.insertText('내편집 ');
  await page.keyboard.press('Control+s');
  const keep=page.getByRole('button',{name:'내 편집 유지하고 저장',exact:true});
  await keep.waitFor();
  if(scenario==="typing"){
   let entered, release;
   const started=new Promise(resolve=>entered=resolve);
   await page.route('**/api/rpc',async route=>{
    if(route.request().postDataJSON().op==='revision_body'){
     await new Promise(resolve=>{release=resolve;entered();});
    }
    await route.continue();
   });
   await keep.click();await started;
   await page.locator('.tiptap-prose p').first().click();
   await page.keyboard.press('Home');await page.keyboard.insertText('후속입력 ');
   const response=page.waitForResponse(r=>r.request().postData()?.includes('"revision_body"'));
   release();await response;
   await page.unroute('**/api/rpc');
   // Resolve once more using the latest draft after the stale recovery was discarded.
   await page.keyboard.press('Control+s');await keep.waitFor();await keep.click();
  } else await keep.click();
  if(missing){
   await page.getByText('편집 기준 버전이 이력에 없습니다.',{exact:false}).waitFor();
   let requests=0;
   const count=()=>requests++;
   page.on('request',count);
   const downloaded=page.waitForEvent('download');
   await page.getByRole('button',{name:'미저장 편집 파일로 보관',exact:true}).click();
   const file=await downloaded;
   const recovery=JSON.parse(await readFile(await file.path(),'utf8'));
   page.off('request',count);
   assert.equal(requests,0,'export must not fetch or save the note');
   assert.equal(recovery.format,'inkism-draft');
   assert.equal(recovery.body.kind,'partial');
   assert.equal(recovery.body.revision,1);
   assert.equal(recovery.note.id,note.id);
   assert.equal(recovery.body.offset_encoding,'utf-8');
   let recovered=Buffer.from(content);
   for(const edit of recovery.body.edits){
    const expected=Buffer.from(edit.expected),end=edit.start+expected.length;
    assert.deepEqual(recovered.subarray(edit.start,end),expected);
    recovered=Buffer.concat([recovered.subarray(0,edit.start),Buffer.from(edit.replacement),recovered.subarray(end)]);
   }
   assert.ok(recovered.toString().includes('내편집 기준😀 0'));
   assert.ok(recovered.toString().includes('기준😀 9999'));
   assert.equal((await rpc('get',{id:note.id})).content,remote.content);
   assert.ok((await page.locator('.tiptap-prose').textContent()).includes('내편집'));
  }else{
   await waitSaved(page);
   const stored=await rpc('get',{id:note.id});
   assert.ok(stored.content.includes('내편집 기준😀 0'));
   if(scenario==='typing')assert.ok(stored.content.includes('후속입력'));
   assert.ok(stored.content.includes('기준😀 9999'));
   assert.equal(stored.content.includes('원격 삽입'),false);
   // Overwritten remote body remains available in history.
   assert.equal((await rpc('revision_body',{id:note.id,revision:remote.revision})).content,remote.content);
  }
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS: lazy conflict restores exact local body; missing baseline keeps both local draft and remote body');
} finally {await browser.close();}
