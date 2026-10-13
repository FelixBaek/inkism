import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48139';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const note=await rpc('save',{note:{title:'History write failure '+Date.now(),content:'<p>original</p>',text:'original'}});
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});await rpc('split_set',{id:null,mode:'source'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const p=await browser.newPage({viewport:{width:1440,height:900}});
// HTML notes open in the rich view; the source (CodeMirror) editor is the explicit HTML view.
const source=async()=>{const html=p.getByRole('button',{name:'HTML',exact:true});await html.waitFor();if(await html.getAttribute('aria-pressed')!=='true')await html.click();await p.locator('.cm-content').waitFor();};
try{
 await p.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await p.goto(base);await p.getByLabel('노트 제목',{exact:true}).waitFor();if(await p.getByRole('button',{name:'대용량 원문',exact:true}).count())await p.getByRole('button',{name:'대용량 원문',exact:true}).click();await source();await p.locator('.cm-content').focus();
 await p.route('**/api/rpc',async route=>{if(route.request().postDataJSON().op==='editor_history_set')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic history disk full'})});return route.continue();});
 await p.keyboard.press('Control+End');await p.keyboard.insertText(' keep');await p.keyboard.press('Control+s');
 await p.getByText(/synthetic history disk full/).first().waitFor();assert.equal((await rpc('get',{id:note.id})).content,'<p>original</p> keep');
 assert.match(await p.locator('.cm-content').innerText(),/keep/);
 await p.unroute('**/api/rpc');await p.locator('.cm-content').focus();await p.keyboard.press('Control+s');
 await p.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 await p.reload();await source();await p.locator('.cm-content').focus();await p.keyboard.press('Control+z');await p.keyboard.press('Control+s');
 await p.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 assert.equal((await rpc('get',{id:note.id})).content,'<p>original</p>');
 console.log('PASS: history write failure preserves saved body/draft, retry restores durable undo');
}finally{await browser.close();}
