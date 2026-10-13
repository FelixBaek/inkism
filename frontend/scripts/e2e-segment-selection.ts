import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {fileURLToPath} from 'node:url';
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{
 name:'segment-selection-check',configureServer(vite){vite.middlewares.use('/__selection',async(req,res,next)=>{
  if(req.url.includes('html-proxy'))return next();
  try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__selection',`<script type="module">
   import {segmentPositionMap,saveSegmentSelection,restoreSegmentSelection} from '/src/lib/segment-selection.ts';
   import {WindowHistory} from '/src/lib/window-history.ts';
   window.fixture={segmentPositionMap,saveSegmentSelection,restoreSegmentSelection,WindowHistory};
  </script>`));}catch(error){next(error);}
 });},
}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}/__selection`);await page.waitForFunction(()=>(window as any).fixture);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,around=(tag,open='<'+tag+'>')=>({tag,open});
  const cases=[
   {source:'가😀&amp;&#x1f642;&NotEqualTilde;\r\n끝',start_context:[around('p'),around('strong')],end_context:[around('p'),around('strong')]},
   {source:'앞</strong> 보통 <em>뒤</em></p><p>둘째',start_context:[around('p'),around('strong')],end_context:[around('p')]},
   {source:'<p>한글😀</p></td><td><p>두번째 &amp; 끝</p>',start_context:[around('table'),around('tbody'),around('tr'),around('td')],end_context:[around('table'),around('tbody'),around('tr'),around('td')]},
   {source:'<li><p>첫째</p></li><li><p>둘째😀</p></li>',start_context:[around('ol')],end_context:[around('ol')]},
  ];
  let count=0;const failures=[];
  for(const [index,value] of cases.entries()){
   const segment={...value,ordinal:3,byte_offset:101},map=f.segmentPositionMap(segment),doc=map.doc();
   for(let pos=0;pos<=doc.content.size;pos++){
    if(!doc.resolve(pos).parent.isTextblock)continue;
    const selection={type:'text',anchor:pos,head:pos};
    const saved=f.saveSegmentSelection(segment,selection),restored=f.restoreSegmentSelection(segment,saved);
    if(restored.anchor!==pos || restored.head!==pos)failures.push({index,pos,saved,restored});count++;
   }
   // Local raw byte hints remain usable after the cache gives the same range a new ordinal.
   const pos=Array.from({length:doc.content.size+1},(_,i)=>i).find(i=>doc.resolve(i).parent.isTextblock),saved=f.saveSegmentSelection(segment,{type:'text',anchor:pos,head:pos});
   const shifted={...segment,ordinal:9,byte_offset:301};
   const restored=f.restoreSegmentSelection(shifted,{...saved,anchorByte:saved.anchorByte+200,headByte:saved.headByte+200});
   if(restored.anchor!==pos)failures.push({index,label:'shifted byte',restored});
  }
  const segment={ordinal:2,byte_offset:101,start_context:[around('p'),around('strong')],end_context:[around('p'),around('strong')],total:50};
  const history=new f.WindowHistory();history.record({from:101,offset:0,before:'앞😀',after:'수정 앞😀',beforeCount:1,afterCount:1,session:1,group:0,time:1,
   beforePreview:{html:'<p><strong>앞😀</strong></p>',count:1,internal:segment},afterPreview:{html:'<p><strong>수정 앞😀</strong></p>',count:1,internal:segment}});
  const restored=f.WindowHistory.restore(JSON.parse(JSON.stringify(history.serialize()))),undo=restored.prepare('undo');
  return {count,failures,undo,bytes:restored.byteSize};
 });
 assert.deepEqual(result.failures,[]);assert.ok(result.count>30);assert.equal(result.undo.html,'앞😀');assert.equal(result.undo.preview.internal.total,50);assert.ok(result.bytes>100);
 console.log(`PASS: ${result.count} source-byte cursor round trips (Unicode/entities/CRLF/marks/tables/lists), relocated fragments and serialized internal raw history`);
}finally{await browser?.close();await server.close();}
