import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from './browser-env.ts';
const src=fileURLToPath(new URL('../src/',import.meta.url));
const bundle=await build({stdin:{contents:`export * from './lib/markdown-compatible';
 export {generateJSON} from '@tiptap/core';`,resolveDir:src,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'compat',
 platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const cases=['','일반 문장','\ufeff# BOM 제목\r\n**본문**\r\n','## 제목\n\n**굵게** *기울임* ~~취소선~~ `코드`','#### 넷째\n\n###### 여섯째',
  '- 항목\n- 둘째','1. 첫째\n2. 둘째','- [ ] 할 일\n- [x] 완료',
  '> 인용\n\n---','```js\nconst x=1;\n```','![이미지](/api/attachments/0f8fad5b-d9cb-469f-a165-70867728950e)',
  '| 제목 | 수량 |\n| --- | --- |\n| 사과 | 3 |','| 왼쪽 | 가운데 |\n| :--- | :---: |\n| A | B |'];
 for(const source of cases) {
  const result=await page.evaluate(source=>{const c=(window as any).compat;try{
   const html=c.compatibleMarkdownHTML(source);
   const md=c.serializeCompatibleMarkdown(c.generateJSON(html,c.markdownContentExtensions()));
   return {html,md};}catch(e){return {error:e.message}}},source);
  assert.equal(result.error,undefined,'supported Markdown: '+JSON.stringify({source,result}));
  if(source.startsWith('\ufeff'))assert.match(result.html||'',/<h1>BOM 제목<\/h1>/);
 }
 for(const source of ['<span style="color:red">색</span>','본문\n<!--주석-->','참고[^1]\n\n[^1]: 각주','[위험](javascript:alert(1))']) {
  const denied=await page.evaluate(source=>{try{(window as any).compat.compatibleMarkdownHTML(source);return false}catch{return true}},source);
  assert.equal(denied,true,'unsupported source should stay in raw editor');
 }
 const references='[링크][one]\n\n[one]: https://example.com\n[unused]: https://example.com/unused';
 const preserved=await page.evaluate(source=>{const c=(window as any).compat;const html=c.compatibleMarkdownHTML(source);
  return c.serializeCompatibleMarkdown(c.generateJSON(html,c.markdownContentExtensions()),c.markdownDefinitions(source));},references);
 assert.match(preserved,/\[unused\]: https:\/\/example.com\/unused/,'unused reference definition was dropped');
 const blankLines=await page.evaluate(()=>{const c=(window as any).compat;return c.serializeCompatibleMarkdown({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'첫째'}]},{type:'paragraph'},{type:'paragraph',content:[{type:'text',text:'둘째'}]},{type:'paragraph'}]});});
 assert.match(blankLines,/첫째\n\n둘째/);assert.doesNotMatch(blankLines,/<[a-z]/i);
 const imageHTML='<p><strong>본문</strong></p><img src="/api/attachments/0f8fad5b-d9cb-469f-a165-70867728950e?preview=1" alt="pixel.gif"><p></p>';
 const imageMD=await page.evaluate(html=>(window as any).compat.compatibleHTMLMarkdown(html),imageHTML);
 assert.match(imageMD,/!\[pixel\.gif\]/);assert.doesNotMatch(imageMD,/<[a-z]/i);
 for(const html of ['<p><span style="color: rgb(233, 30, 99);">색</span></p>',
  '<p><span style="font-size: 24px;">크기</span></p>','<p data-custom="keep">보존</p>']) {
  const denied=await page.evaluate(html=>{try{(window as any).compat.compatibleHTMLMarkdown(html);return false}catch{return true}},html);
  assert.equal(denied,true,'HTML-only style must not be silently removed');
 }
 const term='<span data-term-id="11111111-1111-4111-8111-111111111111" data-term-definition="한글 &quot;정의&quot; &lt;script&gt;literal&lt;/script&gt;">**용어**</span>';
 for (const source of [term,`앞 ${term} 뒤`,`- ${term}`,`| 용어 |\n| --- |\n| ${term} |`]) {
  const result=await page.evaluate(source=>{const c=(window as any).compat;const html=c.compatibleMarkdownHTML(source);const json=c.generateJSON(html,c.markdownContentExtensions());const saved=c.serializeCompatibleMarkdown(json);return {html,saved,reopened:c.compatibleMarkdownHTML(saved),converted:c.compatibleHTMLMarkdown(html)};},source);
  assert.match(result.html,/data-term-definition/);assert.match(result.saved,/data-term-id/);assert.equal(result.reopened,result.html);assert.match(result.converted,/data-term-id/);
 }
 for(const source of [term.replace('data-term-id=', 'onclick="evil()" data-term-id='),term.replace('11111111-1111-4111-8111-111111111111','bad'),term.replace('**용어**','<img src=x onerror=evil()>'),term.replace('**용어**','<strong>용어</strong>'),term.replace('data-term-definition=', 'data-term-id="11111111-1111-4111-8111-111111111111" data-term-definition=')]) {
  assert.equal(await page.evaluate(source=>{try{(window as any).compat.compatibleMarkdownHTML(source);return false}catch{return true}},source),true,'unsafe/unknown term markup must be refused '+source);
 }
 console.log('PASS Markdown compatibility: empty/basic/marks/lists/tasks/quote/code/image/table, HTML-only input refused');
} finally {await browser.close()}
