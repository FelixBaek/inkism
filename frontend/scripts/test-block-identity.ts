import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const src=fileURLToPath(new URL('../src/',import.meta.url));
const bundle=await build({stdin:{contents:`export {Editor} from '@tiptap/core';export {NodeSelection} from '@tiptap/pm/state';export {contentExtensions} from './extensions/content-schema';export {cloneBlockIdentity,cloneHTMLIdentity,prepareHTMLBlockIdentity} from './lib/block-identity';export {inspectRichHTML} from './lib/rich-document';`,resolveDir:src,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'fixture',platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
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
 // Regressions: a block inserted between blocks touches neither neighbour, a
 // node-selected block stays selected while it receives its identity, and an
 // open IME composition is never redrawn (Chromium otherwise drops it and
 // inserts the committed text a second time).
 const bordered=await page.evaluate(()=>{
  const f=(window as any).fixture;const editor=new f.Editor({element:document.querySelector('#editor'),extensions:f.contentExtensions({trailingNode:false}),content:'<p>Alpha</p><p>Beta</p>'});
  const {state}=editor,paragraph=state.schema.nodes.paragraph,at=state.doc.child(0).nodeSize;
  const tr=state.tr.insert(at,paragraph.create(null,state.schema.text('Copy')));tr.setSelection(f.NodeSelection.create(tr.doc,at));editor.view.dispatch(tr);
  const result={html:editor.getHTML(),selected:editor.state.selection instanceof f.NodeSelection&&editor.state.selection.from===at};
  editor.destroy();const third=new f.Editor({element:document.querySelector('#editor'),extensions:f.contentExtensions({trailingNode:false}),content:'<p>One</p><p>Two</p><p>Three</p>'});
  third.view.dispatch(third.state.tr.delete(third.state.doc.child(0).nodeSize,third.state.doc.child(0).nodeSize+third.state.doc.child(1).nodeSize));
  const deleted=third.getHTML();third.destroy();return {...result,deleted};
 });
 assert.match(bordered.html,/^<p>Alpha<\/p><p id="ink-block-[^"]+">Copy<\/p><p>Beta<\/p>$/,'only the inserted block receives identity');
 assert.equal(bordered.selected,true,'identity assignment keeps the node selection');
 assert.equal(bordered.deleted,'<p>One</p><p>Three</p>','deleting a whole block does not touch its neighbours');
 await page.evaluate(()=>{const f=(window as any).fixture;(window as any).composer=new f.Editor({element:document.querySelector('#editor'),extensions:f.contentExtensions({trailingNode:false}),content:'<p>Alpha</p><p>Beta</p>'});(window as any).composer.commands.setTextSelection(1);(window as any).composer.view.focus();});
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'일반',selectionStart:2,selectionEnd:2});await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>(window as any).composer.getHTML()),'<p>일반Alpha</p><p>Beta</p>','an open composition receives no identity yet');
 await cdp.send('Input.insertText',{text:'일반'});
 await page.waitForFunction(()=>!(window as any).composer.view.composing&&/ink-block-/.test((window as any).composer.getHTML()));
 const composed=await page.evaluate(()=>({html:(window as any).composer.getHTML(),undo:((window as any).composer.commands.undo(),(window as any).composer.getHTML())}));
 assert.match(composed.html,/^<p id="ink-block-[^"]+">일반Alpha<\/p><p>Beta<\/p>$/,'committed composition is inserted once and then identified');
 assert.equal(composed.undo,'<p>Alpha</p><p>Beta</p>','one undo removes the composition and its identity');
 // Detached edits that are written back as source splices: input over a
 // document selection (committed from a bounded model, not the mounted editor)
 // and an internal window whose enclosing opening tags lie before it.
 const workerStub={name:'worker-stub',setup(b){b.onResolve({filter:/\?worker$/},a=>({path:a.path,namespace:'worker-stub'}));b.onLoad({filter:/.*/,namespace:'worker-stub'},()=>({contents:'export default class{}',loader:'js'}));}};
 const detachedBundle=await build({stdin:{contents:`export {prepareSelection,changeSelection} from './lib/document-selection';export {contextIdentity,contextIdentifiable,projectSegment} from './lib/rich-segment';`,resolveDir:src,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'detached',platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',plugins:[workerStub]});
 await page.addScriptTag({content:detachedBundle.outputFiles[0].text});
 const detached=await page.evaluate(async()=>{
  const d=(window as any).detached,encoder=new TextEncoder();
  let offset=0;
  const blocks=['<p id="stable">Zero</p>','<p>One</p>','<p>Two</p>','<p>Three</p>'].map((html,ordinal)=>{const block={ordinal,byte_offset:offset,html};offset+=encoder.encode(html).length;return block;});
  const source={read:async(at,limit)=>({blocks:blocks.slice(at,at+limit),next_offset:at+limit<blocks.length?at+limit:null,total_blocks:blocks.length,ready:true}),check(){}};
  const range=await d.prepareSelection({kind:'range',anchor:{block:1,position:2},head:{block:2,position:3}},source);
  const all=await d.prepareSelection({kind:'all'},source);
  const typed=d.changeSelection(range,{kind:'text',text:'X'});
  const replayed=d.changeSelection(range,{kind:'slice',slice:{content:[{type:'text',text:'S'}]}});
  const pasted=d.changeSelection(all,{kind:'paste',html:'<p id="stable">P</p><p>Q</p>'});
  const deleted=d.changeSelection(all,{kind:'delete'});
  const marked=d.changeSelection(all,{kind:'mark',mark:'bold'});
  const id=(n:number)=>`ink-block-00000000-0000-4000-8000-00000000000${n}`;
  const paragraph={ordinal:2,byte_offset:100,source:'cd',start_context:[{tag:'p',open:'<p>',at:0},{tag:'strong',open:'<strong>',at:3}],end_context:[{tag:'p',open:'<p>',at:0},{tag:'strong',open:'<strong>',at:3}]};
  const paragraphEdit=`<p id="${id(1)}"><strong>cXd</strong></p>`;
  const paragraphIdentity=d.contextIdentity(paragraph,paragraphEdit);
  const table='<table style="min-width: 25px;">',columns='<colgroup><col style="min-width: 25px;"></colgroup>';
  const context=[{tag:'table',open:table,prelude:columns,at:0},{tag:'tbody',open:'<tbody>',at:82},{tag:'tr',open:'<tr>',at:300},{tag:'td',open:'<td>',at:304}];
  const cell={ordinal:3,byte_offset:500,source:'<p>a</p>',start_context:context,end_context:context};
  const cellEdit=`<table style="min-width: 25px;" id="${id(2)}">${columns}<tbody><tr id="${id(3)}"><td id="${id(4)}"><p id="${id(5)}">aZ</p></td></tr></tbody></table>`;
  const cellIdentity=d.contextIdentity(cell,cellEdit);
  const legacy={...paragraph,start_context:paragraph.start_context.map(({at:_,...a})=>a)};
  let legacyError=null;try{d.contextIdentity(legacy,paragraphEdit);}catch(error){legacyError=String(error.message);}
  return {
   typed:[typed.start,typed.expected,typed.replacement],replayed:replayed.replacement,pasted:pasted.replacement,deleted:deleted.replacement,marked:marked.replacement,
   paragraph:{tags:paragraphIdentity.tags,segment:paragraphIdentity.segment,replacement:d.projectSegment(paragraphIdentity.segment,paragraphEdit)},
   cell:{tags:cellIdentity.tags,segment:cellIdentity.segment,replacement:d.projectSegment(cellIdentity.segment,cellEdit)},
   unchanged:d.contextIdentity(paragraph,'<p><strong>cXd</strong></p>').tags.length,
   identifiable:[d.contextIdentifiable(paragraph),d.contextIdentifiable(legacy),d.contextIdentifiable({start_context:[{tag:'p',open:'<p id="old">'},{tag:'strong',open:'<strong>'}]})],
   legacyError,ids:[id(1),id(2),id(3),id(4),id(5)],
  };
 });
 const generated='ink-block-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
 // Only the touched block of the selected range gains an identity; untouched
 // blocks (including an existing id) are outside the splice and keep bytes.
 assert.equal(detached.typed[0],Buffer.byteLength('<p id="stable">Zero</p>'));assert.equal(detached.typed[1],'<p>One</p><p>Two</p>');
 assert.match(detached.typed[2],new RegExp(`^<p id="${generated}">OXo</p>$`),'typed input over a range identifies the joined block');
 assert.match(detached.replayed,new RegExp(`^<p id="${generated}">OSo</p>$`),'a replayed provisional slice identifies its block');
 assert.match(detached.pasted,new RegExp(`^<p id="${generated}">P</p><p id="${generated}">Q</p>$`),'pasted blocks get new identities, never a duplicate source id');
 assert.doesNotMatch(detached.pasted,/stable/);
 assert.match(detached.deleted,new RegExp(`^<p id="${generated}"></p>$`),'the block left by a deletion is identified');
 assert.equal(detached.marked,'<p id="stable"><strong>Zero</strong></p><p><strong>One</strong></p><p><strong>Two</strong></p><p><strong>Three</strong></p>','a mark alone adds no identity (as in the editor)');
 // Internal windows: the enclosing opening tag is rewritten by an exact splice
 // of just that tag; later offsets move by the inserted bytes.
 const [one,two,three,four,five]=detached.ids,attr=(id:string)=>` id="${id}"`;
 assert.deepEqual(detached.paragraph.tags,[{start:0,expected:'<p>',replacement:`<p${attr(one)}>`}]);
 assert.equal(detached.paragraph.segment.byte_offset,100+attr(one).length);
 assert.deepEqual(detached.paragraph.segment.start_context,[{tag:'p',open:`<p${attr(one)}>`,at:0},{tag:'strong',open:'<strong>',at:3+attr(one).length}]);
 assert.deepEqual(detached.paragraph.segment.end_context,detached.paragraph.segment.start_context);
 assert.equal(detached.paragraph.replacement,'cXd','the window itself is projected as before');
 assert.deepEqual(detached.cell.tags,[
  {start:0,expected:'<table style="min-width: 25px;">',replacement:`<table style="min-width: 25px;"${attr(two)}>`},
  {start:300+attr(two).length,expected:'<tr>',replacement:`<tr${attr(three)}>`},
  {start:304+attr(two).length+attr(three).length,expected:'<td>',replacement:`<td${attr(four)}>`},
 ],'sequential splices of each enclosing tag, in source order');
 assert.equal(detached.cell.segment.byte_offset,500+attr(two).length+attr(three).length+attr(four).length);
 assert.equal(detached.cell.replacement,`<p${attr(five)}>aZ</p>`,'a block opening inside the window is identified in the window');
 assert.equal(detached.unchanged,0,'no new identity, no tag splice');
 assert.deepEqual(detached.identifiable,[true,false,true],'identities need each enclosing tag offset (or an existing id)');
 assert.ok(detached.legacyError,'without a tag offset the identity is refused, never guessed');
 console.log('PASS block identity: editable roundtrip, typing, move, clone, split, paste, byte-preserving clone attributes, untouched neighbours, kept node selection, IME composition, detached selection input and internal-window tag splices');
}finally{await browser.close();}
