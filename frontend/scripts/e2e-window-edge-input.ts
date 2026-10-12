// A local document-edge shortcut must commit the caret before the next input.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.ok(v.ok,v.error);return v.data;};
const source=Array.from({length:4500},(_,i)=>`<p>구간 원문 ${i} 한글 😀 &amp; 본문</p>`).join('');
const note=await rpc('save',{note:{title:'문서 끝 이동 '+Date.now(),content:source}});await rpc('wait_index');
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);const editor=page.locator('.tiptap-prose');await editor.waitFor();
 await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
 await editor.locator('p').nth(4).click();
 let reads=0;
 await page.route('**/api/rpc',async route=>{const req=route.request().postDataJSON();if(req.id===note.id&&req.op==='document_blocks'){reads++;await new Promise(r=>setTimeout(r,150));}await route.continue();});
 await page.keyboard.press('Control+Home');await page.keyboard.insertText('처음😀 ');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>!!document.querySelector('.status-save.ok'));
 const firstSaved=(await rpc('get',{id:note.id})).content;
 const firstTag=firstSaved.match(/^<p id="ink-block-[a-f0-9-]+">/)?.[0];assert.ok(firstTag,'the edited first block gets an identity');
 let expected=source.replace('<p>',firstTag+'처음😀 ');
 assert.equal((await rpc('get',{id:note.id})).content,expected,'typing immediately after Ctrl+Home must land at document start');
 assert.equal(reads,0,'already mounted document start must not reload');
 await page.unroute('**/api/rpc');
 await page.getByLabel('이동할 블록 번호').fill('4469');await page.getByRole('button',{name:'이동',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='4468');
 await editor.locator('p').first().click();
 await page.keyboard.press('Control+End');await page.keyboard.insertText(' 마지막😀');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>!!document.querySelector('.status-save.ok'));
 const lastSaved=(await rpc('get',{id:note.id})).content;const lastTag=lastSaved.match(/<p id="ink-block-[a-f0-9-]+">[^<]* 마지막😀<\/p>$/)?.[0].split('>')[0]+'>';assert.match(lastTag,/^<p id="ink-block-[a-f0-9-]+">$/);
 expected=expected.slice(0,expected.lastIndexOf('<p>'))+expected.slice(expected.lastIndexOf('<p>')).replace('<p>',lastTag).slice(0,-4)+' 마지막😀</p>';
 assert.equal((lastSaved.match(/ id="ink-block-/g)||[]).length,2,'untouched 4498 blocks must not acquire IDs');
 assert.equal((await rpc('get',{id:note.id})).content,expected,'typing immediately after Ctrl+End must land at document end');
 console.log('PASS: local Ctrl+Home/End commit the caret before immediate typing and preserve the entire large source');
}catch(error){console.error(await page.locator('.status-save').allTextContents());throw error;}finally{await browser.close();}
