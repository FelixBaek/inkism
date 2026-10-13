import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47940';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const prefix='탭 검사 '+Date.now();const a=await rpc('save',{note:{title:prefix+' A',content:'<p>A 원문</p>',text:'A 원문'}}),b=await rpc('save',{note:{title:prefix+' B',content:'<p>B 원문</p>',text:'B 원문'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
// 보통 클릭은 미리보기 탭 하나를 재사용한다. 이 검사는 탭을 여럿 열므로 Ctrl+클릭(새 탭)으로 연다.
const open=async note=>{await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click({modifiers:['Control']});await page.waitForFunction(title=>document.querySelector<any>('.title-input')?.value===title,note.title);};
const tabs=()=>page.getByRole('tablist',{name:'열린 노트',exact:true}).getByRole('tab');// 사이드바 구분 탭(메뉴·노트북·태그)은 세지 않는다.
const tab=note=>page.getByRole('tab',{name:'노트 탭: '+note.title,exact:true});
const close=note=>page.getByRole('button',{name:'탭 닫기: '+note.title,exact:true}).click();
try {
 await rpc('workspace_set',{ids:[],active:null});
 await page.goto(base);await open(a);await open(b);assert.equal(await tabs().count(),2);assert.equal(await tab(b).getAttribute('aria-selected'),'true');
 await page.route('**/api/rpc',route=>['save','document_splice','document_splice_html','document_splice_source','patch'].includes(route.request().postDataJSON().op)?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'offline'})}):route.continue());
 await page.locator('.tiptap-prose').fill('B 미저장 보존');await close(b);await page.getByRole('button',{name:'다시 저장',exact:true}).waitFor();
 assert.equal(await tabs().count(),2);assert.equal(await tab(b).getAttribute('aria-selected'),'true');assert.equal(await page.locator('.tiptap-prose').textContent(),'B 미저장 보존');assert.equal((await rpc('get',{id:b.id})).content,'<p>B 원문</p>');
 const rejected=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.status()===503);
 await tab(a).click();await rejected;await page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('저장 실패'));assert.equal(await tab(b).getAttribute('aria-selected'),'true');
 await page.unroute('**/api/rpc');await page.keyboard.press('Control+s');await waitSaved(page);
 await tab(b).focus();await page.keyboard.press('ArrowLeft');assert.equal(await tab(a).evaluate((el: any)=>el===document.activeElement),true);await page.keyboard.press('Enter');await page.waitForFunction(title=>document.querySelector<any>('.title-input')?.value===title,a.title);
 assert.equal(await page.locator('.tiptap-prose').count(),1);assert.equal(await page.locator('.tiptap-prose').textContent(),'A 원문');
 await page.screenshot({path:'/tmp/inkism-tabs-desktop.png'});
 // Keyboard closing an inactive tab preserves the active note and focus.
 await tab(a).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Delete');await tab(b).waitFor({state:'detached'});assert.equal(await tab(a).evaluate(el=>el===document.activeElement),true);
 await open(b);assert.equal(await page.locator('.tiptap-prose').textContent(),'B 미저장 보존');await close(b);await tab(b).waitFor({state:'detached'});assert.equal(await tab(a).getAttribute('aria-selected'),'true');
 await page.setViewportSize({width:1000,height:720});await page.screenshot({path:'/tmp/inkism-tabs-compact.png'});
 await close(a);await page.getByText('노트를 선택하세요',{exact:true}).waitFor();assert.equal(await tabs().count(),0);
 // Note actions live in the note row menu: move to trash, then delete permanently from the trash view.
 const rowMenu=async(note,item)=>{await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await open(a);await rowMenu(a,'휴지통으로 옮기기');
 await page.locator('.side-item',{hasText:'휴지통'}).click();await rowMenu(a,'영구 삭제');await page.getByRole('dialog').getByRole('button',{name:'영구 삭제',exact:true}).click();
 await tab(a).waitFor({state:'detached'});assert.equal(await tabs().count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: session tabs, save-failure switch/close retention, inactive keyboard close/focus, persisted body and final-tab empty state');
} catch(e){console.error(await page.evaluate(()=>({title:document.querySelector<any>('.title-input')?.value,status:document.querySelector<any>('.status-save')?.textContent,tabs:[...document.querySelectorAll('.note-tabs [role=tab]')].map(el=>({name:el.textContent,selected:el.getAttribute('aria-selected')}))})));throw e;} finally {await browser.close();}
