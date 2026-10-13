// Actual React/Go/Rust. Timed PM transactions and synthetic composition events
// arrive after serialization begins; these are not physical Windows IME tests.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
// Input over the whole-document selection replaces every block: each committed
// block is new and gains an identity (the native reference has none).
const blocks=(html:string)=>(html.match(/<p[ >]/g)??[]).length;
const base=process.env.INKISM_URL;assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.ok(v.ok,v.error);return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>waitSaved(page);
const original='<p><strong>'+'X'.repeat(1024*1024)+'</strong></p><p>끝 원문 &amp;😀</p>';
// Fits the existing 8MiB persisted history budget (UTF-16 before + after).
// The model fixture separately checks 5MiB calculations.
const html='<p><em>'+'P'.repeat(2*1024*1024)+'</em></p>';
const body=async id=>(await rpc('get',{id})).content;
let release;
try{
 for(const kind of ['keys','worker-keys','composition-commit','composition-cancel']){
  const follow=kind.endsWith('keys')?'LATE1한글😀LATE2':kind==='composition-commit'?'확정😀':'',note=await rpc('save',{note:{title:'yield '+kind+' '+Date.now(),content:original,content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press('Control+a');await page.locator('.document-selection-status').waitFor();
  const expected=await editor.evaluate((el:any,{html,follow})=>{
   const schema=el.editor.schema,doc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('old')])]);
   const state=el.editor.state.constructor.create({schema,doc,selection:el.editor.state.selection.constructor.fromJSON(doc,{type:'all'})});
   const view=new el.editor.view.constructor(document.createElement('div'),{state});
   try{view.pasteHTML(html);if(follow)view.dispatch(view.state.tr.insertText(follow));return view.dom.innerHTML;}finally{view.destroy();}
  },{html,follow});
  let entered,hold=true;const held=new Promise(r=>{entered=r;});
  await page.route('**/api/rpc',async route=>{
   const q=route.request().postDataJSON();
   if(process.env.INKISM_LAZY!=='0'&&q.id===note.id&&['get','document_render','revision_body'].includes(q.op))return route.fulfill({status:403,json:{ok:false,error:'whole renderer body forbidden'}});
   if(hold&&q.op==='document_blocks'&&q.id===note.id){hold=false;entered();await new Promise(r=>{release=r;});}
   await route.continue();
  });
  await editor.evaluate((el:any,html)=>el.editor.view.pasteHTML(html),html);await held;
  assert.equal(await body(note.id),original,'paste remains provisional during source preparation');
  // Identify bounded text serialization of the new P content. The original
  // source contains X, so preparation cannot trigger this timed input.
  await editor.evaluate((el:any,kind)=>{
   const create=document.createElement,view=el.editor.view,text=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
   const report:any=(window as any).yieldInput={divs:0,events:[],restored:false};
   const record=label=>report.events.push({label,pending:!!document.querySelector('.document-selection-status'),divs:report.divs});
   if(kind==='worker-keys'){
    const post=Worker.prototype.postMessage,terminate=Worker.prototype.terminate,active=new Set();report.starts=0;
    Worker.prototype.postMessage=function(...args){
     if(Array.isArray(args[0]?.context)&&args[0]?.source?.length>1024*1024){
      active.add(this);report.starts++;
      if(report.starts===1)setTimeout(()=>{
       record('first');report.events.at(-1).inflight=active.has(this);
       view.dispatch(view.state.tr.insertText('LATE1한글😀'));
       setTimeout(()=>{record('second');view.dispatch(view.state.tr.insertText('LATE2'));},10);
      },0);
     }
     return post.apply(this,args);
    };
    Worker.prototype.terminate=function(){active.delete(this);return terminate.call(this);};
    report.restore=()=>{Worker.prototype.postMessage=post;Worker.prototype.terminate=terminate;report.restored=true;};
    return;
   }
   document.createElement=function(...args){
    const node=create.apply(this,args);
    if(String(args[0]).toLowerCase()==='div')Object.defineProperty(node,'textContent',{configurable:true,get(){return text.get.call(this);},set(value){
     text.set.call(this,value);
     if(typeof value!=='string'||value.length<8192||!value.startsWith('P'))return;
     report.divs++;
     if(report.divs===12)setTimeout(()=>{
      record('first');
      if(kind==='keys'){
       view.dispatch(view.state.tr.insertText('LATE1한글😀'));
       setTimeout(()=>{record('second');view.dispatch(view.state.tr.insertText('LATE2'));},10);
      }else{
       view.dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
       view.dispatch(view.state.tr.insertText('候補'));
       setTimeout(()=>{
        record('end');
        if(kind==='composition-commit')view.dispatch(view.state.tr.insertText('확정😀',view.state.selection.head-2,view.state.selection.head));
        view.dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:kind==='composition-commit'?'확정😀':''}));
       },25);
      }
     },0);
    }});
    return node;
   };
   report.restore=()=>{document.createElement=create;report.restored=true;};
  },kind);
  release();release=null;
  await page.waitForFunction(()=>(window as any).yieldInput?.events.length===2);
  await page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));await saved();
  const report=await page.evaluate(()=>{(window as any).yieldInput.restore();return {events:(window as any).yieldInput.events,divs:(window as any).yieldInput.divs,starts:(window as any).yieldInput.starts};});
  assert.ok(report.events.every(e=>e.pending),'late input must land while calculation is still pending');
  if(kind==='worker-keys')assert.ok(report.events[0].inflight&&report.starts>=2,'actual in-flight Worker must be superseded and restarted');
  else assert.ok(report.events.every(e=>e.divs>=12),'late input must follow real serialization work');
  const ids=assertBlockBytes(await body(note.id),expected,{added:blocks(expected),message:'native model exact result preserves accepted late input and drops canceled composition'});
  assert.ok((await editor.textContent()).length<40000);assert.ok(await page.locator('*').count()<1500);
  await page.unroute('**/api/rpc');await page.reload();await ready();
  await historyKey(page,'undo');await saved();assert.equal(await body(note.id),original,'one restart undo preserves original');
  await historyKey(page,'redo');await saved();assertBlockBytes(await body(note.id),expected,{added:blocks(expected),ids,message:'restart redo preserves paste and late input together'});
  console.log('PASS yield application '+kind+'; 2MiB paste, actual pending timers, exact native model/save/restart undo/redo, bounded DOM; '+JSON.stringify(report));
 }
 assert.deepEqual(errors,[]);console.log('PASS selection yield application; lazy='+(process.env.INKISM_LAZY!=='0'));
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,status:document.querySelector('.document-selection-status')?.textContent,events:(window as any).yieldInput?.events})));throw error;}
finally{release?.();await browser.close();}
