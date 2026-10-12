// Real Rust source spans, headless React model, and a bounded live preview.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

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
 await page.goto('http://127.0.0.1:'+(server.httpServer.address() as any).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const m=await import('/src/lib/document-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {canonicalRichHTML}=await import('/src/lib/rich-document.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {contentExtensions}=await import('/src/extensions/content-schema.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {Editor}=await import('/node_modules/.vite/deps/@tiptap_core.js');
  // @ts-expect-error -- served by Vite in the browser
  const {TextSelection,Selection}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js');
  // @ts-expect-error -- served by Vite in the browser
  const {segmentPositionMap}=await import('/src/lib/segment-selection.ts');
  const enc=new TextEncoder(),dec=new TextDecoder();
  const eq=(a,b,label)=>{if(a!==b)throw Error(label+': '+String(a).slice(0,160)+' != '+String(b).slice(0,160));};
  const ok=(value,label)=>{if(!value)throw Error(label);};
  const rejects=async(fn,label)=>{try{await fn();}catch{return;}throw Error('accepted '+label);};
  const fixtures=[
   ['headings','<h2>한글😀</h2><h2>END</h2>'],
   ['plain','<p>A <strong>한글😀</strong></p><h1>제목</h1><p>END</p>'],
   ['mixed first-window headings',Array.from({length:40},(_,i)=>i<32?'<h1>제목 '+i+'</h1>':'<p>본문 '+i+'</p>').join('')],
   ['list','<ol start="7"><li><p>A</p><p>B</p></li><li><p>C</p></li></ol>'],
   ['table','<table><tbody><tr><td><p>A</p><p>B</p></td><td><p>C😀</p></td></tr></tbody></table>'],
   ['code','<pre><code>코드😀 &lt;x&gt;</code></pre><p>본문</p>'],
   ['long paragraph','<p><strong>'+('한😀&amp; '.repeat(60000))+'TARGET</strong></p>'],
  ].map(([name,html])=>[name,canonicalRichHTML(html)]);
  let cases=0,maxPiece=0;
  for(const [name,body] of fixtures){
   const prefix='<p>앞 raw&#128512;</p>',suffix='<p>뒤 raw&#128512;</p>',whole=prefix+body+suffix;
   const note=await (window as any).segmentRPC({op:'save',note:{title:name,content:whole,content_format:'html'}});
   await (window as any).segmentRPC({op:'wait_index'});
   const source={check:()=>{},
    read:(offset,limit)=>(window as any).segmentRPC({op:'document_blocks',id:note.id,revision:1,offset,limit,max_block_bytes:65536,bounded:true}),
    segments:async(ordinal,offset,limit)=>{const p=await (window as any).segmentRPC({op:'document_segments',id:note.id,revision:1,ordinal,offset,limit});for(const s of p.segments)maxPiece=Math.max(maxPiece,enc.encode(s.source).length);return p;},
    locate:(byte_offset,bias)=>(window as any).segmentRPC({op:'document_locate',id:note.id,revision:1,byte_offset,bias}),
   };
   const start=enc.encode(prefix).length,end=start+enc.encode(body).length;
   const probe=new Editor({extensions:contentExtensions({trailingNode:false}),content:whole,parseOptions:{preserveWhitespace:'full'}});
   const pointMap=segmentPositionMap({ordinal:0,byte_offset:0,source:whole,start_context:[],end_context:[]},probe.schema);
   const first=Selection.findFrom(probe.state.doc.resolve(probe.state.doc.firstChild.nodeSize),1,true).from;
   const last=Selection.findFrom(probe.state.doc.resolve(probe.state.doc.content.size-probe.state.doc.lastChild.nodeSize),-1,true).to;
   const a={block:1,position:1,...pointMap.point(first)},b={block:1,position:1,...pointMap.point(last)};probe.destroy();
   const operations=[{kind:'block',type:'heading',level:1,toggle:true},{kind:'block',type:'heading',level:2,toggle:false},{kind:'block',type:'paragraph'}];
   for(const reverse of [false,true])for(const operation of operations){
    const range={kind:'range',anchor:reverse?b:a,head:reverse?a:b};
    const p=await m.prepareSelection(range,source,{completeBlocks:true});
    if(operation.type==='paragraph' && (name==='list'||name==='table')){
     await rejects(()=>m.changeSelectionAsync(p,operation),name+' refuses implicit container lifting');cases++;continue;
    }
    const changed=await m.changeSelectionAsync(p,operation);
    // Independent native Tiptap command on the complete test-only document.
    const native=new Editor({extensions:contentExtensions({trailingNode:false}),content:whole,parseOptions:{preserveWhitespace:'full'}});
    const map=segmentPositionMap({ordinal:0,byte_offset:0,source:whole,start_context:[],end_context:[]},native.schema);
    const from=map.position(a.byte,a.within),to=map.position(b.byte,b.within);
    native.view.dispatch(native.state.tr.setSelection(TextSelection.between(native.state.doc.resolve(reverse?to:from),native.state.doc.resolve(reverse?from:to))));
    if(operation.type==='paragraph')native.commands.setParagraph();
    else if(operation.toggle)native.commands.toggleHeading({level:operation.level});
    else native.commands.setHeading({level:operation.level});
    const assembled=dec.decode(enc.encode(whole).subarray(0,changed.start))+changed.replacement+dec.decode(enc.encode(whole).subarray(changed.start+enc.encode(changed.expected).length));
    eq(canonicalRichHTML(assembled),native.getHTML(),name+' native '+operation.type+' reverse='+reverse);
    ok(assembled.startsWith(prefix)&&assembled.endsWith(suffix),name+' exact outside source');
    ok(enc.encode(changed.previewWindow.raw).length<=32768,name+' bounded preview');
    native.destroy();cases++;
   }
   if(name==='long paragraph'){
    const byte=start+enc.encode(body.slice(0,body.indexOf('TARGET'))).length;
    const short={kind:'range',anchor:{block:1,position:1,byte,within:0},head:{block:1,position:1,byte:byte+6,within:0}};
    const truncated=await m.prepareSelection(short,source);
    await rejects(()=>m.changeSelection(truncated,operations[0]),'truncated structure edit');
    const full=await m.prepareSelection(short,source,{completeBlocks:true});
    const result=await m.changeSelectionAsync(full,operations[0]);
    eq(result.expected,body,'complete long paragraph read');
    eq(result.replacement,body.replace(/^<p>/,'<h1>').replace(/<\/p>$/,'</h1>'),'entire paragraph heading tags');
    let stopped=false;const cancel={...source,check:()=>{if(stopped)throw Error('cancelled');},segments:async(...args: any[])=>{const p=await (source as any).segments(...args);stopped=true;return p;}};
    await rejects(()=>m.prepareSelection(short,cancel,{completeBlocks:true}),'cancelled complete-block read');
    cases+=3;
   }
  }
  return {cases,maxPiece};
 });
 assert.equal(result.cases,45);assert.ok(result.maxPiece<=32768);
 console.log('PASS block format native comparison, complete long paragraph, raw outside bytes, bounded preview, cancellation:',JSON.stringify(result));
}finally{
 if(browser)await browser.close();await server.close();engine.stdin.end();
 const timer=setTimeout(()=>engine.kill(),5000);timer.unref();await engineClosed;clearTimeout(timer);
 await rm(dir,{recursive:true,force:true});
}
