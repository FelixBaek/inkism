import {waitForAsync} from './async-browser-condition.ts';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47980';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const title='탭 위치 '+Date.now();
const html=Array.from({length:10000},(_,i)=>'<p>구간 '+i+' 본문입니다.</p>').join('');
const a=await rpc('save',{note:{title:title+' 큰노트',content:html,text:'구간'}});
const b=await rpc('save',{note:{title:title+' 작은노트',content:'<p>작은 노트의 커서</p>',text:'작은 노트의 커서'}});
await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const selection=()=>page.evaluate(()=>{const s=getSelection();return {text:s.anchorNode?.textContent,anchor:s.anchorOffset,focus:s.focusOffset};});
const at=n=>page.waitForFunction(n=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(n),n);
const open=async note=>{await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await page.waitForFunction(t=>document.querySelector<any>('.title-input')?.value===t,note.title);};
const tab=note=>page.getByRole('tab',{name:'노트 탭: '+note.title,exact:true});
try{
 await page.goto(base+'/?virtual=1&lazy=1');await open(a);await at(0);
 await page.getByLabel('이동할 블록 번호').fill('5001');await page.getByRole('button',{name:'이동',exact:true}).click();await at(5000);
 await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('End');
 await page.keyboard.insertText(' 저장후커서');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
 const bigSelection=await selection();
 await open(b);await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 const smallSelection=await selection();
 await tab(a).click();await at(5000);
 await page.waitForFunction(()=>document.activeElement?.classList.contains('tiptap-prose'));
 assert.deepEqual(await selection(),bigSelection);
 await tab(b).click();await page.waitForFunction(t=>document.querySelector<any>('.title-input')?.value===t,b.title);
 await page.waitForFunction(()=>document.activeElement?.classList.contains('tiptap-prose'));
 assert.deepEqual(await selection(),smallSelection);
 // Wait for the debounced local workspace write, then discard all JS memory.
 await waitForAsync(page,async id=>{
  const r=await (await fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'workspace_get'})})).json();
  return r.data?.active===id && r.data?.locations?.[id]?.selection;
 },b.id);
 await page.reload();
 await page.waitForFunction(()=>document.activeElement?.classList.contains('tiptap-prose'));
 assert.deepEqual(await selection(),smallSelection);
 await tab(a).click();await at(5000);
 await page.waitForFunction(()=>document.activeElement?.classList.contains('tiptap-prose'));
 assert.deepEqual(await selection(),bigSelection);
 await tab(b).click();
 const current=await rpc('get',{id:a.id});
 await rpc('save',{note:{id:a.id,revision:current.revision,content:'<p>다른 기기의 첫 문단</p>'+current.content,text:'다른 기기'}});
 await tab(a).click();await at(0);
 assert.ok((await page.locator('.tiptap-prose').textContent()).includes('다른 기기의 첫 문단'));
 assert.deepEqual(errors,[]);
 console.log('PASS: large tab window/cursor and small tab cursor restored after local save and page restart; remote revision invalidates stale location');
}finally{await browser.close();}
