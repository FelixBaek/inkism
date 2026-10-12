import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL||'http://127.0.0.1:48291';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const title='부분 원문 전환 경합 '+Date.now(),content=Array.from({length:10000},(_,i)=>`<p>전환😀 ${i}</p>`).join('');
const note=await rpc('save',{note:{title,content,content_format:'html'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 let fullReads=0,hold=false,release,entered;
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(request.id===note.id && ['get','revision_body','document_render'].includes(request.op)){
   fullReads++;
   if(hold){const response=await route.fetch();await new Promise(resolve=>{release=resolve;entered();});return route.fulfill({response});}
  }
  await route.continue();
 });
 await page.goto(base+'/?virtual=1&lazy=1');
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await page.locator('[data-window-start="0"]').waitFor();assert.equal(fullReads,0);
 assert.equal(await page.locator('.status-words').textContent(),`원문 ${(Buffer.byteLength(content)/1024).toLocaleString('ko-KR',{maximumFractionDigits:1})}KB`);
 const editor=page.locator('.tiptap-prose');
 const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
 await editor.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('보존편집 ');await page.keyboard.press('Control+s');await saved();
 const before=await rpc('get',{id:note.id});
 // MARKDOWN on an HTML note is now a view (no format-change dialog to cancel); the partial draft must still
 // need no full read before undo/redo.
 assert.equal(fullReads,0,'editing/saving the partial draft must not load the full body');
 await editor.click();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 await page.keyboard.press('Control+y');await saved();assert.equal((await rpc('get',{id:note.id})).content,before.content);
 for(const kind of ['body','title']){
  hold=true;const arrived=new Promise(resolve=>entered=resolve);
  await page.getByRole('button',{name:'HTML',exact:true}).click();await arrived;
  if(kind==='body'){
   await editor.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('대기중입력 ');
  }else await page.getByLabel('노트 제목').fill(title+' 변경');
  release();hold=false;
  await page.getByRole('heading',{name:'원문 형식 변경 실패',exact:true}).waitFor();
  await page.getByRole('button',{name:'확인',exact:true}).click();
  await page.locator('[data-window-start="0"]').waitFor();assert.equal(await page.locator('.split-primary .cm-content').count(),0);
  await page.keyboard.press('Control+s');await saved();
  const stored=await rpc('get',{id:note.id});
  if(kind==='body')assert.ok(stored.content.includes('대기중입력'));
  else assert.equal(stored.title,title+' 변경');
 }
 const stored=await rpc('get',{id:note.id});
 await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.split-primary .cm-content').waitFor();
 await page.locator('.split-primary .cm-content').click();await page.keyboard.press('Control+End');
 await page.waitForFunction(()=>document.querySelector('.split-primary .cm-content')?.textContent?.includes('전환😀 9999'));
 assert.equal((await rpc('get',{id:note.id})).revision,stored.revision);
 assert.equal(fullReads,3);assert.deepEqual(errors,[]);
 console.log('PASS: partial draft keeps undo/redo without full reads; typing/title during delayed source read retained; explicit source view does not write');
}finally{await browser.close();}
