// Every toolbar mark/attribute must survive save → reload and stay editable (inspectRichHTML admission).
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from './browser-env.ts';
// esbuild IIFE global injected into the page
declare const rich: any;
const bundle=await build({stdin:{contents:"export {inspectRichHTML,canonicalRichHTML} from './lib/rich-document';",resolveDir:'frontend/src',loader:'ts'},
  bundle:true,write:false,format:'iife',globalName:'rich',platform:'browser',loader:{'.css':'empty'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 // [input, ...fragments the saved HTML must keep]
 const cases=[
  ['<p><mark data-color="#fff176" style="background-color: #fff176; color: inherit">형광펜</mark></p>','data-color="#fff176"','background-color: rgb(255, 241, 118)'],
  ['<p><span style="color: #e91e63">글자색</span></p>','color: rgb(233, 30, 99)'],
  ['<p><span style="font-size: 18px">크기</span></p>','font-size: 18px'],
  ['<p><span style="font-family: Noto Serif KR, Nanum Myeongjo, Batang, serif">명조</span></p>','Nanum Myeongjo'],
  ['<p><span style="color: #2196f3; font-size: 24px; font-family: D2Coding, Consolas, monospace">겹침</span></p>','rgb(33, 150, 243)','font-size: 24px','D2Coding'],
  ['<p>H<sub>2</sub>O x<sup>2</sup></p>','<sub>2</sub>','<sup>2</sup>'],
  ['<p style="text-align: center">가운데</p>','text-align: center'],['<h2 style="text-align: justify">양쪽</h2>','text-align: justify'],
  ['<p dir="rtl">오른쪽에서</p>','dir="rtl"'],['<blockquote><p dir="rtl">인용</p></blockquote>','dir="rtl"'],
  ['<p dir="rtl" style="text-align: right">방향과 정렬</p>','dir="rtl"','text-align: right'],
  ...['upper-alpha','lower-alpha','upper-roman','lower-roman','lower-greek'].map(t=>[`<ol style="list-style-type: ${t}"><li><p>항목</p></li></ol>`,'list-style-type: '+t]),
  ...['circle','square'].map(t=>[`<ul style="list-style-type: ${t}"><li><p dir="rtl">항목</p></li></ul>`,'list-style-type: '+t,'dir="rtl"']),
  ['<p><a href="note://abc123">다른 노트</a></p>','href="note://abc123"'],
 ];
 // Saved notes are editor.getHTML() output; ProseMirror writes style via cssText (hex → rgb), so
 // the round trip starts from that canonical form, exactly like save → reload.
 for(const [html,...keep] of cases){
  const saved=await page.evaluate(h=>rich.canonicalRichHTML(h),html);
  for(const part of keep)assert.ok(saved.includes(part),'lost '+part+' in '+saved);
  const reload=await page.evaluate(h=>rich.inspectRichHTML(h),saved);
  assert.equal(reload.editable,true,'reload not editable: '+saved);
  assert.equal(reload.content,saved,'not stable: '+saved);
 }
 const ol=await page.evaluate(()=>rich.canonicalRichHTML('<ol style="list-style-type: lower-greek"><li><p>a</p></li></ol>'));
 assert.match(ol,/list-style-type: lower-greek/);assert.doesNotMatch(ol,/ type=/);
 // Source formatting between blocks (HTML source mode, engine-rendered Markdown) must neither block
 // admission nor become empty paragraphs/list items; whitespace inside text and <pre> stays.
 const ws=await page.evaluate(()=>[
  '<p>a</p>\n<p>b</p>\n',
  '<h1>제목</h1>\n<p><strong>굵게</strong> 문단</p>\n<ul>\n<li>항목 A</li>\n<li>항목 B</li>\n</ul>\n',
  '<blockquote>\n  <p>인용</p>\n</blockquote>\n<table style="min-width: 25px;">\n<colgroup><col style="min-width: 25px;"></colgroup>\n<tbody>\n<tr>\n<td><p>셀</p></td>\n</tr>\n</tbody>\n</table>',
 ].map(h=>({h,c:rich.canonicalRichHTML(h),i:rich.inspectRichHTML(h)})));
 for(const [n,{h,c,i}] of ws.entries()){
  assert.doesNotMatch(c,/<p>\s*<\/p>|<li><p><\/p><\/li>/,'empty block from whitespace: '+c);
  assert.doesNotMatch(c,/>\s+</,'whitespace kept between blocks: '+c);
  if(n!==1)assert.equal(i.editable,true,'whitespace refused admission: '+h); // tight <li> text is a real shape change
 }
 assert.equal(ws[1].c,'<h1>제목</h1><p><strong>굵게</strong> 문단</p><ul><li><p>항목 A</p></li><li><p>항목 B</p></li></ul>');
 const kept=await page.evaluate(()=>[rich.canonicalRichHTML('<p>a <strong>b</strong> <em>c</em></p>'),rich.canonicalRichHTML('<pre><code>x\n\n  y</code></pre>'),
  rich.inspectRichHTML('<p>a</p>\n<unknown-tag>x</unknown-tag>').editable,rich.inspectRichHTML('<p data-x="1">a</p>\n<p>b</p>').editable]);
 assert.equal(kept[0],'<p>a <strong>b</strong> <em>c</em></p>');assert.match(kept[1],/x\n\n {2}y/);
 assert.equal(kept[2],false,'unknown tag must still be refused');assert.equal(kept[3],false,'unknown attribute must still be refused');
 // A colorless <mark> stays byte-identical after the null-color parse fix.
 assert.equal(await page.evaluate(()=>rich.canonicalRichHTML('<p><mark>표시</mark></p>')),'<p><mark>표시</mark></p>');
 // A segment that cuts a table's first row keeps the full table's derived colgroup. Accept only
 // Tiptap's derived form when partial; whole tables and foreign colgroups stay strict.
 const cut='<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td><p>앞</p></td></tr></tbody></table>';
 const tables=await page.evaluate(cut=>[rich.inspectRichHTML(cut,{partialTable:true}).editable,rich.inspectRichHTML(cut).editable,
  rich.inspectRichHTML(cut.replace('min-width: 50px','min-width: 60px'),{partialTable:true}).editable,
  rich.inspectRichHTML(cut.replace('<col style="min-width: 25px;"></colgroup>','<col span="2" style="min-width: 25px;"></colgroup>'),{partialTable:true}).editable],cut);
 assert.deepEqual(tables,[true,false,false,false],'partial table admission');
 console.log('PASS rich-format-roundtrip ('+cases.length+' cases)');
}finally{await browser.close();}
