import {chromium} from './browser-env.ts';
import {trackSaves} from './save-state.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47890';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const title='10만 서식 블록 '+Date.now();
const blocks=Array.from({length:100000},(_,i)=>`<p><strong>한글😀 ${i}</strong> 본문</p>`);
const note=await rpc('save',{note:{title,content:blocks.join(''),text:'한글'}});await rpc('wait_index');
const other=await rpc('save',{note:{title:'이동 검사 '+Date.now(),content:'<p>다른 노트</p>',text:'다른 노트'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');const panel=page.getByTestId('windowed-rich-editor');
const saves=trackSaves(page),saved=()=>saves.saved();
const jump=async n=>{await page.getByLabel('이동할 블록 번호').fill(String(n));await page.getByRole('button',{name:'이동',exact:true}).click();await page.waitForFunction(offset=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(offset),n-1);};
try {
 await page.goto(base+'/?virtual=1');await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await panel.waitFor();await editor.waitFor();
 assert.equal(await editor.locator(':scope > p').count(),32);assert.equal(await editor.locator('strong').first().textContent(),'한글😀 0');
 const nodes=await page.locator('*').count();assert.ok(nodes<1500,`DOM count ${nodes}`);
 // A composition session pins its editor even when navigation is requested.
 await editor.dispatchEvent('compositionstart');
 await page.getByLabel('이동할 블록 번호').fill('65');await page.getByRole('button',{name:'이동',exact:true}).click();
 assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'),'0');
 await editor.dispatchEvent('compositionend');await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='64');
 await jump(50001);assert.equal(await editor.locator('strong').first().textContent(),'한글😀 50000');assert.equal(await editor.locator(':scope > p').count(),32);
 await editor.locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('수정된한글 ');await page.keyboard.press('Control+s');await saved();
 let stored=await rpc('get',{id:note.id});assert.ok(stored.content.startsWith(blocks.slice(0,50000).join('')));assert.ok(stored.content.includes('수정된한글'));assert.ok(stored.content.endsWith(blocks.slice(50032).join('')));assert.ok(stored.text.includes('수정된한글'));
 // Moving away flushes an unsaved local edit through the shared save queue.
 await page.keyboard.insertText('전환보존 ');await page.getByRole('button',{name:'노트 열기: '+other.title,exact:true}).click();await page.waitForFunction(title=>document.querySelector<any>('.title-input')?.value===title,other.title);await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await editor.waitFor();await jump(50001);assert.ok((await editor.textContent()).includes('전환보존'));
 // A scrollbar jump must replace the mounted window, not accumulate old DOM.
 await page.locator('.window-scroll').evaluate((el: any)=>{el.scrollTop=80000*48;});
 await page.waitForFunction(()=>Number(document.querySelector('[data-window-start]')?.getAttribute('data-window-start'))>=79968);
 assert.ok(await editor.locator(':scope > p').count()<=32);assert.ok(await page.locator('*').count()<1500);
 // Failed save prevents a window switch and keeps the current edited content.
 stored=await rpc('get',{id:note.id});await rpc('save',{note:{id:note.id,revision:stored.revision,title:title+' 원격'}});
 const offset=await page.locator('[data-window-start]').getAttribute('data-window-start');
 await editor.locator('p').first().click();await page.keyboard.insertText('충돌보존');
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'현재 구간을 유지'}).waitFor();
 assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'),offset);assert.ok((await editor.textContent()).includes('충돌보존'));
 assert.equal((await rpc('get',{id:note.id})).content.includes('충돌보존'),false);
 await page.getByRole('button',{name:'서버 버전으로 교체',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='0');assert.equal((await editor.textContent()).includes('충돌보존'),false);
 assert.deepEqual(errors,[]);console.log(`PASS: 100k formatted blocks, 32 mounted, ${nodes} DOM nodes, mid-document save/reopen, scroll-window replacement, transition flush and conflict retention`);
} catch (e) { console.error('page errors',errors);console.error('server', (await rpc('get',{id:note.id})).content.length);console.error(await page.evaluate(()=>({url:location.href,title:document.querySelector<any>('.title-input')?.value,body:document.body.innerText.slice(-1800),scroll: document.querySelector('.window-scroll')?.scrollTop, start:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),error:document.querySelector('.window-error')?.textContent, controls:document.querySelector('.window-controls')?.textContent}))); throw e; } finally {await browser.close();}
