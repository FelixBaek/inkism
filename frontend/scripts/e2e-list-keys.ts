// Note list: search lives in the list column, Delete moves a row to trash, and the context menu shows "Del".
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47831';
const rpc=async(op:string,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const stamp=Date.now(),title='목록 키 '+stamp;
const note=await rpc('save',{note:{title,content:'<p>여백 '+stamp+'</p>',text:'여백 '+stamp}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');});await page.goto(base);
 const row=page.getByRole('button',{name:'노트 열기: '+title,exact:true});await row.waitFor();
 // Search: label + field inside the list column, header and info switch to results.
 await page.evaluate(()=>window.dispatchEvent(new Event('inkism-open-search')));
 await page.locator('.note-list').getByLabel('노트 검색',{exact:true}).fill(String(stamp));
 await page.locator('.note-list .list-title').filter({hasText:'검색 결과'}).waitFor();
 await page.locator('.note-list .list-info').filter({hasText:'1개 검색 결과'}).waitFor();
 await page.locator('.note-list').getByLabel('노트 검색',{exact:true}).press('Escape');
 await page.locator('.note-list .list-title').filter({hasText:'전체 노트'}).waitFor();
 // Context menu shows the Delete shortcut.
 await row.focus();await page.keyboard.press('Shift+F10');
 const trash=page.getByRole('menuitem',{name:/^삭제/});await trash.waitFor();
 assert.equal(await trash.getAttribute('aria-keyshortcuts'),'Delete');assert.match(await trash.innerText(),/Del/);
 await page.keyboard.press('Escape');
 // Delete on the focused row moves it to trash without touching the body.
 await row.focus();await page.keyboard.press('Delete');
 for(let i=0;i<40&&!(await rpc('get',{id:note.id})).trashed;i++)await page.waitForTimeout(100);
 const after=await rpc('get',{id:note.id});assert.equal(after.trashed,true);assert.equal(after.content,note.content);
 await row.waitFor({state:'detached'});
 assert.deepEqual(errors,[]);console.log('PASS list search in column, Delete moves to trash, context menu Del hint');
}finally{await browser.close();}
