// The shipped RichEditor and ProseMirror run unchanged. Only the unrelated store
// and HTTP boundary are fixtures. This is not native Windows/IME acceptance.
import type {AddressInfo} from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const cacheDir=await mkdtemp(join(tmpdir(),'inkism-rich-flush-'));
const server=await createServer({root,cacheDir,server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{
 name:'rich-flush-contract',enforce:'pre',
 resolveId(source,importer){
  if(source==='../store'&&importer?.includes('/components/'))return '\0rich-flush-store';
  if(source==='../lib/sanitize'&&importer?.endsWith('/components/RichEditor.tsx'))return '\0rich-flush-sanitize';
 },
 load(id){
  if(id==='\0rich-flush-store')return `export function useStore(){return {prompt:async()=>null,showError:async()=>{throw Error('Unexpected fixture operation')}}}`;
  if(id==='\0rich-flush-sanitize')return `import {sanitizeRichHtml as sanitize} from '/src/lib/sanitize.ts'; export function sanitizeRichHtml(html){window.fixture.sanitizes++;return sanitize(html)}`;
 },
 configureServer(vite){vite.middlewares.use('/__rich-flush',async(req,res,next)=>{
  if(req.url.includes('html-proxy'))return next();
  try{
   const html=await vite.transformIndexHtml('/__rich-flush',`<div id="root"></div><script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {RichEditor} from '/src/components/RichEditor.tsx';
    import {SourceEditor} from '/src/components/SourceEditor.tsx';
    import {EditorView} from '@codemirror/view';
    import {inspectRichHTML,canonicalRichHTML} from '/src/lib/rich-document.ts';
    const fixture=window.fixture={deliveries:[],dirty:0,htmlCalls:0,textCalls:0,sanitizes:0,editor:null};
    fixture.inspect=inspectRichHTML;fixture.canonical=canonicalRichHTML;
    window.addEventListener('inkism-editor-dirty',()=>fixture.dirty++);
    const root=createRoot(document.getElementById('root'));
    fixture.render=(options={})=>{
     const {id='first',tag='first',content='<p>seed</p><p>end</p>',revision=1,embedded=false,strict=false,editable=true,readOnly=false}=options;
     const component=React.createElement('section',{'data-tag':tag},React.createElement(RichEditor,{
      key:id,initialContent:content,embedded,editable,readOnly,noteIdentity:{id,revision},
      onEditor:editor=>{
       fixture.editor=editor;
       if(editor&&!editor.__flushMeasured){
        editor.__flushMeasured=true;
        const html=editor.getHTML.bind(editor),text=editor.getText.bind(editor);
        editor.getHTML=()=>{fixture.htmlCalls++;return html()};
        editor.getText=()=>{fixture.textCalls++;return text()};
       }
      },
      onChange:(content,text,change)=>{fixture.deliveries.push({tag,content,text,change});fixture.onDelivery?.();},
     }));
     root.render(strict?React.createElement(React.StrictMode,null,component):component);
    };
    fixture.sourceChanges=[];
    fixture.source=()=>EditorView.findFromDOM(document.querySelector('.cm-editor'));
    fixture.renderSource=readOnly=>root.render(React.createElement(SourceEditor,{
      key:'source-permission',id:'source-permission',revision:1,initialContent:'원문\\r\\n보존',
      readOnly,attachments:true,onChange:content=>fixture.sourceChanges.push(content),
    }));
    fixture.unmount=()=>root.unmount();
    fixture.flush=()=>window.dispatchEvent(new Event('inkism-flush-editor'));
    fixture.render();
   </script>`);
   res.setHeader('Content-Type','text/html');res.end(html);
  }catch(error){next(error);}
 });},
}]});
let browser;
const errors=[],requests=[];
try{
 await server.listen();
 const base=`http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{requests.push(route.request().url());return route.fulfill({status:503,json:{error:'No live API in component fixture'}});});
 const ready=async tag=>{
  await page.locator(`[data-tag="${tag}"] .ProseMirror`).waitFor();
  await page.waitForFunction(()=>(window as any).fixture.editor?.isInitialized);
 };
 const state=()=>page.evaluate(()=>{
  const f=(window as any).fixture;return {html:f.htmlCalls,text:f.textCalls,dirty:f.dirty,sanitizes:f.sanitizes,deliveries:f.deliveries};
 });
 await page.goto(base+'/__rich-flush');await ready('first');
 const admission=await page.evaluate(()=>{
  const f=(window as any).fixture;
  const unsupported=['<p class="unknown">보존</p>','<!--주석--><p>보존</p>','<x-unknown>보존</x-unknown>','<script>window.injected=1</script><p>보존</p>','<!doctype html><html><body><p>보존</p></body></html>'];
  const examples=['<p><b>굵게</b> <i>기울임</i></p>','<h2>제목</h2><ol><li><p>항목</p></li></ol>','<div data-type="callout"><p>메모</p></div>','<details><summary>제목</summary><div data-type="detailsContent"><p>본문</p></div></details>','<div data-type="block-math" data-latex="x^2">x^2</div>','<table><tbody><tr><td><p>셀</p></td></tr></tbody></table>'];
  return {empty:f.inspect('').editable,unsupported:unsupported.map(source=>f.inspect(source).editable),canonical:examples.map(source=>f.inspect(f.canonical(source)).editable),aliases:f.inspect(examples[0]).editable,large:f.inspect('<p>'+'가'.repeat(300000)+'</p>').editable};
 });
 assert.equal(admission.empty,true);assert.deepEqual(admission.unsupported,[false,false,false,false,false]);
 assert.deepEqual(admission.canonical,[true,true,true,true,true,true]);assert.equal(admission.aliases,true);assert.equal(admission.large,true);
 const initial=await state();assert.equal(initial.deliveries.length,0,'opening does not normalize/save source');
 const burst=await page.evaluate(()=>{
  const f=(window as any).fixture;f.editor.commands.setTextSelection(5);
  for(let i=0;i<40;i++)f.editor.commands.insertContent('a');
  return {html:f.htmlCalls,text:f.textCalls,dirty:f.dirty,deliveries:f.deliveries.length};
 });
 assert.deepEqual(burst,{html:0,text:0,dirty:40,deliveries:0},'typing signals dirty without whole-document serialization');
 await page.waitForFunction(()=>(window as any).fixture.deliveries.length===1);
 let saved=await state();assert.equal(saved.html,1);assert.equal(saved.text,1);
 assert.equal(saved.deliveries[0].text,'seed'+'a'.repeat(40)+'\n\nend');
 assert.deepEqual(saved.deliveries[0].change.beforeSelection,{type:'text',anchor:5,head:5});
 assert.deepEqual(saved.deliveries[0].change.afterSelection,{type:'text',anchor:45,head:45});

 // A parent rerender must neither reparse the initial HTML nor retain the old callback.
 await page.evaluate(()=>(window as any).fixture.render({tag:'current',revision:2}));await ready('current');
 assert.equal((await state()).sanitizes,initial.sanitizes);
 const explicit=await page.evaluate(()=>{
  const f=(window as any).fixture;f.editor.commands.insertContent(' 최신');f.flush();f.flush();return f.deliveries.at(-1);
 });
 assert.equal(explicit.tag,'current');assert.ok(explicit.text.includes(' 최신'));
 saved=await state();assert.equal(saved.deliveries.length,2);assert.equal(saved.html,2);
 await page.waitForTimeout(360);assert.equal((await state()).deliveries.length,2,'timer cancelled by explicit flush');
 await page.evaluate(()=>{(window as any).fixture.editor.commands.setTextSelection(1);(window as any).fixture.flush();});
 assert.equal((await state()).html,2,'selection-only transactions do not save');

 // Undo/redo stay native even if intermediate document strings were never emitted.
 const undone=await page.evaluate(()=>{const f=(window as any).fixture;const ok=f.editor.commands.undo();const value=f.editor.state.doc.textContent;f.flush();return {ok,value,emitted:f.deliveries.at(-1).text};});
 assert.equal(undone.ok,true);assert.equal(undone.emitted.replace(/\n/g,''),undone.value);
 const redone=await page.evaluate(()=>{const f=(window as any).fixture;const ok=f.editor.commands.redo();const value=f.editor.state.doc.textContent;f.flush();return {ok,value,emitted:f.deliveries.at(-1).text};});
 assert.equal(redone.ok,true);assert.equal(redone.emitted.replace(/\n/g,''),redone.value);

 // A nested flush is harmless, and a new edit during delivery remains pending.
 const reentrant=await page.evaluate(()=>{
  const f=(window as any).fixture,before=f.deliveries.length;
  f.onDelivery=()=>{f.onDelivery=null;f.flush();f.editor.commands.insertContent(' 새 입력');};
  f.editor.commands.insertContent(' 먼저');f.flush();
  const first=f.deliveries.length-before;f.flush();
  return {first,total:f.deliveries.length-before,last:f.deliveries.at(-1).text};
 });
 assert.equal(reentrant.first,1);assert.equal(reentrant.total,2);assert.ok(reentrant.last.includes(' 새 입력'));

 // Synthetic composition events verify the automatic-flush guard only. They
 // are not evidence of physical Korean IME behavior on WebView2.
 const composition=await page.evaluate(()=>{
  const f=(window as any).fixture;f.editor.commands.insertContent(' 조합');
  f.editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  return {composing:f.editor.view.composing,count:f.deliveries.length};
 });
 assert.equal(composition.composing,true);
 await page.waitForTimeout(380);assert.equal((await state()).deliveries.length,composition.count,'idle flush waits for composition');
 await page.evaluate(()=>(window as any).fixture.editor.view.dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await page.waitForFunction(count=>(window as any).fixture.deliveries.length===count+1,composition.count);
 assert.ok((await state()).deliveries.at(-1).text.includes(' 조합'));

 // The old editor flushes to its own callback on replacement, never to the new note.
 const beforeSwitch=(await state()).deliveries.length;
 await page.evaluate(()=>{const f=(window as any).fixture;f.editor.commands.insertContent(' 떠나기');f.render({id:'second',tag:'second',content:'<p>second note</p>'});});
 await ready('second');saved=await state();
 assert.equal(saved.deliveries.length,beforeSwitch+1);
 assert.equal(saved.deliveries.at(-1).tag,'current');assert.ok(saved.deliveries.at(-1).text.includes(' 떠나기'));
 await page.waitForTimeout(360);assert.equal((await state()).deliveries.length,beforeSwitch+1);

 // Windowed editing must retain synchronous per-change range/history semantics.
 await page.evaluate(()=>(window as any).fixture.render({id:'chunk',tag:'chunk',embedded:true,content:'<p>chunk</p>'}));await ready('chunk');
 const chunk=await page.evaluate(()=>{
  const f=(window as any).fixture,before={html:f.htmlCalls,text:f.textCalls,dirty:f.dirty,count:f.deliveries.length};
  for(let i=0;i<3;i++)f.editor.commands.insertContent('x');
  f.flush();return {html:f.htmlCalls-before.html,text:f.textCalls-before.text,dirty:f.dirty-before.dirty,count:f.deliveries.length-before.count};
 });
 assert.deepEqual(chunk,{html:3,text:3,dirty:0,count:3});

 // A large loaded rich document still serializes once per burst, not once per key.
 await page.evaluate(()=>(window as any).fixture.render({id:'large',tag:'large',content:'<p>본문 문단</p>'.repeat(10000)}));await ready('large');
 const large=await page.evaluate(()=>{
  const f=(window as any).fixture,before=f.htmlCalls;for(let i=0;i<20;i++)f.editor.commands.insertContent('L');
  const during=f.htmlCalls-before;f.flush();return {during,after:f.htmlCalls-before,count:f.editor.state.doc.childCount};
 });
 assert.deepEqual(large,{during:0,after:1,count:10000});

 await page.evaluate(()=>(window as any).fixture.render({id:'readonly',tag:'readonly',editable:false,content:'<p>원본 미리보기</p>'}));await ready('readonly');
 const readonly=await page.evaluate(()=>{
  const f=(window as any).fixture,before=f.deliveries.length;f.editor.commands.insertContent('덮어쓰기');f.flush();
  return {count:f.deliveries.length-before,value:f.editor.state.doc.textContent,editable:f.editor.isEditable};
 });
 assert.deepEqual(readonly,{count:0,value:'원본 미리보기',editable:false});
 assert.equal(await page.getByRole('group',{name:'블록 편집 도구'}).count(),0);

 // The note permission is independent of unsupported-preview mode. Toggling
 // it keeps the mounted document, selection and history, and emits no save.
 await page.evaluate(()=>(window as any).fixture.render({id:'protected',tag:'protected',readOnly:true,content:'<p>원본</p>'}));await ready('protected');
 const protectedBefore=(await state()).deliveries.length;
 const protectedNote=await page.evaluate(()=>{
  const f=(window as any).fixture;f.editor.commands.insertContent('금지');f.editor.commands.toggleBold();f.editor.commands.undo();f.flush();
  f.editor.commands.setTextSelection({from:1,to:3});
  return {html:f.editor.getHTML(),editable:f.editor.isEditable,selection:f.editor.state.selection.toJSON()};
 });
 assert.equal(protectedNote.html,'<p>원본</p>');assert.equal(protectedNote.editable,false);
 assert.equal(protectedNote.selection.anchor,1);assert.equal(protectedNote.selection.head,3);
 assert.equal((await state()).deliveries.length,protectedBefore);
 assert.equal(await page.locator('[data-editor-tools]').count(),1);
 // The find button left the editor top; Ctrl+F (store) raises this event. Find stays usable, replace stays disabled.
 await page.evaluate(()=>window.dispatchEvent(new Event('inkism-find-in-note')));await page.getByLabel('문서에서 찾을 내용',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'모두 바꾸기',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'문서 검색 닫기',exact:true}).click();
 // The paperclip is CSS-hidden (files enter via block menus/drop/paste) but still mirrors the editor's read-only gate.
 assert.equal(await page.locator('button[aria-label="파일 첨부"]').isDisabled(),true);
 await page.evaluate(()=>(window as any).fixture.render({id:'protected',tag:'protected',readOnly:false,content:'<p>무시할 새 입력</p>'}));
 await page.waitForFunction(()=>(window as any).fixture.editor.isEditable);
 assert.equal((await state()).deliveries.length,protectedBefore,'permission change must not dirty the document');
 await page.evaluate(()=>{(window as any).fixture.editor.commands.insertContent('허용');(window as any).fixture.flush();});
 assert.equal((await state()).deliveries.length,protectedBefore+1);

 // CodeMirror must reject direct command dispatch as well as keyboard input,
 // without blocking selection, search or later permission reconfiguration.
 await page.evaluate(()=>(window as any).fixture.renderSource(true));await page.locator('.cm-editor').waitFor();
 await page.waitForFunction(()=>(window as any).fixture.source()?.state.readOnly);
 const sourceBefore=await page.evaluate(()=>(window as any).fixture.source().state.doc.toString());
 assert.equal(sourceBefore,'원문\r\n보존');
 await page.evaluate(()=>{const v=(window as any).fixture.source();v.dispatch({changes:{from:0,insert:'금지'}});v.dispatch({selection:{anchor:2}});(window as any).fixture.flush();});
 assert.equal(await page.evaluate(()=>(window as any).fixture.source().state.doc.toString()),sourceBefore);
 assert.equal(await page.evaluate(()=>(window as any).fixture.source().state.selection.main.head),2);
 assert.deepEqual(await page.evaluate(()=>(window as any).fixture.sourceChanges),[]);
 await page.evaluate(()=>(window as any).fixture.renderSource(false));
 await page.waitForFunction(()=>!(window as any).fixture.source().state.readOnly);
 await page.evaluate(()=>{(window as any).fixture.source().dispatch({changes:{from:0,insert:'허용'}});(window as any).fixture.flush();});
 assert.deepEqual(await page.evaluate(()=>(window as any).fixture.sourceChanges),['허용'+sourceBefore]);

 // React StrictMode replays effects. That must not leave duplicate flush listeners.
 await page.evaluate(()=>(window as any).fixture.render({id:'strict',tag:'strict',strict:true,content:'<p>strict</p>'}));await ready('strict');
 const strict=await page.evaluate(()=>{const f=(window as any).fixture,before=f.deliveries.length;f.editor.commands.insertContent('S');f.flush();return f.deliveries.length-before;});
 assert.equal(strict,1);
 const beforeUnmount=(await state()).deliveries.length;
 await page.evaluate(()=>{const f=(window as any).fixture;f.editor.commands.insertContent(' 마지막');f.unmount();});
 saved=await state();assert.equal(saved.deliveries.length,beforeUnmount+1);assert.ok(saved.deliveries.at(-1).text.includes(' 마지막'));
 await page.waitForTimeout(360);await page.evaluate(()=>(window as any).fixture.flush());
 assert.equal((await state()).deliveries.length,beforeUnmount+1,'no stale timer/listener after unmount');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 console.log('PASS shipped RichEditor: no per-key full serialization, idle/explicit/unmount flush, current callback, single initial sanitize, dirty guard, native undo/redo, reentrant delivery, synthetic composition guard, synchronous embedded chunks, 10k blocks, StrictMode cleanup. Component-only; not Windows, native IME, full rich virtualization or Rust save acceptance.');
}finally{
 await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true});
}
