import {waitForAsync} from './async-browser-condition.ts';
// A real drag across two source pieces of the same oversized paragraph.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data;};
const prefix='<p><strong>',text='a'.repeat(1024*1024),suffix='</strong></p><p>후미 원문 &amp;😀</p>',source=prefix+text+suffix;
const note=await rpc('save',{note:{title:'내부 마우스 '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
const segments=(await rpc('document_segments',{id:note.id,revision:1,ordinal:0,offset:0,limit:2})).segments;
const seam=segments[1].byte_offset-prefix.length;assert.equal(segments[0].source,prefix+text.slice(0,seam));assert.ok(/^a+$/.test(segments[1].source));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']}),errors=[],reads=[];
page.on('pageerror',error=>errors.push(error.message));
const editor=page.locator('.tiptap-prose');
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
const saved=()=>page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
const coordinate=position=>editor.evaluate((el:any,position)=>{const box=el.editor.view.coordsAtPos(position);return {x:box.left+0.1,y:(box.top+box.bottom)/2};},position);
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();
 await page.route('**/api/rpc',route=>{const input=route.request().postDataJSON();if(input.id===note.id){if(process.env.INKISM_LAZY!=='0'&&['get','document_render','revision_body'].includes(input.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});if(['document_blocks','document_segments'].includes(input.op))reads.push(input);}return route.continue();});
 await editor.evaluate((el:any)=>{const e=el.editor;e.commands.setTextSelection(e.state.doc.content.size-11);e.view.focus();e.view.dispatch(e.state.tr.scrollIntoView());});
 const start=await coordinate(seam-9);await page.mouse.move(start.x,start.y);await page.mouse.down();
 const delta=await page.locator('.window-scroll').evaluate((host:any)=>{const active=host.querySelector('[data-window-start]');return Number.parseFloat(active.previousElementSibling.style.height||'0')+active.offsetHeight+2-host.scrollTop;});
 await page.mouse.wheel(0,delta);await page.locator('[data-segment-start="1"]').waitFor({timeout:5000});await ready();
 await editor.locator('p').first().evaluate((el:any)=>el.scrollIntoView({block:'start'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const end=await coordinate(21);await page.mouse.move(end.x,end.y,{steps:4});await page.mouse.up();
 await page.locator('.document-selection-status').waitFor();
 await editor.evaluate((el:any)=>el.editor.view.focus());await page.evaluate(()=>navigator.clipboard.writeText(''));await page.keyboard.press('Control+c');
 await waitForAsync(page,()=>navigator.clipboard.readText().then(value=>value==='a'.repeat(30)),null,{timeout:5000});await ready();
 assert.equal((await rpc('get',{id:note.id})).content,source,'mouse selection does not write');
 assert.ok(reads.every(input=>(input.limit??1)<=32));assert.ok(await page.locator('*').count()<1500);
 await page.keyboard.type('z');await saved();const actual=(await rpc('get',{id:note.id})).content,expected=prefix+text.slice(0,seam-10)+'z'+text.slice(seam+20)+suffix;
 // The edited giant paragraph gains its identity; every other byte is exact.
 assertBlockBytes(actual,expected,{added:1,message:'exact 30-character replacement and outer formatting/source preservation'});
 await historyKey(page,'undo');await saved();assert.equal((await rpc('get',{id:note.id})).content,source,'undo restores the full oversized paragraph');
 assert.deepEqual(errors,[]);console.log('PASS internal mouse drag: exact 30 characters across source seam, clipboard/replacement/undo, strong and trailing source preserved, bounded reads/DOM; lazy='+process.env.INKISM_LAZY);
}catch(error){console.error(await page.evaluate(()=>({error:document.querySelector('.window-error')?.textContent,segment:document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start'),selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON(),save:document.querySelector('.status-save')?.textContent})));throw error;}finally{await browser.close();}
