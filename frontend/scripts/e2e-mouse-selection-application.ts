import {waitForAsync} from './async-browser-condition.ts';
// Real mouse drag across a virtualized window in the shipped React/Go/Rust app.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data;};
const texts=Array.from({length:10000},(_,i)=>`문단 ${i} `+'가나다라마바사 아자차카타파하 '.repeat(13));
const html=list=>list.map(text=>`<p>${text}</p>`).join('');
const source=html(texts);
const equalBody=(actual,expected,label)=>{
 let at=0;while(at<Math.min(actual.length,expected.length)&&actual[at]===expected[at])at++;
 assert.ok(actual===expected,label+' '+JSON.stringify({at,actualChars:actual.length,expectedChars:expected.length,actual:actual.slice(Math.max(0,at-40),at+100),expected:expected.slice(Math.max(0,at-40),at+100)}));
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
const coordinate=(block,offset)=>editor.evaluate((el: any,{block,offset})=>{const e=el.editor;let position=1+offset;for(let i=0;i<block;i++)position+=e.state.doc.child(i).nodeSize;const box=e.view.coordsAtPos(position);return {x:box.left+0.1,y:(box.top+box.bottom)/2};},{block,offset});
try{
 for(const backwards of ((process.env.INKISM_MOUSE_AUTOSCROLL==='1'||process.env.INKISM_MOUSE_RESELECT==='1')?[false]:[false,true])){
  const note=await rpc('save',{note:{title:'마우스 선택 '+backwards+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
  await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  const reads=[];
  const monitor=route=>{const request=route.request().postDataJSON();if(request.id===note.id){if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});if(['document_blocks','document_segments'].includes(request.op))reads.push(request);}return route.continue();};
  await page.route('**/api/rpc',monitor);
  if(backwards){await page.getByRole('button',{name:'다음 구간',exact:true}).click();await page.locator('[data-window-start="32"]').waitFor();await ready();}
  const origin={block:backwards?32:31,offset:10},destination={block:backwards?31:32,offset:20};
  const local=backwards?0:31;
  await editor.evaluate((el: any,{local})=>{const e=el.editor;let position=11;for(let i=0;i<local;i++)position+=e.state.doc.child(i).nodeSize;e.commands.setTextSelection(position);e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());},{local});
  const start=await coordinate(local,10);await page.mouse.move(start.x,start.y);await page.mouse.down();
  const delta=await page.locator('.window-scroll').evaluate((host,backwards)=>{const active=host.querySelector<any>('[data-window-start]');return backwards?-host.scrollTop:Number.parseFloat(active.previousElementSibling.style.height||'0')+active.offsetHeight+2-host.scrollTop;},backwards);
  await page.mouse.wheel(0,delta);
  await page.locator(`[data-window-start="${backwards?0:32}"]`).waitFor({timeout:5000});await ready();
  if(process.env.INKISM_MOUSE_AUTOSCROLL==='1'){
   const edge=await page.locator('.window-scroll').boundingBox();await page.mouse.move(start.x,edge.y+edge.height-1);
   await page.locator('[data-window-start="64"]').waitFor({timeout:10000});await ready();destination.block=64;
  }
  await editor.locator('p').nth(backwards?31:0).evaluate((el: any)=>el.scrollIntoView({block:'center'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const end=await coordinate(backwards?31:0,20);await page.mouse.move(end.x,end.y,{steps:4});await page.mouse.up();
  await page.locator('.document-selection-status').waitFor();
  if(process.env.INKISM_MOUSE_RESELECT==='1'){
   const from=await coordinate(0,30),to=await coordinate(0,50);
   await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});await page.mouse.up();
   origin.block=32;origin.offset=30;destination.block=32;destination.offset=50;
   await page.locator('.document-selection-status').waitFor({state:'hidden'});
  }
  const actual=await editor.evaluate((el: any)=>{const head=el.editor.state.selection.$head;return {block:Number(el.closest('[data-window-start]').getAttribute('data-window-start'))+head.index(0),offset:head.parentOffset};});
  assert.deepEqual(actual,destination,'mouse releases at the exact text position');
  assert.equal((await rpc('get',{id:note.id})).content,source,'drag never writes the body');
  const oracle=await editor.evaluate((el: any,{texts,origin,destination})=>{
   const native=new el.editor.constructor({extensions:el.editor.extensionManager.extensions.filter(extension=>extension.type==='node'||extension.type==='mark'),parseOptions:{preserveWhitespace:'full'},content:texts.slice(0,100).map(text=>`<p>${text}</p>`).join('')});
   const position=point=>{let at=1+point.offset;for(let i=0;i<point.block;i++)at+=native.state.doc.child(i).nodeSize;return at;};
   try{native.commands.setTextSelection({from:position(origin),to:position(destination)});const fragment=native.state.selection.content().content,text=fragment.textBetween(0,fragment.size,'\n\n','\ufffc');native.commands.insertContent('z');return {text,html:native.getHTML()};}finally{native.destroy();}
  },{texts,origin,destination});
  await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+c');
  await waitForAsync(page,expected=>navigator.clipboard.readText().then(value=>value===expected),oracle.text,{timeout:5000});await ready();
  assert.ok(reads.every(request=>request.limit<=32),'bounded body reads');assert.ok(await page.locator('*').count()<1500,'bounded DOM');
  await page.keyboard.type('z');await saved();
  const actualBody=(await rpc('get',{id:note.id})).content;
  let expectedBody=oracle.html+html(texts.slice(100));
  {
   // A local edit, and equally input committed over a document selection,
   // assigns an identity to its touched block. The native node/mark-only
   // oracle deliberately has no identity plugin: verify exactly one generated
   // ID at the edited paragraph, then include that ID in the byte-for-byte
   // oracle instead of stripping attributes from the saved body.
   const ids=[...actualBody.matchAll(/ id="([^"]*)"/g)];
   assert.equal(ids.length,1,'only the locally edited paragraph acquires an ID');
   assert.match(ids[0][1],/^ink-block-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
   // The replacement joins into the first selected paragraph (either direction).
   const edited=Math.min(origin.block,destination.block),blockOpening='<p>문단 '+edited+' ';
   assert.equal(expectedBody.split(blockOpening).length,2,'the edited paragraph has one exact source location');
   expectedBody=expectedBody.replace(blockOpening,'<p id="'+ids[0][1]+'">문단 '+edited+' ');
  }
  equalBody(actualBody,expectedBody,'replacement uses the exact native range');
  await historyKey(page,'undo');await saved();assert.equal((await rpc('get',{id:note.id})).content,source,'undo preserves all outside paragraphs');
  await page.unroute('**/api/rpc',monitor);
  console.log(`PASS real mouse drag ${backwards?'backwards':'forwards'}, wheel window swap, exact range/clipboard/replacement/undo, bounded reads/DOM; lazy=${process.env.INKISM_LAZY}`);
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,window:document.querySelector('[data-window-start]')?.getAttribute('data-window-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),selected:document.querySelector('.document-selection-status')?.textContent,save:document.querySelector('.status-save')?.textContent})));throw error;}finally{await browser.close();}
