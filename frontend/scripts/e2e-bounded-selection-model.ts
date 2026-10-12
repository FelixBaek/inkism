// Real Rust source spans, headless React model, and a bounded live preview.
import type {AddressInfo} from 'node:net';
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
 await page.goto('http://127.0.0.1:'+(server.httpServer.address() as AddressInfo).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const m=await import('/src/lib/document-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {canonicalRichHTML}=await import('/src/lib/rich-document.ts');
  const enc=new TextEncoder(),dec=new TextDecoder();
  const eq=(a,b,label)=>{if(a!==b)throw Error(label+': '+String(a).slice(0,160)+' != '+String(b).slice(0,160));};
  const ok=(v,label)=>{if(!v)throw Error(label);};
  const reject=async(fn,label)=>{try{await fn();}catch{return;}throw Error('accepted '+label);};
  const scenarios=[
   ['paragraph','<p><strong>'+('한글😀&amp; '.repeat(11000))+'TARGET<em>tail</em></strong></p>', 'TARGET'],
   ['list','<ol start="7">'+Array.from({length:3200},(_,i)=>'<li><p>항목 '+i+(i===2600?'TARGET':' 값😀')+'</p></li>').join('')+'</ol>', 'TARGET'],
   ['table','<table><tbody><tr><td><p>'+('셀 한글😀 '.repeat(11000))+'TARGET</p></td><td><p>보존</p></td></tr></tbody></table>', 'TARGET'],
   ['unicode','<p><strong>'+('앞 😀 '.repeat(11000))+'한😀e\u0301</strong></p>', '한😀e\u0301'],
   ['entity','<p>'+('x'.repeat(100000))+'&fjlig;😀 끝</p>', '&fjlig;😀', {within:1,text:'j😀',prefix:'f'}],
   ['19MiB','<p>'+('x'.repeat(19*1024*1024-100))+'TARGET</p>', 'TARGET'],
  ].map(([label,body,target,options]:any[])=>[label,['19MiB','entity'].includes(label)?body:canonicalRichHTML(body),target,options]);
  let cases=0,maxBytes=0,maxPieces=0;
  for(const [label,body,target,options] of scenarios){
   const before='<p>앞 &amp;😀</p>',after='<p>뒤 &#128512;</p>',whole=before+body+after;
   const note=await (window as any).segmentRPC({op:'save',note:{title:'bounded '+label,content:whole,content_format:'html'}});
   await (window as any).segmentRPC({op:'wait_index'});
   let reads=0,readBytes=0,pieces=0,checks=0;
   const source={check:()=>{checks++;},
    read:(offset,limit)=>(window as any).segmentRPC({op:'document_blocks',id:note.id,revision:1,offset,limit,max_block_bytes:65536,bounded:true}),
    segments:async(ordinal,offset,limit)=>{reads++;const page=await (window as any).segmentRPC({op:'document_segments',id:note.id,revision:1,ordinal,offset,limit});pieces+=page.segments.length;readBytes+=page.segments.reduce((n,s)=>n+enc.encode(s.source).length,0);return page;},
    locate:(byte_offset,bias)=>(window as any).segmentRPC({op:'document_locate',id:note.id,revision:1,byte_offset,bias}),
   };
   const at=enc.encode(whole.slice(0,whole.indexOf(target))).length;
   const a={block:1,position:1,byte:at,within:options?.within??0},b={...a,byte:at+enc.encode(target).length,within:0};
   for(const reverse of [false,true]){
    reads=readBytes=pieces=0;
    const p=await m.prepareSelection({kind:'range',anchor:reverse?b:a,head:reverse?a:b},source);
    eq(m.selectionClipboard(p).text,options?.text??target,label+' exact clipboard');
    ok(pieces<=2 && reads<=2 && readBytes<=65536,label+' bounded reads');
    ok(p.byteStart>enc.encode(before).length,label+' starts inside giant block');
    maxBytes=Math.max(maxBytes,readBytes);maxPieces=Math.max(maxPieces,pieces);
    const assembled=value=>dec.decode(enc.encode(whole).subarray(0,value.start))+value.replacement+dec.decode(enc.encode(whole).subarray(value.start+enc.encode(value.expected).length));
    for(const op of [{kind:'delete'},{kind:'text',text:'교체😀'},{kind:'mark',mark:'italic'}]){
     const result=m.changeSelection(p,op);
     const expected=whole.replace(target,(options?.prefix??'')+(op.kind==='delete'?'':op.kind==='text'?op.text:'<em>'+(options?.text??target)+'</em>'));
     // Canonicalizing this giant DOM would defeat the test. Plain paragraph
     // operations must match exact bytes; smaller structured fixtures also
     // compare against the complete standard rich representation.
     eq(label==='19MiB'?assembled(result):canonicalRichHTML(assembled(result)),label==='19MiB'?expected:canonicalRichHTML(expected),label+' '+op.kind+' outside source');
     ok(enc.encode(result.previewWindow.raw).length<=32768,label+' bounded displayed source');
     ok(result.previewWindow.byteStart>=p.byteStart,label+' displayed byte');
     ok(result.selection.type==='text',label+' local caret');
     cases++;
    }
    let invalid=false;
    const cancelled={...source,check:()=>{if(invalid)throw Error('cancelled');},segments:async(...args:Parameters<typeof source.segments>)=>{const result=await source.segments(...args);invalid=true;return result;}};
    await reject(()=>m.prepareSelection({kind:'range',anchor:a,head:b},cancelled),label+' cancellation');
    await reject(()=>m.prepareSelection({kind:'range',anchor:a,head:b},{...source,segments:async()=>{throw Error('unavailable');}}),label+' failed read');
    await reject(()=>m.prepareSelection({kind:'range',anchor:a,head:b},{...source,segments:async(...args:Parameters<typeof source.segments>)=>{const value=await source.segments(...args);return {...value,segments:value.segments.map((s,i)=>i? s:{...s,byte_offset:s.byte_offset+32768})};}}),label+' stale cursor');
   }
   console.log('PASS',label,'short selection, original source, bounded reads');
  }
  return {cases,maxBytes,maxPieces,liveNodes:document.querySelectorAll('*').length};
 });
 assert.equal(result.cases,36);assert.ok(result.liveNodes<10);
 console.log('PASS bounded selection:',JSON.stringify(result));
}finally{
 await browser?.close();await server.close();engine.stdin.end();
 const timer=setTimeout(()=>engine.kill(),2000);
 try{await engineClosed;}finally{clearTimeout(timer);}
 await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
