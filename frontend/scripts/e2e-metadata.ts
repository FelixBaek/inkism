import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47924';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='메타만 수정 '+Date.now();
const content='<p><strong>본문 보존</strong> 한글😀 긴 문서의 메타데이터 검사</p>'.repeat(10000);
const note=await rpc('save',{note:{title,content,text:'본문 보존\n'.repeat(10000)}});await rpc('wait_index');
const notebook=await rpc('save_notebook',{name:'메타 저장 폴더 '+Date.now()});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const workers=[];page.on('worker',w=>workers.push(w.url()));
const menu=async name=>{await page.locator('.note-row.is-selected .note-row-main').click({button:'right'});await page.getByRole('menuitemcheckbox',{name,exact:true}).click();};
try {
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-content').waitFor();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='patch');
 await menu('즐겨찾기');const r=await response;const request=r.request().postDataJSON();assert.equal(request.summary_only,true);assert.equal(request.revision,1);
 const data=await r.json();assert.equal(data.ok,true);assert.equal(data.data.favorite,true);assert.equal(data.data.content,undefined);assert.ok((await r.body()).length<2000);
 assert.equal((await rpc('get',{id:note.id})).content,content);
 const splice=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='document_splice_source');
 await page.locator('.cm-content').first().click();await page.keyboard.press('Control+Home');await page.keyboard.insertText('이어쓰기 ');await page.keyboard.press('Control+s');const savedResponse=await splice;assert.equal(savedResponse.request().postDataJSON().text,undefined);const savedReply=await savedResponse.json();assert.equal(savedReply.data.text,undefined);
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 assert.equal(workers.some(url=>url.includes('plaintext.worker')),false);
 let local=await rpc('get',{id:note.id});assert.ok(local.content.includes('이어쓰기'));assert.equal(local.favorite,true);
 assert.match(await page.locator('.status-words').textContent(),/^[\d,]+ words$/);
 // Title-only edits must not resend or rederive the stored body.
 const titlePatch=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='patch');
 await page.getByLabel('노트 제목').fill(title+' 수정');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 const titleRequest=(await titlePatch).request().postDataJSON();assert.equal(titleRequest.changes.title,title+' 수정');assert.equal(titleRequest.changes.content,undefined);assert.equal(workers.some(url=>url.includes('plaintext.worker')),false);
 local=await rpc('get',{id:note.id});assert.ok(local.text.includes('이어쓰기'));assert.ok(local.content.includes('이어쓰기'));

 // Metadata autosave must omit unchanged titles instead of marking them as edits.
 assert.equal(typeof local.edited_at,'number');const beforeMetadata=local;
 const tagPatch=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='patch');
 await page.getByLabel('새 태그 입력 후 Enter').fill('정보만 변경');await page.getByLabel('새 태그 입력 후 Enter').press('Enter');await page.keyboard.press('Control+s');
 const tagResponse=await tagPatch;assert.equal((await tagResponse.json()).ok,true);
 assert.deepEqual(tagResponse.request().postDataJSON().changes,{tags:['정보만 변경']});
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 for(const notebookId of [notebook.id,'']){
  const notebookPatch=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='patch');
  await page.getByLabel('이 노트가 속한 폴더').selectOption(notebookId);await page.keyboard.press('Control+s');
  const notebookResponse=await notebookPatch;assert.equal((await notebookResponse.json()).ok,true);
  assert.deepEqual(notebookResponse.request().postDataJSON().changes,{notebook_id:notebookId||null});
  await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 }
 local=await rpc('get',{id:note.id});assert.equal(local.edited_at,beforeMetadata.edited_at);
 assert.equal(local.created_at,beforeMetadata.created_at);assert.equal(local.content,beforeMetadata.content);assert.equal(local.text,beforeMetadata.text);
 assert.equal(local.revision,beforeMetadata.revision+3);assert.deepEqual(local.tags,['정보만 변경']);assert.equal(local.notebook_id,null);

 // A remote revision must not be accepted as the local draft's new baseline.
 const remote=await rpc('save',{note:{id:note.id,revision:local.revision,content:'<p>원격 내용</p>',text:'원격 내용'}});
 const conflict=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='patch');await menu('고정');assert.equal((await(await conflict).json()).ok,false);
 await page.getByRole('heading',{name:'작업 실패',exact:true}).waitFor();
 const stored=await rpc('get',{id:note.id});assert.equal(stored.revision,remote.revision);assert.equal(stored.pinned,false);assert.equal(stored.content,'<p>원격 내용</p>');
 assert.ok((await page.locator('.cm-content').textContent()).includes('이어쓰기'));assert.deepEqual(errors,[]);
 console.log('PASS: bounded metadata response, changed fields only, preserved edit time/body, incremental save after patch, remote-revision rejection and local draft preservation');
} finally {await browser.close();}
