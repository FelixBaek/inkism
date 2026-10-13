// Actual React/Go/Rust: input arriving while a full-document block worker is busy.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const commandName=process.env.INKISM_BLOCK_FORMAT_COMMAND??'setHeading';
assert.ok(['setHeading','toggleBulletList','toggleOrderedList','toggleTaskList','toggleBlockquote','toggleCodeBlock'].includes(commandName));
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.ok(value.ok,value.error);return value.data;
};
const original=Array.from({length:10000},(_,i)=>'<p>본문 '+i+' 한글😀 '.repeat(8)+'</p>').join('');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
 const Native=window.Worker;
 (window as any).__blockGate={posted:false,released:false,deliveries:[],result:null};
 window.Worker=class extends Native{
  constructor(url,options){
   super(url,options);
   if(!String(url).includes('native-block-format.worker'))return;
   let handler;
   Object.defineProperty(this,'onmessage',{get:()=>handler,set:value=>{handler=value;}});
   this.addEventListener('message',event=>{
    (window as any).__blockGate.result=event.data;
    const deliver=()=>handler?.call(this,event);
    if((window as any).__blockGate.released)deliver();else (window as any).__blockGate.deliveries.push(deliver);
   });
   const post=this.postMessage.bind(this);
   this.postMessage=(...args)=>{(window as any).__blockGate.posted=true;return post(...args);};
  }
 };
});
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
const body=async id=>(await rpc('get',{id})).content;
try{
 const supported=['keys','keys-caret','keys-selection','paste-keys','composition','after-format','after-range-format','after-format-right','after-range-left'];
 const cases=process.env.INKISM_BLOCK_INPUT_CASES?.split(',')??(commandName==='setHeading'?supported:supported.filter(kind=>!kind.startsWith('after-')));
 assert.ok(cases.length&&cases.every(kind=>supported.includes(kind)),'known input cases required');
 assert.ok(commandName==='setHeading'||cases.every(kind=>!kind.startsWith('after-')),'heading-specific after-format fixtures require a heading');
 for(const kind of cases){
 const after=kind.startsWith('after-');
 const range=kind.startsWith('after-range-'),collapse=kind==='after-format-right'||kind==='after-range-left';
 const note=await rpc('save',{note:{title:'서식 중 입력 '+Date.now(),content:original,content_format:'html'}});
 await rpc('wait_index');await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
 await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await editor.evaluate((el: any)=>el.editor.view.focus());
 if(range){
  await editor.evaluate((el: any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});
  await page.keyboard.press('Control+Shift+End');
  await page.locator('[data-window-start="9999"]').waitFor();await ready();
 }else await page.keyboard.press('Control+a');
 await editor.evaluate((el: any,name)=>name==='setHeading'?el.editor.chain().focus().setHeading({level:2}).run():el.editor.chain().focus()[name]().run(),commandName);
 await page.waitForFunction(()=>(window as any).__blockGate.posted);
 if(after){
  await page.evaluate(()=>{(window as any).__blockGate.released=true;for(const deliver of (window as any).__blockGate.deliveries.splice(0))deliver();});
  await ready();await saved();
  assert.equal(((await body(note.id)).match(/<h2>/g)||[]).length,10000,'format completed before follow-up typing');
 }
 if(collapse){
  await page.keyboard.press(kind==='after-format-right'?'ArrowRight':'ArrowLeft');
  await page.locator('[data-window-start="'+(kind==='after-format-right'?9999:0)+'"]').waitFor();await ready();
 }
 const text=kind==='composition'?'확정😀':collapse?'z':kind==='keys-caret'?'abxc':'abc';
 if(kind==='paste-keys')await editor.evaluate((el: any)=>el.editor.view.pasteHTML('<p>붙임</p><p>끝</p>'));
 if(kind==='composition')await editor.evaluate((el: any)=>{
  const view=el.editor.view;
  view.dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
  view.dispatch(view.state.tr.insertText('候補'));
  view.dispatch(view.state.tr.insertText('확정😀',view.state.selection.head-2,view.state.selection.head));
  view.dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'확정😀'}));
 });else if(kind==='keys-caret'){
  await page.keyboard.type('abc');await page.keyboard.press('ArrowLeft');await page.keyboard.type('x');
 }else if(kind==='keys-selection'){
  await page.keyboard.type('abc');await page.keyboard.press('Shift+ArrowLeft');
 }else await page.keyboard.type(text);
 if(!after)assert.equal(await body(note.id),original,'source guarded during block calculation');
 assert.ok((await editor.textContent()).includes(text),'busy worker retains visible native input');
 await page.waitForFunction(()=>(window as any).__blockGate.result);
 // Native full model after the actual worker transform, then native insertText.
 // The all-selection must cover all 10000 blocks rather than the 32-block view.
 const oracle=await editor.evaluate((el: any,{text,kind})=>{
  const e=el.editor,result=(window as any).__blockGate.result,doc=e.schema.nodeFromJSON(result.doc);
  const Selection=Object.getPrototypeOf(e.state.selection.constructor);
  const selection=kind==='after-format-right'?Selection.atEnd(doc):kind==='after-range-left'?Selection.atStart(doc):Selection.fromJSON(doc,result.selection);
  const state=e.state.constructor.create({schema:e.schema,doc,selection});
  let input=state;
  if(kind==='paste-keys'){
   const doc=e.schema.topNodeType.create(null,[e.schema.nodes.paragraph.create(null,e.schema.text('붙임')),
    e.schema.nodes.paragraph.create(null,e.schema.text('끝'))]);
   const pasted=input.tr.replaceSelection(doc.slice(0,doc.content.size));
   input=state.constructor.create({schema:e.schema,doc:pasted.doc,selection:pasted.selection});
  }
  let tr=input.tr.insertText(text);
  if(kind==='keys-caret'){
   const first=input.tr.insertText('abc');
   const moved=input.constructor.create({schema:e.schema,doc:first.doc,selection:Selection.near(first.doc.resolve(first.selection.head-1),-1)});
   tr=moved.tr.insertText('x');
  }else if(kind==='keys-selection'){
   const selected=Selection.fromJSON(tr.doc,{type:'text',anchor:tr.selection.head,head:tr.selection.head-1});
   tr=input.constructor.create({schema:e.schema,doc:tr.doc,selection:selected}).tr;
  }
  return {doc:tr.doc.toJSON(),selection:tr.selection.toJSON(),selectionText:state.selection.content().content.textBetween(0,state.selection.content().content.size,'\n\n','\ufffc')};
 },{text,kind});
 assert.equal(oracle.doc.content.length,collapse?10000:kind==='paste-keys'?2:1,'native selection/collapse covers the full document');
 assert.equal(oracle.doc.content[0].type,range||collapse?'heading':'paragraph');
 await page.evaluate(()=>{(window as any).__blockGate.released=true;for(const deliver of (window as any).__blockGate.deliveries.splice(0))deliver();});
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));
 const formatted=original.replaceAll('<p>','<h2>').replaceAll('</p>','</h2>');
 const expected=kind==='after-format-right'?formatted.replace(/<\/h2>$/,'z</h2>'):
  kind==='after-range-left'?formatted.replace(/^<h2>/,'<h2>z'):
  kind==='paste-keys'?'<p>붙임</p><p>끝abc</p>':kind==='after-range-format'?'<h2>abc</h2>':`<p>${text}</p>`;
 // Typed blocks acquire permanent IDs; every other byte must match exactly.
 await saved();const editedSource=await body(note.id),actual=editedSource.replace(/ id="ink-block-[0-9a-f-]{36}"/g,'');
 const acquired=editedSource.match(/ id="ink-block-[0-9a-f-]{36}"/g)??[];
 assert.ok(acquired.length<=(kind==='paste-keys'?2:1),'identities may only be added to the typed/pasted blocks');
 assert.equal(new Set(acquired).size,acquired.length,'new block identities must be unique');
 assert.ok(actual===expected,'worker command then all-selection input; actual characters='+actual.length+', expected='+expected.length);
 const previewOracle=await editor.evaluate((el: any,oracle)=>{
  const e=el.editor,full=e.schema.nodeFromJSON(oracle.doc);
  const offset=Number(document.querySelector('[data-window-start]').getAttribute('data-window-start'));
  let shift=0;for(let i=0;i<offset;i++)shift+=full.child(i).nodeSize;
  const doc={...oracle.doc,content:oracle.doc.content.slice(offset,offset+e.state.doc.childCount)};
  const selection={...oracle.selection,anchor:oracle.selection.anchor-shift,head:oracle.selection.head-shift};
  return {doc,selection};
 },oracle);
 // The plugin-free oracle has no block identity; compare edited blocks without their acquired IDs.
 assert.deepEqual(await editor.evaluate((el: any)=>JSON.parse(JSON.stringify(el.editor.state.doc.toJSON()),(key,value)=>key==='id'&&typeof value==='string'&&value.startsWith('ink-block-')?null:value)),previewOracle.doc,'bounded native model parity');
 assert.deepEqual(await editor.evaluate((el: any)=>el.editor.state.selection.toJSON()),previewOracle.selection,'bounded native selection parity');
 await page.reload();await ready();
 await historyKey(page,'undo');await saved();
 if(after){
  assert.equal(((await body(note.id)).match(/<h2>/g)||[]).length,10000,'first restart undo restores formatted source');
  if(!collapse){
  await page.evaluate(()=>navigator.clipboard.writeText(''));
  await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+c');
  let copied='';
  await waitForPredicate(async()=>{copied=await page.evaluate(()=>navigator.clipboard.readText());return copied.length===oracle.selectionText.length;},'restored full selection clipboard did not arrive');
  let difference=0;while(difference<copied.length&&copied[difference]===oracle.selectionText[difference])difference++;
  assert.ok(copied===oracle.selectionText,'restart undo full native selection: first difference='+difference+
   ', actual='+JSON.stringify(copied.slice(Math.max(0,difference-20),difference+40))+
   ', expected='+JSON.stringify(oracle.selectionText.slice(Math.max(0,difference-20),difference+40)));
  }
  await historyKey(page,'undo');await saved();
 }
 assert.equal(await body(note.id),original,'restart undo restores complete source');
 if(after){
  await historyKey(page,'redo');await saved();
  assert.equal(((await body(note.id)).match(/<h2>/g)||[]).length,10000,'first restart redo restores format');
 }
 await historyKey(page,'redo');await saved();assert.equal(await body(note.id),editedSource,'restart redo retains busy-worker input');
 assert.deepEqual(errors,[]);
 console.log('PASS 10000-block worker + '+kind+': guarded source, full-model selection, restart undo/redo; lazy='+(process.env.INKISM_LAZY!=='0'));
 }
}catch(error){
 console.error(await page.evaluate(()=>({title:document.querySelector<any>('.title-input')?.value,
  error:document.querySelector('.window-error')?.textContent,save:document.querySelector('.status-save')?.textContent,
  offset:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),
  controls:document.querySelector('.window-controls')?.textContent,
  selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),
  text:document.querySelector('.tiptap-prose')?.textContent?.slice(0,40)})));
 throw error;
}finally{await browser.close();}
