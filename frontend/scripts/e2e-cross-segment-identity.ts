// The parent opening token is outside this edited giant-block slice.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:object={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const prefix='<p>앞 &amp;😀</p>',suffix='<p>뒤 &#128512;</p>';
const source=prefix+'<p><strong>'+'한글😀&amp; 선택 '.repeat(50000)+'</strong></p>'+suffix;
const note=await rpc('save',{note:{title:'부분 선택 ID '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const part=(await rpc('document_segments',{id:note.id,revision:1,ordinal:1,offset:3,limit:1})).segments[0];
const token=part.source.match(/^(&[^;]+;|[\s\S])/u)![0];
const raw=Buffer.from(source),start=part.byte_offset;
const expected=(replacement:string)=>Buffer.concat([raw.subarray(0,start),Buffer.from(replacement),raw.subarray(start+Buffer.byteLength(token))]).toString();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});
 const errors:string[]=[],writes:any[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/rpc',route=>{const q=route.request().postDataJSON();if(q.id===note.id){if(q.op==='document_splice_html')writes.push(q);if(['get','revision_body','document_render'].includes(q.op))return route.fulfill({status:403,json:{ok:false,error:'full body renderer read forbidden'}});}return route.continue();});
 const editor=page.locator('.tiptap-prose');
 const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
 const segment=(n:number)=>page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),n);
 const select=async()=>{
  await page.goto(base+'/?virtual=1&lazy=1');await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  await page.getByLabel('이동할 블록 번호').fill('2');await page.getByRole('button',{name:'이동',exact:true}).click();await ready();
  // Returning to the same block may restore its prior segment location.
  let offset=Number(await page.locator('[data-segment-start]').getAttribute('data-segment-start'));
  while(offset>0){await page.getByRole('button',{name:'이전 구간',exact:true}).click();await segment(--offset);await ready();}
  await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(1);await ready();
  await page.getByRole('button',{name:'다음 구간',exact:true}).click();await segment(2);await ready();
  await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(el.editor.state.doc.content.size-1);el.editor.view.focus();});
  await page.keyboard.press('Shift+ArrowRight');await segment(3);await page.locator('.document-selection-status').waitFor();await ready();
 };
 for(const kind of ['delete','paste']){
  await select();const before=writes.length;
  if(kind==='delete')await page.keyboard.press('Delete');else await editor.evaluate((el:any)=>el.editor.view.pasteText('삽입😀'));
  await waitSaved(page);const actual=(await rpc('get',{id:note.id})).content;
  const ids=assertBlockBytes(actual,expected(kind==='delete'?'':'삽입😀'),{added:1,message:`partial ${kind} identifies its outside parent`});
  const edits=writes.slice(before).flatMap(q=>q.edits??[q.content]);
  assert.ok(edits.some(e=>e.start===Buffer.byteLength(prefix+'<p')&&e.expected===''&&e.replacement===` id="${ids[0]}"`),'bounded opening-tag insertion sent');
  assert.ok(edits.every(e=>Buffer.byteLength(e.expected)<100000),'no full giant-block rewrite');
  await page.reload();await ready();await historyKey(page,'undo');await waitSaved(page);assert.equal((await rpc('get',{id:note.id})).content,source,'restart Undo restores exact tag and body');
  await historyKey(page,'redo');await waitSaved(page);assertBlockBytes((await rpc('get',{id:note.id})).content,expected(kind==='delete'?'':'삽입😀'),{added:1,ids,message:'redo keeps identity'});
  await historyKey(page,'undo');await waitSaved(page);assert.equal((await rpc('get',{id:note.id})).content,source);
 }
 assert.deepEqual(errors,[]);console.log('PASS partial giant-block selection delete/paste: opening-tag identity, exact UTF-8 outside bytes, bounded reads/writes, restart Undo/Redo');
}finally{await browser.close();}
