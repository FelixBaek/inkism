// Actual ReminderEditor component; explicit Windows API fixture, no native task/notification calls.
import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=fileURLToPath(new URL('..',import.meta.url));
const cacheDir=await mkdtemp(join(tmpdir(),'inkism-reminder-contract-'));
// Only the unrelated note store is stubbed; the shipped settings component is unchanged.
const server=await createServer({root,cacheDir,server:{host:'127.0.0.1',port:48973,strictPort:false},plugins:[{name:'reminder-contract-harness',enforce:'pre',resolveId(source,importer){if(source==='../store'&&importer?.endsWith('/components/Reminders.tsx'))return '\0reminder-test-store';},load(id){if(id==='\0reminder-test-store')return 'export function useStore(){return {note:null,setReminder(){throw new Error("Note mutation outside fixture scope")}}}';},configureServer(vite){
vite.middlewares.use('/__reminder-contract',async(req,res,next)=>{
 if(req.url.includes('html-proxy'))return next();
 try {
  const html=await vite.transformIndexHtml('/__reminder-contract',`<div id="root"></div><script type="module">
   import React from 'react';
   import {createRoot} from 'react-dom/client';
   import {ReminderEditor} from '/src/components/Reminders.tsx';
   createRoot(document.getElementById('root')).render(React.createElement(ReminderEditor,{id:'synthetic-note',at:null,disabled:false}));
  </script>`);
  res.setHeader('Content-Type','text/html');res.end(html);
 } catch(error){next(error);}
});
}}]});
await server.listen();
const base=`http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const waitFor=async(test,message)=>{for(let i=0;i<100;i++){if(await test())return;await new Promise(r=>setTimeout(r,25));}throw new Error(message);};
const errors=[];
async function fixture(initial){
 const page=await browser.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/api/security/status',route=>route.fulfill({json:{enabled:false,locked:false}}));
 let state={...initial},getCount=0,posts=[],fail='',hold=null;
 await page.route('**/api/reminders/settings*',async route=>{
  if(route.request().method()==='GET'){getCount++;return route.fulfill({json:state});}
  const value=route.request().postDataJSON();posts.push(value);
  if(hold)await hold;
  if(fail)return route.fulfill({status:503,json:{error:fail}});
  state={...state,...value};if(value.enabled===false)state.background=false;
  return route.fulfill({json:{ok:true}});
 });
 await page.goto(base+'/__reminder-contract');
 await page.getByRole('button',{name:'노트 알림 설정',exact:true}).click({timeout:10000});
 await waitFor(()=>getCount>0,'GET fixture not requested');
 return {page,posts,get state(){return state;},set fail(v){fail=v;},set hold(v){hold=v;}};
}
try{
 const absent=await fixture({available:false});
 assert.equal(await absent.page.getByRole('switch').count(),0,'unavailable controls must be hidden');
 await absent.page.close();
 const limited=await fixture({available:true,enabled:false,background_available:false});
 await limited.page.getByRole('switch',{name:'시스템 알림 켜기',exact:true}).waitFor();
 assert.equal(await limited.page.getByRole('switch').count(),1,'unsupported background control hidden');
 await limited.page.close();
 const f=await fixture({available:true,enabled:false,background:false,background_available:true});
 const master=f.page.getByRole('switch',{name:'시스템 알림 켜기',exact:true});
 const background=f.page.getByRole('switch',{name:'앱이 닫히거나 잠겨 있어도 알림 받기',exact:true});
 await master.waitFor();assert.equal(await master.isChecked(),false);assert.equal(await background.isChecked(),false);assert.equal(await background.isDisabled(),true);
 await master.click();await waitFor(()=>master.isChecked(),'enable master confirmed');
 await waitFor(async()=>!await background.isDisabled(),'dependent control enabled');
 assert.deepEqual(f.posts,[{enabled:true}]);
 let release;f.hold=new Promise(resolve=>release=resolve);
 await background.click();await waitFor(()=>f.posts.length===2,'background request');
 assert.equal(await master.isDisabled(),true);assert.equal(await background.isDisabled(),true);
 const box=await background.boundingBox();for(let i=0;i<4;i++)await f.page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 assert.equal(f.posts.length,2,'busy repeat clicks must not submit again');
 release();f.hold=null;await waitFor(()=>background.isChecked(),'background enable confirmed');
 await waitFor(async()=>!await master.isDisabled(),'request settled');
 f.fail='합성 작업 해제 실패';await background.click();
 await f.page.getByRole('alert').filter({hasText:'합성 작업 해제 실패'}).waitFor();
 await waitFor(async()=>!await master.isDisabled(),'failed request settled');
 assert.equal(await background.isChecked(),true,'failed POST keeps last confirmed state');assert.equal(f.state.background,true);
 f.fail='';await background.click();await waitFor(async()=>!await background.isChecked(),'retry off confirmed');
 assert.equal(await f.page.getByRole('alert').count(),0,'retry clears error');
 await background.click();await waitFor(()=>background.isChecked(),'re-enable');
 await waitFor(async()=>!await master.isDisabled(),'re-enable settled');
 await master.click();await waitFor(async()=>!await master.isChecked(),'master off confirmed');
 assert.equal(await background.isChecked(),false);assert.equal(await background.isDisabled(),true);
 assert.deepEqual(f.posts,[{enabled:true},{background:true},{background:false},{background:false},{background:true},{enabled:false}]);
 await f.page.close();assert.deepEqual(errors,[]);
 console.log('PASS actual ReminderEditor: unavailable/unsupported hidden, default off, dependent disable, busy duplicate suppression, POST failure preserves confirmed state+error, retry, master off (Windows API fixture only; no OS actions)');
}finally{await browser.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}
