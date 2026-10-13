// Native PM baseline is independent of the shared synchronous/async driver.
import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage();
 await page.route('**/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:'+(server.httpServer.address() as AddressInfo).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const {prepareSelection,changeSelectionAsync}=await import('/src/lib/document-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {parseBoundedRichSliceWork}=await import('/src/lib/segment-projection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {scheduleEditWork}=await import('/src/lib/edit-work.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {sanitizeRichHtml}=await import('/src/lib/sanitize.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {segmentPositionMap}=await import('/src/lib/segment-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {modelSourceSegments,joinSegmentModels}=await import('/src/lib/segment-model.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {getHTMLFromFragment,elementFromString}=await import('/node_modules/.vite/deps/@tiptap_core.js');
  // @ts-expect-error -- served by Vite in the browser
  const {DOMParser,Slice,Fragment}=await import('/node_modules/.vite/deps/@tiptap_pm_model.js');
  const source={check:()=>{},read:async()=>({ready:true,total_blocks:1,next_offset:null,blocks:[{ordinal:0,byte_offset:0,html:'<p>old &amp;😀</p>'}]})};
  const prepared=await prepareSelection({kind:'all'},source),schema=prepared.state.schema,original=prepared.before,originalDoc=prepared.state.doc;
  let selectionCases=0;
  for(const raw of [
   '<p><strong>'+('P'.repeat(1024*1024))+'</strong><em>끝😀&amp;</em></p>',
   '<ol start="7"><li><p>'+('목록😀 '.repeat(8192))+'</p></li><li><p>끝</p></li></ol>',
   '<table><tbody><tr><td><p>'+('T'.repeat(70000))+'</p></td><td><p>끝😀</p></td></tr></tbody></table>',
  ]){
   const native=DOMParser.fromSchema(schema).parse(elementFromString(raw),{preserveWhitespace:'full'});
   const html=getHTMLFromFragment(native.content,schema),segments=Array.from(modelSourceSegments(html,0));
   const loaded=await prepareSelection({kind:'all'},{check:()=>{},
    read:async()=>({ready:true,total_blocks:1,oversized_block:true,blocks:[],next_offset:null}),
    segments:async(_,offset,limit)=>({ready:true,supported:true,revision:1,ordinal:0,total_segments:segments.length,
     segments:segments.slice(offset,offset+limit),next_offset:offset+limit<segments.length?offset+limit:null}),
   });
   if(!loaded.state.doc.eq(native)||loaded.before!==html||loaded.fragments.length!==segments.length)throw Error('oversized selection differs from native model');
   // The prior sequential join is an independent cursor-shift oracle.
   let sequential;
   for(const entry of loaded.fragments){
    const map=segmentPositionMap(entry.segment,schema),part=map.doc();
    const joined=sequential?joinSegmentModels(sequential,part,entry.segment.start_context):{doc:part,shift:0};
    const end=entry.segment.byte_offset+new TextEncoder().encode(entry.segment.source).length;
    if(entry.shift!==joined.shift||entry.from!==joined.shift+map.position(entry.segment.byte_offset)||entry.to!==joined.shift+map.position(end))throw Error('oversized selection cursor shift changed');
    sequential=joined.doc;
   }
   if(!sequential.eq(loaded.state.doc))throw Error('balanced selection differs from sequential join');
   selectionCases++;
  }
  const fixtures=[];
  for(const size of [1024*1024,5*1024*1024])fixtures.push({name:String(size),size,slice:new Slice(Fragment.from(schema.node('paragraph',null,[schema.text('P'.repeat(size)+'끝😀 &',[schema.marks.bold.create()])])),0,0)});
  for(const [name,html] of [
   ['Unicode','<p><strong>A😀&amp;</strong><em>한국é</em><br>끝</p>'],
   ['list','<ol start="7"><li><p>앞😀</p></li><li><p><em>뒤</em></p></li></ol>'],
   ['table','<table><tbody><tr><td><p>셀😀</p></td><td><p><strong>끝</strong></p></td></tr></tbody></table>'],
  ]){const t=document.createElement('template');t.innerHTML=html;fixtures.push({name,size:0,slice:new Slice(DOMParser.fromSchema(schema).parse(t.content).content,0,0)});}
  for(const [name,html] of [
   ['paste-block','<p><strong>'+('P'.repeat(1024*1024))+'끝😀 &amp;</strong></p>'],
   ['paste-inline',('<strong>한국😀&amp;</strong>').repeat(4096)],
   ['paste-list','<ul><li><p>'+('목록😀 '.repeat(8192))+'</p></li><li><p>끝</p></li></ul>'],
   ['paste-table','<table><tbody><tr><td><p>'+('셀😀 '.repeat(8192))+'</p></td><td><p>끝</p></td></tr></tbody></table>'],
   // Mismatched closing tags fail in the worker scanner. HTML5 import repairs them.
   ['paste-fallback','<p>'+('F'.repeat(70000))+'</div>'],
  ])fixtures.push({name,size:html.length,html,slice:DOMParser.fromSchema(schema).parseSlice(elementFromString(sanitizeRichHtml(html)),{preserveWhitespace:'full'})});
  // Cover final run folding on both sides of a power of two. Require the
  // bounded parser itself to succeed so full-import fallback cannot hide a bug.
  for(const count of [8191,8192,8193]){
   const html=('<p>한😀&amp;<strong>끝</strong></p>').repeat(count);
   fixtures.push({name:'paste-many-'+count,size:html.length,html,bounded:true,slice:DOMParser.fromSchema(schema).parseSlice(elementFromString(html),{preserveWhitespace:'full'})});
  }
  const fallback=fixtures.find(f=>f.name==='paste-fallback');
  if(await scheduleEditWork(parseBoundedRichSliceWork(fallback.html,schema),()=>{})!==null)throw Error('worker error did not return import fallback');
  const measurements=[];
  for(const fixture of fixtures){
   if(fixture.bounded||fixture.name==='paste-block'){
    const slice=await scheduleEditWork(parseBoundedRichSliceWork(fixture.html,schema),()=>{});
    if(!slice?.eq(fixture.slice))throw Error('bounded paste differs from native slice: '+fixture.name);
   }
   const native=prepared.state.tr.replaceSelection(fixture.slice),expected=getHTMLFromFragment(native.doc.content,schema);
   let previous=performance.now(),maxGap=0,ticks=0;
   const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-previous);previous=now;ticks++;},5);
   const begin=performance.now();let actual;
   try{actual=await changeSelectionAsync(prepared,fixture.html===undefined?{kind:'slice',slice:fixture.slice.toJSON()}:{kind:'paste',html:fixture.html});}finally{clearInterval(timer);}
   const duration=performance.now()-begin;
   if(actual.replacement!==expected)throw Error('native HTML differs: '+fixture.name);
    if(fixture.size>=1024*1024&&ticks<2)throw Error('UI timer did not run during calculation: '+fixture.name);
   const window=actual.previewWindow,internal=window.internal;
   const shown={ordinal:0,byte_offset:window.byteStart,source:window.raw,start_context:internal?.start_context??[],end_context:internal?.end_context??[]};
   const point=segmentPositionMap(shown,schema).point(actual.selection.head);
   const full=segmentPositionMap({ordinal:0,byte_offset:0,source:expected,start_context:[],end_context:[]},schema);
   if(full.position(point.byte,point.within)!==native.selection.head)throw Error('native cursor differs: '+fixture.name);
   if(prepared.before!==original||prepared.state.doc!==originalDoc)throw Error('calculation mutated prepared source');
   measurements.push({name:fixture.name,duration,maxGap,ticks});
  }
  // Invalidate during real text serialization, after a UI yield. Preparation
  // and the initial async delay cannot cause this cancellation assertion.
  const create=document.createElement,text=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');let chunks=0,stale=false,canceled=false;
  document.createElement=function(...args){
   const node=create.apply(this,args);
   if(String(args[0]).toLowerCase()==='div')Object.defineProperty(node,'textContent',{configurable:true,get(){return text.get.call(this);},set(value){text.set.call(this,value);if(typeof value==='string'&&value.length>=8192&&value.startsWith('P')&&++chunks===4)setTimeout(()=>{stale=true;},0);}});
   return node;
  };
  try{await changeSelectionAsync(prepared,{kind:'slice',slice:fixtures[1].slice.toJSON()},()=>{if(stale)throw Error('fixture source canceled');});}
  catch(e){if(e.message!=='fixture source canceled')throw e;canceled=true;}
  finally{document.createElement=create;}
  if(!canceled||!stale||chunks<4||prepared.before!==original||prepared.state.doc!==originalDoc)throw Error('yield cancellation failed to preserve source');
  const post=Worker.prototype.postMessage;let pasteStale=false,pasteCanceled=false,workerStarted=false,domAfterCancel=0;
  Worker.prototype.postMessage=function(...args){
   const result=post.apply(this,args);
   if(args[0]?.source?.includes('CANCEL-PASTE')){workerStarted=true;pasteStale=true;}
   return result;
  };
  document.createElement=function(...args){if(pasteStale)domAfterCancel++;return create.apply(this,args);};
  try{await changeSelectionAsync(prepared,{kind:'paste',html:'<p>CANCEL-PASTE'+('C'.repeat(1024*1024))+'</p>'},()=>{if(pasteStale)throw Error('paste source canceled');});}
  catch(error){if(error.message!=='paste source canceled')throw error;pasteCanceled=true;}
  finally{Worker.prototype.postMessage=post;document.createElement=create;}
  if(!workerStarted||!pasteCanceled||domAfterCancel||prepared.before!==original||prepared.state.doc!==originalDoc)throw Error('paste cancellation entered fallback or mutated source');
  return {measurements,canceled,pasteCanceled,selectionCases,cases:fixtures.length};
 });
 assert.equal(result.cases,13);assert.equal(result.selectionCases,3);assert.ok(result.canceled);assert.ok(result.pasteCanceled);console.log('PASS selection yield model:',JSON.stringify(result));
}finally{await browser?.close();await server.close();}
