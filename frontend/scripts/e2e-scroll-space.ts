import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47952';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const count=1_000_000,title='백만 블록 스크롤 '+Date.now();
const note=process.env.INKISM_NOTE_ID ? await rpc('get',{id:process.env.INKISM_NOTE_ID}) : await rpc('save',{note:{title,content:Array.from({length:count},(_,i)=>`<p>${i}</p>`).join(''),text:'백만'}});
for(let i=0;i<12;i++){if((await rpc('wait_index')).pending===0)break;}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let fullReads=0;page.on('request',r=>{if(r.url().endsWith('/api/rpc')){const req=r.postDataJSON();if(req.op==='get'&&req.id===note.id)fullReads++;}});
const start=()=>page.locator('[data-window-start]').getAttribute('data-window-start');
try{
 await page.goto(base+'/?virtual=1'+(process.env.INKISM_LAZY==='1'?'&lazy=1':''));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await page.locator('.tiptap-prose').waitFor({timeout:60000});
 const scroll=page.locator('.window-scroll');
 const height=await scroll.evaluate(el=>el.scrollHeight);assert.ok(height<9_000_000,`scroll exceeded safe spacer range: ${height}`);
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='999968',null,{timeout:30000});
 assert.equal(await page.locator('.tiptap-prose > p').last().textContent(),'999999');
 // Midpoint scrollbar movement must map back into the million-block document.
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight/2;});
 await page.waitForFunction(()=>{const n=Number(document.querySelector('[data-window-start]')?.getAttribute('data-window-start'));return n>499000 && n<501000;});
 assert.equal(await page.locator('.tiptap-prose > p').count(),32);
 await page.locator('.tiptap-prose > p').first().click();await page.keyboard.press('Control+End');
 await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='999968');
 await page.keyboard.press('Control+Home');
 await page.waitForFunction(()=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')==='0');
 assert.equal(await page.locator('.tiptap-prose > p').first().textContent(),'0');
 assert.ok(await page.locator('*').count()<1500);assert.deepEqual(errors,[]);if(process.env.INKISM_LAZY==='1')assert.equal(fullReads,0);
 console.log(`PASS: ${count} blocks, ${height}px scroll extent, scrollbar end/midpoint and keyboard first/last with 32 mounted blocks; note ${note.id}`);
}catch(e){console.error({start:await start(),error:await page.locator('.window-error').allTextContents()});throw e;}finally{await browser.close();}
