import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47948';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='높이 검사 '+Date.now();
const html=Array.from({length:10000},(_,i)=>`<p>블록 ${i} ${i<32?'긴 문단<br>'.repeat(80):'일반 본문 내용'}</p>`).join('');
await rpc('save',{note:{title,content:html,text:'높이'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const jump=async n=>{await page.getByLabel('이동할 블록 번호').fill(String(n));await page.getByRole('button',{name:'이동',exact:true}).click();await page.waitForFunction(n=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(n-1),n);};
const spacer=()=>page.locator('[data-window-start]').evaluate((el: any)=>parseFloat(el.previousElementSibling.style.height));
try{
 await page.goto(base+'/?virtual=1');await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.locator('.tiptap-prose > p').first().waitFor();
 const firstHeight=await page.locator('.tiptap-prose').evaluate(el=>el.getBoundingClientRect().height);
 assert.ok(firstHeight>32*48*5);
 // Wait until measurement reduces the estimated bottom spacing for this window.
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await jump(33);const top=await spacer();assert.ok(Math.abs(top-firstHeight)<2,`measured ${firstHeight}, spacer ${top}`);
 assert.equal(await page.locator('.tiptap-prose > p').count(),32);
 await jump(65);assert.ok(await spacer()>firstHeight);
 // Width invalidates offscreen measurements without ejecting the visible window.
 await page.setViewportSize({width:1000,height:720});
 await page.waitForFunction(()=>{const w=document.querySelector<any>('[data-window-start]');return w && Math.abs(parseFloat(w.previousElementSibling.style.height)-64*48)<1;});
 assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'),'64');
 const alignment=await page.locator('.window-scroll').evaluate((el: any)=>Math.abs(el.scrollTop-parseFloat(el.querySelector('[data-window-start]').previousElementSibling.style.height)));
 assert.ok(alignment<100,`width change lost visible anchor: ${alignment}`);
 assert.ok(await page.locator('*').count()<1500);assert.deepEqual(errors,[]);
 console.log('PASS: tall measured blocks determine spacers, navigation stays bounded, width reset preserves viewport');
}finally{await browser.close();}
