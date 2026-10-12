import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:48006';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const initial='<p>일반 <strong>리치 본문</strong></p>';
const a=await rpc('save',{note:{title:'리치 이력 A '+Date.now(),content:initial,text:'원문'}});
const b=await rpc('save',{note:{title:'리치 이력 B '+Date.now(),content:'<p>다른 노트</p>',text:'다른 노트'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const open=async n=>{await page.getByRole('button',{name:'노트 열기: '+n.title,exact:true}).click();await page.waitForFunction(t=>document.querySelector<any>('.title-input')?.value===t,n.title);};
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
const roundtrip=async()=>{await page.reload();await page.locator('.tiptap-prose').waitFor();await page.locator('.tiptap-prose').focus();};
const insert=async text=>{await page.locator('.tiptap-prose').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText(text);await page.keyboard.press('Control+s');await saved();};
const key=async k=>{await page.locator('.tiptap-prose').focus();await page.keyboard.press(k);await page.keyboard.press('Control+s');await saved();};
try{
 await rpc('workspace_set',{ids:[a.id,b.id],active:a.id,locations:{}});await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base+'/?virtual=1&lazy=1');await page.getByRole('button',{name:'텍스트',exact:true}).click();await page.locator('.tiptap-prose').waitFor();
 await insert('첫 편집😀');const edited=(await rpc('get',{id:a.id})).content;
 await page.getByRole('button',{name:'텍스트',exact:true}).click(); // active mode is a no-op
 await roundtrip();await historyKey(page,'undo');
 if(process.env.INKISM_EXPECT_BROKEN==='1'){
  await page.waitForTimeout(1000);assert.equal((await rpc('get',{id:a.id})).content,edited);
  console.log('REPRODUCED: rich undo is lost after switching tabs');
 }else{
  await page.keyboard.press('Control+s');await saved();assert.equal((await rpc('get',{id:a.id})).content,initial);
  await roundtrip();await historyKey(page,'redo');await page.keyboard.press('Control+s');await saved();assert.equal((await rpc('get',{id:a.id})).content,edited);
  await roundtrip();await insert('둘째 편집');await key('Control+z');
  assert.equal((await rpc('get',{id:a.id})).content,edited,'edits across mounts must not merge');
  await page.locator('.note-row.is-selected .note-row-main').click({button:'right'}).then(()=>page.getByRole('menuitem',{name:'알림 설정',exact:true}).click());await page.getByLabel('알림 날짜와 시간').fill('2030-01-01T12:00');await page.getByRole('button',{name:'알림 저장',exact:true}).click();await page.getByRole('form',{name:'노트 알림',exact:true}).waitFor({state:'hidden'});
  await roundtrip();await key('Control+z');assert.equal((await rpc('get',{id:a.id})).content,initial);assert.notEqual((await rpc('get',{id:a.id})).reminder_at,null);
  await open(b);const current=await rpc('get',{id:a.id});const remote=current.content+'<p>원격 추가</p>';
  await rpc('save',{note:{id:a.id,revision:current.revision,content:remote,text:'원격 추가'}});
  await open(a);await page.locator('.tiptap-prose').waitFor();await page.locator('.tiptap-prose').focus();await page.keyboard.press('Control+z');await page.waitForTimeout(1000);
  assert.equal((await rpc('get',{id:a.id})).content,remote);
  assert.deepEqual(errors,[]);console.log('PASS: rich undo/redo across restarts, separate edit groups, metadata revisions, remote invalidation');
 }
}finally{await browser.close();}
