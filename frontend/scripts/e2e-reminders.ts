import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47988';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const lazy=process.env.INKISM_LAZY==='1';
const title='알림 '+Date.now();
const content=lazy?Array.from({length:10000},(_,i)=>'<p>알림 본문 '+i+'</p>').join(''):'<p>알림 본문</p>';
const a=await rpc('save',{note:{title,content,text:'알림 본문',reminder_at:Date.now()-1000}});
const trash=await rpc('save',{note:{title:title+' 휴지통',reminder_at:Date.now()-2000}});
await rpc('patch',{id:trash.id,changes:{trashed:true}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base+(lazy?'/?virtual=1&lazy=1':''));
 const inbox=page.getByRole('complementary',{name:'도래한 노트 알림'});
 await inbox.getByRole('button',{name:/도래한 알림/}).click();
 assert.equal(await inbox.getByRole('button',{name:trash.title,exact:true}).count(),0);
 await inbox.getByRole('button',{name:title,exact:true}).click();
 await page.locator('.note-row.is-selected .note-row-main').click({button:'right'}).then(()=>page.getByRole('menuitem',{name:'알림 설정',exact:true}).click());
 await page.getByRole('form',{name:'노트 알림',exact:true}).getByRole('button',{name:'알림 해제',exact:true}).click();
 await page.getByRole('form',{name:'노트 알림',exact:true}).waitFor({state:'hidden'});
 assert.equal((await rpc('get',{id:a.id})).reminder_at,null);
 await page.locator('.note-row.is-selected .note-row-main').click({button:'right'}).then(()=>page.getByRole('menuitem',{name:'알림 설정',exact:true}).click());
 const field=page.getByLabel('알림 날짜와 시간');
 await field.fill('2001-01-01T12:00');
 await page.getByRole('button',{name:'알림 저장',exact:true}).click();
 await page.getByText('현재보다 뒤의 시간을 선택해 주세요.').waitFor();
 assert.equal((await rpc('get',{id:a.id})).reminder_at,null);
 const future=new Date(Date.now()+3600000);
 const local=new Date(+future-future.getTimezoneOffset()*60000).toISOString().slice(0,16);
 await field.fill(local);
 await page.getByRole("combobox",{name:"알림 반복",exact:true}).selectOption("24");
 let entered,release,saves=0;
 const held=new Promise(r=>entered=r);
 await page.route('**/api/rpc',async route=>{
  const req=route.request().postDataJSON();
  if(['save','document_splice','document_splice_html','document_splice_source'].includes(req.op))saves++;
  if(req.op==='patch' && req.changes?.reminder_at){
   const response=await route.fetch();
   await new Promise(r=>{release=r;entered();});
   return route.fulfill({response});
  }
  return route.continue();
 });
 await page.getByRole('button',{name:'알림 저장',exact:true}).click();
 await held;
 await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 동시입력');
 await new Promise(r=>setTimeout(r,1000));assert.equal(saves,0);
 release();
 await page.getByRole('form',{name:'노트 알림',exact:true}).waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 await page.unroute('**/api/rpc');
 assert.equal((await rpc('get',{id:a.id})).reminder_repeat_hours,24);
 let saved=await rpc('get',{id:a.id});
 assert.equal(saved.reminder_at,new Date(local).getTime());assert.ok(saved.content.includes('동시입력'));
 await page.reload();
 await page.locator('.note-row.is-selected .note-row-main').click({button:'right'}).then(()=>page.getByRole('menuitem',{name:'알림 설정',exact:true}).click());
 assert.equal(await field.inputValue(),local);
 await page.getByRole('form',{name:'노트 알림',exact:true}).getByRole('button',{name:'알림 해제',exact:true}).click();
 await page.getByRole('form',{name:'노트 알림',exact:true}).waitFor({state:'hidden'});
 saved=await rpc('get',{id:a.id});assert.equal(saved.reminder_at,null);assert.ok(saved.content.includes('동시입력'));
 assert.deepEqual(errors,[]);
 console.log('PASS: overdue inbox excludes trash; schedule validation, clear, restart, typing during delayed reminder response preserve content');
}finally{await browser.close();}
