import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47930';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='직접 구간 저장 '+Date.now();
const html=Array.from({length:10000},(_,i)=>`<p><strong>한글😀 ${i}</strong> 본문</p>`).join('');
const note=await rpc('save',{note:{title,content:html,text:'원본'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[],workers=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('worker',w=>workers.push(w.url()));
const at=offset=>page.waitForFunction(offset=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(offset),offset);
// Lazy paged editing is the default since db114d4 and saves through document_splice_html edits batches.
// This script covers the direct (non-lazy) window splice path, i.e. a launch with --experimental-lazy-editor=false.
await page.route('**/api/info',async route=>{const response=await route.fetch();route.fulfill({response,json:{...await response.json(),lazy_editor:false}});});
try {
 await page.goto(base+'/?virtual=1');await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await at(0);
 await page.getByLabel('이동할 블록 번호').fill('3201');await page.getByRole('button',{name:'이동',exact:true}).click();await at(3200);
 let arrived,release;const received=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);
 await page.route('**/api/rpc',async route=>{
  const body=route.request().postDataJSON();
  if(body.op!=='document_splice_html'){await route.continue();return;}
  requests.push(body);const response=await route.fetch();
  if(requests.length===1){arrived();await gate;}
  await route.fulfill({response});
 });
 await page.getByLabel('노트 제목').fill(title+' 함께 수정');
 await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('첫편집 ');await page.keyboard.press('Control+s');await received;
 // Continue typing while an earlier snapshot is already committed but its response is delayed.
 await page.keyboard.insertText('추가편집 ');await page.keyboard.press('Control+s');release();
 await page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
 assert.equal(requests[0].metadata.title,title+' 함께 수정');assert.equal(requests[1].metadata,undefined);
 assert.equal(requests.length,2);assert.equal(requests[1].revision,requests[0].revision+1);
 assert.equal(requests[1].content.expected,requests[0].content.replacement);
 const expectedStart=Buffer.byteLength(html.slice(0,html.indexOf('<p><strong>한글😀 3200')));
 assert.equal(requests[0].content.start,expectedStart);assert.equal(requests[1].content.start,expectedStart);
 assert.equal((requests[0].content.expected.match(/<p>/g)||[]).length,32);
 assert.equal(workers.some(url=>/\/(splice|plaintext)\.worker-/.test(url)),false);
 const saved=await rpc('get',{id:note.id});assert.equal(saved.title,title+' 함께 수정');assert.equal(saved.content,html.replace('한글😀 3200</strong>','첫편집 추가편집 한글😀 3200</strong>'));
 // Another save in the same window must keep using the latest accepted window.
 await page.keyboard.insertText('세번째 ');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
 assert.equal(requests.length,3);assert.equal(requests[2].content.expected,requests[1].content.replacement);
 assert.equal(workers.some(url=>/\/(splice|plaintext)\.worker-/.test(url)),false);assert.deepEqual(errors,[]);
 console.log('PASS: exact UTF-8 cached position, repeated direct window saves and typing during delayed response without whole-document diff/text workers');
} finally {await browser.close();}
