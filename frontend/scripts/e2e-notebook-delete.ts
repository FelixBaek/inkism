import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47986';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const title='폴더 삭제 '+Date.now(),nb=await rpc('save_notebook',{name:'분류 '+Date.now()});
const content=Array.from({length:10000},(_,i)=>'<p>본문 '+i+' 보존</p>').join('');
const note=await rpc('save',{note:{title,content,text:'본문',notebook_id:nb.id}});
await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-content').waitFor();
 // 폴더 색·아이콘: ⋮ 메뉴에서 바꾸면 사이드바 줄·상단 경로·폴더 선택 옆 아이콘이 같이 바뀐다.
 const shots=process.env.INKISM_SHOTS,blue='rgb(59, 130, 246)';
 await page.getByRole('tab',{name:'폴더',exact:true}).click();
 const options=()=>page.getByRole('button',{name:'폴더 '+nb.name+' 옵션',exact:true});
 await options().click();await page.getByRole('menuitem',{name:'색 변경',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:'파랑',exact:true}).click();
 await options().click();await page.getByRole('menuitem',{name:'아이콘 변경',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:'기본',exact:true}).waitFor();
 if(shots)await page.screenshot({path:shots+'/folder-icon-menu.png'});
 const sideSvg='.side-row:has(.side-label:text-is("'+nb.name+'")) .side-icon svg';
 const glyph=async sel=>page.locator(sel).first().evaluate(el=>({color:getComputedStyle(el).color,html:el.outerHTML.replace(/ style="[^"]*"/,'')}));
 const before=(await glyph(sideSvg)).html;
 await page.getByRole('menuitemcheckbox',{name:'briefcase',exact:true}).click();
 for(let i=0;i<50&&(await glyph(sideSvg)).html===before;i++)await new Promise(r=>setTimeout(r,100));
 const folderGlyph=await glyph(sideSvg);
 assert.notEqual(folderGlyph.html,before,'sidebar shows the picked icon');assert.equal(folderGlyph.color,blue);
 const listed=(await rpc('notebooks')).find(x=>x.id===nb.id);
 assert.equal(listed.color,'#3b82f6');assert.equal(listed.icon,'briefcase');assert.equal(listed.name,nb.name);
 for(const sel of ['.app-topbar > svg','.meta-select-icon svg']){const g=await glyph(sel);assert.equal(g.color,blue,sel);assert.equal(g.html,folderGlyph.html,sel+' uses the folder icon');}
 if(shots)await page.screenshot({path:shots+'/folder-styled.png'});
 await options().click();await page.getByRole('menuitem',{name:'아이콘 변경',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:'기본',exact:true}).click();
 const reset=async()=>(await rpc('notebooks')).find(x=>x.id===nb.id).icon;
 for(let i=0;i<50&&await reset()!==null;i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(await reset(),null);
 let entered,release;
 const held=new Promise(r=>entered=r);
 if(process.env.INKISM_EXPECT_BROKEN!=='1')await page.route('**/api/rpc',async route=>{
  if(route.request().postDataJSON().op==='delete_notebook'){
   const response=await route.fetch();
   await new Promise(r=>{release=r;entered();});return route.fulfill({response});
  }
  await route.continue();
 });
 await page.getByRole('tab',{name:'폴더',exact:true}).click();await page.getByRole('button',{name:'폴더 '+nb.name+' 옵션',exact:true}).click();
 await page.getByRole('menuitem',{name:'삭제',exact:true}).click();
 await page.getByRole('button',{name:'삭제',exact:true}).click();
 if(process.env.INKISM_EXPECT_BROKEN!=='1'){
  await held;
  await page.locator('.cm-content').first().click();await page.keyboard.press('Control+Home');await page.keyboard.insertText('삭제중입력 ');
  await new Promise(r=>setTimeout(r,1000));release();
 }
 await page.getByRole('button',{name:'폴더 '+nb.name+' 옵션',exact:true}).waitFor({state:'hidden'});
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
