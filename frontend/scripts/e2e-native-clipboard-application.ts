// Actual isolated browser clipboard events, shipped React + Go + Rust.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes,withoutBlockIds} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.ok(v.ok,v.error);return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose'),focus=()=>editor.evaluate((el: any)=>el.editor.view.focus());
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>waitSaved(page);
const settled=async()=>{await page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));await saved();};
const body=async id=>(await rpc('get',{id})).content;
const bounded=async()=>{assert.ok(await page.locator('*').count()<1500);assert.ok((await editor.textContent()).length<40000);};
const firstText='X'.repeat(1024*1024),tail='TAIL😀';
const clip={html:'<p><em>'+'RICH😀 '.repeat(13000)+'</em></p><p>HTML END</p>',text:'PLAIN😀\r\n\r\n'+'text '.repeat(13000)+'\r\nTEXT END'};
const second={html:'<p><strong>'+'SECOND '.repeat(8000)+'</strong></p>',text:'SECOND plain\n'+'plain '.repeat(8000)};
const writeClipboard=async input=>page.evaluate(async({html,text})=>navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]),input);
let release;
try{
 for(const [label,first,last,plain,again] of [
  ['paragraph-to-code','paragraph','codeBlock',false,true],
  ['code-to-paragraph','codeBlock','paragraph',false,true],
  ['plain-paragraph-to-code','paragraph','codeBlock',true,false],
  ['plain-code-to-paragraph','codeBlock','paragraph',true,false],
 ]){
  const original=(first==='paragraph'?'<p><strong>'+firstText+'</strong></p>':'<pre><code>'+firstText+'</code></pre>')+(last==='paragraph'?'<p>'+tail+'</p>':'<pre><code>'+tail+'</code></pre>');
  const note=await rpc('save',{note:{title:'native clipboard '+label+' '+Date.now(),content:original,content_format:'html'}});await rpc('wait_index');
  const lastSegment=await rpc('document_locate',{id:note.id,revision:note.revision,byte_offset:Buffer.byteLength(original.slice(0,original.indexOf(first==='paragraph'?'</strong>':'</code>'))),bias:'before'});
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await page.locator('[data-segment-start="0"]').waitFor();await ready();
  await focus();await page.keyboard.press('Control+End');await page.locator('[data-window-start="1"]').waitFor();await ready();
  assert.ok(await body(note.id)===original,'navigation must preserve the original code block');
  await editor.evaluate((el: any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});await page.keyboard.press('ArrowLeft');await page.locator('[data-segment-start="'+lastSegment.offset+'"]').waitFor();await ready();
  assert.ok(await body(note.id)===original,'previous-window navigation preserves source');
  // Selection setup is programmatic; the paste below uses the real browser
  // clipboard and Control+V. Avoid depending on Chromium's visual caret at the
  // last long wrapped line while exercising the application's range handler.
  await editor.evaluate((el: any)=>{
   const doc=el.editor.state.doc;el.editor.commands.setTextSelection({from:doc.content.size-2,to:doc.content.size-1});
   el.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));
  });await page.locator('[data-window-start="1"]').waitFor();await ready();await page.locator('.document-selection-status').waitFor();
  const expected=await editor.evaluate((el: any,{first,last,firstText,tail,clip,second,plain,again})=>{
   const schema=el.editor.schema,block=(kind,text,bold=false)=>schema.node(kind,null,[schema.text(text,bold?[schema.marks.bold.create()]:[])]);
   const doc=schema.node('doc',null,[block(first,firstText,first==='paragraph'),block(last,tail)]);
   const state=el.editor.state.constructor.create({schema,doc,selection:el.editor.state.selection.constructor.fromJSON(doc,{type:'text',anchor:doc.firstChild.nodeSize-2,head:doc.firstChild.nodeSize+1})});
   const view=new el.editor.view.constructor(document.createElement('div'),{state});
   const paste=input=>{if(plain)view.pasteText(input.text);else{const data=new DataTransfer();data.setData('text/html',input.html);data.setData('text/plain',input.text);view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));}};
   try{
    paste(clip);if(again)paste(second);view.dispatch(view.state.tr.insertText('FOLLOW한글😀'));
    // Full fixture DOM normalizes this untouched ancestor attribute. The
    // product must preserve the original opening tag outside the edited span.
    const rendered=view.dom.innerHTML;return first==='codeBlock'?rendered.replace(/^<pre spellcheck="false"><code>/,'<pre><code>'):rendered;
   }finally{view.destroy();}
  },{first,last,firstText,tail,clip,second,plain,again});
  let entered,hold=true;const held=new Promise(r=>{entered=r;});
  await page.route('**/api/rpc',async route=>{
   const q=route.request().postDataJSON();
   if(process.env.INKISM_LAZY!=='0'&&q.id===note.id&&['get','document_render','revision_body'].includes(q.op))return route.fulfill({status:403,json:{ok:false,error:'whole-body renderer read forbidden'}});
   if(hold&&q.op==='document_blocks'&&q.id===note.id){hold=false;entered();await new Promise(r=>{release=r;});}
   await route.continue();
  });
  await writeClipboard(clip);await focus();await page.keyboard.press(plain?'Control+Shift+v':'Control+v');await Promise.race([held,page.waitForTimeout(10000).then(()=>{throw Error('native paste did not start a document range read');})]);await bounded();assert.ok(await body(note.id)===original,'preparation keeps original');
  if(again){await writeClipboard(second);await focus();await page.keyboard.press('Control+v');}
  await page.keyboard.type('FOLLOW',{delay:2});await page.keyboard.insertText('한글😀');await bounded();assert.ok(await body(note.id)===original,'raw clipboard and subsequent input remain provisional');
  release();release=null;await settled();const actual=await body(note.id);
  const untouched=original.slice(0,original.indexOf(first==='paragraph'?'</strong>':'</code>')-1);
  assert.ok(withoutBlockIds(actual).startsWith(untouched),'exact source bytes before the selected character, including original ancestor attributes');
  // Blocks the paste created after the giant first block gain identities. The
  // giant block also receives an ID through its exact outside opening-tag splice.
  const added=(expected.match(/<(p|pre)[ >]/g)??[]).length;
  if(withoutBlockIds(actual)!==expected){let at=0;while(at<Math.min(actual.length,expected.length)&&actual[at]===expected[at])at++;console.log('DIFF',{label,at,actualLength:actual.length,expectedLength:expected.length,actual:actual.slice(Math.max(0,at-60),at+150),expected:expected.slice(Math.max(0,at-60),at+150)});}
  const ids=assertBlockBytes(actual,expected,{added,message:label+' exact real-context native clipboard and follow-up'});await bounded();await page.unroute('**/api/rpc');
  await page.reload();await ready();await historyKey(page,'undo');await saved();assert.equal(await body(note.id),original,'restart undo original');
  await historyKey(page,'redo');await saved();assertBlockBytes(await body(note.id),expected,{added,ids,message:'restart redo full clipboard and follow-up'});
  console.log('PASS native clipboard '+label+', real Control+V'+(plain?' plain':'')+', delayed follow-up'+(again?'/second native paste':'')+', bounded view, exact save/restart undo/redo');
 }
 assert.deepEqual(errors,[]);console.log('PASS native clipboard application; lazy='+(process.env.INKISM_LAZY!=='0'));
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector<any>('.window-error')?.textContent,status:document.querySelector<any>('.document-selection-status')?.textContent,head:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{release?.();await browser.close();}
