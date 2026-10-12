// Real keyboard input -> next rendering opportunity. Linux Chromium only; not an IME benchmark.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
const base=process.env.INKISM_URL;
assert.ok(base,'INKISM_URL must point to an isolated synthetic test library');
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const withIndexLoad=process.env.INKISM_INDEX_LOAD==='1';
const defaultLaunch=process.env.INKISM_BENCH_DEFAULT==='1';
if(defaultLaunch){
 const info=await (await fetch(base+'/api/info')).json();
 assert.equal(info.windowed_editor,true,'ordinary launch must enable bounded editing');
 assert.equal(info.lazy_editor,true,'ordinary launch must enable lazy body reads');
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
let stopLoad=true,loadPromise;
const report={platform:process.platform,logicalCPUs:os.availableParallelism(),browser:await browser.version(),engineProfile:process.env.INKISM_ENGINE_PROFILE||'unspecified',indexLoad:withIndexLoad,defaultLaunch,metric:'beforeinput-to-next-animation-frame-ms',ime:false,samples:[]};
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 for(const count of [10000,100000]) {
  const title=`입력 지연 ${count} ${Date.now()}`;
  const content=Array.from({length:count},(_,i)=>`<p id="bench-${i}"><strong>한글😀 ${i}</strong> 본문</p>`).join('');
  const note=await rpc('save',{note:{title,content,text:'입력 검사'}});await rpc('wait_index');
  await page.goto(defaultLaunch?base+'/':base+'/?virtual=1'+(process.env.INKISM_LAZY==='1'?'&lazy=1':''));const opened=performance.now();await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.locator('[data-window-start="0"]').waitFor();
  const openMs=performance.now()-opened;
  await page.getByLabel('이동할 블록 번호').fill(String(Math.floor(count/2)+1));await page.getByRole('button',{name:'이동',exact:true}).click();
  await page.waitForFunction(offset=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(offset),Math.floor(count/2));
  await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');
  await page.evaluate(()=>{
   (window as any).inputFrames=[];
   document.querySelector('.tiptap-prose').addEventListener('beforeinput',(event: InputEvent)=>{
    if(event.inputType!=='insertText') return;
    const start=performance.now();requestAnimationFrame(()=>(window as any).inputFrames.push(performance.now()-start));
   },true);
  });
  let loadNotes=0,maxPending=0;
  if(withIndexLoad){
   stopLoad=false;
   const paragraphs=Array.from({length:2000},(_,i)=>`배경 문단 ${i} 고유어 ${i*31}`);
   const text=paragraphs.join('\n');
   const html=paragraphs.map(value=>'<p>'+value+'</p>').join('');
   loadPromise=(async()=>{
    while(!stopLoad && loadNotes<80){
     await rpc('save',{note:{title:`색인 경쟁 ${count} ${Date.now()} ${loadNotes}`,content:html,text}});loadNotes++;
    }
   })();
   // Attach immediately, so an early producer failure is not an unhandled rejection.
   loadPromise.catch(()=>{});
   const deadline=Date.now()+30000;
   do {maxPending=Math.max(maxPending,(await rpc('index_status')).pending);if(maxPending>5)break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<deadline && loadNotes<80);
   assert.ok(maxPending>0,'no background indexing backlog was observed');
  }
  const pendingWhileTyping=[];
  const typed='abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for(let i=0;i<typed.length;i++) {
   if(withIndexLoad && i%5===0)pendingWhileTyping.push((await rpc('index_status')).pending);
   await page.keyboard.type(typed[i]);
   await page.waitForFunction(n=>(window as any).inputFrames.length>=n,i+1);
  }
  stopLoad=true;if(loadPromise){await loadPromise;loadPromise=undefined;}
  if(withIndexLoad)assert.ok(pendingWhileTyping.some(n=>n>0),`indexing did not overlap typing: ${JSON.stringify({loadNotes,maxPending,pendingWhileTyping})}`);
  await page.keyboard.press('Control+s');await page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
  const saved=await rpc('get',{id:note.id});
  const targetId=`bench-${Math.floor(count/2)}`;
  const changed=new RegExp(`<p id="${targetId}">[\\s\\S]*?</p>`);
  const originalBlock=content.match(changed)?.[0],savedBlock=saved.content.match(changed)?.[0];
  assert.ok(originalBlock&&savedBlock,'edited canonical block must remain identifiable');
  assert.equal(saved.content.replace(changed,originalBlock),content,'all other canonical source bytes remain exact');
  const savedText=await page.evaluate(html=>{const t=document.createElement('template');t.innerHTML=html;return t.content.textContent;},savedBlock);
  assert.equal(savedText,typed+`한글😀 ${Math.floor(count/2)} 본문`,'all typed characters persist in order');
  const timings=await page.evaluate(()=>(window as any).inputFrames);assert.equal(timings.length,typed.length);
  const sorted=[...timings].sort((a,b)=>a-b),percentile=p=>sorted[Math.ceil(sorted.length*p)-1];
  maxPending=Math.max(maxPending,...pendingWhileTyping);
  const sample={blocks:count,backgroundBlocksPerNote:withIndexLoad?2000:0,loadNotes,maxPending,pendingWhileTyping,utf8Bytes:Buffer.byteLength(content),openMs,keystrokes:timings.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:sorted.at(-1),mountedParagraphs:await page.locator('.tiptap-prose p').count(),domNodes:await page.locator('*').count()};
  report.samples.push(sample);assert.equal(sample.mountedParagraphs,32);assert.ok(sample.p95Ms<100,`input frame p95 exceeded 100ms: ${JSON.stringify(sample)}`);
 }
 assert.deepEqual(errors,[]);
 await fs.mkdir('.test-data/benchmarks',{recursive:true});await fs.writeFile(`.test-data/benchmarks/windowed-input${withIndexLoad?'-index-load':''}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
} finally {stopLoad=true;if(loadPromise)await loadPromise.catch(()=>{});await browser.close();}
