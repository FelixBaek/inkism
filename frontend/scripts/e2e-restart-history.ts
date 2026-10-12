import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48149';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 // Source history covers HTML/Markdown; visual TEXT history has a separate runtime gate.
 for(const format of ['html','markdown']){
  const original=(format==='html'?'<p>한글😀</p>':'# 한글😀')+'\r\n둘째\r줄\n'+Array.from({length:1000},(_,i)=>'line '+i).join('\n');
  const note=await rpc('save',{note:{title:'Restart '+format+' '+Date.now(),content:original,content_format:format}});
  await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});await rpc('split_set',{id:null,mode:'source'});
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const editor=()=>page.locator('.split-primary .cm-content');
  const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
  // HTML notes open in the rich view; the source history under test lives in the HTML (CodeMirror) view.
  const source=async()=>{if(format==='html'){const b=page.getByRole('button',{name:'HTML',exact:true});await b.waitFor();if(await b.getAttribute('aria-pressed')!=='true')await b.click();}await editor().waitFor();};
  const restart=async()=>{await page.reload();await source();await editor().focus();};
  try{
   await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await source();await editor().focus();await page.keyboard.press('Control+End');await page.keyboard.insertText(' appended😀');await page.keyboard.press('Control+s');await saved();
   assert.equal((await rpc('get',{id:note.id})).content,original+' appended😀');
   await restart();await page.keyboard.press('Control+z');await page.keyboard.press('Control+s');await saved();assert.equal((await rpc('get',{id:note.id})).content,original);
   await restart();await page.keyboard.press('Control+Shift+z');await page.keyboard.press('Control+s');await saved();assert.equal((await rpc('get',{id:note.id})).content,original+' appended😀');
   const latest=await rpc('get',{id:note.id});await rpc('save',{note:{id:note.id,revision:latest.revision,content:original+' external',content_format:format}});
   await restart();await page.keyboard.press('Control+z');await page.waitForTimeout(500);assert.equal((await rpc('get',{id:note.id})).content,original+' external');
   assert.deepEqual(errors,[]);console.log('PASS restart undo/redo and stale revision rejection: '+format);
  }catch(e){console.error(format,await page.locator('.status-save').innerText(),await page.getByRole('alert').allTextContents());console.error((await rpc('editor_history_get')).filter(h=>h.id===note.id).map(h=>({kind:h.kind,format:h.format,revision:h.revision,identity:h.value.identity})));throw e;}finally{await page.close();}
 }
}finally{await browser.close();}
