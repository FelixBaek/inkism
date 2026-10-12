import {waitForAsync} from './async-browser-condition.ts';
// A burst of real keys while the next window read is deliberately delayed.
// The expected cursor/range comes from the ordinary browser editor.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const shift=process.env.INKISM_VERTICAL_SHIFT==='1';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.ok(value.ok,value.error);return value.data;
};
const texts=Array.from({length:10000},(_,i)=>'문단 '+i+' '+'가나다라마바사 '.repeat(4));
texts[30]='a'.repeat(50);texts[31]='b';texts[32]='c'.repeat(50);texts[33]='d';texts[34]='e'.repeat(50);texts[35]='f'.repeat(50);
const html=list=>list.map(text=>`<p>${text}</p>`).join('');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const opened=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
const saved=()=>page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
const cursor=async(block,offset)=>editor.evaluate((el: any,{block,offset})=>{
 const e=el.editor;let start=0;for(let i=0;i<block;i++)start+=e.state.doc.child(i).nodeSize;
 e.commands.setTextSelection(start+1+offset);e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());
},{block,offset});
const point=()=>editor.evaluate((el: any)=>{const e=el.editor,$head=e.state.selection.$head;return {block:$head.index(0),offset:$head.parentOffset};});
try{
 for(const direction of ['down','up']){
  const first=direction==='down'?30:35,last=direction==='down'?35:30,key=(shift?'Shift+':'')+(direction==='down'?'ArrowDown':'ArrowUp');
  const normal=await rpc('save',{note:{title:'일반 연속 상하 '+direction+Date.now(),content:html(texts.slice(0,64)),content_format:'html'}});
  await rpc('wait_index');await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+normal.title,exact:true}).click();
  await page.getByRole('button',{name:'텍스트',exact:true}).click();await opened();await cursor(first,24);
  for(let step=1;step<=5;step++){
   await page.keyboard.press(key);
   await page.waitForFunction(block=>document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.$head.index(0)===block,first+(direction==='down'?step:-step));
  }
  const oracle=await point();assert.equal(oracle.block,last);
  assert.ok(oracle.offset>1,'the native goal is wider than the intervening short lines');
  const range=shift?await editor.evaluate((el: any)=>{
   const e=el.editor,selection=e.state.selection,fragment=selection.content().content;
   const native=new e.constructor({extensions:e.extensionManager.extensions.filter(extension=>extension.type==='node'||extension.type==='mark'),content:e.state.doc.toJSON(),parseOptions:{preserveWhitespace:'full'}});
   try{native.commands.setTextSelection({from:selection.anchor,to:selection.head});native.commands.insertContent('z');return {text:fragment.textBetween(0,fragment.size,'\n\n','\ufffc'),html:native.getHTML()};}
   finally{native.destroy();}
  }):null;
  const source=html(texts),note=await rpc('save',{note:{title:'연속 상하 '+direction+Date.now(),content:source,content_format:'html'}});
  await rpc('wait_index');await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
  await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  if(direction==='up'){await page.getByRole('button',{name:'다음 구간',exact:true}).click();await page.locator('[data-window-start="32"]').waitFor();await ready();}
  await cursor(direction==='down'?30:3,24);
  let delayed=0;const reads=[];
  const slow=async route=>{
   const input=route.request().postDataJSON();
   if(input.id===note.id){
    if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(input.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});
    if(['document_blocks','document_segments','document_locate'].includes(input.op)){
     reads.push(input);delayed++;await new Promise(resolve=>setTimeout(resolve,180));
    }
   }
   return route.continue();
  };
  await page.route('**/api/rpc',slow);
  // No readiness wait between keys: all five arrive during the same read.
  for(let step=0;step<5;step++)await page.keyboard.press(key);
  await page.waitForFunction(block=>{
   const host=document.querySelector<any>('[data-window-start]'),e=document.querySelector<any>('.tiptap-prose')?.editor;
   return e?.isInitialized&&Number(host?.getAttribute('data-window-start'))+e.state.selection.$head.index(0)===block;
  },last,{timeout:10000});await ready();
  const actual=await point(),offset=Number(await page.locator('[data-window-start]').getAttribute('data-window-start'));
  assert.deepEqual({block:offset+actual.block,offset:actual.offset},oracle,'every queued key and the original column survive');
  assert.ok(delayed>0,'the burst crosses an actual delayed read');
  assert.ok(reads.every(input=>(input.limit??1)<=32));
  assert.ok(await editor.evaluate((el: any)=>el.editor.state.doc.childCount)<=32);
  assert.equal((await rpc('get',{id:note.id})).content,source,'movement does not save a changed body');
  await page.unroute('**/api/rpc',slow);
  if(shift){
   await page.locator('.document-selection-status').waitFor();await page.evaluate(()=>navigator.clipboard.writeText(''));
   await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+c');
   await waitForAsync(page,expected=>navigator.clipboard.readText().then(value=>value===expected),range.text,{timeout:5000});await ready();
  }
  await page.keyboard.type('z');await saved();
  const changed=[...texts];changed[oracle.block]=changed[oracle.block].slice(0,oracle.offset)+'z'+changed[oracle.block].slice(oracle.offset);
  const actualBody=(await rpc('get',{id:note.id})).content;let expectedBody=shift?range.html+html(texts.slice(64)):html(changed);
  if(!shift){const at=html(texts.slice(0,oracle.block)).length;const opening=/^<p id="ink-block-[0-9a-f-]{36}">/.exec(actualBody.slice(at))?.[0];assert.ok(opening,'only the edited paragraph acquires its permanent block ID');expectedBody=expectedBody.slice(0,at)+opening+expectedBody.slice(at+3);}
  assert.equal(actualBody,expectedBody,'exact native cursor/range replacement');
  await historyKey(page,'undo');await saved();
  assert.equal((await rpc('get',{id:note.id})).content,source,'undo preserves the complete source');
  console.log(`PASS ${shift?'Shift+':''}Arrow${direction} burst: five keys, delayed reads, short-line column, native range/typing/undo, bounded models; lazy=${process.env.INKISM_LAZY}`);
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector<any>('.window-error')?.textContent,window:document.querySelector<any>('[data-window-start]')?.getAttribute('data-window-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
