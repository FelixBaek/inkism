// Product PM model/serializer; complete baseline DOMs are test-only.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();
 page.on('console',message=>console.log(message.text()));
 // Avoid loading the application and a second copy of ProseMirror.
 await page.route('**/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.goto('http://127.0.0.1:'+(server.httpServer.address() as any).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const {prepareSelection,changeSelection}=await import('/src/lib/document-selection.ts'),{PendingSelection}=await import('/src/lib/pending-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {canonicalRichHTML}=await import('/src/lib/rich-document.ts'),{serializeModel}=await import('/src/lib/segment-model.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {segmentPositionMap}=await import('/src/lib/segment-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {DOMParser,Slice,Fragment}=await import('/node_modules/.vite/deps/@tiptap_pm_model.js'),{EditorState,TextSelection}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js');
  // @ts-expect-error -- served by Vite in the browser
  const {splitBlock}=await import('/node_modules/.vite/deps/@tiptap_pm_commands.js');
  const blocks=['<p>first prefix</p>','<p>middle outside</p>'];let cases=0;
  for(const html of ['<p><strong>last suffix</strong></p>','<ol start="7"><li><p><strong>last suffix</strong></p></li><li><p>keep</p></li></ol>','<table><tbody><tr><td><p><strong>last suffix</strong></p></td><td><p>keep</p></td></tr></tbody></table>','<pre><code>last suffix</code></pre>'])for(const cross of [false,true])for(const rich of [false,true]){
   const original=[...blocks,canonicalRichHTML(html)],enc=new TextEncoder();
   const source={check:()=>{},read:async(offset,limit)=>({ready:true,total_blocks:3,next_offset:offset+limit<3?offset+limit:null,blocks:original.slice(offset,offset+limit).map((html,index)=>({ordinal:offset+index,html,byte_offset:enc.encode(original.slice(0,offset+index).join('')).length}))})};
   const all=await prepareSelection({kind:'all'},source),schema=all.state.schema,parser=DOMParser.fromSchema(schema),t=document.createElement('template');
   t.innerHTML=original[2];const viewDoc=parser.parse(t.content,{preserveWhitespace:'full'});
   let textStart;viewDoc.descendants((node,pos)=>{if(textStart===undefined&&node.isText)textStart=pos;});
   const head=textStart+4;
   const prepared=await prepareSelection({kind:'range',anchor:cross?{block:0,position:3}:{block:2,position:textStart+2},head:{block:2,position:head}},source);
   const before=EditorState.create({schema,doc:viewDoc,selection:TextSelection.between(viewDoc.resolve(cross?0:textStart+2),viewDoc.resolve(head))});
   t.innerHTML=rich?'<p><em>'+'Y'.repeat(100000)+'</em></p><p>END</p>':'<em>'+'Y'.repeat(100000)+'</em>';
   const slice=parser.parseSlice(t.content,{preserveWhitespace:'full'}),pending=new PendingSelection(before,slice),shown=pending.preview();
   if(shown.doc.content.size>3000||shown.doc.childCount>32)throw Error('unbounded pending model');
   let local=EditorState.create({schema,doc:shown.doc,selection:shown.selection}),expected=prepared.state.apply(prepared.state.tr.replaceSelection(slice));
   for(const text of ['typed','한글😀']){
    const tr=local.tr.insertText(text);pending.accept(local,tr);local=local.apply(tr);expected=expected.apply(expected.tr.insertText(text));
   }
   // Model comparison after cursor navigation, surrogate-aware deletion,
   // paragraph split and join at the native insertion point.
   const del=local.tr.delete(local.selection.head-2,local.selection.head);pending.accept(local,del);local=local.apply(del);expected=expected.apply(expected.tr.delete(expected.selection.head-2,expected.selection.head));
   const split=(state)=>{let tr;if(splitBlock(state,value=>{tr=value;}))return tr;return null;};
   const tr=split(local),ref=split(expected);if(!!tr!==!!ref)throw Error('split availability');
   if(tr){pending.accept(local,tr);local=local.apply(tr);expected=expected.apply(ref);}
   console.log('CASE',html,'cross='+cross,'rich='+rich);
   const result=changeSelection(prepared,pending.operation()),raw=original.join(''),bytes=enc.encode(raw),dec=new TextDecoder();
   const assembled=dec.decode(bytes.subarray(0,result.start))+result.replacement+dec.decode(bytes.subarray(result.start+enc.encode(result.expected).length));
   const whole=all.state.tr.replaceWith(prepared.blockOffset===0?0:all.state.doc.child(0).nodeSize+all.state.doc.child(1).nodeSize,all.state.doc.content.size,expected.doc.content).doc;
   if(canonicalRichHTML(assembled)!==serializeModel(whole.content))throw Error('pending replay differs: '+html+' cross='+cross+' rich='+rich);
   const shownRegion={ordinal:0,byte_offset:result.previewWindow.byteStart,source:result.previewWindow.raw,start_context:result.previewWindow.internal?.start_context??[],end_context:result.previewWindow.internal?.end_context??[]};
   const point=segmentPositionMap(shownRegion,schema).point(result.selection.head);
   const global=segmentPositionMap({ordinal:0,byte_offset:0,source:assembled,start_context:[],end_context:[]},schema).position(point.byte,point.within);
   const prefix=prepared.blockOffset===0?0:all.state.doc.child(0).nodeSize+all.state.doc.child(1).nodeSize;
   if(global!==prefix+expected.selection.head)throw Error('pending cursor differs');
   cases++;
  }
  // A selectable block atom must also survive the pending path.
  const base=await prepareSelection({kind:'all'},{check:()=>{},read:async()=>({ready:true,total_blocks:1,next_offset:null,blocks:[{ordinal:0,byte_offset:0,html:'<p>old</p>'}]})});
  const schema=base.state.schema,t=document.createElement('template');t.innerHTML='<img src="https://example.invalid/fixture.png">';
  const image=DOMParser.fromSchema(schema).parseSlice(t.content),pending=new PendingSelection(base.state,image),shown=pending.preview();
  if(shown.selection.toJSON().type!=='node')throw Error('missing block atom selection');
  const result=changeSelection(base,pending.operation());if(!result.replacement.includes('fixture.png'))throw Error('lost block atom');
  let refused=0;
  for(const content of [
   [schema.node('paragraph',null,[schema.text('Z'.repeat(100000),[schema.marks.link.create({href:'javascript:alert(1)'})])])],
   [schema.node('paragraph',null,[schema.text('Z'.repeat(100000))]),schema.node('image',{src:'javascript:alert(1)'})],
  ]){
   const pending=new PendingSelection(base.state,new Slice(Fragment.fromArray(content),0,0));
   try{changeSelection(base,pending.operation());}catch{refused++;}
  }
  if(refused!==2||base.before!=='<p>old</p>')throw Error('unsafe generated attributes accepted or source changed');
  return {cases,nodeSelection:true,unsafeRefused:refused};
 });
 assert.equal(result.cases,16);assert.ok(result.nodeSelection);assert.equal(result.unsafeRefused,2);console.log('PASS pending model:',JSON.stringify(result));
}finally{
 await browser?.close();await server.close();
}
