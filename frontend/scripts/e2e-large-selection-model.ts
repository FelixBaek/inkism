// Product PM model/serializer; complete baseline DOMs are test-only.
import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';

const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();
 page.on('console',message=>console.log(message.text()));
 // Avoid loading the application and a second copy of ProseMirror.
 await page.route('**/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.goto('http://127.0.0.1:'+(server.httpServer.address() as AddressInfo).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const m=await import('/src/lib/document-selection.ts'),{canonicalRichHTML}=await import('/src/lib/rich-document.ts'),{segmentPositionMap}=await import('/src/lib/segment-selection.ts'),{sanitizeRichHtml}=await import('/src/lib/sanitize.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {getHTMLFromFragment}=await import('/node_modules/.vite/deps/@tiptap_core.js');
  // @ts-expect-error -- served by Vite in the browser
  const {DOMParser,Slice}=await import('/node_modules/.vite/deps/@tiptap_pm_model.js');
  // @ts-expect-error -- served by Vite in the browser
  const {TextSelection,EditorState}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js');
  // @ts-expect-error -- served by Vite in the browser
  const {serializeModelMapped,modelSourceSegments}=await import('/src/lib/segment-model.ts');
  const enc=new TextEncoder(),dec=new TextDecoder();
  const exactEdited=(actual,expected,label)=>{
   const root=document.createElement('template');root.innerHTML=actual;
   const edited=Array.from(root.content.children).slice(1,-1);
   if(!edited.length)throw Error('missing edited block '+label);
   const nodes=edited.flatMap(node=>[node,...node.querySelectorAll('[id]')]);const ids=[];
   for(const node of nodes){const id=node.getAttribute('id');if(id&&/^ink-block-[0-9a-f-]{36}$/.test(id)){ids.push(id);node.removeAttribute('id');}}
   if(!ids.length||new Set(ids).size!==ids.length)throw Error('missing or duplicate edited identities '+label);
   if(canonicalRichHTML(root.innerHTML)!==expected)throw Error(label);
  };
  const original=['<p>앞 &amp;😀</p>','<p><strong>abcdef</strong></p>','<p>뒤 raw&#128512;</p>'],whole=original.join('');
  const source={check:()=>{},read:async(offset,limit)=>({ready:true,total_blocks:3,next_offset:offset+limit<3?offset+limit:null,blocks:original.slice(offset,offset+limit).map((html,index)=>({ordinal:offset+index,html,byte_offset:enc.encode(original.slice(0,offset+index).join('')).length}))})};
  const inputs=[
   {name:'256KiB ASCII',operation:{kind:'text',text:'X'.repeat(256*1024)}},
   {name:'Unicode',operation:{kind:'text',text:'한😀e\u0301 & '.repeat(25000)}},
   {name:'inline HTML',operation:{kind:'paste',html:'<em>'+('한글😀 &amp; '.repeat(14000))+'</em><strong>END</strong>'}},
   {name:'code',operation:{kind:'paste',html:canonicalRichHTML('<pre><code>'+('코드😀 &amp; &lt;div&gt;\r\n'.repeat(12000))+'</code></pre>')}},
   {name:'paragraphs',operation:{kind:'paste',html:canonicalRichHTML(Array.from({length:3500},(_,i)=>'<p>본문 '+i+' <em>한글😀</em></p>').join(''))}},
   {name:'list',operation:{kind:'paste',html:canonicalRichHTML('<ol start="7">'+Array.from({length:1800},(_,i)=>'<li><p>항목 '+i+' <em>본문😀</em></p></li>').join('')+'</ol>')}},
   {name:'table',operation:{kind:'paste',html:canonicalRichHTML('<table><tbody>'+Array.from({length:900},(_,i)=>'<tr><td><p>행 '+i+' 한글😀</p></td><td><p><strong>본문</strong></p></td></tr>').join('')+'</tbody></table>')}},
   {name:'open slice',operation:{kind:'paste',html:canonicalRichHTML('<p><em>'+('조각😀 '.repeat(45000))+'</em>END</p>')},slice:true},
   {name:'foreign HTML fallback',operation:{kind:'paste',html:'<div class="legacy"><script>alert(1)</script><p><strong>'+('외부😀 '.repeat(35000))+'</strong></p></div>'},fallback:true},
  ];
  let cases=0,maxDOMBytes=0,maxPreview=0,fallbackDOMBytes=0;
  const base=await m.prepareSelection({kind:'all'},source),parser=DOMParser.fromSchema(base.state.schema),template=document.createElement('template');
  template.innerHTML=canonicalRichHTML('<p><strong>A😀&amp;&nbsp;</strong><em>\r\n한국</em><br>끝</p><hr><ol start="7"><li><p>항목</p></li></ol><table><tbody><tr><td><p>셀😀</p></td><td><p>끝</p></td></tr></tbody></table>');
  const doc=parser.parse(template.content,{preserveWhitespace:'full'}),positions=Array.from({length:doc.content.size+1},(_,pos)=>pos);
  const mapped=serializeModelMapped(doc.content,positions),mapping=segmentPositionMap({ordinal:0,byte_offset:0,source:mapped.html,start_context:[],end_context:[]},base.state.schema);
  if(mapped.html!==getHTMLFromFragment(doc.content,base.state.schema))throw Error('serializer changed HTML');
  mapped.points.forEach((point,index)=>{if(mapping.position(point.byte,point.within)!==index)throw Error('serialized cursor '+index);});
  const short=await m.prepareSelection({kind:'range',anchor:{block:1,position:3},head:{block:1,position:5}},source);
  try{m.changeSelection(short,{kind:'text',text:'X'.repeat(21*1024*1024)});throw Error('over-limit accepted');}catch(error){if(!String(error).includes('20 MiB'))throw error;}
  if(short.before!==original[1])throw Error('over-limit changed source');
  for(const fixture of inputs)for(const reverse of [false,true]){
   const anchor={block:1,position:3},head={block:1,position:5};
   const range={kind:'range',anchor:reverse?head:anchor,head:reverse?anchor:head};
   const prepared=await m.prepareSelection(range,source),full=await m.prepareSelection({kind:'all'},source);
   const schema=prepared.state.schema,parser=DOMParser.fromSchema(schema);
   const op:any=fixture.slice?{kind:'slice',slice:(()=>{const t=document.createElement('template');t.innerHTML=fixture.operation.html;return parser.parseSlice(t.content,{preserveWhitespace:'full'}).toJSON();})()}:fixture.operation;
   const offset=full.state.doc.firstChild.nodeSize,refState=full.state.apply(full.state.tr.setSelection(TextSelection.create(full.state.doc,offset+(reverse?5:3),offset+(reverse?3:5))));
   let tr=refState.tr;
   if(op.kind==='text')tr.insertText(op.text);
   else if(op.kind==='slice')tr.replaceSelection(Slice.fromJSON(schema,op.slice));
   else {const t=document.createElement('template');t.innerHTML=sanitizeRichHtml(op.html);tr.replaceSelection(parser.parseSlice(t.content,{preserveWhitespace:'full'}));}
   // Product DOM measurement excludes the complete baseline model and its
   // serialized expected output, which are deliberately test-only DOMs.
   const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');let largest=0;
   const nativeParse=window.DOMParser.prototype.parseFromString;
   Object.defineProperty(Element.prototype,'innerHTML',{...descriptor,set(value){largest=Math.max(largest,enc.encode(String(value)).length);descriptor.set.call(this,value);}});
   window.DOMParser.prototype.parseFromString=function(value,type){largest=Math.max(largest,enc.encode(String(value)).length);return nativeParse.call(this,value,type);};
   let result;
   try{result=m.changeSelection(prepared,op);}finally{Object.defineProperty(Element.prototype,'innerHTML',descriptor);window.DOMParser.prototype.parseFromString=nativeParse;}
   const assembled=dec.decode(enc.encode(whole).subarray(0,result.start))+result.replacement+dec.decode(enc.encode(whole).subarray(result.start+enc.encode(result.expected).length));
   const expected=getHTMLFromFragment(tr.doc.content,schema);
   exactEdited(assembled,expected,'full baseline '+fixture.name+' reverse='+reverse);
   if(!assembled.startsWith(original[0])||!assembled.endsWith(original[2]))throw Error('outside raw changed '+fixture.name);
   if(!fixture.fallback&&largest>65536)throw Error('whole product DOM '+fixture.name+' bytes='+largest);
   if(enc.encode(result.previewWindow.raw).length>32768)throw Error('large display '+fixture.name);
   const shown={ordinal:0,byte_offset:result.previewWindow.byteStart,source:result.previewWindow.raw,start_context:result.previewWindow.internal?.start_context??[],end_context:result.previewWindow.internal?.end_context??[]};
   const point=segmentPositionMap(shown,schema).point(result.selection.head);
   const global=segmentPositionMap({ordinal:0,byte_offset:0,source:assembled,start_context:[],end_context:[]},schema).position(point.byte,point.within);
   if(global!==tr.selection.head)throw Error('wrong pasted cursor '+fixture.name+' '+global+' != '+tr.selection.head);
   if(fixture.fallback){if(largest<65536)throw Error('fallback DOM gap not observed');fallbackDOMBytes=Math.max(fallbackDOMBytes,largest);}else maxDOMBytes=Math.max(maxDOMBytes,largest);
   maxPreview=Math.max(maxPreview,enc.encode(shown.source).length);cases++;
   console.log('PASS',fixture.name,'reverse='+reverse,'DOM='+largest,'preview='+enc.encode(shown.source).length);
  }
  // Synthetic edge contracts exercise raw alias/case preservation. These are
  // not evidence of Rust segmentation; the native fixtures test that separately.
  let contextCases=0;
  for(const tag of ['b','i','del','strong'])for(const uppercase of [false,true])for(const split of [false,true])for(const reverse of [false,true]){
   const token=uppercase?tag.toUpperCase():tag,p=uppercase?'P':'p';
   const prefix='<'+p+'><'+token+'>',at=enc.encode(prefix).length+94;
   const before=prefix+'x'.repeat(94)+'abcdef'+'x'.repeat(100)+'</'+token+'></'+p+'>';
   const context=[{tag:'p',open:'<'+p+'>'},{tag,open:'<'+token+'>'}];
   const region={ordinal:1,byte_offset:at,source:'abcdef',start_context:context,end_context:context};
   const source={check:()=>{},read:async()=>({ready:true,total_blocks:1,next_offset:null,oversized_block:true,blocks:[]}),
    locate:async()=>({ready:true,ordinal:0,offset:1,supported:true}),
    segments:async(ordinal,offset,limit)=>{if(ordinal!==0||offset!==1||limit!==1)throw Error('synthetic unbounded read');return {ready:true,supported:true,ordinal:0,total_segments:3,next_offset:2,segments:[region]};}};
   const a={block:0,position:1,byte:at+2,within:0},b={...a,byte:at+4};
   const prepared=await m.prepareSelection({kind:'range',anchor:reverse?b:a,head:reverse?a:b},source);
   const schema=prepared.state.schema,parser=DOMParser.fromSchema(schema),t=document.createElement('template');
   t.innerHTML=canonicalRichHTML(before);
   const doc=parser.parse(t.content,{preserveWhitespace:'full'}),map=segmentPositionMap({ordinal:0,byte_offset:0,source:before,start_context:[],end_context:[]},schema);
   const sa=map.position(a.byte),sb=map.position(b.byte),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,reverse?sb:sa,reverse?sa:sb)});
   const operation={kind:'paste',html:split?'<p><em>'+('Y'.repeat(80000))+'</em></p><p>END</p>':'<em>'+('Y'.repeat(80000))+'</em>END'};
   t.innerHTML=sanitizeRichHtml(operation.html);const tr=state.tr.replaceSelection(parser.parseSlice(t.content,{preserveWhitespace:'full'}));
   const changed=m.changeSelection(prepared,operation),assembled=before.slice(0,changed.start)+changed.replacement+before.slice(changed.start+changed.expected.length);
   if(!assembled.startsWith(before.slice(0,at))||!assembled.endsWith(before.slice(at+6)))throw Error('raw alias outside changed '+token);
   if(canonicalRichHTML(assembled.replace(/ id="ink-block-[0-9a-f-]{36}"/g,''))!==getHTMLFromFragment(tr.doc.content,schema))throw Error('alias baseline '+token+' split='+split);
   const pieces:any[]=Array.from(modelSourceSegments(assembled,0,[]));
   if(pieces.at(-1).end_context.length)throw Error('unbalanced alias source '+token);
   const shown={ordinal:0,byte_offset:changed.previewWindow.byteStart,source:changed.previewWindow.raw,start_context:changed.previewWindow.internal?.start_context??[],end_context:changed.previewWindow.internal?.end_context??[]};
   const point=segmentPositionMap(shown,schema).point(changed.selection.head),global=segmentPositionMap({ordinal:0,byte_offset:0,source:assembled,start_context:[],end_context:[]},schema).position(point.byte,point.within);
   if(global!==tr.selection.head)throw Error('alias cursor '+token+' '+global+' != '+tr.selection.head);
   contextCases++;
  }
  console.log('PASS synthetic alias/case edge contracts:',contextCases);
  return {cases,contextCases,cursorPositions:positions.length,maxDOMBytes,maxPreview,fallbackDOMBytes,liveNodes:document.querySelectorAll('*').length};
 });
 assert.equal(result.cases,18);assert.equal(result.contextCases,32);assert.ok(result.liveNodes<10);console.log('PASS large selection model:',JSON.stringify(result));
}finally{
 await browser?.close();await server.close();
}
