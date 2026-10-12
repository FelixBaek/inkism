import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const src=process.env.INKISM_SOURCE_ROOT||fileURLToPath(new URL('../src/',import.meta.url));
const bundle=await build({stdin:{contents:`export {Editor} from '@tiptap/core';export {default as StarterKit} from '@tiptap/starter-kit';export {NoteEmbeds} from './extensions/note-embeds';export {referenceHTML} from './lib/note-embed';`,resolveDir:src,loader:'ts'},nodePaths:[fileURLToPath(new URL('../node_modules',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'fixture',platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
 await page.route('http://embed.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body><div id="editor"></div></body>'}));await page.goto('http://embed.test/');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{
  const w=window as any;w.calls=[];w.blockResolve=false;
  w.fetch=async(_url:string,init:any)=>{
   const input=JSON.parse(init.body);w.calls.push(input);
   if(input.op==='link_resolve'&&w.blockResolve)await new Promise<void>(resolve=>{w.releaseResolve=resolve;});
   const data=input.op==='link_resolve'?{items:[{id:'target',title:'Target'}],ambiguous:false}:{id:'target',title:'Target',revision:1,content_format:'html',content:'<h2>Live target</h2><p>Read only target ![[Owner]]</p>',trashed:false};
   return new Response(JSON.stringify({ok:true,data}),{status:200,headers:{'content-type':'application/json'}});
  };
  w.make=(html:string)=>{const host=document.createElement('div');document.body.append(host);const {Editor,StarterKit,NoteEmbeds}=w.fixture;return new Editor({element:host,extensions:[StarterKit.configure({trailingNode:false}),NoteEmbeds.configure({noteId:'owner'})],content:html});};
  w.editor=w.make('<p>Before ![[Target]] after</p>');w.original=w.editor.getHTML();
 });
 await page.locator('.inline-note-embed-body').filter({hasText:'Live target'}).waitFor();
 const initial=await page.evaluate(()=>{const w=window as any;return{source:w.editor.getHTML(),original:w.original,calls:w.calls.length,widgets:document.querySelectorAll('.inline-note-embed').length,json:JSON.stringify(w.editor.getJSON())};});
 assert.equal(initial.source,initial.original,'preview altered canonical HTML');assert.doesNotMatch(initial.json,/Live target|Read only target/);assert.equal(initial.widgets,1,'cyclic target reference recursively rendered');assert.equal(initial.calls,2);
 await page.evaluate(()=>{const w=window as any;w.editor.commands.setTextSelection(2);w.editor.view.focus();});await page.keyboard.type('X');await page.waitForTimeout(100);
 const edited=await page.evaluate(()=>{const w=window as any;return{source:w.editor.getHTML(),calls:w.calls.length,widgets:document.querySelectorAll('.inline-note-embed').length};});
 assert.equal(edited.source,'<p>BXefore ![[Target]] after</p>');assert.equal(edited.widgets,1);assert.equal(edited.calls,2,'typing before an unchanged embed reloads its RPC requests');
 await page.evaluate(()=>{const w=window as any;w.editor.commands.setTextSelection(w.editor.state.doc.textContent.indexOf(' after')+1);w.editor.view.focus();});await page.keyboard.type('Z');await page.waitForTimeout(30);
 const beside=await page.evaluate(()=>{const w=window as any;return{source:w.editor.getHTML(),calls:w.calls.length};});assert.equal(beside.source,'<p>BXefore ![[Target]]Z after</p>');assert.equal(beside.calls,2);
 const cap=await page.evaluate(async()=>{const w=window as any;w.editor.destroy();w.calls=[];w.editor=w.make('<pre><code>![[Code example]]</code></pre><p><code>![[Inline code]]</code></p>'+Array(25).fill('<p>![[Target]]</p>').join(''));await new Promise(r=>setTimeout(r,50));return{widgets:document.querySelectorAll('.inline-note-embed').length,calls:w.calls.length,targets:w.calls.filter((r:any)=>r.op==='link_resolve').map((r:any)=>r.target),source:w.editor.getHTML()};});
 assert.equal(cap.widgets,20,'live preview cap exceeded');assert.equal(cap.calls,40);assert.ok(cap.targets.every((name:string)=>name==='Target'),'code example fetched as a live reference');assert.doesNotMatch(cap.source,/Live target|Read only target/);
 const destroyed=await page.evaluate(async()=>{const w=window as any;w.editor.destroy();w.calls=[];w.blockResolve=true;w.editor=w.make('<p>![[Pending]]</p>');const root=document.querySelector('.inline-note-embed')!;const before=root.innerHTML;w.editor.destroy();w.releaseResolve();await new Promise(r=>setTimeout(r,50));return{calls:w.calls,unchanged:root.innerHTML===before,widgets:document.querySelectorAll('.inline-note-embed').length};});
 assert.deepEqual(destroyed.calls.map((r:any)=>r.op),['link_resolve'],'destroyed widget fetched full target body');assert.equal(destroyed.unchanged,true);assert.equal(destroyed.widgets,0);assert.deepEqual(failures,[]);
 const references=await page.evaluate(()=>{const w=window as any;const note={id:'n',title:'n',content_format:'markdown',content:'앞 문단\r\n\r\n선택 문단 ^chosen\r\n\r\n뒤 문단'};const selected=w.fixture.referenceHTML(note,'^chosen');const spaced=w.fixture.referenceHTML({...note,content:note.content.replace(/\r\n\r\n/g,'\r\n \t\r\n')},'^chosen');let tooLarge=false;try{w.fixture.referenceHTML({...note,content_format:'text',content:'가'.repeat(800000)},'');}catch{tooLarge=true;}return{selected,spaced,tooLarge};});
 assert.match(references.selected,/선택 문단/);assert.doesNotMatch(references.selected,/앞 문단|뒤 문단/);assert.match(references.spaced,/선택 문단/);assert.doesNotMatch(references.spaced,/앞 문단|뒤 문단/);assert.equal(references.tooLarge,true,'2MiB byte cap ignored multibyte text');
 console.log('PASS note embed decorations: async preview preserves HTML/JSON, real typing beside preview, unchanged widget request reuse, 20-preview cap, cycles nonrecursive, code examples excluded, destroyed pending load stops');
}finally{await browser.close();}
