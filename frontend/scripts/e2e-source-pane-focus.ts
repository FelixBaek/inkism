import {waitForPredicate} from './wait-for-predicate.ts';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL||'http://127.0.0.1:48305';
const rpc=async(op,args={})=>{
 const value=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const a=await rpc('save',{note:{title:'느린 왼쪽 '+Date.now(),content:'<p>왼쪽</p>',content_format:'html'}});
const b=await rpc('save',{note:{title:'활성 오른쪽 '+Date.now(),content:'<p>오른쪽</p>',content_format:'html'}});
const location={kind:'source',revision:a.revision,offset:0,scrollTop:0,selection:{ranges:[{anchor:0,head:0}],main:0}};
await rpc('workspace_set',{ids:[a.id],active:a.id,locations:{[a.id]:location}});
await rpc('split_set',{id:b.id,ids:[b.id],mode:'source',locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 let release,entered;const pending=new Promise(resolve=>entered=resolve);
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(request.op==='get'&&request.id===a.id){
   const response=await route.fetch();await new Promise(resolve=>{release=resolve;entered();});return route.fulfill({response});
  }
  return route.continue();
 });
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.split.mode','source');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await pending;
 const right=page.locator('.split-secondary'),left=page.locator('.split-primary');
 await right.locator('.cm-content').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 먼저');
 release();await left.locator('.cm-content').waitFor();
 // Wait through CodeMirror's deferred measurement, when the old implementation
 // focuses its newly mounted primary view even though the user is in the other pane.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('.split-secondary'))),true,'late primary cursor restoration must not steal the secondary editor focus');
 await page.keyboard.insertText(' 이어서');await right.getByRole('button',{name:'분할 저장',exact:true}).click();
 await waitForPredicate(async()=>(await rpc('get',{id:b.id})).content==='<p>오른쪽</p> 먼저 이어서','분할 입력의 실제 저장을 기다리는 시간이 초과됐습니다.');
 assert.equal((await rpc('get',{id:a.id})).content,a.content);assert.deepEqual(errors,[]);
 console.log('PASS: delayed primary source restore keeps focus and subsequent typing in the secondary pane; both saved bodies exact');
}finally{await browser.close();}
