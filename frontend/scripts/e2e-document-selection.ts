import {chromium} from './browser-env.ts';
import {trackSaves} from './save-state.ts';
import assert from 'node:assert/strict';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:48117';
const api=process.env.INKISM_API_URL||(process.env.INKISM_URL?base:'http://127.0.0.1:48118');
const rpc=async(op,args={})=>{const r=await fetch(api+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:960}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const title='전체 선택 검사 '+Date.now();
const content=Array.from({length:10000},(_,i)=>`<p><strong>블록 ${i}</strong> 한글😀</p>`).join('');
const note=await rpc('save',{note:{title,content,text:'선택'}});await rpc('wait_index');
const saves=trackSaves(page),saved=()=>saves.saved();
const formatted=()=>page.waitForFunction(()=>!document.querySelector<any>('.window-error')&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const focus=()=>page.locator('.tiptap-prose').evaluate((el: any)=>{el.editor.view.focus();});
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await page.locator('[data-window-start="0"]').waitFor();await focus();
 await page.keyboard.press('Control+a');await page.getByText('문서 전체 선택됨',{exact:false}).waitFor();
 await page.keyboard.press('Control+c');
 await waitForPredicate(()=>page.evaluate(async()=>(await navigator.clipboard.readText()).includes('블록 9999')),'full clipboard did not arrive');
 await page.waitForFunction(()=>!document.querySelector<any>('.window-controls button:last-child')?.disabled);
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 // A capability check must not run the asynchronous whole-document command.
 await page.locator('.tiptap-prose').evaluate((el: any)=>el.editor.can().toggleHeading({level:1}));
 assert.equal((await rpc('get',{id:note.id})).content,content);
 // Structural formatting must reach all 10,000 blocks while the DOM stays bounded.
 await page.locator('.tiptap-prose').evaluate((el: any)=>el.editor.commands.toggleHeading({level:1}));
 await formatted();await saved();
 let headings=(await rpc('get',{id:note.id})).content;
 const headingIds=assertBlockBytes(headings,content.replaceAll('<p>','<h1>').replaceAll('</p>','</h1>'),{added:10000,message:'all selected headings receive identities'});
 assert.equal(await page.locator('.tiptap-prose h1').count(),32);
 await focus();await page.keyboard.press('Control+a');
 await page.locator('.tiptap-prose').evaluate((el: any)=>el.editor.commands.toggleHeading({level:1}));
 await formatted();await saved();
 assertBlockBytes((await rpc('get',{id:note.id})).content,content,{added:10000,ids:headingIds,message:'format toggle keeps existing identities'});
 await focus();await page.keyboard.press('Control+z');await saved();
 assert.equal((await rpc('get',{id:note.id})).content,headings);
 await page.reload();await page.locator('[data-window-start="0"]').waitFor();
 await historyKey(page,'undo');await saved();
 assert.equal((await rpc('get',{id:note.id})).content,content);
 await focus();await page.keyboard.press('Control+a');
 await page.keyboard.press('Control+b');
 await formatted();await saved();
 let updated=await rpc('get',{id:note.id});assert.notEqual(updated.content,content);assert.ok(updated.content.includes('블록 9999'));
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 await focus();await page.keyboard.press('Control+a');await page.keyboard.press('Delete');
 await page.waitForFunction(()=>document.querySelector('.tiptap-prose')?.textContent==='');await saved();
 // The block left by the deletion is the one edited block: it gains an identity
 // in the same commit (and the same undo step) as the deletion.
 const deletedIds=assertBlockBytes((await rpc('get',{id:note.id})).content,'<p></p>',{added:1,message:'Ctrl+A Delete'});
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 await historyKey(page,'redo');await saved();assertBlockBytes((await rpc('get',{id:note.id})).content,'<p></p>',{added:1,ids:deletedIds,message:'Ctrl+A Delete redo'});
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 await focus();await page.keyboard.press('Control+a');await page.keyboard.insertText('대체😀');
 await page.waitForFunction(()=>document.querySelector('.tiptap-prose')?.textContent==='대체😀');await saved();
 const typedIds=assertBlockBytes((await rpc('get',{id:note.id})).content,'<p><strong>대체😀</strong></p>',{added:1,message:'Ctrl+A typing'});
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 await historyKey(page,'redo');await saved();assertBlockBytes((await rpc('get',{id:note.id})).content,'<p><strong>대체😀</strong></p>',{added:1,ids:typedIds,message:'Ctrl+A typing redo'});
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 await focus();await page.keyboard.press('Control+a');await page.keyboard.press('Escape');assert.equal(await page.locator('.document-selection-status').count(),0);
 // Shift selection retains an anchor in the first window while displaying the end.
 await page.locator('.tiptap-prose').evaluate((el: any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});
 await page.keyboard.press('Control+Shift+End');
 await page.locator('[data-window-start="9999"]').waitFor();
 await page.getByText('화면 밖을 포함한 문서 범위 선택됨',{exact:false}).waitFor();
 await page.keyboard.press('Control+c');await page.waitForFunction(()=>!document.querySelector<any>('.window-controls button:first-child')?.disabled);
 const clipboard=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(clipboard.includes('블록 0')&&clipboard.includes('블록 9999'));
 await page.keyboard.press('Escape');await page.keyboard.press('Control+Home');await page.locator('[data-window-start="0"]').waitFor();
 // Cancel while fetching offscreen blocks: no partial application, repeat ignored.
 let release,entered;const held=new Promise(r=>entered=r);
 await page.route('**/api/rpc',async route=>{
  const r=route.request().postDataJSON();
  if(r.op==='document_blocks'&&r.offset===32){await new Promise(r=>{release=r;entered();});}
  await route.continue();
 });
 await focus();await page.keyboard.press('Control+a');await page.keyboard.press('Delete');await held;
 await page.keyboard.press('Delete');await page.keyboard.press('Escape');release();
 await page.locator('.window-error').filter({hasText:'취소'}).waitFor();await page.unroute('**/api/rpc');
 assert.equal((await rpc('get',{id:note.id})).content,content);
 // Clipboard rejection must not perform cut and must not leak a rejected read.
 await page.evaluate(()=>{(window as any).originalClipboardWrite=navigator.clipboard.write.bind(navigator.clipboard);navigator.clipboard.write=()=>Promise.reject(new Error('permission rejected'));});
 await focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+x');
 await page.locator('.window-error').filter({hasText:'permission rejected'}).waitFor();
 assert.equal((await rpc('get',{id:note.id})).content,content);
 await page.evaluate(()=>{navigator.clipboard.write=(window as any).originalClipboardWrite;});
 await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS: real backend Ctrl+A full copy/format/delete/text and bounded undo DOM; Escape');
}catch(e){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selection:document.querySelector('.document-selection-status')?.textContent,save:document.querySelector('.status-save')?.textContent,body:document.querySelector('.tiptap-prose')?.textContent?.slice(0,100)})));throw e;}
finally{await browser.close();}
