import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const bundle=await build({stdin:{contents:`export {Editor} from '@tiptap/core';export {contentExtensions} from './extensions/content-schema';export {validTermDefinition} from './extensions/term-definition';export {sanitizeRichHtml} from './lib/sanitize';export {sourceToMarkdown,htmlToMarkdown,markdownToHTML,markdownToEditableHTML} from './lib/markdown';export {inspectRichHTML,canonicalRichHTML} from './lib/rich-document';`,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'fixture',platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.setContent('<div id="editor"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,id='11111111-1111-4111-8111-111111111111';
  const attrs={id,definition:'한글 "정의" <script>literal</script> & data',glossaryId:id,noteId:id};
  const editor=new f.Editor({element:document.querySelector('#editor'),extensions:f.contentExtensions({trailingNode:false,automaticIds:false}),content:'<p>용어와 문장</p>'});
  editor.chain().setTextSelection({from:1,to:3}).setMark('termDefinition',attrs).run();
  const html=editor.getHTML(),json=editor.getJSON(),safe=f.sanitizeRichHtml(html),admitted=f.inspectRichHTML(html).editable;
  editor.commands.setContent(safe);const reopened=editor.getJSON();
  if(!admitted)throw new Error(JSON.stringify({html,safe,canonical:f.canonicalRichHTML(html),json}));
  const portable=f.sourceToMarkdown(html,'html');
  const markdown=f.htmlToMarkdown(html),restored=f.canonicalRichHTML(f.markdownToHTML(markdown).content),editable=f.canonicalRichHTML(f.markdownToEditableHTML(markdown).content);
  editor.chain().setTextSelection({from:1,to:3}).unsetMark('termDefinition').run();const removed=editor.getHTML();editor.commands.undo();const undone=editor.getHTML();
  const invalid=['', 'x'.repeat(2001)].map(definition=>f.validTermDefinition({...attrs,definition}));
  const malicious=f.sanitizeRichHtml(html.replace('<span ','<span onclick="alert(1)" '));
  const invalidHTML=f.canonicalRichHTML('<p><span data-term-id="bad" data-term-definition="def">word</span></p>');
  editor.destroy();return {portable,attrs,html,json,reopened,safe,admitted,markdown,restored,editable,removed,undone,invalid,malicious,invalidHTML};
 });
 assert.match(result.portable,/\[\^inkism-term-1-/);assert.match(result.portable,/정의/);assert.doesNotMatch(result.portable,/data-term-definition/);
 assert.equal(result.admitted,true);assert.deepEqual(result.json,result.reopened);
 assert.equal(result.restored,result.html);assert.equal(result.editable,result.html);assert.match(result.markdown,/data-term-definition/);
 assert.doesNotMatch(result.html,/<script/i);assert.doesNotMatch(result.malicious,/onclick/);assert.doesNotMatch(result.removed,/data-term-/);assert.equal(result.undone,result.html);
 assert.deepEqual(result.invalid,[false,false]);assert.equal(result.invalidHTML,'<p>word</p>');
 console.log('term definition schema, sanitize, Markdown, reload and undo regressions passed');
} finally {await browser.close();}
