import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48032';
const rpc=async(op,args={})=>{const r=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto(base);
 // 동기화 도구는 설정 창의 '동기화' 항목 안에 있다.
 const open=async()=>{await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'동기화',exact:true}).click();await page.getByRole('button',{name:'기기 동기화',exact:true}).click();};await open();
 if(!(await rpc('sync_status')).configured){
  await page.getByLabel('서버 주소',{exact:true}).fill('http://127.0.0.1:1');
  await page.getByLabel('접속 토큰',{exact:true}).fill('ui-test-token-not-a-secret-at-least-32-chars');
  await page.getByRole('button',{name:'첫 기기용 키 만들기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll<any>('.sync-dialog input[type="password"]')[1]?.value.length>0);
  await page.getByRole('button',{name:'동기화 연결',exact:true}).click();
 }
 if((await rpc('sync_status')).paused)await page.getByRole('button',{name:'동기화 다시 시작',exact:true}).click();
 await page.getByRole('button',{name:'동기화 일시중지',exact:true}).click();
 await page.getByRole('button',{name:'동기화 다시 시작',exact:true}).waitFor();assert.equal((await rpc('sync_status')).paused,true);
 assert.equal(await page.getByRole('button',{name:'지금 동기화',exact:true}).isDisabled(),true);
 const note=await rpc('save',{note:{title:'중지 중 노트 '+Date.now(),content:'<p>전송 대기 보존</p>',text:'전송 대기 보존'}});
 await page.reload();await open();await page.getByRole('button',{name:'동기화 다시 시작',exact:true}).waitFor();assert.ok((await rpc('sync_status')).pending>0);
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='sync_pause'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'중지 상태 변경 실패'})}):route.continue());
 await page.getByRole('button',{name:'동기화 다시 시작',exact:true}).click();await page.getByRole('alert').filter({hasText:'중지 상태 변경 실패'}).waitFor();assert.equal((await rpc('sync_status')).paused,true);
 await page.unroute('**/api/rpc');await page.getByRole('button',{name:'동기화 다시 시작',exact:true}).click();await page.getByRole('button',{name:'동기화 일시중지',exact:true}).waitFor();assert.equal((await rpc('sync_status')).paused,false);
 assert.equal((await rpc('get',{id:note.id})).content,'<p>전송 대기 보존</p>');
 console.log('PASS: real RPC pause/resume UI, pending preservation, reload, disabled manual sync and failed update');
}finally{await browser.close();}
