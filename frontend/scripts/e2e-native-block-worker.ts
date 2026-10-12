// Large-document native block format must run in native-block-format.worker:
// 10000 canonical mixed blocks (~1MiB) prepared as {kind:'all'}, the synchronous
// baseline and the async worker result must agree exactly, no main-thread
// setBlockType during async, real worker create/terminate, live main-thread
// timers, check() cancellation and recovery, and no fallback when the worker
// constructor fails. Pure mock source (honest ordinals/byte offsets), no Rust
// engine; the 45-case Rust/cache/native comparison runs separately.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const executablePath=process.env.CHROMIUM_PATH;
assert.ok(executablePath,'headless Chromium required: set CHROMIUM_PATH');
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({executablePath,args:['--no-sandbox']});
 const page=await browser.newPage();
 page.on('console',message=>console.log(message.text()));
 page.on('pageerror',error=>console.log('pageerror:',error.message));
 // Avoid loading the application and a second copy of ProseMirror.
 await page.route('**/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.goto('http://127.0.0.1:'+(server.httpServer.address() as any).port+'/');
 const result=await page.evaluate(async()=>{
  const enc=new TextEncoder();
  const ok=(value,label)=>{if(!value)throw Error(label);};
  const deepEqual=(a,b)=>{
   if(a===b)return true;
   if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return false;
   if(Array.isArray(a)!==Array.isArray(b))return false;
   const keys=Object.keys(a).sort(),other=Object.keys(b).sort();
   return keys.length===other.length&&keys.every((key,index)=>key===other[index]&&deepEqual(a[key],b[key]));
  };
  const round=v=>Math.round(v*100)/100;
  // Forwarding Worker hook: only observe/force native-block-format workers;
  // every other worker (source-scan and friends) is created untouched.
  const NativeWorker=window.Worker;
  const stats={created:0,terminated:0,live:0,otherCreated:0,urlSample:''};
  let forceNativeWorkerFailure=false,onNativeCreated=null;
  class TrackedWorker extends NativeWorker{
   constructor(url,options){
    const target=String(url);
    if(forceNativeWorkerFailure&&target.includes('native-block-format.worker'))
     throw new Error('forced native block worker failure (test hook)');
    super(url,options);
    if(target.includes('native-block-format.worker')){
     stats.created++;stats.live++;if(!stats.urlSample)stats.urlSample=target;
     const terminate=this.terminate.bind(this);
     this.terminate=()=>{stats.terminated++;stats.live--;return terminate();};
     if(onNativeCreated)onNativeCreated(target);
    }else stats.otherCreated++;
   }
  }
  window.Worker=TrackedWorker;
  let originalSetBlockType=null,TransformRef=null;
  const restored={transform:false,worker:false};
  // Hook the real Vite pre-bundled ProseMirror transform before loading the
  // module under test, so the baseline and async paths share the instance.
  try{
   // @ts-expect-error -- served by Vite in the browser
   const {Transform}=await import('/node_modules/.vite/deps/@tiptap_pm_transform.js');
   TransformRef=Transform;
   originalSetBlockType=Transform.prototype.setBlockType;
   const transform={calls:0,ms:0};
   Transform.prototype.setBlockType=function(...args){
    const at=performance.now();transform.calls++;
    try{return originalSetBlockType.apply(this,args);}finally{transform.ms+=performance.now()-at;}
   };
   // @ts-expect-error -- served by Vite in the browser
   const m=await import('/src/lib/document-selection.ts');
   // @ts-expect-error -- served by Vite in the browser
   const {canonicalRichHTML}=await import('/src/lib/rich-document.ts');
   // @ts-expect-error -- served by Vite in the browser
   const {getSchema}=await import('/node_modules/.vite/deps/@tiptap_core.js');
   // @ts-expect-error -- served by Vite in the browser
   const {EditorState,AllSelection}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js');
   // @ts-expect-error -- served by Vite in the browser
   const {contentExtensions}=await import('/src/extensions/content-schema.ts');
   // @ts-expect-error -- served by Vite in the browser
   const {nativeBlockFormat}=await import('/src/lib/native-block-format.ts');
   // @ts-expect-error -- served by Vite in the browser
   const {formatBlocksInWorker}=await import('/src/lib/native-block-client.ts');
   // Actual custom schema: persisted attributes, validated column widths,
   // whitespace/linebreak conversion, atom nodes and inline/block math.
   const schema=getSchema(contentExtensions()),n=schema.nodes;
   const paragraph=text=>n.paragraph.create(null,schema.text(text,[schema.marks.bold.create()]));
   const customDoc=schema.topNodeType.create(null,[
    n.heading.create({level:2},schema.text('제목 😀')),
    n.callout.create({icon:'😀',backColor:'#abcdef'},paragraph('콜아웃')),
    n.details.create({open:true},[
     n.detailsSummary.create(null,schema.text('접기 제목')),
     n.detailsContent.create(null,paragraph('접기 내용')),
    ]),
    n.table.create(null,n.tableRow.create(null,n.tableCell.create({colwidth:[140]},paragraph('셀')))),
    n.codeBlock.create({language:'rust'},schema.text('line 1\nline 2\n끝 😀')),
    n.blockMath.create({latex:'x^2'}),
    n.paragraph.create(null,[schema.text('수식 '),n.inlineMath.create({latex:'a+b'})]),
    n.attachment.create({url:'/api/attachments/00000000-0000-4000-8000-000000000001',
     mediaType:'application/pdf',name:'한글😀.pdf',size:123}),
   ]);
   customDoc.check();
   const customState=EditorState.create({doc:customDoc,selection:new AllSelection(customDoc)});
   const customOperations=[{kind:'block',type:'heading',level:3,toggle:false},
    {kind:'block',type:'paragraph'},{kind:'block',type:'heading',level:1,toggle:true}];
   for(const operation of customOperations){
    const expected=nativeBlockFormat(customState,operation);
    const actual=await formatBlocksInWorker(customState,operation,()=>{});
    ok(deepEqual(actual.doc.toJSON(),expected.doc.toJSON()),'custom schema document parity');
    ok(deepEqual(actual.selection.toJSON(),expected.selection.toJSON()),'custom schema selection parity');
    for(let pos=0;pos<=customDoc.content.size;pos++)for(const bias of [-1,1])
     ok(actual.mapping.map(pos,bias)===expected.mapping.map(pos,bias),'custom schema position-map parity');
   }
   ok(stats.live===0,'custom schema workers terminated');
   // 10000 canonical paragraph/heading blocks with Korean, emoji and strong.
   const raw=[];
   for(let i=0;i<10000;i++){
    if(i%10===3)raw.push(`<h2>제목 ${i} 한글😀</h2>`);
    else if(i%10===7)raw.push(`<h3>소제목 ${i} 😀</h3>`);
    else raw.push(`<p>${`본문 ${i} 한글😀 여름 <strong>강조 ${i} 😀</strong> 마침 `.repeat(2)}</p>`);
   }
   const blocks: any[]=raw.map((html,ordinal)=>({html:canonicalRichHTML(html),ordinal}));
   const whole=blocks.map(block=>block.html).join('');
   ok(canonicalRichHTML(whole)===whole,'per-block canonical HTML must concatenate to the canonical whole');
   let inputBytes=0;
   for(const block of blocks){block.byte_offset=inputBytes;inputBytes+=enc.encode(block.html).length;}
   ok(inputBytes>768*1024,'about 1MiB of canonical source expected, got '+inputBytes+' bytes');
   // Honest mock: sequential ordinals, contiguous byte offsets, real cursors.
   const gate={invalid:false};
   const source={
    check:()=>{if(gate.invalid)throw new Error('준비된 선택 범위의 원본 검사가 만료되었습니다(검사 무효화).');},
    read:async(offset,limit)=>{
     ok(Number.isSafeInteger(offset)&&offset>=0&&offset<blocks.length,'mock read offset '+offset);
     ok(Number.isSafeInteger(limit)&&limit>=1,'mock read limit '+limit);
     const slice=blocks.slice(offset,offset+limit);
     return {ready:true,total_blocks:blocks.length,blocks:slice,
      next_offset:offset+limit<blocks.length?offset+limit:null};
    },
   };
   const prepareAt=performance.now();
   const p=await m.prepareSelection({kind:'all'},source,{completeBlocks:true});
   const prepareMS=performance.now()-prepareAt;
   const docSnapshot=p.state.doc,beforeSnapshot=p.before,childCount=p.state.doc.childCount;
   ok(docSnapshot.content.size>64*1024&&childCount>128,'prepared job must exceed the large-job thresholds');
   const preserved=()=>p.before===beforeSnapshot&&p.state.doc===docSnapshot&&p.state.doc.childCount===childCount;
   const H2={kind:'block',type:'heading',level:2,toggle:false};
   const fields=['start','expected','replacement','count','preview','previewCount','previewWindow','selection','beforeSelection'];
   const snapshot=()=>({created:stats.created,terminated:stats.terminated,calls:transform.calls,ms:transform.ms});
   // Baseline: synchronous native transform on the main thread.
   const base=snapshot();
   const baselineAt=performance.now();
   const baseline=m.changeSelection(p,H2);
   const baselineMS=performance.now()-baselineAt;
   ok(transform.calls>base.calls,'baseline changeSelection must drive main-thread setBlockType');
   // Async: the same prepared selection through the real native worker.
   const started=snapshot();
   let ticks=0,maxGap=0,lastTick=performance.now();
   const tickTimer=setInterval(()=>{const now=performance.now(),gap=now-lastTick;if(gap>maxGap)maxGap=gap;lastTick=now;ticks++;},16);
   let asyncResult;const asyncAt=performance.now();
   try{asyncResult=await m.changeSelectionAsync(p,H2);}
   finally{maxGap=Math.max(maxGap,performance.now()-lastTick);clearInterval(tickTimer);}
   const asyncMS=performance.now()-asyncAt;
   ok(transform.calls===started.calls,'async changeSelection must keep setBlockType off the main thread');
   ok(stats.created>started.created,'async changeSelection must create the native block worker');
   ok(stats.live===0,'native block worker must be terminated after the async run');
   ok(ticks>=20,'main-thread timers must progress during the async run, ticks='+ticks);
   ok(enc.encode(asyncResult.previewWindow.raw).length<=32768,'bounded preview window');
   const mismatched=fields.filter(field=>!deepEqual(baseline[field],asyncResult[field]));
   ok(!mismatched.length,'sync/async mismatch: '+mismatched.join(','));
   const asyncCreated=stats.created-started.created,asyncTerminated=stats.terminated-started.terminated;
   // Cancellation: invalidate the prepared check 25ms into the worker run.
   gate.invalid=false;
   let flipped=false,pendingFlip=null;
   const cancelStart=snapshot();
   onNativeCreated=()=>{if(!flipped)pendingFlip=setTimeout(()=>{flipped=true;gate.invalid=true;},25);};
   const fallback=setTimeout(()=>{if(!flipped&&stats.created===cancelStart.created){flipped=true;gate.invalid=true;}},25);
   let cancelError;const cancelAt=performance.now();
   try{
    await m.changeSelectionAsync(p,H2);
    throw new Error('무효화된 검사로 큰 작업이 취소되어야 했습니다.');
   }catch(error){cancelError=error;}
   finally{clearTimeout(fallback);if(pendingFlip)clearTimeout(pendingFlip);onNativeCreated=null;}
   const cancelRejected=cancelError&&!cancelError.message.startsWith('무효화된');
   ok(cancelRejected,'invalidated check must reject the large job: '+String(cancelError&&cancelError.message));
   ok(preserved(),'cancelled job must keep the prepared source and state immutable');
   ok(transform.calls===cancelStart.calls,'cancelled job must not transform on the main thread');
   ok(stats.live===0,'cancelled native worker must be terminated');
   const cancelCreated=stats.created-cancelStart.created,
    cancelTerminated=stats.terminated-cancelStart.terminated;
   ok(cancelCreated>0&&cancelTerminated===cancelCreated,'a real native worker was cancelled and terminated');
   // Recovery: reset the invalid flag and retry the same large job.
   gate.invalid=false;flipped=false;
   const retryStart=snapshot();
   const retryAt=performance.now();
   const retry=await m.changeSelectionAsync(p,H2);
   const retryMS=performance.now()-retryAt;
   ok(preserved(),'retry must keep the prepared source and state immutable');
   ok(stats.created>retryStart.created,'retry must create its own native worker');
   ok(stats.live===0,'retry native worker must be terminated');
   const retryMismatched=fields.filter(field=>!deepEqual(baseline[field],retry[field]));
   ok(!retryMismatched.length,'retry must reproduce the baseline result: '+retryMismatched.join(','));
   ok(transform.calls===retryStart.calls,'retry must keep setBlockType off the main thread');
   const retryCreated=stats.created-retryStart.created,
    retryTerminated=stats.terminated-retryStart.terminated;
   // Forced worker constructor failure: reject without any main-thread fallback.
   forceNativeWorkerFailure=true;
   const failureStart=snapshot();
   let failureError;
   try{
    await m.changeSelectionAsync(p,H2);
    throw new Error('생성 실패 후 주 스레드 대체 실행되어서는 안 됩니다.');
   }catch(error){failureError=error;}
   finally{forceNativeWorkerFailure=false;}
   const failureRejected=failureError&&!failureError.message.startsWith('생성 실패 후');
   ok(failureRejected&&/forced native block worker/.test(String(failureError&&failureError.message)),
    'forced worker failure must reject with the hook error: '+String(failureError&&failureError.message));
   ok(transform.calls===failureStart.calls,'no main-thread native fallback after worker failure');
   ok(stats.created===failureStart.created,'no native worker is created after the forced failure');
   ok(preserved(),'forced failure must keep the prepared source and state immutable');
   ok(stats.live===0,'every native block worker must be terminated');
   const failureCreated=stats.created-failureStart.created;
   return {
    schemaCases:customOperations.length,blocks:blocks.length,inputBytes,outputBytes:enc.encode(asyncResult.replacement).length,
    docContentSize:docSnapshot.content.size,childCount,
    workerUrlSample:stats.urlSample,otherWorkersCreated:stats.otherCreated,
    prepareMS:round(prepareMS),
    baseline:{ms:round(baselineMS),setBlockTypeCalls:transform.calls-base.calls,
     setBlockTypeMS:round(transform.ms-base.ms),count:baseline.count},
    async:{ms:round(asyncMS),setBlockTypeCalls:transform.calls-started.calls,
     setBlockTypeMS:round(transform.ms-started.ms),workerCreated:asyncCreated,
     workerTerminated:asyncTerminated,workerLive:stats.live,
     timerTicks:ticks,timerMaxGapMS:round(maxGap),count:asyncResult.count,
     previewRawBytes:enc.encode(asyncResult.previewWindow.raw).length},
    mismatched,
    cancel:{rejected:cancelRejected,message:String(cancelError&&cancelError.message).slice(0,120),
     workerCreated:cancelCreated,workerTerminated:cancelTerminated,
     setBlockTypeCalls:transform.calls-cancelStart.calls,preserved:preserved()},
    retry:{ms:round(retryMS),matchesBaseline:!retryMismatched.length,count:retry.count,
     workerCreated:retryCreated,workerTerminated:retryTerminated},
    forcedFailure:{rejected:failureRejected,message:String(failureError&&failureError.message).slice(0,120),
     workerCreated:failureCreated,
     setBlockTypeCalls:transform.calls-failureStart.calls,preserved:preserved()},
    hooksRestored:restored,
   };
  }finally{
   if(originalSetBlockType)TransformRef.prototype.setBlockType=originalSetBlockType;
   window.Worker=NativeWorker;
   restored.transform=!originalSetBlockType||TransformRef.prototype.setBlockType===originalSetBlockType;
   restored.worker=window.Worker===NativeWorker;
  }
 });
 assert.equal(result.hooksRestored.transform,true,'setBlockType hook restored');
 assert.equal(result.hooksRestored.worker,true,'Worker hook restored');
 assert.ok(result.docContentSize>64*1024&&result.childCount>128,'large job thresholds');
 assert.ok(result.async.workerCreated>0,'native block worker created');
 assert.equal(result.async.workerTerminated,result.async.workerCreated,'all native block workers terminated');
 assert.equal(result.async.workerLive,0,'no live native block worker');
 assert.ok(result.workerUrlSample.includes('native-block-format.worker'),'worker URL: '+result.workerUrlSample);
 assert.ok(result.baseline.setBlockTypeCalls>0,'baseline main-thread setBlockType');
 assert.equal(result.async.setBlockTypeCalls,0,'async main-thread setBlockType');
 assert.ok(result.async.timerTicks>=20,'main-thread timer progress during async');
 assert.deepEqual(result.mismatched,[]);
 assert.equal(result.cancel.rejected,true,'cancelled large job rejects');
 assert.equal(result.cancel.preserved,true,'cancelled job preserves source/state');
 assert.equal(result.cancel.setBlockTypeCalls,0,'cancelled job has no main-thread transform');
 assert.equal(result.retry.matchesBaseline,true,'retry matches baseline');
 assert.equal(result.forcedFailure.rejected,true,'forced worker failure rejects');
 assert.equal(result.forcedFailure.setBlockTypeCalls,0,'no main-thread fallback');
 assert.equal(result.forcedFailure.preserved,true,'forced failure preserves source/state');
 console.log('PASS native-block worker isolation, cancellation, retry, forced failure:',
  JSON.stringify(result));
}finally{
 if(browser)await browser.close();
 await server.close();
}
