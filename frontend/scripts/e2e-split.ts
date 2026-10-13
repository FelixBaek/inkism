import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48139';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const a=await rpc('save',{note:{title:'Split A '+Date.now(),content:'<p>left</p>',text:'left'}});
const b=await rpc('save',{note:{title:'Split B '+Date.now(),content:'<p>right</p>',text:'right'}});await rpc('wait_index');
await rpc('workspace_set',{ids:[a.id,b.id],active:a.id,locations:{}});// The 분할 편집 entry button was removed; a split layout saved earlier still reopens the pane, so seed it.
await rpc('split_set',{id:b.id,mode:'source'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const right=page.getByRole('region',{name:'분할 편집기'}),left=page.locator('.split-primary');
// HTML notes open in the rich view; the primary pane is edited through its HTML source view.
const source=async()=>{const rich=left.getByRole('button',{name:'텍스트',exact:true});if(await rich.count()&&await rich.getAttribute('aria-pressed')==='true')await left.getByRole('button',{name:'HTML',exact:true}).click();};
const edit=async(pane,text)=>{if(pane===left)await source();await pane.locator('.cm-content').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText(text);};
const waitContent=async(id,expected)=>{for(let i=0;i<60;i++){if((await rpc('get',{id})).content===expected)return;await page.waitForTimeout(100);}assert.equal((await rpc('get',{id})).content,expected);};
const durable=async(id,revision?)=>{for(let i=0;i<100;i++){const expected=revision??(await rpc('get',{id})).revision;if((await rpc('editor_history_get')).some(h=>h.id===id&&h.kind==='split-source'&&h.revision===expected))return;await page.waitForTimeout(100);}throw new Error('split history persistence timeout');};
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await page.getByLabel('노트 제목',{exact:true}).waitFor();if(await page.getByRole('button',{name:'대용량 원문',exact:true}).count())await page.getByRole('button',{name:'대용량 원문',exact:true}).click();await right.getByLabel('분할 노트',{exact:true}).selectOption(b.id);await right.getByRole('heading',{name:b.title}).waitFor();
 await edit(right,' saved');await page.keyboard.press('Control+s');await waitContent(b.id,'<p>right</p> saved');
 await edit(left,' saved');await page.keyboard.press('Control+s');await waitContent(a.id,'<p>left</p> saved');
 await durable(b.id);await page.reload();await right.getByRole('heading',{name:b.title}).waitFor();assert.equal(await right.locator('.cm-content').innerText(),'<p>right</p> saved');
 await right.locator('.cm-content').focus();await page.keyboard.press('Control+z');await right.getByRole('button',{name:'분할 저장',exact:true}).click();await waitContent(b.id,'<p>right</p>');
 await durable(b.id);await page.reload();await right.locator('.cm-content').focus();await page.keyboard.press('Control+Shift+z');await right.getByRole('button',{name:'분할 저장',exact:true}).click();await waitContent(b.id,'<p>right</p> saved');
 let releaseSave,saveStarted;const started=new Promise(resolve=>{saveStarted=resolve;});const release=new Promise(resolve=>{releaseSave=resolve;});let intercepted=false;
 await page.route('**/api/rpc',async route=>{
  const body=route.request().postDataJSON();
  if(!intercepted && body.op==='save' && body.note?.id===b.id){intercepted=true;const response=await route.fetch();saveStarted();await release;return route.fulfill({response});}
  return route.continue();
 });
 await edit(right,' delayed');await right.getByRole('button',{name:'분할 저장',exact:true}).click();await started;
 await edit(right,' later');releaseSave();await waitContent(b.id,'<p>right</p> saved delayed later');await page.unroute('**/api/rpc');
 await right.getByLabel('분할 노트',{exact:true}).selectOption(a.id);await right.getByRole('heading',{name:a.title}).waitFor();
 await edit(left,' remote');await page.keyboard.press('Control+s');await waitContent(a.id,'<p>left</p> saved remote');
 await edit(right,' conflict');await right.getByRole('button',{name:'분할 저장',exact:true}).click();await right.getByRole('alert').waitFor();
 assert.equal((await rpc('get',{id:a.id})).content,'<p>left</p> saved remote');
 await page.getByRole('button',{name:'분할 닫기',exact:true}).click();assert.equal(await right.count(),1);
 page.once('dialog',d=>d.dismiss());await right.getByRole('button',{name:'저장된 버전 다시 열기',exact:true}).click();assert.match(await right.locator('.cm-content').innerText(),/conflict/);
 await right.getByRole('button',{name:'초안을 새 노트로 보관',exact:true}).click();await right.getByRole('heading',{name:a.title+' (분할 복구 사본)'}).waitFor();
 const layout=await rpc('split_get');assert.notEqual(layout.id,a.id);assert.equal((await rpc('get',{id:layout.id})).content,'<p>left</p> saved conflict');
 const long=await rpc('save',{note:{title:'Split scroll '+Date.now(),content:Array.from({length:1000},(_,i)=>'line '+i).join('\n'),text:'lines'}});
 await page.reload();await right.getByLabel('분할 노트',{exact:true}).selectOption(long.id);await right.getByRole('heading',{name:long.title}).waitFor();
 await right.locator('.cm-content').focus();await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 await right.locator('.cm-scroller').hover();await page.mouse.wheel(0,1200);
 await page.waitForFunction(()=>document.querySelector('.split-secondary .cm-scroller')?.scrollTop>500);
 await right.getByRole('button',{name:'분할 저장',exact:true}).click();
 await page.waitForTimeout(800);const position=(await rpc('split_get')).locations[long.id];
 assert.ok(position.scrollTop>500);assert.equal(position.selection.ranges[0].anchor,2);
 const order=(await rpc('split_get')).tabs.map(t=>t.id);assert.ok(order.includes(a.id)&&order.includes(b.id)&&order.includes(long.id));
 await page.reload();await right.getByRole('heading',{name:long.title}).waitFor();
 await page.waitForTimeout(600);assert.equal((await rpc('split_get')).locations[long.id].selection.ranges[0].anchor,2);
 assert.ok(Math.abs(await right.locator('.cm-scroller').evaluate((el: any)=>el.scrollTop)-position.scrollTop)<4);
 assert.deepEqual((await rpc('split_get')).tabs.map(t=>t.id),order);
 await right.getByRole('button',{name:'분할 탭 닫기: '+b.title,exact:true}).click();await right.getByRole('tab',{name:b.title,exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'분할 닫기',exact:true}).click();await right.waitFor({state:'hidden'});await page.reload();assert.equal(await right.count(),0);

 // Stop the previous app before replacing its persisted workspace fixture.
 // Otherwise its delayed startup/pagehide write can reopen Split A instead.
 await page.goto('about:blank');
 // Local RPC changes exercise open-pane permissions, not real device sync.
 const c=await rpc('save',{note:{title:'Permission main '+Date.now(),content:'main\r\nsource',content_format:'markdown'}});
 const d=await rpc('save',{note:{title:'Permission split '+Date.now(),content:'split\r\nsource',content_format:'markdown'}});
 // Leave the app first so its unload flush cannot overwrite the seeded workspace/split layout.
 await page.goto('about:blank');await page.waitForTimeout(300);
 await rpc('workspace_set',{ids:[c.id,d.id],active:c.id,locations:{}});
 await rpc('split_set',{id:d.id,mode:'source'});await page.goto(base);
 await right.getByRole('heading',{name:d.title}).waitFor();await left.getByLabel('노트 제목',{exact:true}).waitFor();
 await left.locator('.cm-content').waitFor();await right.locator('.cm-content').waitFor();
 const permission=async(id,readonly)=>{
  const n=await rpc('get',{id});return rpc('patch',{id,revision:n.revision,changes:{readonly},summary_only:true});
 };
 const checkPermissions=()=>page.evaluate(()=>window.dispatchEvent(new Event('inkism-sync-check')));
 const waitPermission=editable=>page.waitForFunction(value=>{
  const panes=['.split-primary','.split-secondary'];
  return panes.every(p=>document.querySelector(p+' .cm-content')?.getAttribute('contenteditable')===String(value))
   && document.querySelector<any>('.split-primary input[aria-label="노트 제목"]')?.readOnly===!value;
 },editable);
 await permission(c.id,true);await permission(d.id,true);await checkPermissions();await waitPermission(false);
 await edit(left,' blocked');await edit(right,' blocked');await page.keyboard.press('Control+z');
 assert.equal((await rpc('get',{id:c.id})).content,c.content);assert.equal((await rpc('get',{id:d.id})).content,d.content);
 await permission(c.id,false);await permission(d.id,false);await checkPermissions();await waitPermission(true);

 // Synthetic IME events cover deferral only; Windows IME remains unverified.
 await right.locator('.cm-content').evaluate((el: any)=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
 await permission(d.id,true);await checkPermissions();await page.waitForTimeout(300);
 assert.equal(await right.locator('.cm-content').getAttribute('contenteditable'),'true');
 await right.locator('.cm-content').evaluate((el: any)=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await checkPermissions();await page.waitForFunction(()=>document.querySelector('.split-secondary .cm-content')?.getAttribute('contenteditable')==='false');
 await permission(d.id,false);await checkPermissions();await waitPermission(true);
 // Receipts cannot rebase the body. Reopen the clean note before each edit.
 await right.getByLabel('분할 노트',{exact:true}).selectOption(c.id);
 await right.getByLabel('분할 노트',{exact:true}).selectOption(d.id);
 await right.getByRole('heading',{name:d.title}).waitFor();

 let finishPermissionSave,permissionSaveStarted;
 const permissionStarted=new Promise(resolve=>{permissionSaveStarted=resolve;});
 const finishPermission=new Promise(resolve=>{finishPermissionSave=resolve;});
 let heldPermissionSave=false;
 const delayPermissionSave=async route=>{
  const body=route.request().postDataJSON();
  if(!heldPermissionSave && body.op==='save' && body.note?.id===d.id){
   heldPermissionSave=true;const response=await route.fetch();permissionSaveStarted();
   await finishPermission;return route.fulfill({response});
  }
  return route.continue();
 };
 await page.route('**/api/rpc',delayPermissionSave);
 try{
  await edit(right,' delayed');await right.getByRole('button',{name:'분할 저장',exact:true}).click();await permissionStarted;
  const savedPermissionRevision=(await rpc('get',{id:d.id})).revision;
  await permission(d.id,true);await checkPermissions();
  await page.waitForFunction(()=>document.querySelector('.split-secondary .cm-content')?.getAttribute('contenteditable')==='false');
  // The permission patch already advanced the revision, so the engine must reject this save's history write as stale.
  const staleHistory=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON()?.op==='editor_history_set'&&r.request().postDataJSON()?.id===d.id&&r.request().postDataJSON()?.revision===savedPermissionRevision);
  finishPermissionSave();assert.equal((await (await staleHistory).json()).data.stale,true);await page.waitForTimeout(300);
  assert.equal(await right.locator('.cm-content').getAttribute('contenteditable'),'false','late save cannot reopen a protected pane');
  assert.equal((await rpc('get',{id:d.id})).content,d.content+' delayed');
 }finally{finishPermissionSave();await page.unroute('**/api/rpc',delayPermissionSave);}
 await permission(d.id,false);await checkPermissions();await waitPermission(true);
 await right.getByLabel('분할 노트',{exact:true}).selectOption(c.id);
 await right.getByLabel('분할 노트',{exact:true}).selectOption(d.id);
 await right.getByRole('heading',{name:d.title}).waitFor();
 await edit(right,' resumed');await right.getByRole('button',{name:'분할 저장',exact:true}).click();
 await waitContent(d.id,d.content+' delayed resumed');
 assert.deepEqual(errors,[]);console.log('PASS: independent split edits, layout/history restart, delayed saves, conflict recovery, layout close, open-pane readonly/unlock, synthetic composition deferral and permission receipt ordering');
}catch(e){console.error((await page.locator('body').innerText()).slice(0,6000));console.error(await rpc('split_get'));throw e;}finally{await browser.close();}
