import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48036';
const rpc=async(op,args={})=>{const r=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1360,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Native picker/copy are separately covered by Go and Windows integration.
 // Here only that host boundary is substituted; saves use the real Rust engine.
 await page.route('**/api/info',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({json:{...data,native_encrypted_copy:true,native_open_library:true}});});
 let calls=0,mode='success',release;
 let openCalls=0,openMode='cancel';
 await page.route('**/api/storage/open',async route=>{
  openCalls++;assert.deepEqual(route.request().postDataJSON(),{});
  assert.ok((await rpc('get',{id:note.id})).content.includes('저장확인'));
  await route.fulfill({status:openMode==='failure'?500:200,json:openMode==='failure'?{ok:false,error:'저장소 선택 실패 시험'}:{ok:true,data:{cancelled:openMode==='cancel'}}});
 });
 const path='C:\\내 노트\\'+'긴폴더'.repeat(35)+'\\notes.db';
 const note=await rpc('save',{note:{title:'암호화 UI '+Date.now(),content:'<p>원문</p>',text:'원문'}});
 await page.route('**/api/storage/encrypted-copy',async route=>{
  calls++;assert.deepEqual(route.request().postDataJSON(),{});
  assert.ok((await rpc('get',{id:note.id})).content.includes('저장확인'));
  await new Promise(r=>{release=r;});
  await route.fulfill({status:mode==='failure'?500:200,json:mode==='failure'?{ok:false,error:'복사 실패 시험: 원본 유지'}:{ok:true,data:{cancelled:mode==='cancel',path:mode==='cancel'?'':path}}});
 });
 // 이 기기의 저장 보호는 설정 화면의 '동기화' 안에 펼쳐져 있다.
 const openSync=async()=>{await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'동기화',exact:true}).click();};
 const closeSync=async()=>{await page.getByRole('button',{name:'설정 닫기',exact:true}).click();};
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();
 // HTML notes open in the rich view; the source editor is the explicit HTML view.
 await page.getByRole('button',{name:'HTML',exact:true}).click();
 await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 저장확인');
 await openSync();
 const button=page.getByRole('button',{name:'암호화 사본 만들기',exact:true});
 const waitHost=async()=>{for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,30));assert.ok(release,'host was not called');};
 await button.click();await waitHost();
 await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('dialog.settings-dialog').evaluate((e:HTMLDialogElement)=>e.open),true,'copy in progress keeps settings open');
 assert.equal(calls,1);release();release=null;
 await page.getByText('암호화 사본을 만들었습니다.',{exact:false}).waitFor();
 assert.equal(await page.locator('.sync-settings').evaluate(e=>e.scrollWidth<=e.clientWidth),true,'long destination overflows');
 await page.screenshot({path:process.env.INKISM_SCREENSHOT||'/tmp/inkism-copy-ui.png'});
 mode='cancel';await button.click();await waitHost();release();release=null;await page.getByText('폴더 선택을 취소했습니다.',{exact:true}).waitFor();
 mode='failure';await button.click();await waitHost();release();release=null;await page.getByText('복사 실패 시험: 원본 유지',{exact:true}).waitFor();
 const openButton=page.getByRole('button',{name:'다른 저장소 열기',exact:true});
 await openButton.click();await page.getByText('저장소 선택을 취소했습니다.',{exact:true}).waitFor();
 openMode='failure';await openButton.click();await page.getByText('저장소 선택 실패 시험',{exact:true}).waitFor();
 assert.equal(openCalls,2);
 await closeSync();
 // A failed draft save must prevent even opening the native picker.
 await page.route('**/api/rpc',async route=>{if(['save','patch','document_splice','document_splice_html','document_splice_source'].includes(route.request().postDataJSON().op))return route.fulfill({json:{ok:false,error:'저장 실패 시험'}});await route.continue();});
 await page.locator('.cm-content').click();await page.keyboard.insertText(' 미저장');
 await openSync();await button.click();
 await page.getByText('작성 내용을 저장하지 못했습니다.',{exact:false}).waitFor();assert.equal(calls,3);
 await openButton.click();await page.getByText('작성 내용을 저장하지 못했습니다.',{exact:false}).waitFor();assert.equal(openCalls,2);
 await closeSync();
 assert.ok((await page.locator('.cm-content').textContent()).includes('미저장'));
 assert.ok(!(await rpc('get',{id:note.id})).content.includes('미저장'));
 assert.deepEqual(errors,[]);
 console.log('PASS: encrypted-copy UI saves first, blocks duplicate/close, handles cancel/failure, preserves failed drafts and long paths');
}finally{await browser.close();}
