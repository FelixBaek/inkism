import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48042';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const stamp=Date.now();
 const target=await rpc('save',{note:{title:'미룰 알림 '+stamp,content:'<p>보존할 본문</p>',reminder_at:stamp-1000}});
 const clear=await rpc('save',{note:{title:'해제할 알림 '+stamp,content:'<p>해제 본문</p>',reminder_at:stamp-1000}});
 const lazy=process.env.INKISM_LAZY==='1';
 const content=lazy?Array.from({length:10000},(_,i)=>`<p>작성 본문 ${i} 대용량 문서의 원문을 보존합니다.</p>`).join(''):'<p>작성 본문</p>';
 const active=await rpc('save',{note:{title:'작성 중 '+stamp,content}});
 let fullReads=0,splices=0,denySave=false,release,entered,blockedId=null,patches=0,onDenied;
 await page.route('**/api/rpc',async route=>{
  const req=route.request().postDataJSON();
  if(lazy && req.id===active.id && ['get','document_render','revision_body'].includes(req.op)){
   fullReads++;return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden in lazy reminder test'}});
  }
  if(req.op==='patch' && req.id===target.id && entered){
   const response=await route.fetch();
   await new Promise(resolve=>{release=resolve;entered();});
   return route.fulfill({response});
  }
  if(req.op==='patch' && req.id===blockedId)patches++;
  if(lazy && req.id===active.id && req.op==='document_blocks')assert.ok(req.limit<=32,'bounded block reads');
  if(req.op==='document_splice_html' && req.id===active.id){
   splices++;assert.ok(JSON.stringify(req).length<4096,'small draft uses bounded splice');
  }
  if(denySave && ['save','document_splice','document_splice_html','document_splice_source'].includes(req.op)){
   onDenied?.();return route.abort();
  }
  return route.continue();
 });
 const editor=page.locator(lazy?'.tiptap-prose':'.cm-content');
 // HTML notes open in the rich view; the non-lazy run edits the exact source in the explicit HTML view.
 const openEditor=async()=>{if(!lazy){const html=page.getByRole('button',{name:'HTML',exact:true});await html.waitFor();if(await html.getAttribute('aria-pressed')!=='true')await html.click();}await editor.waitFor();};
 const expected=suffix=>lazy?content.slice(0,-4)+suffix+'</p>':content+suffix;
 // Editing a block gives it an identity (BlockIdentity), so the lazily edited last paragraph gains an id.
 const stripEditedId=body=>lazy?body.replace(/<p id="ink-block-[0-9a-f-]{36}">([^<]*)<\/p>$/,'<p>$1</p>'):body;
 const stored=async suffix=>{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   if(stripEditedId((await rpc('get',{id:active.id})).content)===expected(suffix))return;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  const actual=(await rpc('get',{id:active.id})).content;
  assert.ok(stripEditedId(actual)===expected(suffix),'exact durable body; tail='+actual.slice(-180));
 };
 const append=async text=>{
  if(lazy){
   // Already on the last block. Ctrl+End would begin another asynchronous
   // window navigation, which is unrelated to the held reminder response.
   // The open reminder toast covers the lower-right portion of a wide paragraph.
   // Click its unobscured leading edge; keep the pending reminder visible.
   await editor.locator('p').last().click({position:{x:4,y:4}});await page.keyboard.press('End');
   await page.waitForFunction(()=>{const e=document.querySelector<any>('.tiptap-prose')?.editor;return e?.state.selection.empty && e.state.selection.head===e.state.doc.content.size-1;});
  }else{await editor.click();await page.keyboard.press('Control+End');}
  await page.keyboard.insertText(text);
 };
 await rpc('wait_index');await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base+(lazy?'/?virtual=1&lazy=1':''));
 await page.getByRole('button',{name:'노트 열기: '+active.title,exact:true}).click();
 await openEditor();
 if(lazy){
  await page.getByLabel('이동할 블록 번호').fill('10000');
  await page.getByRole('button',{name:'이동',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='9999');
  assert.ok(await page.locator('.tiptap-prose p').count()<=32,'bounded mounted paragraphs');
  assert.equal(fullReads,0,'opening and jumping never fetch full body');
 }
 const inbox=page.getByRole('complementary',{name:'도래한 노트 알림'});
 await inbox.getByRole('button',{name:/도래한 알림/}).click();
 const actions=inbox.getByRole('group',{name:target.title+' 알림 처리',exact:true});
 const held=new Promise(resolve=>entered=resolve);
 const before=Date.now();await actions.getByRole('button',{name:'10분 뒤 다시 알림',exact:true}).click();
 let timer;try{await Promise.race([held,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('reminder request missing')),5000);})]);}finally{clearTimeout(timer);}
 assert.equal(await actions.getByRole('button',{name:'알림 해제',exact:true}).isDisabled(),true);
 await append(' 동시 입력 보존');
 release();entered=null;await actions.waitFor({state:'hidden'});
 await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 const saved=await rpc('get',{id:target.id});assert.ok(saved.reminder_at>=before+600000 && saved.reminder_at<=Date.now()+600000);assert.equal(saved.content,target.content);
 await stored(' 동시 입력 보존');
 await inbox.getByRole('group',{name:clear.title+' 알림 처리',exact:true}).getByRole('button',{name:'알림 해제',exact:true}).click();
 await inbox.getByRole('group',{name:clear.title+' 알림 처리',exact:true}).waitFor({state:'hidden'});
 assert.equal((await rpc('get',{id:clear.id})).reminder_at,null);
 // A remote reschedule must not be overwritten by an old inbox row.
 const stale=await rpc('save',{note:{title:'변경된 알림 '+stamp,reminder_at:Date.now()-1000}});
 await page.evaluate(()=>window.dispatchEvent(new Event('inkism-reminders-changed')));
 const toggle=inbox.getByRole('button',{name:/도래한 알림/});await toggle.waitFor();
 if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 const staleActions=inbox.getByRole('group',{name:stale.title+' 알림 처리',exact:true});await staleActions.waitFor();
 const remoteTime=Date.now()+7200000;await rpc('patch',{id:stale.id,revision:stale.revision,changes:{reminder_at:remoteTime}});
 await staleActions.getByRole('button',{name:'알림 해제',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'확인',exact:true}).click();
 await page.getByText('알림을 변경하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.').waitFor();
 assert.equal((await rpc('get',{id:stale.id})).reminder_at,remoteTime);
 // Failed draft persistence must stop the reminder mutation as well.
 const blocked=await rpc('save',{note:{title:'저장 실패 알림 '+stamp,reminder_at:Date.now()-1000}});
 await page.evaluate(()=>window.dispatchEvent(new Event('inkism-reminders-changed')));
 const blockedActions=inbox.getByRole('group',{name:blocked.title+' 알림 처리',exact:true});await blockedActions.waitFor();
 blockedId=blocked.id;denySave=true;
 const rejected=new Promise(resolve=>onDenied=resolve);
 await append(' 실패 중 초안');
 await blockedActions.getByRole('button',{name:'알림 해제',exact:true}).click();
 let rejectTimer;try{await Promise.race([rejected,new Promise((_,reject)=>{rejectTimer=setTimeout(()=>reject(new Error('draft save was not attempted')),5000);})]);}finally{clearTimeout(rejectTimer);}
 await page.getByText('알림을 변경하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.').waitFor();
 await blockedActions.getByRole('button',{name:'알림 해제',exact:true}).waitFor();await page.waitForFunction(title=>document.querySelector(`[aria-label="${title} 알림 처리"] button`)?.matches(':enabled'),blocked.title);
 assert.equal(patches,0);assert.equal((await rpc('get',{id:blocked.id})).reminder_at,blocked.reminder_at);
 assert.ok((await editor.innerText()).includes('실패 중 초안'));
 assert.equal(stripEditedId((await rpc('get',{id:active.id})).content),expected(' 동시 입력 보존'),'failed persistence preserves durable body');
 denySave=false;await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 await stored(' 동시 입력 보존 실패 중 초안');
 const durable=await rpc('get',{id:active.id});
 for(const key of ['title','reminder_at','content_format','notebook_id','favorite','pinned','archived','trashed'])assert.equal(durable[key],active[key],'draft metadata preserved: '+key);
 assert.deepEqual(durable.tags,active.tags);
 await rpc('wait_index');
 assert.ok((await rpc('list',{view:'all',query:'실패 중 초안'})).items.some(note=>note.id===active.id),'saved draft is indexed');
 await page.reload();await openEditor();
 assert.equal((await rpc('get',{id:target.id})).reminder_at,saved.reminder_at);
 assert.ok((await editor.innerText()).includes('실패 중 초안'),'restart restores final draft');
 if(lazy){assert.equal(fullReads,0);assert.ok(splices>=2);assert.ok(await page.locator('.tiptap-prose p').count()<=32);}
 assert.deepEqual(errors,[]);
 console.log('PASS: inbox snooze/clear, duplicate prevention, concurrent draft preservation, stale revision rejection, save failure and restart persistence; lazy='+lazy);
} finally {await browser.close();}
