// Export must check the original DOM before a schema can silently strip it.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
const src=fileURLToPath(new URL('../src/',import.meta.url));
const bundle=await build({stdin:{contents:`
 export {htmlToMarkdown,markdownToHTML,sourceToMarkdown} from './lib/markdown';
 export {inspectRichHTML,canonicalRichHTML} from './lib/rich-document';`,resolveDir:src,loader:'ts'},
 bundle:true,write:false,format:'iife',globalName:'md',platform:'browser',loader:{'.css':'empty'},
 external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const md=(window as any).md;
  const basic=md.sourceToMarkdown('<h2>제목</h2><p><strong>굵게</strong> <em>기울임</em> <a href="https://example.com">링크</a></p><ul><li><p>항목</p></li></ul>','html');
  const rich=[
   '<p><span style="color: #e91e63">색깔</span></p>',
   '<p><span style="font-size: 24px">크기</span></p>',
   '<p style="text-align: center">가운데</p>',
   '<p><u>밑줄</u></p>', '<p><mark>강조</mark></p>',
   '<p>H<sub>2</sub>O x<sup>2</sup></p>',
  ].map(html=>{
   const original=md.canonicalRichHTML(html), markdown=md.htmlToMarkdown(original);
   const restored=md.markdownToHTML(markdown).content;
   return {original,markdown,restored:md.canonicalRichHTML(restored)};
  });
  const bad=['<p data-custom="keep-me">본문</p>','<unknown-tag>원문</unknown-tag>',
   '<p>본문</p><!--원문 주석-->', '<p onclick="evil()">본문</p>',
   '<p>본문</p><script>alert(1)</script>'];
  const failures=bad.map(html=>{try{md.sourceToMarkdown(html,'html');return ''}catch(e){return e.message}});
  const raw='\ufeff# 제목\r\n<!--주석-->\r\n';
  const plain='**강조 아님**\r\n# 제목 아님\r\n[x](y) <tag> $수식 아님$ &copy;';
  return {basic,rich,failures,raw,native:md.sourceToMarkdown(raw,'markdown'),plain:md.sourceToMarkdown(plain,'text')};
 });
 assert.match(result.basic,/## 제목/);assert.match(result.basic,/\*\*굵게\*\*/);
 assert.match(result.basic,/- 항목/);assert.doesNotMatch(result.basic,/<[a-z]/);
 for(const item of result.rich){
  assert.match(item.markdown,/<p/,'rich formatting should retain HTML');
  assert.equal(item.restored,item.original,'rich format lost in round trip');
 }
 for(const failure of result.failures)assert.match(failure,/서식을 Markdown으로 보존하지 못했습니다/);
 assert.equal(result.native,result.raw,'native Markdown BOM/CRLF/comments changed');
 assert.match(result.plain,/\\\*\\\*강조 아님\\\*\\\*/);
 assert.match(result.plain,/\\# 제목 아님/);assert.match(result.plain,/\\<tag\\>/);
 assert.match(result.plain,/\\\$수식 아님\\\$/);assert.match(result.plain,/\\&copy;/);
 console.log('PASS Markdown export: basic syntax, six rich formats preserved as HTML, five lossy inputs rejected, native source preserved, plain text escaped');
} finally {await browser.close()}
