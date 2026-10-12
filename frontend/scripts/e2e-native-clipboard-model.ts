// Installed native clipboard parser vs its real DOM event path. Full baseline
// DOMs are fixture-only; the product adapter never mounts the source model.
import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false}});let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage();
 await page.route('**/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:'+(server.httpServer.address() as AddressInfo).port+'/');
 const result=await page.evaluate(async()=>{
  // @ts-expect-error -- served by Vite in the browser
  const {nativeClipboardPaste,readClipboard}=await import('/src/lib/native-clipboard.ts'),{PendingSelection,replayPendingSelection}=await import('/src/lib/pending-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {prepareSelection}=await import('/src/lib/document-selection.ts');
  // @ts-expect-error -- served by Vite in the browser
  const {EditorState,TextSelection,Plugin}=await import('/node_modules/.vite/deps/@tiptap_pm_state.js'),{EditorView}=await import('/node_modules/.vite/deps/@tiptap_pm_view.js');
  const all=await prepareSelection({kind:'all'},{check:()=>{},read:async()=>({ready:true,total_blocks:1,next_offset:null,blocks:[{ordinal:0,byte_offset:0,html:'<p>schema</p>'}]})}),schema=all.state.schema;
  let cases=0,refused=0,legacyMismatch=0;
  const inputs=[
   {html:'<p><em>'+'HTML '.repeat(10000)+'</em></p><p>end</p>',text:'PLAIN\r\n\r\n'+'plain '.repeat(10000)},
   {html:'<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>',text:'A\tB'},
   {html:'<p data-pm-slice="1 1 []"><strong>copied</strong></p>',text:'copied'},
  ];
  const pasteEvent=(view,input)=>{
   if(input.plain){view.pasteText(input.text);return;}
   const data=new DataTransfer();data.setData('text/plain',input.text);data.setData('text/html',input.html);
   view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  };
  for(const first of ['paragraph','codeBlock'])for(const last of ['paragraph','codeBlock'])for(const plain of [false,true])for(const raw of inputs){
   const input={...raw,plain},block=(kind,text)=>schema.node(kind,null,[schema.text(text)]),doc=schema.node('doc',null,[block(first,'start prefix'),block(last,'last suffix')]);
   const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3,doc.firstChild.nodeSize+5)});
   const shownDoc=schema.node('doc',null,[block(last,'last suffix')]),before=EditorState.create({schema,doc:shownDoc,selection:TextSelection.create(shownDoc,1,5)});
   const localView=new EditorView(document.createElement('div'),{state:before}),reference=new EditorView(document.createElement('div'),{state});
   try{
    const pending=new PendingSelection(before,{input,parse:(state,input)=>nativeClipboardPaste(localView,state,input)}),shown=pending.preview();
    let local=EditorState.create({schema,doc:shown.doc,selection:shown.selection});pasteEvent(reference,input);
    // Reproduce the former loss of raw clipboard context independently of
    // source navigation: the visible-context Slice cannot recover raw text/HTML.
    const normalized=nativeClipboardPaste(localView,before,input).slice,legacy=new PendingSelection(before,normalized);
    try{if(!replayPendingSelection(state,legacy.operation()).doc.eq(reference.state.doc))legacyMismatch++;}catch{legacyMismatch++;}
    const typed=local.tr.insertText('FOLLOW');pending.accept(local,typed);local=local.apply(typed);reference.dispatch(reference.state.tr.insertText('FOLLOW'));
    const second={input:{html:'<p><strong>SECOND</strong></p>',text:'SECOND plain\nend',plain},parse:(state,input)=>nativeClipboardPaste(localView,state,input)};
    const next=second.parse(local,second.input).transaction;pending.accept(local,next,second);pasteEvent(reference,second.input);
    const fresh=pending.preview();local=EditorState.create({schema,doc:fresh.doc,selection:fresh.selection});
    const follow=local.tr.insertText('한글😀');pending.accept(local,follow);reference.dispatch(reference.state.tr.insertText('한글😀'));
    const actual=replayPendingSelection(state,pending.operation());
    if(!actual.doc.eq(reference.state.doc)||!actual.selection.eq(reference.state.selection))throw Error('native clipboard replay differs: '+first+'/'+last+' plain='+plain+' input='+inputs.indexOf(raw));
    if(!state.doc.eq(doc)||localView.state!==before)throw Error('parser changed source or mounted state');
    cases++;
   }finally{localView.destroy();reference.destroy();}
  }
  // Hooks retain the mounted editor's plugin order but inspect actual state.
  const doc=schema.node('doc',null,[schema.node('codeBlock',null,[schema.text('old')])]),state=EditorState.create({schema,doc,selection:TextSelection.create(doc,1,4)});
  const local=EditorState.create({schema,plugins:[new Plugin({props:{transformPastedText:(text,_plain,view)=>text+'-'+view.state.selection.$from.parent.type.name}})]});
  const view=new EditorView(document.createElement('div'),{state:local});
  try{const parsed=nativeClipboardPaste(view,state,{html:null,text:'hook',plain:true});if(parsed.transaction.doc.textContent!=='hook-codeBlock')throw Error('hook used visible context');}finally{view.destroy();}
  const data=new DataTransfer();data.setData('text/uri-list','https://example.invalid/a\r\nhttps://example.invalid/b');
  if(readClipboard(new ClipboardEvent('paste',{clipboardData:data})).text!=='https://example.invalid/a https://example.invalid/b')throw Error('URI clipboard fallback differs');
  // If reparsing changes the geometry, edits in the provisional original paste
  // cannot be mapped by an endpoint shift. Preserve them and reject, never write.
  const visibleDoc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('visible')])]),visible=EditorState.create({schema,doc:visibleDoc,selection:TextSelection.create(visibleDoc,1,4)});
  const mounted=new EditorView(document.createElement('div'),{state:visible});
  try{
   const input={html:'<p>different HTML</p>',text:'actual code text',plain:false};
   const pending=new PendingSelection(visible,{input,parse:(state,input)=>nativeClipboardPaste(mounted,state,input)}),shown=pending.preview();
   const local=EditorState.create({schema,doc:shown.doc,selection:TextSelection.create(shown.doc,2)}),edit=local.tr.insertText('X');pending.accept(local,edit);
   try{replayPendingSelection(state,pending.operation());}catch{refused++;}
   if(refused!==1||pending.operation().clipboard.input.text!==input.text||state.doc.textContent!=='old')throw Error('ambiguous edit or clipboard not preserved');
  }finally{mounted.destroy();}
  return {cases,refused,legacyMismatch,hooks:true,uri:true};
 });
 assert.equal(result.cases,24);assert.equal(result.refused,1);assert.ok(result.legacyMismatch>0);assert.ok(result.hooks&&result.uri);console.log('PASS native clipboard model:',JSON.stringify(result));
}finally{await browser?.close();await server.close();}
