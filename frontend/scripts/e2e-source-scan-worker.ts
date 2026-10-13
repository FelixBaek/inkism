// Legacy golden hashes preserve the prior scanner's source/context contract.
// Opening-tag byte positions are checked separately against the original UTF-8.
// Actual Worker messages are inspected; source text never returns in results.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage();
 await page.route('**/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:'+(server.httpServer.address() as AddressInfo).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const {scanSourceInWorker}=await import('/src/lib/source-scan-client.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {sourceSegmentWork}=await import('/src/lib/source-segment-work.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {finishEditWork,scheduleEditWork}=await import('/src/lib/edit-work.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {modelSourceSegments}=await import('/src/lib/source-segments.ts');
  const fixtures=[
   ['<p><strong>'+'X'.repeat(50000)+'</strong></p>','108f8b7c4440ce964e9d909d18ca5a5a9cce6de34d7cbcc6778cbe132804a7c2'],
   ['<p>'+'한😀&amp;\r\n'.repeat(8000)+'</p>','40de826cb6d5a6954d035f08bf38680687ed0635de8177c63533bd143c574f97'],
   ['<table><colgroup><col style="width:40px"><col></colgroup><tbody><tr><td><p>'+'A'.repeat(33000)+'</p></td><td><p>B</p></td></tr></tbody></table>','a298eee4044c76de5d704c7472c79cca02e3eb6c080ef513e78edd7359508eea'],
   ['<ol start="7"><li><p>'+'A'.repeat(35000)+'</p></li><li><p>end</p></li></ol>','74395deb8c0bce13102cfdec77d912ec205ed4b4a7ab33efcebcbc8c76573bae'],
   ['<P data-a="x>y"><B>start&amp;end</B></P><hr>','8546bc08cbb1d8aeaaa23382ef85b308d02e45a4592bb2b8de02534931eac168'],
  ];
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const withoutPositions=segments=>segments.map(segment=>({...segment,
   start_context:segment.start_context.map(({at,...ancestor})=>ancestor),
   end_context:segment.end_context.map(({at,...ancestor})=>ancestor),
  }));
  let positionsChecked=0;
  const verifyPositions=(segments,source,byteOffset)=>{
   const encoder=new TextEncoder(),bytes=encoder.encode(source);
   for(const segment of segments)for(const [context,limit]of [
    [segment.start_context,segment.byte_offset],
    [segment.end_context,segment.byte_offset+encoder.encode(segment.source).length],
   ])for(const ancestor of context){
    if(!Number.isSafeInteger(ancestor.at)||ancestor.at<byteOffset||ancestor.at>limit)throw Error('invalid opening-tag byte position');
    const offset=ancestor.at-byteOffset,opening=encoder.encode(ancestor.open);
    if(offset+opening.length>bytes.length||opening.some((byte,index)=>bytes[offset+index]!==byte))throw Error('opening-tag position does not match original UTF-8 bytes');
    positionsChecked++;
   }
  };
  const post=Worker.prototype.postMessage,terminate=Worker.prototype.terminate;let started=0,terminated=0,maxResponse=0,leakedSource=false;
  Worker.prototype.postMessage=function(...args){
   started++;this.addEventListener('message',event=>{
    if(event.data.spans){
     if(event.data.spans.some(span=>'source' in span))leakedSource=true;
     maxResponse=Math.max(maxResponse,JSON.stringify(event.data).length);
    }
   },{once:true});return post.apply(this,args);
  };
  Worker.prototype.terminate=function(){terminated++;return terminate.call(this);};
  try{
   for(const [source,expected] of fixtures){
    const segments=Array.from<any>(await scanSourceInWorker({source,byteOffset:123,context:[]},()=>{}));
    if(await hash(withoutPositions(segments))!==expected)throw Error('worker differs from prior scanner golden');
    verifyPositions(segments,source,123);
    if(segments.map(s=>s.source).join('')!==source)throw Error('source text lost');
   }
   const source='<p>'+'X'.repeat(5*1024*1024)+'</p>';let previous=performance.now(),gap=0,ticks=0;
   const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-previous);previous=now;ticks++;},5);
   const begin=performance.now();let segments;
   try{segments=Array.from(await scanSourceInWorker({source,byteOffset:0,context:[]},()=>{}));}finally{clearInterval(timer);}
   const duration=performance.now()-begin;if(ticks<2||segments.map(s=>s.source).join('')!==source)throw Error('worker did not isolate scan or preserve source');
   if(maxResponse>=1024*1024)throw Error('worker response contains disproportionate source copies');
   // Preview stops scanning after the requested source point's piece. Both
   // byte/UTF-16 coordinates and the inside-mark context must stay exact.
   const context=[{tag:'p',open:'<p>'},{tag:'strong',open:'<strong>'}],inside='한😀&amp; '.repeat(18000);
   const all=Array.from<any>(modelSourceSegments(inside,999,context)),at=all[2].byte_offset+17;
   const partial=Array.from(await scanSourceInWorker({source:inside,byteOffset:999,context,untilByte:at},()=>{}));
   if(JSON.stringify(partial)!==JSON.stringify(all.slice(0,3)))throw Error('preview target/context differs');
   const sync=Array.from(finishEditWork(sourceSegmentWork(source,0))),async=Array.from(await scheduleEditWork(sourceSegmentWork(source,0),()=>{}));
   if(JSON.stringify(sync)!==JSON.stringify(async))throw Error('drivers disagree');
   const canceled={},before=started;let stale=false,refused=false;
   const invalidate=setTimeout(()=>{stale=true;},5);
   try{await scanSourceInWorker({source:'<p>'+'Y'.repeat(20*1024*1024)+'</p>',byteOffset:0,context:[]},()=>{if(stale)throw canceled;});}
   catch(error){if(error!==canceled)throw error;refused=true;}
   finally{clearTimeout(invalidate);}
   if(!refused||started!==before+1)throw Error('in-flight source cancellation was not observed');
   let malformed=false;
   try{await scanSourceInWorker({source:'<p><strong>x</p>',byteOffset:0,context:[]},()=>{});}catch(error){if(!error.message.includes('태그'))throw error;malformed=true;}
   if(!malformed)throw Error('malformed nesting admitted');
   const next=Array.from<any>(await scanSourceInWorker({source:'<p>next😀</p>',byteOffset:0,context:[]},()=>{}));
   if(next[0].source!=='<p>next😀</p>'||terminated!==started||leakedSource)throw Error('worker cleanup/retry/source response failed');
   return {goldens:fixtures.length,positionsChecked,measurement:{duration,gap,ticks,segments:segments.length},maxResponse,started,terminated,canceled:refused,malformed,partial:partial.length};
  }finally{Worker.prototype.postMessage=post;Worker.prototype.terminate=terminate;}
 });
 assert.equal(result.goldens,5);assert.ok(result.positionsChecked>0);assert.ok(result.canceled&&result.malformed);assert.equal(result.started,result.terminated);console.log('PASS source scan worker:',JSON.stringify(result));
}finally{await browser?.close();await server.close();}
