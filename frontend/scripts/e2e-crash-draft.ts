// Real renderer checkpoint, killed renderer, then the Rust fixture kills the engine.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL,scenario=process.env.INKISM_CRASH_SCENARIO;
assert.ok(base && process.env.INKISM_CRASH_MANIFEST);
const rpc=async(op,args={})=>{
 const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const v=await r.json();assert.equal(v.ok,true,v.error);return v.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
let release,saveBlocked=false,lastCommitted,putAttempts=0;
const savedScenario=['saved','stalled'].includes(scenario);
const marker='LATE_AFTER_SAVE😀',first='FIRST_INPUT';
page.on('response',async response=>{
 try{
  const request=response.request();if(!request.url().endsWith('/api/rpc'))return;
  const q=request.postDataJSON();if(q.op!=='draft_journal_put')return;
  const result=await response.json();if(result.ok)lastCommitted=q.draft;
 }catch{ /* Closed renderer responses are not checkpoint acknowledgements. */ }
});
try{
 const notebook=await rpc('save_notebook',{name:'Crash fixture notebook'}),tags=['보관😀'];
 let original=null,expectedContent,format='html';
 if(scenario==='existing' || scenario==='split'){
  format='markdown';original=await rpc('save',{note:{title:'기존 원문',content:'\ufeff# 기준\r\n한글😀\r끝',
   content_format:format,notebook_id:notebook.id,tags}});
 }else if(scenario==='paged'){
  const content=Array.from({length:10000},(_,i)=>'<p>원문'+String(i).padStart(5,'0')+' 한글😀</p>').join('');
  original=await rpc('save',{note:{title:'큰 노트 원문',content,content_format:'html',notebook_id:notebook.id,tags}});
  await rpc('wait_index');
 }
 // The 분할 편집 entry was removed; a split saved by an older layout still opens and still journals.
 if(scenario==='split')await rpc('split_set',{id:original.id,ids:[original.id],mode:'source'});
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base+(scenario==='paged'?'/?virtual=1&lazy=1':''));
 if(original)await page.getByRole('button',{name:'노트 열기: '+original.title,exact:true}).click();
 else await page.locator('.topbar-new-note').click();
 await page.locator('.title-input').waitFor();
 if(scenario!=='paged' && format==='html')await page.getByRole('button',{name:'HTML',exact:true}).click();
 if(scenario==='split'){
  await page.locator('.split-secondary .cm-content').waitFor();
 }
 const sourceEditor=page.locator(scenario==='split'?'.split-secondary .cm-content':'.split-primary .cm-content');
 if(scenario==='paged')await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
 else await sourceEditor.waitFor();
 const block=new Promise(resolve=>{release=resolve;});
 if(scenario!=='saved')await page.route('**/api/rpc',async route=>{
  const op=route.request().postDataJSON().op;
  if(scenario==='retry' && op==='draft_journal_put' && ++putAttempts<=2)
   return route.fulfill({status:503,json:{ok:false,error:'transient journal failure'}});
  if(scenario==='stalled' && op==='draft_journal_put'){
   await block;try{await route.fulfill({status:503,json:{ok:false,error:'stalled journal transport'}});}catch{}return;
  }
  if(scenario==='stalled')return route.continue();
  if(['save','patch','document_splice','document_splice_source','document_splice_html'].includes(op)){
   saveBlocked=true;if(scenario!=='retry')await block;
   try{await route.fulfill({status:503,json:{ok:false,error:'crash fixture blocks normal save'}});}catch{}
  }else await route.continue();
 });
 const title=scenario==='split'?original.title:'강제 종료 '+scenario+' '+Date.now();
 if(scenario!=='split')await page.locator('.title-input').fill(title);
 if(!original){
  await page.getByRole('combobox',{name:'이 노트가 속한 노트북',exact:true}).selectOption(notebook.id);
  // Keep this fixture in the existing title/body paths; new-note tags are empty.
 }
 if(scenario==='paged'){
  await page.locator('.tiptap-prose').evaluate((el: any,text)=>el.editor.chain().focus().setTextSelection(1).insertContent(text).run(),first);
 }else{
  const source='\ufeff'+(format==='markdown'?'# ':'<p>')+first+' 한글😀'+(format==='markdown'?'\n原文':'</p>');
  await sourceEditor.click();await page.keyboard.press('Control+a');await page.keyboard.insertText(source);
  expectedContent=source;
 }
 if(!savedScenario){
  const deadline=Date.now()+15000;while(!saveBlocked && Date.now()<deadline)await page.waitForTimeout(25);
  assert.equal(saveBlocked,true,'a real normal-save request must be in flight');
  if(scenario==='retry'){
   // Both journal and ordinary save failed; no more input triggers the retry.
  }else if(scenario==='paged'){
   await page.locator('.tiptap-prose').evaluate((el: any,{text,offset})=>el.editor.chain().focus().setTextSelection(offset).insertContent(text).run(),{text:marker,offset:1+first.length});
   const id=await page.locator('.tiptap-prose').evaluate((el:any)=>el.editor.state.doc.firstChild.attrs.id);
   assert.match(id,/^ink-block-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,'edited block has an identity');
   expectedContent=original.content.replace('<p>',`<p id="${id}">`+first+marker);
  }else{
   await sourceEditor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(marker);
   expectedContent+=marker;
  }
  const deadline2=Date.now()+15000;
  const required=scenario==='retry'?first:marker;
  while(Date.now()<deadline2 && !(lastCommitted?.note.title===title && JSON.stringify(lastCommitted.body).includes(required)))
   await page.waitForTimeout(25);
  assert.equal(lastCommitted?.note.title,title);
  assert.ok(JSON.stringify(lastCommitted.body).includes(required),'pending input must have a durable checkpoint');
  if(scenario==='retry')assert.ok(putAttempts>=3,'failed checkpoints retry without new input');
  assert.equal(lastCommitted.body.kind,scenario==='paged'?'partial':'complete');
  assert.equal((await rpc('draft_journal_status')).pending,1);
  if(original)assert.deepEqual(await rpc('get',{id:original.id}),original,'blocked save never changes original');
  if(scenario==='new'){
   const composition=await page.context().newCDPSession(page);
   await composition.send('Input.imeSetComposition',{text:'조합취소검사',selectionStart:5,selectionEnd:5});
   await page.waitForTimeout(450);
   assert.equal(JSON.stringify(lastCommitted.body).includes('조합취소검사'),false,'uncommitted candidate is not journaled');
   await composition.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
  }
 }else{
  await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
  const clearDeadline=Date.now()+5000;
  while((await rpc('draft_journal_status')).pending && Date.now()<clearDeadline)await page.waitForTimeout(25);
  assert.equal((await rpc('draft_journal_status')).pending,0);
  const notes=(await rpc('list',{view:'all'})).items;assert.equal(notes.length,1);
  original=await rpc('get',{id:notes[0].id});assert.equal(original.content,expectedContent);
 }
 assert.deepEqual(errors,[]);
 const manifest={original,expectedContent,title,format,tags:original?.tags??[],notebook_id:notebook.id,recoverySuffix:scenario==='split'?' (분할 자동 복구)':' (자동 복구)',
  expectRecovered:!savedScenario,source_id:lastCommitted?.note.id??original?.id};
 const crashed=page.waitForEvent('crash',{timeout:15000}),cdp=await page.context().newCDPSession(page);
 void cdp.send('Page.crash').catch(()=>{});await crashed;
 await writeFile(process.env.INKISM_CRASH_MANIFEST,JSON.stringify(manifest),'utf8');
 console.log('PASS: '+scenario+'; acknowledged checkpoint; real renderer crash without unload; original preserved');
}finally{release?.();await browser.close();}
