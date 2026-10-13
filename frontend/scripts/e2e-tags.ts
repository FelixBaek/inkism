import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47984';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const stamp=Date.now(),old='이전'+stamp,target='통합'+stamp,title='태그 '+stamp;
const html=Array.from({length:10000},(_,i)=>'<p>태그 본문 '+i+'</p>').join('');
const a=await rpc('save',{note:{title,content:html,text:'태그',tags:[old,target]}});
const b=await rpc('save',{note:{title:title+' 지운 노트',content:'<p>보존</p>',text:'보존',tags:[old]}});
await rpc('patch',{id:b.id,changes:{trashed:true}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-content').waitFor();
 let entered,release,bodySaves=0;
 const held=new Promise(r=>entered=r);
 await page.route('**/api/rpc',async route=>{
  const req=route.request().postDataJSON();
  if(req.op==='document_splice_source')bodySaves++;
  if(req.op==='tag_change_apply'){
   const response=await route.fetch();
   await new Promise(r=>{release=r;entered();});
   return route.fulfill({response});
  }
  await route.continue();
 });
 await page.getByRole('tab',{name:'태그',exact:true}).click();await page.getByRole('button',{name:'태그 '+old+' 옵션',exact:true}).click();
 await page.getByRole('menuitem',{name:'이름 변경',exact:true}).click();
 await page.getByLabel('태그 이름',{exact:true}).fill(target);
 await page.getByRole('button',{name:'변경',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'태그 변경 미리보기와 기록',exact:true});
 await dialog.getByRole('button',{name:'확인한 태그 변경 적용',exact:true}).click();
 await held;
 // Dispatch a real CodeMirror transaction while the modal intentionally owns
 // focus, reproducing an input that was queued before metadata acknowledgement.
 await page.locator('.cm-content').first().evaluate((el:any)=>{const view=el.cmTile?.root?.view||el.cmView?.view;if(!view)throw Error('CodeMirror view unavailable');view.dispatch({changes:{from:0,insert:'동시입력 '}});});
 await new Promise(r=>setTimeout(r,1000));
 assert.equal(bodySaves,0,'autosave must wait until tag revision is acknowledged');
 release();
 await dialog.getByRole('status').filter({hasText:'태그를 변경했습니다'}).waitFor();
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 const deadline=Date.now()+10000;let saved;
 while(Date.now()<deadline){saved=await rpc('get',{id:a.id});if(saved.content==='동시입력 '+html)break;await new Promise(r=>setTimeout(r,100));}
 await page.unroute('**/api/rpc');
 assert.equal(saved.content,'동시입력 '+html,'all source bytes survive the metadata revision rebase');assert.ok(bodySaves>0);
 assert.deepEqual(saved.tags,[target]);assert.ok(saved.content.includes('동시입력'));
 assert.deepEqual((await rpc('get',{id:b.id})).tags,[target]);
 await page.getByRole('button',{name:'태그 '+target+' 옵션',exact:true}).click();
 await page.getByRole('menuitem',{name:'태그 제거',exact:true}).click();
 await dialog.getByRole('button',{name:'확인한 태그 변경 적용',exact:true}).click();
 await dialog.getByRole('status').filter({hasText:'태그를 변경했습니다'}).waitFor();await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'태그 '+target+' 옵션',exact:true}).waitFor({state:'hidden'});
 assert.deepEqual((await rpc('get',{id:a.id})).tags,[]);
 assert.equal((await rpc('get',{id:a.id})).content,saved.content);
 assert.deepEqual((await rpc('get',{id:b.id})).tags,[]);
 assert.deepEqual(errors,[]);
 console.log('PASS: merge/remove tags across live and trashed notes; typing during delayed metadata acknowledgement remains saved');
}finally{await browser.close();}
