// Real Rust source spans, headless React model, and a bounded live preview.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';

assert.ok(process.env.INKISM_SEGMENT_ENGINE,'current Rust executable required');
const dir=await mkdtemp(join(tmpdir(),'inkism-selection-segments-'));
const engine=spawn(process.env.INKISM_SEGMENT_ENGINE,['--db',join(dir,'notes.db')],{stdio:['pipe','pipe','pipe']});
const engineClosed=new Promise(resolve=>engine.once('close',resolve));
const pending=[];
createInterface({input:engine.stdout}).on('line',line=>{
 const task=pending.shift();if(!task)return;
 try{const value=JSON.parse(line);value.ok?task.resolve(value.data):task.reject(Error(value.error));}catch(error){task.reject(error);}
});
engine.on('error',error=>{while(pending.length)pending.shift().reject(error);});
engine.on('exit',code=>{while(pending.length)pending.shift().reject(Error('engine exit '+code));});
const call=request=>new Promise((resolve,reject)=>{pending.push({resolve,reject});engine.stdin.write(JSON.stringify(request)+'\n');});
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();
 page.on('console',message=>console.log(message.text()));
 await page.exposeFunction('segmentRPC',call);
 // Avoid loading the application and a second copy of ProseMirror.
 await page.route('**/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.goto('http://127.0.0.1:'+(server.httpServer.address() as AddressInfo).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const m=await import('/src/lib/document-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const s=await import('/src/lib/segment-model.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {canonicalRichHTML}=await import('/src/lib/rich-document.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {getHTMLFromFragment}=await import('/node_modules/.vite/deps/@tiptap_core.js');
  const eq=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify(a).slice(0,400)+' != '+JSON.stringify(b).slice(0,400));};
  const ok=(condition,label)=>{if(!condition)throw Error(label);};
  const reject=async(fn,label)=>{try{await fn();}catch{return;}throw Error('accepted '+label);};
  const enc=new TextEncoder();
  const cases=[
   '<p><strong><em>'+('한글😀&amp; boundary '.repeat(7000))+'</em></strong></p>',
   '<table><tbody>'+Array.from({length:1500},(_,i)=>'<tr><td><p>행 '+i+' 😀</p></td><td><p><strong>값</strong></p></td></tr>').join('')+'</tbody></table>',
   '<table><tbody><tr><td><p>'+('거대 셀😀 '.repeat(12000))+'</p></td></tr></tbody></table>',
   '<ol start="4">'+Array.from({length:2200},(_,i)=>'<li><p>항목 '+i+' <em>한글😀</em></p></li>').join('')+'</ol>',
  ].map(canonicalRichHTML);
  let checked=0,maxPreview=0;
  for(const [index,body] of cases.entries()){
   console.log('fixture',index);
   const before='<p>앞 원문 &amp;😀</p>',after='<p>뒤 원문&#128512;</p>';
   const note=await (window as any).segmentRPC({op:'save',note:{title:'selection '+index,content:before+body+after,text:'fixture'}});
   await (window as any).segmentRPC({op:'wait_index'});
   const source: any={check:()=>{},
    read:(offset,limit)=>(window as any).segmentRPC({op:'document_blocks',id:note.id,revision:1,offset,limit,max_block_bytes:65536,bounded:true}),
    segments:(ordinal,offset,limit)=>(window as any).segmentRPC({op:'document_segments',id:note.id,revision:1,ordinal,offset,limit}),
    locate:(byte_offset,bias)=>(window as any).segmentRPC({op:'document_locate',id:note.id,revision:1,byte_offset,bias}),
   };
   const all=await m.prepareSelection({kind:'all'},source);
   const reference=await m.prepareSelection({kind:'all'},{check:()=>{},read:async()=>({ready:true,total_blocks:3,next_offset:null,blocks:[before,body,after].map((html,ordinal)=>({ordinal,html,byte_offset:enc.encode([before,body,after].slice(0,ordinal).join('')).length}))})});
   eq(all.state.doc.toJSON(),reference.state.doc.toJSON(),'joined model '+index);
   eq(s.serializeModel(all.state.doc.content),getHTMLFromFragment(all.state.doc.content,all.state.schema),'stream serializer '+index);
   eq(all.before,before+body+after,'exact raw '+index);
   all.state.doc.check();
   const changed=m.changeSelection(all,{kind:'mark',mark:'highlight'});
   ok(changed.replacement.includes('<mark'),'all mark '+index);
   const removed=m.changeSelection(all,{kind:'delete'});eq(removed.replacement,'<p></p>','whole delete '+index);
   maxPreview=Math.max(maxPreview,enc.encode(changed.previewWindow.raw).length);
   ok(enc.encode(changed.previewWindow.raw).length<=512*1024,'bounded preview '+index);
   const parts=all.fragments.filter(f=>f.segment.start_context.length||f.segment.end_context.length);
   ok(parts.length>2,'real internal segments '+index);
   // Choose two source points inside the same large top-level block.
   const left=parts[1],right=parts.at(-2);
   const range={kind:'range',anchor:{block:1,position:1,byte:left.segment.byte_offset,within:0},head:{block:1,position:1,byte:right.segment.byte_offset,within:0}};
   const prepared=await m.prepareSelection(range,source);
   ok(!prepared.state.selection.empty,'source range '+index);
   if(index===1){
    // Removing partial rows changes the fixed column layout; reject until
    // a full enclosing table transaction can preserve that layout.
    await reject(()=>m.changeSelection(prepared,{kind:'text',text:'교체😀'}),'partial table structure change');
    eq(new TextDecoder().decode(enc.encode(before+body+after).subarray(prepared.byteStart,prepared.byteStart+enc.encode(prepared.before).length)),prepared.before,'failed table edit keeps original source');
   }else{
    const replacement=m.changeSelection(prepared,{kind:'text',text:'교체😀'});
    ok(replacement.replacement.includes('교체😀'),'cross-segment replacement '+index);
    eq(new TextDecoder().decode(enc.encode(before+body+after).subarray(replacement.start,replacement.start+enc.encode(replacement.expected).length)),replacement.expected,'exact bounded source '+index);
   }
   const marked=m.changeSelection(prepared,{kind:'mark',mark:'bold'});
   maxPreview=Math.max(maxPreview,enc.encode(marked.previewWindow.raw).length);
   ok(enc.encode(marked.previewWindow.raw).length<=32768,'internal preview bound '+index);
   const assemble=value=>new TextDecoder().decode(enc.encode(before+body+after).subarray(0,value.start))+value.replacement+new TextDecoder().decode(enc.encode(before+body+after).subarray(value.start+enc.encode(value.expected).length));
   const markedWhole=assemble(marked);
   eq(new TextDecoder().decode(enc.encode(markedWhole).subarray(0,prepared.byteStart)),new TextDecoder().decode(enc.encode(before+body+after).subarray(0,prepared.byteStart)),'unselected raw prefix '+index);
   // @ts-expect-error -- served by Vite in the browser
   const {segmentPositionMap}=await import('/src/lib/segment-selection.ts');
   const baselinePoint=point=>{
    const entry=all.fragments.find(e=>point.byte>=e.segment.byte_offset && point.byte<=e.segment.byte_offset+enc.encode(e.segment.source).length);
    return {...point,byte:undefined,within:undefined,position:entry.shift+segmentPositionMap(entry.segment,all.state.schema).position(point.byte,point.within)-reference.state.doc.firstChild.nodeSize};
   };
   const baseline=await m.prepareSelection({kind:'range',anchor:baselinePoint(range.anchor),head:baselinePoint(range.head)},{check:()=>{},read:async()=>({ready:true,total_blocks:3,next_offset:2,blocks:[{ordinal:1,html:body,byte_offset:enc.encode(before).length}]})});
   const baselineMark=m.changeSelection(baseline,{kind:'mark',mark:'bold'});
   eq(canonicalRichHTML(markedWhole),canonicalRichHTML(assemble(baselineMark)),'full baseline mark '+index);
   if(index!==1){const baselineText=m.changeSelection(baseline,{kind:'text',text:'교체😀'});eq(canonicalRichHTML(assemble(m.changeSelection(prepared,{kind:'text',text:'교체😀'}))),canonicalRichHTML(assemble(baselineText)),'full baseline replacement '+index);}
   const bad={...source,segments:async(...args)=>{const value=await source.segments(...args);return {...value,segments:value.segments.map((v,i)=>i===0?{...v,byte_offset:v.byte_offset+1}:v)};}};
   await reject(()=>m.prepareSelection({kind:'all'},bad),'discontinuous spans '+index);
   const incomplete={...source,segments:async(...args)=>{const value=await source.segments(...args);return {...value,segments:value.segments.map((v,i)=>i===0?{...v,start_context:[{tag:'p',open:'<p>'}]}:v)};}};
   await reject(()=>m.prepareSelection({kind:'all'},incomplete),'incomplete initial context '+index);
   const unsupported={...source,segments:async(...args)=>({...await source.segments(...args),supported:false})};
   await reject(()=>m.prepareSelection({kind:'all'},unsupported),'unsupported spans '+index);
   checked++;
  }
  return {checked,maxPreview,liveNodes:document.querySelectorAll('*').length};
 });
 assert.equal(result.checked,4);assert.ok(result.liveNodes<10);
 console.log('PASS real Rust cross-segment selection:',JSON.stringify(result));
}finally{
 await browser?.close();await server.close();engine.stdin.end();
 const timer=setTimeout(()=>engine.kill(),2000);
 try{await engineClosed;}finally{clearTimeout(timer);}
 await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
