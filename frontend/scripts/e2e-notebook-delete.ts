import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47986';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const title='노트북 삭제 '+Date.now(),nb=await rpc('save_notebook',{name:'분류 '+Date.now()});
const content=Array.from({length:10000},(_,i)=>'<p>본문 '+i+' 보존</p>').join('');
const note=await rpc('save',{note:{title,content,text:'본문',notebook_id:nb.id}});
await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-content').waitFor();
 let entered,release;
 const held=new Promise(r=>entered=r);
 if(process.env.INKISM_EXPECT_BROKEN!=='1')await page.route('**/api/rpc',async route=>{
  if(route.request().postDataJSON().op==='delete_notebook'){
   const response=await route.fetch();
   await new Promise(r=>{release=r;entered();});return route.fulfill({response});
  }
  await route.continue();
 });
 await page.getByRole('tab',{name:'노트북',exact:true}).click();await page.getByRole('button',{name:'노트북 '+nb.name+' 옵션',exact:true}).click();
 await page.getByRole('menuitem',{name:'삭제',exact:true}).click();
 await page.getByRole('button',{name:'삭제',exact:true}).click();
 if(process.env.INKISM_EXPECT_BROKEN!=='1'){
  await held;
  await page.locator('.cm-content').first().click();await page.keyboard.press('Control+Home');await page.keyboard.insertText('삭제중입력 ');
  await new Promise(r=>setTimeout(r,1000));release();
 }
 await page.getByRole('button',{name:'노트북 '+nb.name+' 옵션',exact:true}).waitFor({state:'hidden'});
 await page.locator('.cm-content').first().click();await page.keyboard.press('Control+Home');await page.keyboard.insertText('삭제후편집 ');
 await page.keyboard.press('Control+s');
 if(process.env.INKISM_EXPECT_BROKEN==='1'){
  await page.getByRole('button',{name:'다시 저장',exact:true}).waitFor();
  assert.equal((await rpc('get',{id:note.id})).content,content);
  console.log('REPRODUCED: deleting the notebook leaves the open draft unable to save');
 }else{
  await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
  const saved=await rpc('get',{id:note.id});assert.equal(saved.notebook_id,null);assert.ok(saved.content.includes('삭제후편집'));assert.ok(saved.content.includes('삭제중입력'));
  assert.equal(saved.content,'삭제후편집 삭제중입력 '+content);
  assert.ok(saved.revision>=note.revision+2);
  assert.deepEqual(errors,[]);
  console.log('PASS: deleting a notebook preserves its open source draft and subsequent save');
 }
}finally{await browser.close();}
