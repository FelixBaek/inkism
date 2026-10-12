// Native paste and follow-up transactions, actual React/Go/Rust, isolated profile.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.ok(v.ok,v.error);return v.data;};
const original='<p><strong>'+'X'.repeat(1024*1024)+'</strong></p><p>끝 원문 &amp;😀</p>';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose'),focus=()=>editor.evaluate((el:any)=>el.editor.view.focus());
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
const settled=async()=>{await page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));await saved();};
const body=async(id)=>(await rpc('get',{id})).content;
const bound=async()=>{assert.ok(await page.locator('*').count()<1500,'bounded live DOM');assert.ok((await editor.textContent()).length<40000,'bounded displayed text');};
const prepare=async(label)=>{
 const note=await rpc('save',{note:{title:'pending paste '+label+' '+Date.now(),content:original,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
 await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();await focus();await page.keyboard.press('Control+a');await page.locator('.document-selection-status').waitFor();
 return note;
};
const reference=async(html,second,follow)=>editor.evaluate((el:any,{html,second,follow})=>{
 const schema=el.editor.schema,doc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('X'.repeat(1024*1024),[schema.marks.bold.create()])]),schema.node('paragraph',null,[schema.text('끝 원문 &😀')])]);
 const state=el.editor.state.constructor.create({schema,doc,selection:el.editor.state.selection.constructor.fromJSON(doc,{type:'all'})});
 const view=new el.editor.view.constructor(document.createElement('div'),{state});
 try{view.pasteHTML(html);if(second)view.pasteHTML(second);view.dispatch(view.state.tr.insertText(follow));return view.dom.innerHTML;}finally{view.destroy();}
},{html,second,follow});
let release;
try{
 for(const [label,html,second,ime] of [
  ['inline','<p><em>'+'붙여넣기😀 '.repeat(14000)+'</em></p>','<p><strong>'+'SECOND '.repeat(10000)+'</strong></p><p>끝</p>',false],
  ['paragraphs',Array.from({length:3500},(_,i)=>'<p>문단 '+i+' <em>본문😀</em></p>').join(''),'',true],
 ]){
  const note=await prepare(label),follow='native_KEYS한글😀',expected=await reference(html,second,follow);
  let entered,hold=true;const held=new Promise(r=>{entered=r;});
  await page.route('**/api/rpc',async route=>{const q=route.request().postDataJSON();if(hold&&q.id===note.id&&q.op==='document_blocks'){hold=false;entered();await new Promise(r=>{release=r;});}await route.continue();});
  await editor.evaluate((el:any,html)=>{el.editor.view.focus();el.editor.view.pasteHTML(html);},html);await held;
  await bound();assert.ok(await body(note.id)===original,'preparation must preserve original');
  if(second)await editor.evaluate((el:any,html)=>el.editor.view.pasteHTML(html),second);
  await page.keyboard.type('native_KEYS',{delay:2});
  if(ime){
   const cdp=await page.context().newCDPSession(page);
   await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
   await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
   release();release=null;await page.waitForTimeout(500);
   assert.ok(await body(note.id)===original,'preparation must not commit a provisional candidate');
   await cdp.send('Input.insertText',{text:'한글😀'});
  }else{
   await page.keyboard.insertText('한글😀');assert.ok(await body(note.id)===original,'follow-up stays provisional');await bound();release();release=null;
  }
  await settled();assert.ok(await body(note.id)===expected,label+' exact native baseline including all follow-up input');await bound();
  await page.unroute('**/api/rpc');await page.reload();await ready();
  await historyKey(page,'undo');await saved();assert.ok(await body(note.id)===original,'one restart undo restores original');
  await historyKey(page,'redo');await saved();assert.ok(await body(note.id)===expected,'restart redo restores paste and follow-up together');
  console.log('PASS pending',label,'native keys/Unicode'+(ime?'/CDP IME':'/second large paste')+', exact save, bounded view, one restart undo/redo');
 }
 // A failed read keeps both the initial paste and subsequent edits for retry.
 const note=await prepare('failed read'),html='<p><em>'+'RETRY '.repeat(24000)+'</em></p>',expected=await reference('<p><em>'+'RETRY '.repeat(24000)+'</em></p>','','RETAINED');
 let fail=true;
 await page.route('**/api/rpc',async route=>{const q=route.request().postDataJSON();if(fail&&q.id===note.id&&q.op==='document_blocks'){fail=false;return route.fulfill({status:503,json:{ok:false,error:'fixture failed read'}});}await route.continue();});
 await editor.evaluate((el:any,html)=>el.editor.view.pasteHTML(html),html);await page.locator('.window-error').waitFor();
 await focus();await page.keyboard.type('RETAINED',{delay:2});
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
 await page.waitForTimeout(100);await bound();assert.ok(await body(note.id)===original,'failed read and canceled IME keep original');
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();await settled();assert.ok(await body(note.id)===expected,'retry keeps the original paste and all accepted keys, drops canceled IME');
 await page.unroute('**/api/rpc');
 assert.deepEqual(errors,[]);
 console.log('PASS pending paste read failure/retry, canceled candidate and original preservation; lazy='+(process.env.INKISM_LAZY!=='0'));
}finally{release?.();await browser.close();}
