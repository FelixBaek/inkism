import {waitForAsync} from './async-browser-condition.ts';
// Native keyboard movement across a virtual window, compared with the full editor.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;
const shift=process.env.INKISM_VERTICAL_SHIFT==='1';
const key=direction=>(shift?'Shift+':'')+(direction==='down'?'ArrowDown':'ArrowUp');
assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.ok(value.ok,value.error);return value.data;
};
const texts=Array.from({length:10000},(_,i)=>`문단 ${i} `+'가나다라마바사 아자차카타파하 '.repeat(13));
const html=list=>list.map(text=>`<p>${text}</p>`).join('');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const opened=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
const cursor=async(block,end)=>editor.evaluate((el:any,{block,end})=>{
 const e=el.editor;let start=0;for(let i=0;i<block;i++)start+=e.state.doc.child(i).nodeSize;
 const node=e.state.doc.child(block);
 e.commands.setTextSelection(start+1+(end?node.content.size:20));e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());
},{block,end});
const point=()=>editor.evaluate((el:any)=>{const head=el.editor.state.selection.$head;return {block:head.index(0),offset:head.parentOffset};});
try{
 for(const direction of ['down','up']){
  const normal=await rpc('save',{note:{title:'일반 이동 '+direction+Date.now(),content:html(texts.slice(0,64)),content_format:'html'}});
  await rpc('wait_index');await page.goto(base+'/');
  await page.getByRole('button',{name:'노트 열기: '+normal.title,exact:true}).click();
  await page.getByRole('button',{name:'텍스트',exact:true}).click();await opened();
  assert.equal(await editor.evaluate((el:any)=>el.editor.state.doc.childCount),64,'oracle uses the full native editor');
  await cursor(direction==='down'?31:32,direction==='down');
  await page.keyboard.press(key(direction));
  await page.waitForFunction(block=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.index(0)===block,direction==='down'?32:31,{timeout:3000});
  const oracle=await point();assert.equal(oracle.block,direction==='down'?32:31,'native movement crosses a paragraph');
  let shrinkOracle;
  if(shift){
   const reverse=direction==='down'?'up':'down';
   await page.keyboard.press(key(reverse));
   // Browser keyboard selection is observed asynchronously by ProseMirror.
   await page.waitForFunction(block=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.index(0)===block,direction==='down'?31:32);
   shrinkOracle=await point();
   await page.keyboard.press(key(direction));
   await page.waitForFunction(block=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.index(0)===block,oracle.block);
  }
  const rangeOracle=shift?await editor.evaluate((el:any)=>{
   const e=el.editor,selection=e.state.selection,fragment=selection.content().content;
   const native=new e.constructor({extensions:e.extensionManager.extensions.filter(extension=>extension.type==='node'||extension.type==='mark'),content:e.state.doc.toJSON()});
   try{native.commands.setTextSelection({from:selection.anchor,to:selection.head});native.commands.insertContent('z');return {text:fragment.textBetween(0,fragment.size,'\n\n','\ufffc'),html:native.getHTML()};}
   finally{native.destroy();}
  }):null;
  const source=html(texts),note=await rpc('save',{note:{title:'가상 이동 '+direction+Date.now(),content:source,content_format:'html'}});
  await rpc('wait_index');await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
  await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  if(direction==='up'){
   await page.getByRole('button',{name:'다음 구간',exact:true}).click();
   await page.locator('[data-window-start="32"]').waitFor();await ready();
  }
  await cursor(direction==='down'?31:0,direction==='down');
  await page.keyboard.press(key(direction));
  // Wait for the actual next window; the old implementation never moves.
  await page.waitForFunction(block=>{
   const host=document.querySelector('[data-window-start]'),e=document.querySelector<any>('.tiptap-prose')?.editor;
   return e?.isInitialized&&Number(host?.getAttribute('data-window-start'))+e.state.selection.$head.index(0)===block;
  },oracle.block,{timeout:5000});
  await ready();const actual=await point();
  const offset=Number(await page.locator('[data-window-start]').getAttribute('data-window-start'));
  assert.deepEqual({block:offset+actual.block,offset:actual.offset},oracle,'native visual column and document position');
  assert.equal((await rpc('get',{id:note.id})).content,source,'navigation does not change source');
  assert.ok(await editor.evaluate((el:any)=>el.editor.state.doc.childCount)<=32,'bounded document model');
  if(shift){
   await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press(key(direction==='down'?'up':'down'));
   await page.waitForFunction(block=>{
    const host=document.querySelector('[data-window-start]'),e=document.querySelector<any>('.tiptap-prose')?.editor;
    return e?.isInitialized&&Number(host?.getAttribute('data-window-start'))+e.state.selection.$head.index(0)===block;
   },shrinkOracle.block,{timeout:5000});await ready();
   const shrunk=await point(),shrunkOffset=Number(await page.locator('[data-window-start]').getAttribute('data-window-start'));
   assert.deepEqual({block:shrunkOffset+shrunk.block,offset:shrunk.offset},shrinkOracle,'reverse Shift shrinks the same native range');
   await page.keyboard.press(key(direction));
   await page.waitForFunction(block=>{
    const host=document.querySelector('[data-window-start]'),e=document.querySelector<any>('.tiptap-prose')?.editor;
    return e?.isInitialized&&Number(host?.getAttribute('data-window-start'))+e.state.selection.$head.index(0)===block;
   },oracle.block,{timeout:5000});await ready();
   await page.locator('.document-selection-status').waitFor();
   await page.evaluate(()=>navigator.clipboard.writeText(''));
   await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press('Control+c');
   await waitForAsync(page,expected=>navigator.clipboard.readText().then(value=>value===expected),rangeOracle.text,{timeout:5000});
   await ready();
  }
  await page.keyboard.type('z');await saved();
  const changed=[...texts];changed[oracle.block]=changed[oracle.block].slice(0,oracle.offset)+'z'+changed[oracle.block].slice(oracle.offset);
  const actualBody=(await rpc('get',{id:note.id})).content;let expectedBody=shift?rangeOracle.html+html(texts.slice(64)):html(changed);
  if(!shift){const at=html(texts.slice(0,oracle.block)).length;const opening=/^<p id="ink-block-[0-9a-f-]{36}">/.exec(actualBody.slice(at))?.[0];assert.ok(opening,'only the edited paragraph acquires its permanent block ID');expectedBody=expectedBody.slice(0,at)+opening+expectedBody.slice(at+3);}
  assert.equal(actualBody,expectedBody,'typing lands at the exact native cursor/selection');
  if(shift){
   await historyKey(page,'undo');await saved();
   assert.equal((await rpc('get',{id:note.id})).content,source,'selection replacement undo restores exact source');
   console.log(`PASS Shift+Arrow${direction}, native visual column and selected text, exact replacement/undo; lazy=${process.env.INKISM_LAZY}`);
   continue;
  }
  await page.reload();await ready();
  const restored=await point(),restoredOffset=Number(await page.locator('[data-window-start]').getAttribute('data-window-start'));
  assert.deepEqual({block:restoredOffset+restored.block,offset:restored.offset},{block:oracle.block,offset:oracle.offset+1},'restart preserves the cursor');
  console.log(`PASS Arrow${direction} across a window, native visual column, exact source and restart; lazy=${process.env.INKISM_LAZY}`);
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selected:document.querySelector('.document-selection-status')?.textContent,window:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),save:document.querySelector('.status-save')?.textContent})));throw error;}finally{await browser.close();}
