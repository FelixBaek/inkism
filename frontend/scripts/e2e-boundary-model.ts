// Real Rust source spans, headless React model, and a bounded live preview.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';

assert.ok(process.env.INKISM_SEGMENT_ENGINE,'current Rust executable required');
const dir=await mkdtemp(join(tmpdir(),'inkism-boundary-model-'));
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
 await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const {Editor}=await import('/node_modules/.vite/deps/@tiptap_core.js');
  // @ts-expect-error -- served by Vite in the browser
  const {contentExtensions}=await import('/src/extensions/content-schema.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {canonicalRichHTML}=await import('/src/lib/rich-document.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {segmentPositionMap}=await import('/src/lib/segment-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {Selection,NodeSelection}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js');
  // @ts-expect-error -- served by Vite in the browser
  const {prepareBoundary,changeBoundary}=await import('/src/lib/boundary-edit.ts');
  const cases=[
   '<p><strong>'+('한글😀e\u0301&amp;👨‍👩‍👧‍👦 '.repeat(5000))+'</strong></p>',
   '<ol start="4">'+Array.from({length:2200},(_,i)=>'<li><p>항목 '+i+' <em>한글😀</em></p></li>').join('')+'</ol>',
   '<table><tbody><tr><td><p>'+('거대 셀😀 '.repeat(12000))+'</p></td></tr></tbody></table>',
   '<table><tbody>'+Array.from({length:1500},(_,i)=>'<tr><td><p>행 '+i+' 😀</p></td><td><p>값</p></td></tr>').join('')+'</tbody></table>',
   '<p><strong>'+('문단 '.repeat(25000))+'</strong></p><p>뒤 문단😀</p>',
   '<p>앞 문단😀</p><p><strong>'+('문단 '.repeat(25000))+'</strong></p>',
   '<p>'+('앞 문단 '.repeat(15000))+'</p><hr><p>'+('뒤 문단 '.repeat(15000))+'</p>',
  ].map(canonicalRichHTML);
  const eq=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify(a).slice(0,300)+' != '+JSON.stringify(b).slice(0,300));};
  const reject=async(fn,label)=>{try{await fn();}catch{return;}throw Error('accepted '+label);};
  (window as any).boundaryFixture={cases,reference:null,result:null};
  (window as any).boundaryFixture.setup=async(index,direction,repeat=1,selectedAtom=false)=>{
   const f=(window as any).boundaryFixture;f.reference?.destroy();document.body.innerHTML='<div id="reference"></div>';
   const body=cases[index],note=await (window as any).segmentRPC({op:'save',note:{title:'boundary '+index+direction,content:body,content_format:'html'}});await (window as any).segmentRPC({op:'wait_index'});
   let currentBlock=index===6&&direction==='backward'?2:index===5?1:index===4&&direction==='backward'?1:0;
   const initial=await (window as any).segmentRPC({op:'document_segments',id:note.id,revision:1,ordinal:currentBlock});
   let offset=(index===4||index===6)&&direction==='forward'?initial.total_segments-1:(index===4||index===6)&&direction==='backward'?0:Math.floor(initial.total_segments/2);
   const current=(await (window as any).segmentRPC({op:'document_segments',id:note.id,revision:1,ordinal:currentBlock,offset})).segments[0];
   const map=segmentPositionMap(current),point=map.point((direction==='backward'?Selection.atStart(map.doc()):Selection.atEnd(map.doc())).head);
   let reads=0;
   const source={check:()=>{},
    locate:(byte_offset,bias)=>(window as any).segmentRPC({op:'document_locate',id:note.id,revision:1,byte_offset,bias}),
    read:offset=>{reads++;return (window as any).segmentRPC({op:'document_blocks',id:note.id,revision:1,offset,limit:1,max_block_bytes:65536,bounded:true});},
    segments:(ordinal,offset)=>(window as any).segmentRPC({op:'document_segments',id:note.id,revision:1,ordinal,offset,limit:1}),
   };
   const prepared=await prepareBoundary(point,direction,source);
   if(!prepared)throw Error('missing boundary '+index+direction);
   if(selectedAtom){let at;prepared.state.doc.descendants((node,pos)=>{if(node.type.name==='horizontalRule')at=pos;});if(at===undefined)throw Error('atom not present in bounded model');prepared.state=prepared.state.apply(prepared.state.tr.setSelection(NodeSelection.create(prepared.state.doc,at)));}
   const changed=changeBoundary(prepared,direction,repeat);
   if(reads!==(index===6?3:2))throw Error('boundary reads '+reads);
   if(new TextEncoder().encode(prepared.region.source).length>131072)throw Error('unbounded region');
   let corrupted=false;
   const broken={...source,segments:async(...args: any[])=>{const value=await (source as any).segments(...args);if(corrupted)return value;corrupted=true;return {...value,segments:value.segments.map((v,i)=>i===0?{...v,byte_offset:v.byte_offset+1}:v)};}};
   await reject(()=>prepareBoundary(point,direction,broken),'discontinuous boundary');
   let cancelled=false;const guarded=await prepareBoundary(point,direction,{...source,check:()=>{if(cancelled)throw Error('cancelled');}});cancelled=true;
   await reject(()=>changeBoundary(guarded,direction),'cancelled edit');
   f.note=note;f.body=body;f.result=changed;f.direction=direction;f.nativeSpace=selectedAtom&&repeat===2&&direction==='forward';
   f.reference=new Editor({element:document.getElementById('reference'),extensions:contentExtensions({trailingNode:false,automaticIds:false}),content:body,parseOptions:{preserveWhitespace:'full'},injectCSS:false});
   const full=segmentPositionMap({ordinal:0,byte_offset:0,source:body,start_context:[],end_context:[]});
   if(selectedAtom){let at;f.reference.state.doc.descendants((node,pos)=>{if(node.type.name==='horizontalRule')at=pos;});f.reference.commands.setNodeSelection(at);}
   else f.reference.commands.setTextSelection(full.position(point.byte,point.within));f.reference.view.focus();
   console.log('prepared',index,direction,'source bytes',new TextEncoder().encode(prepared.region.source).length);
  };
  (window as any).boundaryFixture.verify=async()=>{
   const f=(window as any).boundaryFixture,changed=f.result,native=f.reference.getHTML();
   if(!changed){eq(native,f.body,'native no-op');return {changed:false};}
   const encoder=new TextEncoder(),decoder=new TextDecoder();let bytes=encoder.encode(f.body);
   const edits=[...changed.tags,{start:changed.start,expected:changed.expected,replacement:changed.replacement}];
   for(const edit of edits){
    const end=edit.start+encoder.encode(edit.expected).length;
    eq(decoder.decode(bytes.subarray(edit.start,end)),edit.expected,'exact expected span');
    bytes=encoder.encode(decoder.decode(bytes.subarray(0,edit.start))+edit.replacement+decoder.decode(bytes.subarray(end)));
   }
   const expected=decoder.decode(bytes),ids=[...expected.matchAll(/ id="(ink-block-[0-9a-f-]{36})"/g)];
   eq(new Set(ids.map(v=>v[1])).size,ids.length,'unique block identities');
   const canonical=canonicalRichHTML(expected.replace(/ id="ink-block-[0-9a-f-]{36}"/g,''));
   if(canonical!==native){let at=0;while(canonical[at]===native[at]&&at<Math.min(canonical.length,native.length))at++;console.log('native mismatch',at,canonical.slice(at-35,at+55),native.slice(at-35,at+55),f.reference.state.selection.toJSON());}
   // Blink's second native Delete after a selected HR may rewrite a newly
   // leading ASCII space to NBSP. Keep the original source space in the model
   // and expose this one serialization difference instead of hiding it.
   const browserWhitespace=f.nativeSpace&&canonical!==native;
   eq(canonical,browserWhitespace?native.replace('<p>&nbsp;','<p> '):native,'whole native command equivalence (declared leading-space DOM rewrite)');
   if(changed.tags.length||changed.expected!==changed.replacement)await (window as any).segmentRPC({op:'document_splice_html',id:f.note.id,revision:1,edits});
   const saved=await (window as any).segmentRPC({op:'get',id:f.note.id});eq(saved.content,expected,'saved exact outside bytes');
   if(encoder.encode(changed.afterPreview.raw).length>65536)throw Error('unbounded preview');
   if(changed.selection.type==='node'){
    eq(saved.revision,1,'selection alone must not save a new revision');
    const p=changed.afterPreview,local=segmentPositionMap({ordinal:0,byte_offset:p.byteStart,source:p.raw,start_context:p.internal?.start_context??[],end_context:p.internal?.end_context??[]}),point=local.point(changed.selection.anchor);
    const full=segmentPositionMap({ordinal:0,byte_offset:0,source:expected,start_context:[],end_context:[]});
    eq(full.position(point.byte,point.within),f.reference.state.selection.anchor,'restored atom selection');
    if(local.doc().childCount<2)throw Error('atom preview discarded the neighbouring textblock');
   }
   return {changed:true,previewBytes:encoder.encode(changed.afterPreview.raw).length,browserWhitespace};
  };
 });
 let checked=0;
 for(let index=0;index<6;index++)for(const direction of ['backward','forward']){
  await page.evaluate(({index,direction})=>(window as any).boundaryFixture.setup(index,direction),{index,direction});
  await page.keyboard.press(direction==='backward'?'Backspace':'Delete');
  console.log('verified',index,direction,await page.evaluate(()=>(window as any).boundaryFixture.verify()));checked++;
 }
 for(const [repeat,selectedAtom] of [[1,false],[2,false],[1,true],[2,true]] as [number,boolean][])for(const direction of ['backward','forward']){
  await page.evaluate(({direction,repeat,selectedAtom})=>(window as any).boundaryFixture.setup(6,direction,repeat,selectedAtom),{direction,repeat,selectedAtom});
  for(let key=0;key<repeat;key++)await page.keyboard.press(direction==='backward'?'Backspace':'Delete');
  console.log('verified atom',direction,repeat,selectedAtom,await page.evaluate(()=>(window as any).boundaryFixture.verify()));checked++;
 }
 assert.equal(checked,20);console.log('PASS bounded boundary model, Unicode/list/table/cross-block/atom edits, declared native leading-space rewrite, stale/discontinuous refusal and real Rust exact source preservation: '+checked);
}finally{
 await browser?.close();await server.close();engine.stdin.end();
 const timer=setTimeout(()=>engine.kill(),2000);
 try{await engineClosed;}finally{clearTimeout(timer);}
 await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
