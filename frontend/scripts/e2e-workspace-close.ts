import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47946';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
await rpc('workspace_set',{ids:[],active:null});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();
try {
 let atClose;
 await page.route('**/api/close',async route=>{atClose=await rpc('workspace_get');await route.fulfill({status:200,body:'{}'});});
 await page.goto(base);
 await page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON().op==='workspace_set');
 await page.getByRole('button',{name:'새 노트 만들기',exact:true}).last().click();
 const title='즉시 닫기 '+Date.now();
 await page.locator('.title-input').fill(title);
 await page.locator('.tiptap-prose').fill('닫기 직전 새 노트 본문');
 const closed=page.waitForResponse('**/api/close');
 await page.evaluate(()=>window.dispatchEvent(new Event('native-close-request')));await closed;
 assert.equal(atClose.tabs.length,1,'newly saved note must be in the workspace before native close');
 assert.equal(atClose.tabs[0].title,title);assert.equal(atClose.active,atClose.tabs[0].id);
 await page.reload();await page.waitForFunction(t=>document.querySelector<HTMLInputElement>('.title-input')?.value===t,title);
 assert.equal(await page.locator('.tiptap-prose').textContent(),'닫기 직전 새 노트 본문');
 console.log('PASS: immediately closing a newly created note persists its tab before native close and restores its body');
}finally{await browser.close();}
