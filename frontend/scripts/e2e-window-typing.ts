// Actual successive key events while the selected offscreen range is prepared.
// insertText/paste as one transaction cannot detect dropped subsequent keys.
import {chromium} from 'playwright-core';
import {trackSaves} from './save-state.ts';
import assert from 'node:assert/strict';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:48421';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const title='연속 키 입력 '+Date.now();
const content=Array.from({length:10000},(_,i)=>`<p>nativeblock${String(i).padStart(5,'0')} original paragraph 한글😀</p>`).join('');
const focus=()=>page.locator('.tiptap-prose').evaluate((el:any)=>el.editor.view.focus());
const saves=trackSaves(page),saved=()=>saves.saved();
try{
 const note=await rpc('save',{note:{title,content,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await page.locator('[data-window-start="0"]').waitFor();await focus();
 let entered,release,hold=true;
 const held=new Promise(resolve=>{entered=resolve;});
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(hold && request.id===note.id && request.op==='document_blocks' && request.offset===32){
   hold=false;entered();await new Promise(resolve=>{release=resolve;});
  }
  await route.continue();
 });
 await page.keyboard.press('Control+a');
 const typing=page.keyboard.type('native_typed',{delay:5});
 await held;await typing;
 assert.equal((await rpc('get',{id:note.id})).content===content,true,'provisional typing must preserve the canonical original');
 await page.locator('.tiptap-prose').evaluate((el:any)=>el.editor.commands.insertContent(Array.from({length:40},(_,i)=>`<p>paste-${i}</p>`).join('')));
 assert.equal(await page.locator('.tiptap-prose p').count(),1,'pending input must not mount a large paste outside the 32-block window');
 assert.equal(await page.locator('.tiptap-prose').textContent(),'native_typed','a refused paste retains all accepted keys');
 assert.ok((await page.locator('.window-error').textContent()).includes('큰 붙여넣기'));
 release();await page.waitForFunction(()=>!document.querySelector('.document-selection-status'));await saved();
 // Committed provisional input identifies the block it created, like typing.
 assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>native_typed</p>',{added:1,message:'all successive keys must survive selected-range preparation'});
 await page.unroute('**/api/rpc');
 await focus();await page.keyboard.press('Control+z');await saved();
 assert.equal((await rpc('get',{id:note.id})).content===content,true,'one undo restores all original blocks');
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 // A small byte count can still contain more than one virtual window. The
 // first selected-range paste must use the bounded async path too.
 let enteredPaste,releasePaste,holdPaste=true;
 const pasteHeld=new Promise(resolve=>{enteredPaste=resolve;});
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(holdPaste && request.id===note.id && request.op==='document_blocks' && request.offset===32){
   holdPaste=false;enteredPaste();await new Promise(resolve=>{releasePaste=resolve;});
  }
  await route.continue();
 });
 const paste=Array.from({length:40},(_,i)=>`<p>short${i}</p>`).join('');
 await focus();await page.keyboard.press('Control+a');
 await page.locator('.tiptap-prose').evaluate((el:any,html)=>el.editor.commands.insertContent(html),paste);
 await pasteHeld;
 const provisionalCount=await page.locator('.tiptap-prose p').count();
 assert.equal((await rpc('get',{id:note.id})).content,content,'initial multi-paragraph paste preserves the original until prepared');
 releasePaste();
 assert.ok(provisionalCount<=32,'initial small-byte paste must stay inside the 32-block DOM window');
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status'));await saved();
 // Each inserted paragraph is a new block and gains its own identity.
 assertBlockBytes((await rpc('get',{id:note.id})).content,paste,{added:40,message:'initial multi-paragraph paste commits all paragraphs exactly'});
 assert.ok(await page.locator('.tiptap-prose p').count()<=32,'bounded cursor viewport after paste');
 assert.ok((await page.locator('.tiptap-prose').textContent()).includes('short39'),'viewport follows the insertion end');
 await page.unroute('**/api/rpc');
 await focus();await page.keyboard.press('Control+z');await saved();
 assert.equal((await rpc('get',{id:note.id})).content,content,'one undo restores the original after the multi-paragraph paste');
 assert.deepEqual(errors,[]);
 console.log('PASS: successive native key events over 10k selected blocks, delayed preparation, initial multi-paragraph paste, exact save, one undo and bounded DOM; lazy='+(process.env.INKISM_LAZY!=='0'));
}finally{await browser.close();}
