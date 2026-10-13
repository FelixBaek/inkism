// MARKDOWN view admission: tables and attachments open, unknown markup is refused with a plain message.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from './browser-env.ts';
declare const md: any;
const bundle=await build({stdin:{contents:"export {editableMarkdown,markdownToEditableHTML,MARKDOWN_UNSUPPORTED} from './lib/markdown'; export {canonicalRichHTML} from './lib/rich-document';",resolveDir:'frontend/src',loader:'ts'},
  bundle:true,write:false,format:'iife',globalName:'md',platform:'browser',loader:{'.css':'empty'},
  external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const view=html=>page.evaluate(h=>{try{return {ok:md.editableMarkdown(h)}}catch(e){return {error:e.message}}},html);
 const cell=(t,x)=>`<${t}><p>${x}</p></${t}>`;
 // Editor-made table (empty cells, last block, trailing node) — GFM table, no trailing <p></p> noise.
 const table=await page.evaluate(h=>md.canonicalRichHTML(h),'<p>앞</p><table><tbody><tr>'+cell('th','')+cell('th','')+'</tr><tr>'+cell('td','')+cell('td','')+'</tr></tbody></table><p></p>');
 const t=await view(table);assert.ok(t.ok?.includes('| --- | --- |'),'table: '+JSON.stringify(t));
 const filled=await view(await page.evaluate(h=>md.canonicalRichHTML(h),'<table><tbody><tr>'+cell('th','이름')+cell('th','수량')+'</tr><tr>'+cell('td','사과')+cell('td','3')+'</tr></tbody></table><p>뒤</p>'));
 assert.match(filled.ok??'',/\| 사과 +\| 3 +\|/);
 // Attachment HTML block (contenteditable is re-added by the schema) and an invisible leading space.
 const att='<div data-type="mindbox-attachment" data-attachment-url="/api/attachments/68f45f49-7b97-4979-bc7e-594312baaef2" data-name="memo.txt" data-size="24" data-media-type="text/plain" class="mindbox-attachment" contenteditable="false"><a href="/api/attachments/68f45f49-7b97-4979-bc7e-594312baaef2" download="memo.txt" aria-label="memo.txt 다운로드"><span class="attachment-symbol" aria-hidden="true">↓</span><span class="attachment-name">memo.txt</span><span class="attachment-size">24 B</span></a></div>';
 assert.ok((await view('<p> 앞</p>'+att)).ok?.includes('mindbox-attachment'));
 // Unknown attributes/tags are still refused, with the plain message (no "Error:", ZIP, 대용량).
 const message=await page.evaluate(()=>md.MARKDOWN_UNSUPPORTED);
 for(const bad of ['<p data-x="1">a</p>','<p>a</p><unknown-tag>b</unknown-tag>']){
  const r=await view(bad);assert.equal(r.error,message,bad+' → '+JSON.stringify(r));
 }
 assert.doesNotMatch(message,/ZIP|대용량|Error/);
 console.log('PASS markdown view: tables, attachments, refusal message');
}finally{await browser.close();}
