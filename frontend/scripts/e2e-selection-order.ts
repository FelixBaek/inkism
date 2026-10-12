import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47896';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const title='전환순서 '+Date.now();
const a=await rpc('save',{note:{title:title+' A',content:'<p>처음</p>',text:'처음'}});
const b=await rpc('save',{note:{title:title+' B',content:'<p>둘째</p>',text:'둘째'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();const root=page.locator('.tiptap-prose');
let release,started,finished;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r),handled=new Promise(r=>finished=r);
try {
 await page.goto(base);await page.getByRole('button',{name:'노트 열기: '+a.title,exact:true}).click();await root.waitFor();
 await page.route('**/api/rpc',async route=>{if(/^(document_splice|save$)/.test(route.request().postDataJSON().op)){const response=await route.fetch();started();await gate;await route.fulfill({response});finished();}else await route.continue();});
 await root.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 보존');await page.keyboard.press('Control+s');await ready;
 await page.getByRole('button',{name:'노트 열기: '+b.title,exact:true}).click();
 await page.getByRole('button',{name:'노트 열기: '+a.title,exact:true}).click();
 release();await handled;await page.unroute('**/api/rpc');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
 // Drain the old selection's 25 ms flush waiter as well as React's commit.
 await page.waitForTimeout(100);
 assert.equal(await page.getByLabel('노트 제목',{exact:true}).inputValue(),a.title);
 assert.equal(await root.textContent(),'처음 보존');
 const n=await rpc('get',{id:a.id});await rpc('save',{note:{id:a.id,revision:n.revision,content:'<p>원격 새 내용</p>',text:'원격 새 내용'}});
 await root.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 충돌');await page.keyboard.press('Control+s');
 await page.getByRole('button',{name:'서버 버전으로 교체',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tiptap-prose')?.textContent==='원격 새 내용');
 await root.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 이후편집');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
 assert.equal((await rpc('get',{id:a.id})).content,'<p>원격 새 내용 이후편집</p>');
 // Discarding a conflicting source editor must not flush its last buffered keys
 // back over the explicitly selected server version during unmount.
 await page.getByRole('button',{name:'HTML',exact:true}).click();
 const source=page.locator('.cm-content');await source.waitFor();
 const latest=await rpc('get',{id:a.id});await rpc('save',{note:{id:a.id,revision:latest.revision,content:'<p>원격 원문</p>',text:'원격 원문'}});
 await source.click();await page.keyboard.press('Control+End');await page.keyboard.insertText('<p>로컬</p>');await page.keyboard.press('Control+s');
 await page.getByRole('button',{name:'서버 버전으로 교체',exact:true}).waitFor();
 await source.click();await page.keyboard.insertText('버릴 입력');await page.getByRole('button',{name:'서버 버전으로 교체',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent==='<p>원격 원문</p>');
 assert.equal((await rpc('get',{id:a.id})).content,'<p>원격 원문</p>');
 console.log('PASS: newest selection intent wins during delayed save; server replacement remounts editor and subsequent edits preserve it');
} finally {release?.();await browser.close();}
