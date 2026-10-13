import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47944';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const prefix='복원 '+Date.now();
const a=await rpc('save',{note:{title:prefix+' A',content:'<p>A</p>',text:'A'}});
const b=await rpc('save',{note:{title:prefix+' B',content:'<p>B</p>',text:'B'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const settled=async active=>{for(let i=0;i<100;i++){const w=await rpc('workspace_get');if(w.active===active)return w;await new Promise(r=>setTimeout(r,50));}throw Error('workspace did not settle');};
const selected=async note=>page.waitForFunction(title=>document.querySelector<any>('.title-input')?.value===title,note.title);
try {
 await rpc('workspace_set',{ids:[a.id,b.id],active:b.id});
 await page.goto(base);await selected(b);assert.equal(await page.getByRole('tablist',{name:'열린 노트',exact:true}).getByRole('tab').count(),2);
 await page.getByRole('tab',{name:'노트 탭: '+a.title,exact:true}).click();await selected(a);await settled(a.id);
 await page.reload();await selected(a);assert.equal(await page.getByRole('tablist',{name:'열린 노트',exact:true}).getByRole('tab').count(),2);
 // A failed read must never replace saved tabs with an empty workspace.
 await page.route('**/api/rpc',r=>r.request().postDataJSON().op==='workspace_get'?r.fulfill({status:503,json:{ok:false,error:'offline'}}):r.continue());
 await page.reload();await page.getByRole('button',{name:'이전 탭을 불러오지 못했습니다. 다시 시도'}).waitFor();
 assert.deepEqual((await rpc('workspace_get')).tabs.map(t=>t.id),[a.id,b.id]);
 await page.unroute('**/api/rpc');await page.getByRole('button',{name:'이전 탭을 불러오지 못했습니다. 다시 시도'}).click();await selected(a);
 // Slow restore must not replace a newer user selection, even while get is pending.
 let release;const gate=new Promise(r=>release=r);let entered;const seen=new Promise(r=>entered=r);
 await page.route('**/api/rpc',async route=>{if(route.request().postDataJSON().op==='workspace_get'){entered();await gate;}await route.continue();});
 await page.reload();await seen;
 await page.getByRole('button',{name:'노트 열기: '+b.title,exact:true}).click();await selected(b);release();await settled(b.id);
 assert.equal(await page.locator('.title-input').inputValue(),b.title);await page.unroute('**/api/rpc');
 // Write failure retains pending state and can be retried.
 await page.route('**/api/rpc',r=>r.request().postDataJSON().op==='workspace_set'?r.fulfill({status:503,json:{ok:false,error:'offline'}}):r.continue());
 await page.getByRole('tab',{name:'노트 탭: '+a.title,exact:true}).click();await selected(a);
 await page.getByRole('button',{name:'열린 탭을 저장하지 못했습니다. 다시 시도'}).waitFor();assert.equal((await rpc('workspace_get')).active,b.id);
 let closeCalls=0;
 await page.route('**/api/close',route=>{closeCalls++;return route.fulfill({status:200,body:'{}'});});
 const failedClose=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='workspace_set');
 await page.evaluate(()=>window.dispatchEvent(new Event('native-close-request')));await failedClose;
 await page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('저장 실패'));assert.equal(closeCalls,0);
 await page.unroute('**/api/rpc');await page.getByRole('button',{name:'열린 탭을 저장하지 못했습니다. 다시 시도'}).click();await settled(a.id);
 const closed=page.waitForResponse('**/api/close');await page.evaluate(()=>window.dispatchEvent(new Event('native-close-request')));await closed;assert.equal(closeCalls,1);
 // Only one write may be in flight; the latest selection follows it.
 let releaseWrite;const writeGate=new Promise(r=>releaseWrite=r);
 let sawWrite;const firstWrite=new Promise(r=>sawWrite=r);let writes=0;
 await page.route('**/api/rpc',async route=>{
   if(route.request().postDataJSON().op==='workspace_set'){
     writes++;if(writes===1){sawWrite();await writeGate;}
   }await route.continue();
 });
 await page.getByRole('tab',{name:'노트 탭: '+b.title,exact:true}).click();await firstWrite;await selected(b);
 await page.getByRole('tab',{name:'노트 탭: '+a.title,exact:true}).click();await selected(a);assert.equal(writes,1);
 const lastWrite=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='workspace_set'&&r.request().postDataJSON().active===a.id);
 releaseWrite();await lastWrite;assert.equal((await rpc('workspace_get')).active,a.id);await page.unroute('**/api/rpc');
 await page.getByRole('button',{name:'탭 닫기: '+b.title,exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.note-tabs [role=tab]').length===1);
 for(let i=0;i<100 && (await rpc('workspace_get')).tabs.length!==1;i++)await new Promise(r=>setTimeout(r,50));
 await page.reload();await selected(a);assert.equal(await page.getByRole('tablist',{name:'열린 노트',exact:true}).getByRole('tab').count(),1);
 // A deleted note is filtered without loading its missing body.
 await rpc('workspace_set',{ids:[a.id,b.id],active:b.id});
 await rpc('patch',{id:b.id,changes:{trashed:true}});
 await rpc('delete',{id:b.id});
 await page.reload();await page.getByRole('tab',{name:'노트 탭: '+a.title,exact:true}).waitFor();
 assert.equal(await page.getByRole('tablist',{name:'열린 노트',exact:true}).getByRole('tab').count(),1);
 assert.equal((await rpc('workspace_get')).active,null);
 assert.deepEqual(errors,[]);console.log('PASS: reload/active tab, failed read preservation, restore race, write retry and closed-tab persistence');
}finally{await browser.close();}
