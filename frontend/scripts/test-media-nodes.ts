import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

// The schema needs a real DOM: bundle rich-document + markdown for the browser and check
// each media node survives sanitize -> parse -> serialize unchanged (editable admission).
const src=fileURLToPath(new URL('../src/',import.meta.url));
const bundle=await build({stdin:{contents:`
 import {inspectRichHTML} from './lib/rich-document';
 import {htmlToMarkdown, markdownToHTML} from './lib/markdown';
 (window as any).check={inspectRichHTML,htmlToMarkdown,markdownToHTML};`,resolveDir:src,loader:'ts'},
 bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},
 external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const id='0f8fad5b-d9cb-469f-a165-70867728950e';
const cases={
 video:'<div data-type="inkism-video" data-src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" data-kind="youtube" data-title="회의 녹화"><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" class="media-fallback-link">회의 녹화</a></div>',
 videoFile:`<div data-type="inkism-video" data-src="/api/attachments/${id}" data-kind="file" data-title="clip.mp4"><a href="/api/attachments/${id}" class="media-fallback-link">clip.mp4</a></div>`,
 videoEmpty:'<div data-type="inkism-video" data-src="" data-kind="url" data-title=""></div>',
 audio:`<div data-type="inkism-audio" data-src="/api/attachments/${id}" data-title="회의 녹음.m4a" data-duration="190.5"><a href="/api/attachments/${id}" class="media-fallback-link">회의 녹음.m4a</a></div>`,
 diagram:'<div data-type="inkism-diagram" data-mode="preview"><pre><code class="language-mermaid">flowchart LR\n  A[메모 쓰기] --&gt; B[기기에 저장]</code></pre></div>',
 model3d:`<div data-type="inkism-model3d" data-src="/api/attachments/${id}" data-title="의자 시안.glb"><a href="/api/attachments/${id}" class="media-fallback-link">의자 시안.glb</a></div>`,
 embed:'<div data-type="inkism-embed" data-src="https://www.example.com/page"><a href="https://www.example.com/page" class="media-fallback-link">https://www.example.com/page</a></div>',
 aiEmpty:'<div data-type="inkism-ai" data-prompt="" data-status="empty"></div>',
 aiDone:'<div data-type="inkism-ai" data-prompt="요점 3개로 정리해 줘" data-status="done"><h3>회의 요점</h3><p>1. 시안 2개</p><p>2. <strong>금요일</strong> 배포</p></div>',
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const [name,html] of Object.entries(cases)){
  const out=await page.evaluate(html=>{const r=(window as any).check.inspectRichHTML(html);return {editable:r.editable,content:r.content,again:(window as any).check.inspectRichHTML(r.content).content};},html);
  assert.equal(out.editable,true,name+' must be admitted as editable: '+out.content);
  assert.equal(out.again,out.content,name+' canonical HTML must be stable');
  // Markdown export keeps the node (HTML block fallback) and imports back to the same HTML.
  const back=await page.evaluate(html=>(window as any).check.markdownToHTML((window as any).check.htmlToMarkdown(html)).content,out.content);
  assert.equal(await page.evaluate(([a,b])=>(window as any).check.inspectRichHTML(a).content===(window as any).check.inspectRichHTML(b).content,[back,out.content]),true,name+' markdown round trip: '+back);
 }
 // Unsafe sources never reach a media element and make the block read-only instead of silently changing.
 const unsafe=await page.evaluate(()=>(window as any).check.inspectRichHTML('<div data-type="inkism-video" data-src="javascript:alert(1)" data-kind="url" data-title=""></div>'));
 assert.equal(unsafe.editable,false);
 const unsafeEmbed=await page.evaluate(()=>(window as any).check.inspectRichHTML('<div data-type="inkism-embed" data-src="/api/attachments/x"></div>'));
 assert.equal(unsafeEmbed.editable,false);assert.doesNotMatch(unsafe.content,/javascript:/);
 assert.deepEqual(errors,[]);
 console.log('PASS media nodes: video/audio/diagram/model3d/aiBlock/embed HTML round-trip, editable admission, Markdown fallback, unsafe src rejected');
}finally{await browser.close()}
