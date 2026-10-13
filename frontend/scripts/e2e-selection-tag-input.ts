// Native typing while the final outside-tag byte lookup is awaiting its worker.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.ok(v.ok,v.error);return v.data;};
const source='<p><strong>'+'X'.repeat(600000)+'</strong></p><p>끝 &amp;😀</p>';
const note=await rpc('save',{note:{title:'tag input '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const first=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:1})).segments[0];
const seam=first.byte_offset+Buffer.byteLength(first.source);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
try{
 await page.route('**/api/info',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),lazy_editor:false}});});
 await page.goto(base+'/?virtual=1');await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(el.editor.state.doc.content.size-1);el.editor.view.focus();});
 await page.keyboard.press('ArrowRight');await page.locator('[data-segment-start="1"]').waitFor();
 await editor.evaluate((el:any)=>{el.editor.commands.setTextSelection(el.editor.state.doc.content.size-1);el.editor.view.focus();});
 await page.keyboard.press('Shift+ArrowRight');await page.locator('[data-segment-start="2"]').waitFor();await page.locator('.document-selection-status').waitFor();
 await page.evaluate(()=>{
  const Native=window.Worker;const report=(window as any).tagInput={held:false,released:false,deliver:null};
  window.Worker=class extends Native{
   constructor(url,options){super(url,options);if(!String(url).includes('block-range.worker'))return;
    let handler,hold=false;Object.defineProperty(this,'onmessage',{get:()=>handler,set:value=>{handler=value;}});
    const post=this.postMessage.bind(this);this.postMessage=(data,...rest)=>{hold=data.expected==='<p>'&&!report.released;return post(data,...rest);};
    this.addEventListener('message',event=>{const deliver=()=>handler?.call(this,event);if(hold){report.held=true;report.deliver=deliver;}else deliver();});
   }
  };report.restore=()=>{window.Worker=Native;};
 });
 await editor.evaluate((el:any)=>el.editor.view.focus());await page.keyboard.type('A');
 await page.waitForFunction(()=>(window as any).tagInput.held);
 assert.equal((await rpc('get',{id:note.id})).content,source,'uncommitted tag lookup preserves original');
 await page.keyboard.type('LATE');await page.keyboard.insertText('한글😀');
 await page.evaluate(()=>{const r=(window as any).tagInput;r.released=true;r.deliver();});
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));await waitSaved(page);
 const expected=source.slice(0,seam)+'ALATE한글😀'+source.slice(seam+1);
 const ids=assertBlockBytes((await rpc('get',{id:note.id})).content,expected,{added:1,message:'final tag lookup retains all native input'});
 await page.evaluate(()=>(window as any).tagInput.restore());await page.reload();await ready();
 await historyKey(page,'undo');await waitSaved(page);assert.equal((await rpc('get',{id:note.id})).content,source);
 await historyKey(page,'redo');await waitSaved(page);assertBlockBytes((await rpc('get',{id:note.id})).content,expected,{added:1,ids,message:'restart redo retains late input'});
 assert.deepEqual(errors,[]);console.log('PASS final tag lookup native typing, exact source, restart undo/redo');
}finally{await browser.close();}
