import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const src=fileURLToPath(new URL('../src/',import.meta.url));
const bundle=await build({stdin:{contents:`export {Editor} from '@tiptap/core';export {contentExtensions} from './extensions/content-schema';export {cloneBlockIdentity,cloneHTMLIdentity,prepareHTMLBlockIdentity} from './lib/block-identity';export {inspectRichHTML} from './lib/rich-document';`,resolveDir:src,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'fixture',platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.route('https://identity.test/**',r=>r.fulfill({contentType:'text/html',body:'<body><div id="editor"></div></body>'}));await page.goto('https://identity.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture;
  const source='<p id="stable">Alpha</p><p>Beta</p>';
  const editor=new f.Editor({element:document.querySelector('#editor'),extensions:f.contentExtensions({trailingNode:false}),content:source});
  const admitted=f.inspectRichHTML(source).editable;
  editor.commands.setTextSelection(3);editor.commands.insertContent('X');const typed=editor.getHTML();
  const first=editor.state.doc.child(0),second=editor.state.doc.child(1);
  editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,[second,first]));const moved=editor.getHTML();
  const copied=f.cloneBlockIdentity(first);editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size,copied));const ids=Array.from(editor.view.dom.querySelectorAll('[id]'),(el:any)=>el.id);
  editor.commands.setContent(source);editor.commands.setTextSelection(3);editor.commands.splitBlock();const splitIds=Array.from(editor.view.dom.querySelectorAll('[id]'),(el:any)=>el.id);
  const cloned=f.cloneHTMLIdentity('<p id="stable" title=" id=unchanged">A</p><!-- <p id="comment"> -->');
  editor.commands.setContent(source);const before=editor.getHTML();editor.commands.setTextSelection(3);editor.view.pasteHTML('<p id="stable">Paste</p>');const pasted=editor.getHTML();const pasteIds=Array.from(editor.view.dom.querySelectorAll('[id]'),(el:any)=>el.id);
  const original=`\ufeff<p title="id=fake">One</p>\r\n<p id="stable">Two</p><!-- <p>comment</p> --><script>"<p>fake</p>"</script>`;
  const prepared=f.prepareHTMLBlockIdentity(original);const repeated=f.prepareHTMLBlockIdentity(prepared);
  editor.destroy();
  const historySource="<p>Original</p><p>Untouched</p>";const historyEditor=new f.Editor({element:document.querySelector("#editor"),extensions:f.contentExtensions({trailingNode:false}),content:historySource});
  const unopened=historyEditor.getHTML();historyEditor.commands.setTextSelection(3);historyEditor.commands.insertContent("X");const historyEdited=historyEditor.getHTML();historyEditor.commands.undo();const historyUndo=historyEditor.getHTML();historyEditor.commands.redo();const historyRedo=historyEditor.getHTML();historyEditor.destroy();
  return {unopened,historySource,historyEdited,historyUndo,historyRedo,prepared,repeated,original,admitted,typed,moved,ids,splitIds,cloned,before,pasted,pasteIds};
 });
 assert.equal(result.unopened,result.historySource,"opening must not add IDs");assert.equal(result.historyUndo,result.historySource,"Undo must remove the first edit and its generated ID exactly");assert.equal(result.historyRedo,result.historyEdited,"Redo must restore the same ID");assert.equal((result.historyEdited.match(/ink-block-/g)||[]).length,1,"only changed block receives identity");
 assert.equal(result.prepared.replace(/ id="ink-block-[^"]+"/g,''),result.original,'preparation preserves source except missing IDs');assert.equal(result.prepared,result.repeated,'preparation is idempotent');assert.equal((result.prepared.match(/ink-block-/g)??[]).length,1,'comments/raw text/existing IDs excluded');
 assert.equal(result.admitted,true,'ID-bearing HTML lost visual editing');assert.match(result.typed,/<p id="stable">AlXpha<\/p>/);assert.match(result.moved,/<p id="ink-block-[^"]+">Beta<\/p><p id="stable">/);
 assert.equal(new Set(result.ids).size,result.ids.length);assert.equal(result.splitIds.filter(id=>id==='stable').length,1);assert.match(result.cloned,/title=" id=unchanged"/);assert.match(result.cloned,/<!-- <p id="comment"> -->/);assert.doesNotMatch(result.cloned,/^<p id="stable"/);assert.equal(new Set(result.pasteIds).size,result.pasteIds.length);
 console.log('PASS block identity: editable roundtrip, typing, move, clone, split, paste and byte-preserving clone attributes');
}finally{await browser.close();}
