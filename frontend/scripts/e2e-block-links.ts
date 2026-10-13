import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{const e=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(e.ok,true,JSON.stringify(e));return e.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));
 const target='<p>Link this paragraph</p>',filler=Array.from({length:70},(_,i)=>`<p>f-${i} ${'a'.repeat(4000)}</p>`).join('');
 const note=await rpc('save',{note:{title:'Window block links',content:target+filler,content_format:'html'}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});await page.goto(base+'/?virtual=1&lazy=1');
 const ready=()=>page.waitForFunction(()=>Boolean((document.querySelector('.tiptap-prose') as any)?.editor?.isInitialized)&&Array.from(document.querySelectorAll<HTMLButtonElement>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));await ready();
 await page.locator('.tiptap-prose p').first().click();await page.locator('.tiptap-prose p').first().hover();await page.getByRole('button',{name:'블록 동작',exact:true}).click();await page.getByRole('menuitem',{name:'문단 링크 복사',exact:true}).click();
 let linked='';for(let i=0;i<100;i++){linked=(await rpc('get',{id:note.id})).content;if(linked.includes('id="ink-block-'))break;await page.waitForTimeout(100);}
 assert.equal(linked.replace(/ id="ink-block-[^"]+"/g,''),target+filler);// Only the linked paragraph gains an identity; its untouched neighbour keeps exact bytes.
 assert.equal((linked.match(/id="ink-block-/g)||[]).length,1);assert.match(linked,/^<p id="ink-block-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}">Link this paragraph<\/p><p>f-0 /);await ready();await page.waitForTimeout(500);
 assert.deepEqual(errors,[]);
 console.log('PASS windowed paragraph link creation, persistent block IDs, and exact source preservation');
}finally{await browser.close();}
