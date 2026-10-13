// Native paste and follow-up transactions, actual React/Go/Rust, isolated profile.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import {historyKey} from './history-keys.ts';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL;assert.ok(base,'isolated application URL required');
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.ok(v.ok,v.error);return v.data;};
const original='<p><strong>'+'X'.repeat(1024*1024)+'</strong></p><p>끝 원문 &amp;😀</p>';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const editor=page.locator('.tiptap-prose'),focus=()=>editor.evaluate((el: any)=>el.editor.view.focus());
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));
const saved=()=>waitSaved(page);
const settled=async()=>{await page.waitForFunction(()=>!document.querySelector('.document-selection-status')&&!document.querySelector('.window-error'));await saved();};
const body=async(id)=>(await rpc('get',{id})).content;
const bound=async()=>{assert.ok(await page.locator('*').count()<1500,'bounded live DOM');assert.ok((await editor.textContent()).length<40000,'bounded displayed text');};
const prepare=async(label)=>{
 const note=await rpc('save',{note:{title:'pending paste '+label+' '+Date.now(),content:original,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='0'?'':'&lazy=1'));
 await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();await focus();await page.keyboard.press('Control+a');await page.locator('.document-selection-status').waitFor();
 return note;
};
let release;
try{
 const note=await prepare('heading command');
 let entered;const held=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const delayed=async route=>{const q=route.request().postDataJSON();if(q.id===note.id&&q.op==='document_blocks'){entered();await gate;}return route.continue();};
 await page.route('**/api/rpc',delayed);
 await editor.evaluate((el: any)=>el.editor.view.pasteHTML('<p>새 본문</p><p>끝</p>'));await held;
 await editor.evaluate((el: any)=>el.editor.chain().focus().setHeading({level:2}).run());
 await page.keyboard.insertText(' 후속😀');
 assert.equal(await body(note.id),original,'uncommitted source preserved');
 release();await settled();
 // Both blocks were created by the paste over the whole document: each gains an identity.
 const ids=assertBlockBytes(await body(note.id),'<p>새 본문</p><h2>끝 후속😀</h2>',{added:2,message:'pending heading and follow-up preserved'});await bound();
 await page.unroute('**/api/rpc');await page.reload();await ready();
 await historyKey(page,'undo');await saved();assert.equal(await body(note.id),original,'one restart undo');
 await historyKey(page,'redo');await saved();assertBlockBytes(await body(note.id),'<p>새 본문</p><h2>끝 후속😀</h2>',{added:2,ids,message:'one restart redo'});
 assert.deepEqual(errors,[]);
 console.log('PASS heading during pending paste: exact follow-up, guarded source, one restart undo/redo; lazy='+(process.env.INKISM_LAZY!=='0'));
}finally{release?.();await browser.close();}
