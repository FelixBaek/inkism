import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47918';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='전체 복사 '+Date.now();
const content=Array.from({length:10000},(_,i)=>`<p><strong>문단 ${i} 한글😀</strong> &amp; 본문</p>`).join('');
const note=await rpc('save',{note:{title,content,text:Array.from({length:10000},(_,i)=>`문단 ${i} 한글😀 & 본문`).join('\n')}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:960}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const clipboard=()=>page.evaluate(async()=>{const [item]=await navigator.clipboard.read();return {html:await(await item.getType('text/html')).text(),text:await(await item.getType('text/plain')).text()};});
try {
 await page.goto(base+'/?virtual=1');await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.locator('[data-window-start="0"]').waitFor();
 await page.getByRole('button',{name:'문서 전체 복사',exact:true}).click();await page.getByText('문서 전체를 복사했습니다.',{exact:true}).waitFor();
 let copied=await clipboard();assert.ok(copied.html.includes('<strong>문단 9999 한글😀</strong>'));assert.ok(copied.text.includes('문단 9999 한글😀 & 본문'));assert.equal((copied.html.match(/<p>/g)||[]).length,10000);
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 // Unsaved content must be copied even if storage is unavailable.
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='document_splice_html' ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'offline'})}) : route.continue());
 await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('미저장내용 ');await page.keyboard.press('Control+s');await page.getByRole('button',{name:'다시 저장',exact:true}).waitFor();
 await page.getByRole('button',{name:'문서 전체 복사',exact:true}).click();await page.getByText('문서 전체를 복사했습니다.',{exact:true}).waitFor();
 copied=await clipboard();assert.ok(copied.html.includes('미저장내용'));assert.ok(copied.text.includes('미저장내용'));assert.ok(copied.text.includes('문단 9999'));
 assert.equal((await rpc('get',{id:note.id})).content,content);
 // Clipboard refusal must be visible and must not affect the draft or storage.
 await page.evaluate(()=>{navigator.clipboard.write=async()=>{throw new DOMException('denied','NotAllowedError');};});
 await page.getByRole('button',{name:'문서 전체 복사',exact:true}).click();await page.getByText('문서를 복사하지 못했습니다. 창을 활성화한 뒤 다시 시도해 주세요.',{exact:true}).waitFor();
 assert.ok((await page.locator('.tiptap-prose').textContent()).includes('미저장내용'));assert.deepEqual(errors,[]);
 console.log('PASS: whole-document HTML/plain clipboard, unmounted content, unsaved offline draft, bounded DOM and clipboard rejection');
} finally {await browser.close();}
