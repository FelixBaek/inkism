// Shipped React/Go/Rust, isolated profile. No personal desktop automation.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;
assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const source='<p><strong>'+('X'.repeat((process.env.INKISM_LARGE_SELECTION==='1'?19:1)*1024*1024))+'</strong></p><p>끝 원문 &amp;😀</p>';
const note=await rpc('save',{note:{title:'짧은 선택 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const end=Buffer.byteLength(source.slice(0,source.indexOf('</strong>')));
const location=await rpc('document_locate',{id:note.id,revision:1,byte_offset:end,bias:'before'});
const last=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:location.offset,limit:1})).segments[0];
const seam=last.byte_offset;
assert.ok(location.offset>2);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],splices=[],reads=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>waitSaved(page);
const body=async()=>(await rpc('get',{id:note.id})).content;
const idle=()=>page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await page.route('**/api/rpc',route=>{
  const request=route.request().postDataJSON();
  if(request.id===note.id){
   if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(request.op))return route.fulfill({status:403,json:{ok:false,error:'whole-body renderer read forbidden'}});
   if(request.op==='document_segments')reads.push(request);
   if(request.op==='document_splice_html')splices.push(request);
  }
  return route.continue();
 });
 const select=async()=>{
  // Ctrl+End first reaches the small trailing paragraph. Move back to the
  // giant block's last internal source piece without stepping through it.
  await editor.evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press('Control+End');await page.locator('[data-window-start="1"]').waitFor();await ready();
  await editor.evaluate((el: any)=>{el.editor.commands.setTextSelection(1);el.editor.view.focus();});await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(n=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')===String(n),location.offset);await ready();
  await editor.evaluate((el: any)=>{let start;el.editor.state.doc.descendants((node,at)=>{if(start===undefined&&node.isTextblock)start=at+1;});el.editor.commands.setTextSelection(start);el.editor.view.focus();});
  await page.keyboard.press('Shift+ArrowLeft');await page.locator('.document-selection-status').waitFor();await ready();
 };
 await select();reads.length=0;
 const inserted='붙여넣기😀 '.repeat(22000),html='<p><em>'+inserted+'</em></p>';
 const reference=await editor.evaluate((el: any,{source,html,seam})=>{
  const schema=el.editor.schema,text=source.slice('<p><strong>'.length,source.indexOf('</strong>'));
  const doc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text(text,[schema.marks.bold.create()])]),schema.node('paragraph',null,[schema.text('끝 원문 &😀')])]);
  const from=1+seam-1-'<p><strong>'.length;
  const state=el.editor.state.constructor.create({schema,doc,selection:el.editor.state.selection.constructor.create(doc,from,from+1)});
  const view=new el.editor.view.constructor(document.createElement('div'),{state});
  try{view.pasteHTML(html);const paste=view.dom.innerHTML;view.dispatch(view.state.tr.insertText('후속'));return {paste,follow:view.dom.innerHTML};}finally{view.destroy();}
 },{source,html,seam});
 await editor.evaluate((el: any,html)=>{el.editor.view.focus();el.editor.view.pasteHTML(html);},html);await idle();await saved();
 const expected=reference.paste;
 const pasteIds=assertBlockBytes(await body(),expected,{added:1,message:'large rich paste keeps exact outside bytes and formatting'});
 assert.ok((await editor.textContent()).length<33000);assert.ok(await page.locator('*').count()<1500,'bounded mounted display after paste');
 await page.keyboard.insertText('후속');await saved();
 // Typing in the internal window identifies the giant paragraph enclosing it
 // (one splice of its opening tag); the native reference has no identity plugin.
 assertBlockBytes(await body(),reference.follow,{added:1,ids:pasteIds,message:'follow-up typing lands at inserted end with inherited format'});
 await page.reload();await ready();
 await historyKey(page,'undo');await saved();assertBlockBytes(await body(),expected,{added:1,ids:pasteIds,message:'restart undo follow-up'});
 await historyKey(page,'undo');await saved();assert.equal(await body(),source,'restart undo large paste');
 await historyKey(page,'redo');await saved();assertBlockBytes(await body(),expected,{added:1,ids:pasteIds,message:'restart redo large paste'});
 assert.deepEqual(errors,[]);
 console.log('PASS large rich paste, exact outside source and marks, bounded mounted display, follow-up caret/marks, restart undo/redo; lazy='+(process.env.INKISM_LAZY!=='0'));
}finally{await browser.close();}
