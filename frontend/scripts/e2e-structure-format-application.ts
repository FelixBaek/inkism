// Full-selection structural commands compared with an unmodified native editor.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const range=process.env.INKISM_STRUCTURE_SELECTION==='range';
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.ok(value.ok,value.error);return value.data;
};
const source=Array.from({length:1000},(_,i)=>`<${i<32?'h2':'p'}>문단 ${i} <strong>굵은 한글😀</strong> ${'본문 가나다 '.repeat(30)}</${i<32?'h2':'p'}>`).join('');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
 const Native=window.Worker;(window as any).__structureWorkers=0;
 window.Worker=class extends Native{
  constructor(url,options){super(url,options);if(String(url).includes('native-block-format.worker'))(window as any).__structureWorkers++;}
 };
});
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
const focus=()=>editor.evaluate((el:any)=>el.editor.view.focus());
const command=name=>editor.evaluate((el:any,name)=>el.editor.chain().focus()[name]().run(),name);
const body=async id=>(await rpc('get',{id})).content;
const expectBody=async(id,expected,label)=>{
 let actual='';
 await waitForPredicate(async()=>{
  const error=await page.locator('.window-error').count()?await page.locator('.window-error').textContent():null;
  if(error)throw Error(label+': '+error);
  actual=await body(id);return actual===expected;
 },label+'; expected chars='+expected.length,15000);
 assert.ok(actual===expected,label);
};
try{
 const names=process.env.INKISM_STRUCTURE_CASES?.split(',')??['toggleBulletList','toggleOrderedList','toggleTaskList','toggleBlockquote','toggleCodeBlock'];
 for(const name of names){
  const note=await rpc('save',{note:{title:name+' '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
  await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  const reads=[],writes=[];
  const monitor=route=>{
   const input=route.request().postDataJSON();
   if(input.id===note.id){
    if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(input.op))return route.fulfill({status:403,json:{ok:false,error:'whole-body read forbidden'}});
    if(input.op==='document_blocks'||input.op==='document_segments')reads.push(input);
    if(input.op==='document_splice_html')writes.push(input);
   }
   return route.continue();
  };
  await page.route('**/api/rpc',monitor);
  await focus();
  if(range){
   await editor.evaluate((el:any)=>{let start=0;for(let i=0;i<16;i++)start+=el.editor.state.doc.child(i).nodeSize;el.editor.commands.setTextSelection(start+10);el.editor.view.focus();});
   await page.keyboard.press('Control+Shift+End');await page.locator('[data-window-start="999"]').waitFor();await ready();
  }else await page.keyboard.press('Control+a');
  const oracle=await editor.evaluate((el:any,{source,name,range})=>{
   const actual=el.editor;
   // Keep the real node/mark extensions but omit our command interceptor,
   // window guard, history and UI plugins. Core native commands are unchanged.
   const extensions=actual.extensionManager.extensions.filter(extension=>extension.type==='node'||extension.type==='mark');
   const native=new actual.constructor({extensions,content:source,parseOptions:{preserveWhitespace:'full'}});
   try{
    if(range){let start=0;for(let i=0;i<16;i++)start+=native.state.doc.child(i).nodeSize;native.commands.setTextSelection({from:start+10,to:native.state.doc.content.size-1});}
    else native.view.dispatch(native.state.tr.setSelection(new actual.state.selection.constructor(native.state.doc)));
    if(!native.commands[name]())throw Error('native command failed: '+name);
    const formatted=native.getHTML(),model=native.state.doc.toJSON(),selection=native.state.selection.toJSON();
    if(!native.commands[name]()){
     // Native lift requires a text range inside a quote. AllSelection is at
     // the doc root, so use the native command on the same whole text range.
     if(name!=='toggleBlockquote')throw Error('native toggle-off failed: '+name);
     const blocks=[];native.state.doc.descendants((node,at)=>{if(node.isTextblock)blocks.push({start:at+1,end:at+1+node.content.size});});
     native.commands.setTextSelection({from:blocks[0].start,to:blocks.at(-1).end});
     if(!native.commands[name]())throw Error('native quote text-range lift failed');
    }
    return {formatted,model,selection,removed:native.getHTML()};
   }finally{native.destroy();}
  },{source,name,range});
  assert.notEqual(oracle.formatted,source,'native command changes the document');
  const beforeReads=reads.length,beforeWrites=writes.length;
  assert.equal(await editor.evaluate((el:any,name)=>el.editor.can()[name](),name),true);
  assert.equal(reads.length,beforeReads,'can has no body reads');assert.equal(writes.length,beforeWrites,'can has no writes');
  await command(name);await ready();
  assert.equal(await page.locator('.window-error').count(),0,'format has no preservation error');
  await expectBody(note.id,oracle.formatted,'full native formatted source');
  await saved();
  assert.ok(await page.evaluate(()=>(window as any).__structureWorkers)>0,'large transform runs in an actual worker');
  assert.ok((await editor.textContent()).length<33000,'bounded visible text');
  assert.ok(await page.locator('*').count()<1500,'bounded DOM');
  assert.ok(reads.length>0&&reads.every(input=>input.limit<=32),'bounded source reads');
  if(name==='toggleTaskList'&&!range){
   const checked=await editor.evaluate((el:any,model)=>{
    const native=new el.editor.constructor({extensions:el.editor.extensionManager.extensions.filter(extension=>extension.type==='node'||extension.type==='mark'),content:model});
    try{native.view.dispatch(native.state.tr.setNodeMarkup(1,undefined,{checked:true}));return native.getHTML();}
    finally{native.destroy();}
   },oracle.model);
   await editor.getByRole('checkbox').first().check();
   await expectBody(note.id,checked,'checkbox updates only the first task item');await saved();
   await historyKey(page,'undo');
   await expectBody(note.id,oracle.formatted,'checkbox undo preserves the other 999 items');await saved();
  }
  await page.reload();await ready();
  await historyKey(page,'undo');await saved();
  await expectBody(note.id,source,'restart undo restores exact source');
  await historyKey(page,'redo');await saved();
  await expectBody(note.id,oracle.formatted,'restart redo restores native structure');
  await focus();if(!range)await page.keyboard.press('Control+a');await command(name);await ready();
  assert.equal(await page.locator('.window-error').count(),0,'toggle-off has no preservation error');
  await expectBody(note.id,oracle.removed,'toggle-off uses full native model');
  await saved();
  await page.unroute('**/api/rpc',monitor);
  console.log(`PASS ${name}: full native source, real worker, bounded reads/DOM, can purity, toggle-off, restart undo/redo; range=${range}, lazy=${process.env.INKISM_LAZY}`);
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,selected:document.querySelector('.document-selection-status')?.textContent,save:document.querySelector('.status-save')?.textContent})));throw error;}
finally{await browser.close();}
