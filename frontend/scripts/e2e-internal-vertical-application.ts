import {waitForAsync} from './async-browser-condition.ts';
// Oversized-paragraph navigation and range integrity. This does not claim that
// arbitrary source splits have the same soft-wrap phase as a full paragraph.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{
 const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const value=await response.json();assert.ok(value.ok,value.error);return value.data;
};
const prefix='<p><strong>',text='a'.repeat(1024*1024),suffix='</strong></p><p>후미 원문 &amp;😀</p>',source=prefix+text+suffix;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
const point=()=>editor.evaluate((el:any)=>{
 const e=el.editor,host=el.closest('[data-segment-start]'),$head=e.state.selection.$head;
 const byte=Number(host.getAttribute('data-segment-byte'));
 return {head:byte+(byte===0?$head.parentOffset+11:$head.parentOffset),x:e.view.coordsAtPos($head.pos).left,local:$head.parentOffset};
});
try{
 for(const shift of process.env.INKISM_INTERNAL_VERTICAL_PLAIN_ONLY==='1'?[false]:[false,true]){
  const note=await rpc('save',{note:{title:'내부 상하 '+shift+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
  const reads=[];const bounded=async route=>{
   const input=route.request().postDataJSON();if(input.id===note.id){
    if(process.env.INKISM_LAZY!=='0'&&['get','revision_body','document_render'].includes(input.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});
    if(['document_blocks','document_segments'].includes(input.op))reads.push(input);
   }return route.continue();
  };await page.route('**/api/rpc',bounded);
  await editor.evaluate((el:any)=>{const e=el.editor;e.commands.setTextSelection(e.state.doc.content.size-1);e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());});
  const origin=await point();assert.ok(origin.head>16000&&origin.head<33000);
  const down=(shift?'Shift+':'')+'ArrowDown',up=(shift?'Shift+':'')+'ArrowUp';
  await page.keyboard.press(down);await page.locator('[data-segment-start="1"]').waitFor({timeout:5000});await ready();
  const target=await point();assert.ok(target.head>origin.head,'down enters the next source span');
  assert.ok(Math.abs(target.x-origin.x)<1,'down retains the original column');
  assert.equal((await rpc('get',{id:note.id})).content,source,'navigation preserves all source bytes');
  await page.keyboard.press(up);await page.waitForFunction(byte=>{
   const el=document.querySelector<any>('.tiptap-prose'),e=el?.editor,host=el?.closest('[data-segment-byte]');
   if(!e?.isInitialized)return false;const start=Number(host.getAttribute('data-segment-byte'));
   return start+(start===0?11:0)+e.state.selection.$head.parentOffset===byte;
  },origin.head,{timeout:5000});await ready();
  assert.equal((await point()).head,origin.head,'up returns to the exact original source byte');
  await page.keyboard.press(down);await page.locator('[data-segment-start="1"]').waitFor({timeout:5000});await ready();
  assert.equal((await point()).head,target.head,'the round trip preserves the target');
  if(shift){
   await page.locator('.document-selection-status').waitFor();await page.evaluate(()=>navigator.clipboard.writeText(''));
   await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.press('Control+c');
   await waitForAsync(page,count=>navigator.clipboard.readText().then(value=>value==='a'.repeat(count)),target.head-origin.head,{timeout:5000});await ready();
  }
  assert.ok(reads.every(input=>(input.limit??1)<=32));assert.ok(await page.locator('*').count()<1500);
  await page.keyboard.type('z');await saved();
  const start=(shift?origin.head:target.head)-prefix.length,end=target.head-prefix.length;
  assert.equal((await rpc('get',{id:note.id})).content,prefix+text.slice(0,start)+'z'+text.slice(end)+suffix,'exact insertion/range replacement and outside formatting');
  await historyKey(page,'undo');await saved();
  assert.equal((await rpc('get',{id:note.id})).content,source,'undo preserves original oversized source');
  await page.unroute('**/api/rpc',bounded);
  console.log(`PASS internal ${shift?'Shift+':''}up/down: column, byte round trip, exact ${shift?'clipboard/':''}typing/undo, bounded reads and DOM; lazy=${process.env.INKISM_LAZY}`);
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})));throw error;}
finally{await browser.close();}
