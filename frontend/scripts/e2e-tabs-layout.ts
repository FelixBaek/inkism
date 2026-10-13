import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
const base=process.env.INKISM_URL||'http://127.0.0.1:48161';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const notes=[];
for(let i=0;i<18;i++)notes.push(await rpc('save',{note:{title:`탭 폭 회귀 ${Date.now()} ${i}`,content:`<p>본문 ${i}</p>`,text:`본문 ${i}`,tags:[]}}));
await rpc('workspace_set',{ids:notes.map(n=>n.id),active:notes[0].id,locations:{}});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
async function frame(label,mobile=false){
 const data=await p.evaluate(()=>({x:scrollX,sw:document.documentElement.scrollWidth,w:innerWidth,boxes:Object.fromEntries(['.sidebar','.note-list','.editor-pane','.note-tabs'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return[s,{x:r.x,w:r.width,y:r.y}]}))}));
 assert.equal(data.x,0,label+JSON.stringify(data));assert.equal(data.sw,data.w,label+' overflow '+JSON.stringify(data));
 if(mobile)return; // 좁은 화면은 탭 줄 없이 머리줄 하나만 둔다(mobile.css).
 const bar=await p.locator('.workspace-topbar').boundingBox(),editor=await p.locator('.editor-pane').boundingBox(),tabs=await p.locator('.note-tabs').boundingBox();
 if(!mobile){assert.equal(data.boxes['.sidebar'].x,0,label);assert.equal(data.boxes['.note-list'].x,data.boxes['.sidebar'].w,label);assert.equal(editor.x,data.boxes['.sidebar'].w+data.boxes['.note-list'].w,label);}
 assert.equal(bar.x,editor.x,label);assert.equal(bar.width,editor.width,label);
 assert.ok(tabs.width>0&&tabs.x>=bar.x&&tabs.x+tabs.width<=bar.x+bar.width,label+' tabs share the topbar with actions');
 assert.equal(bar.y+bar.height,editor.y,label+' topbar sits above the editor');
}
try{
 await p.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await p.goto(base);await p.getByLabel('노트 제목',{exact:true}).waitFor();await frame('restored workspace');
 let release;
 await p.route('**/api/rpc',async route=>{const body=route.request().postDataJSON();if(body.op==='get'&&body.id===notes.at(-1).id){await new Promise(resolve=>{release=resolve;});}await route.continue();});
 // Hold the actual get response so the loading-state layout is observable.
 await p.getByRole('tab',{name:'노트 탭: '+notes.at(-1).title,exact:true}).click();await p.locator('.editor-empty').waitFor();await frame('loading last tab');
 assert.ok(await p.locator('.note-tabs').evaluate(e=>e.scrollWidth>e.clientWidth),'tabs actually overflow internally');
 while(!release)await new Promise(r=>setTimeout(r,10));release();await p.getByLabel('노트 제목',{exact:true}).waitFor();await frame('loaded last tab');await p.unroute('**/api/rpc');
 for(let i=0;i<2;i++){
   await p.getByRole('tab',{name:'노트 탭: '+notes[0].title,exact:true}).click();await p.waitForFunction(t=>document.querySelector<any>('[aria-label="노트 제목"]')?.value===t,notes[0].title);await frame('first tab');
   await p.getByRole('tab',{name:'노트 탭: '+notes[0].title,exact:true}).focus();await p.keyboard.press('End');await frame('keyboard focus last');await p.keyboard.press('Enter');await p.waitForFunction(t=>document.querySelector<any>('[aria-label="노트 제목"]')?.value===t,notes.at(-1).title);await frame('keyboard selected last');
 }
 await p.reload();await p.getByLabel('노트 제목',{exact:true}).waitFor();await frame('reload');
 await p.setViewportSize({width:412,height:915});await frame('mobile',true);await p.setViewportSize({width:1440,height:900});await frame('desktop resize');
 await p.screenshot({path:process.env.INKISM_LAYOUT_SCREENSHOT||path.join(os.tmpdir(),'inkism-frontend-20261004','layout-fixed.png')});
 assert.deepEqual(errors,[]);console.log('PASS: 18 tabs, delayed loading, first/last navigation, keyboard focus, reload and mobile/desktop resize preserve frame and internal tab scrolling');
}finally{await b.close();}
