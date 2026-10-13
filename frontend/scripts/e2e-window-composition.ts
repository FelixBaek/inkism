// Chromium's actual composition events through CDP, with the real Go/Rust backend.
// This is browser-engine coverage, not a physical Windows IME acceptance test.
import {chromium} from 'playwright-core';
import {trackSaves} from './save-state.ts';
import assert from 'node:assert/strict';
import {assertBlockBytes} from './block-identity-bytes.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:48415';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const title='범위 조합 검사 '+Date.now();
// The full-draft path classifies size by JS string length. Keep its fixture
// above that threshold as well as the lazy path's UTF-8/block threshold.
const suffix=process.env.INKISM_LAZY==='0'?' 길이 확보 본문':'';
const content=Array.from({length:10000},(_,i)=>`<p>문단 ${i} 한글😀${suffix}</p>`).join('');
let note;
const saves=trackSaves(page),saved=()=>saves.saved({timeout:30000});
const focus=()=>page.locator('.tiptap-prose').evaluate((el: any)=>el.editor.view.focus());
try{
 note=await rpc('save',{note:{title,content,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await page.locator('[data-window-start="0"]').waitFor();await focus();
 await page.keyboard.press('Control+a');
 await page.locator('.document-selection-status').waitFor();
 await page.locator('.tiptap-prose').evaluate((el: any)=>{(window as any).composingEditor=el.editor;});
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
 assert.equal((await rpc('get',{id:note.id})).content,content,'provisional composition must not save a partial window');
 await cdp.send('Input.insertText',{text:'한글😀'});
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status'),undefined,{timeout:30000});await saved();
 // The committed composition is the one edited block: it gains its identity
 // in the same commit as the replacement, never during the composition.
 const composedIds=assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>한글😀</p>',{added:1,message:'composition must replace all selected offscreen content exactly once'});
 assert.equal(await page.locator('.window-error').count(),0,'composition must not be refused');
 assert.equal(await page.locator('.tiptap-prose').evaluate((el: any)=>el.editor===(window as any).composingEditor),true,'committing input must keep the native composing editor mounted');
 await focus();await page.keyboard.press('Control+z');await saved();
 assert.equal((await rpc('get',{id:note.id})).content,content,'one undo restores the whole original');
 await historyKey(page,'redo');await saved();assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>한글😀</p>',{added:1,ids:composedIds,message:'redo restores the same identity'});
 await focus();await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content,'undo after redo');
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 // The full-draft range worker can finish during a new composition. Its result
 // must be located before taking the latest slice, with no later async gap.
 if(process.env.INKISM_LAZY==='0'){
  await page.evaluate(()=>{
   const NativeWorker=window.Worker;(window as any).nativeRangeWorker=NativeWorker;
   (window as any).holdRange=true;(window as any).rangeStarted=false;
   window.Worker=class extends NativeWorker{
    constructor(url,options){super(url,options);(this as any).range=String(url).includes('block-range.worker');}
    postMessage(data,...rest){
     if((this as any).range && (window as any).holdRange){(window as any).holdRange=false;(window as any).rangeStarted=true;(window as any).releaseRange=()=>super.postMessage(data,...rest);return;}
     super.postMessage(data,...rest);
    }
   };
  });
  await focus();await page.keyboard.press('Control+a');
  await cdp.send('Input.imeSetComposition',{text:'ㅊ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.insertText',{text:'첫'});await page.waitForFunction(()=>(window as any).rangeStarted);
  await cdp.send('Input.imeSetComposition',{text:'두',selectionStart:1,selectionEnd:1});
  await page.evaluate(()=>(window as any).releaseRange());await page.waitForTimeout(250);
  assert.equal((await rpc('get',{id:note.id})).content,content,'range worker completion must not commit an older word during a new candidate');
  await cdp.send('Input.insertText',{text:'번째'});
  await page.waitForFunction(()=>!document.querySelector('.document-selection-status'));await saved();
  assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>첫번째</p>',{added:1});
  await page.evaluate(()=>{window.Worker=(window as any).nativeRangeWorker;});
  await focus();await page.keyboard.press('Control+z');await saved();
  assert.equal((await rpc('get',{id:note.id})).content,content);
 }
 // Cancellation keeps the original body, revision and document-wide selection.
 const originalRevision=(await rpc('get',{id:note.id})).revision;
 await focus();await page.keyboard.press('Control+a');
 await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
 await page.waitForFunction(()=>document.querySelector('.tiptap-prose')?.textContent?.includes('문단 31'));
 await page.keyboard.press('Control+s');
 const cancelled=await rpc('get',{id:note.id});
 assert.equal(cancelled.content,content);assert.equal(cancelled.revision,originalRevision);
 assert.equal(await page.locator('.document-selection-status').count(),1);
 await page.keyboard.press('Escape');
 // Selection endpoints in different windows retain the unselected prefix.
 await page.locator('.tiptap-prose').evaluate((el: any)=>{el.editor.commands.setTextSelection(5);el.editor.view.focus();});
 await page.keyboard.press('Control+Shift+End');await page.locator('[data-window-start="9999"]').waitFor();
 await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'한글😀'});
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status'));await saved();
 assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>문단 0한글😀</p>',{added:1});
 await focus();await page.keyboard.press('Control+z');await saved();
 assert.equal((await rpc('get',{id:note.id})).content,content);
 // Continue composing while an offscreen read is delayed. Switching/closing
 // must wait; no provisional block or intermediate word may reach the store.
 let release,entered;
 const held=new Promise(resolve=>{entered=resolve;});
 let hold=true;
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(hold && request.id===note.id && request.op==='document_blocks' && request.offset===32){
   hold=false;entered();await new Promise(resolve=>{release=resolve;});
  }
  await route.continue();
 });
 await focus();await page.keyboard.press('Control+a');
 await cdp.send('Input.imeSetComposition',{text:'ㅊ',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'첫'});await held;
 await cdp.send('Input.imeSetComposition',{text:'두',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'번째'});
 assert.equal((await rpc('get',{id:note.id})).content,content);
 await page.waitForFunction(()=>document.querySelector('.tiptap-prose')?.textContent==='첫번째');
 assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
 const other=await rpc('save',{note:{title:'조합 이동 대상 '+Date.now(),content:'<p>다른 문서</p>',content_format:'html'}});
 await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(other.title);
 await page.getByRole('button',{name:'노트 열기: '+other.title,exact:true}).click();
 assert.equal(await page.getByLabel('노트 제목',{exact:true}).inputValue(),title,'note switch waits for the selected input');
 release();
 await page.waitForFunction(title=>document.querySelector<any>('[aria-label="노트 제목"]')?.value===title,other.title);
 assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>첫번째</p>',{added:1});
 await page.unroute('**/api/rpc');
 await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(title);
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await focus();
 await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
 // Failed offscreen preparation retains the composed input and blocks leaving.
 let fail=true;
 await page.route('**/api/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(fail && request.id===note.id && request.op==='document_blocks' && request.offset===32)
   return route.fulfill({status:503,json:{ok:false,error:'offscreen fixture failure'}});
  await route.continue();
 });
 await focus();await page.keyboard.press('Control+a');
 await cdp.send('Input.imeSetComposition',{text:'미',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'미전송'});
 await page.locator('.window-error').waitFor();
 assert.equal((await rpc('get',{id:note.id})).content,content);
 assert.equal(await page.locator('.tiptap-prose').textContent(),'미전송');
 await page.getByRole('button',{name:'선택 취소',exact:true}).click();
 let discard=page.getByRole('dialog',{name:'미반영 입력을 버릴까요?',exact:true});await discard.waitFor();
 await discard.getByRole('button',{name:'취소',exact:true}).click();
 assert.equal(await page.locator('.tiptap-prose').textContent(),'미전송','declining discard retains pending input');
 await page.getByRole('button',{name:'선택 취소',exact:true}).click();await discard.waitFor();
 await discard.getByRole('button',{name:'입력 버리기',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status'));
 assert.equal((await rpc('get',{id:note.id})).content,content,'confirmed discard must preserve the canonical original');
 assert.ok((await page.locator('.tiptap-prose').textContent()).includes('문단 31'));
 // Recreate the failed candidate to exercise successful retry independently.
 await focus();await page.keyboard.press('Control+a');
 await cdp.send('Input.imeSetComposition',{text:'미',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'미전송'});await page.locator('.window-error').waitFor();
 await page.getByRole('button',{name:'HTML',exact:true}).click();
 await page.locator('.window-error').waitFor();
 assert.equal(await page.locator('.tiptap-prose').textContent(),'미전송');
 assert.equal(await page.locator('.split-primary .cm-content').count(),0);
 let closeRequests=0;
 await page.route('**/api/close',route=>{closeRequests++;return route.fulfill({status:200,body:'{}'});});
 await page.evaluate(()=>window.dispatchEvent(new Event('native-close-request')));
 await page.waitForFunction(()=>document.querySelector<any>('.window-error') && !document.querySelector<any>('.window-controls button:last-child')?.disabled);
 assert.equal(closeRequests,0,'native close must be refused while composed input cannot be committed');
 assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
 await page.waitForFunction(()=>document.querySelector<any>('.window-error') && !document.querySelector<any>('.window-controls button:last-child')?.disabled);
 // The beforeunload guard itself starts a flush. Keep failure enabled until
 // that retry has actually failed, rather than racing its pending request.
 fail=false;await page.locator('.window-error').getByRole('button',{name:'다시 시도'}).click();
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status'));await saved();
 assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>미전송</p>',{added:1});
 await page.unroute('**/api/rpc');
 const closed=page.waitForResponse('**/api/close');
 await page.evaluate(()=>window.dispatchEvent(new Event('native-close-request')));await closed;
 assert.equal(closeRequests,1,'native close resumes after exact input and history are saved');
 await page.unroute('**/api/close');
 // Explicit source viewing and page restart retain byte-based range undo even
 // though the current result is now a single small paragraph.
 await page.getByRole('button',{name:'HTML',exact:true}).click();
 await page.locator('.split-primary .cm-content').waitFor();
 await page.getByRole('button',{name:'텍스트',exact:true}).click();
 await page.locator('[data-window-start]').waitFor();
 await page.reload();await page.locator('[data-window-start]').waitFor();
 await focus();await page.keyboard.press('Control+z');await saved();
 assert.equal((await rpc('get',{id:note.id})).content,content);
 assert.equal(await page.locator('.tiptap-prose p').count(),32);
 // Ordinary window composition also resumes autosave after a long held
 // candidate, even if the end event itself produces no additional edit.
 await page.keyboard.press('Escape');
 await page.locator('.tiptap-prose').evaluate((el: any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});
 await cdp.send('Input.imeSetComposition',{text:'일반',selectionStart:2,selectionEnd:2});
 await page.waitForTimeout(1800);
 assert.equal((await rpc('get',{id:note.id})).content,content,'a long-lived provisional candidate must not save');
 await cdp.send('Input.insertText',{text:'일반'});await saved();
 // Exactly one committed word (an identity redraw during the composition used
 // to drop it, insert it twice and leave autosave stuck); the edited block
 // receives its identity only after the composition ended.
 assertBlockBytes((await rpc('get',{id:note.id})).content,'<p>일반'+content.slice(3),{added:1,message:'held composition commit'});
 assert.equal(await page.locator('.tiptap-prose').evaluate((el: any)=>el.editor.view.composing),false,'composition ended');
 assert.deepEqual(errors,[]);
 console.log('PASS: Chromium IME over 10k blocks; all/range selection, cancellation, continued composition, delayed note switch/close, failed-read input retention/retry, exact save/undo and bounded DOM; lazy='+ (process.env.INKISM_LAZY!=='0'));
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selection:document.querySelector('.document-selection-status')?.textContent,save:document.querySelector('.status-save')?.textContent,body:document.querySelector('.tiptap-prose')?.textContent?.slice(0,100)})));throw error;}
finally{await browser.close();}
