import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from './browser-env.ts';
const bundle=await build({stdin:{contents:"export * from './lib/writing-tools';export * from './lib/note-anchor';",resolveDir:new URL("../src/",import.meta.url).pathname,loader:"ts"},bundle:true,write:false,format:"iife",globalName:"writing",platform:"browser",logLevel:"error"});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:["--no-sandbox"]});
try {
 const page=await browser.newPage();await page.setContent("<!doctype html><body></body>");await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const w=(window as any).writing;
  const html='<!-- <h1>comment</h1> --><script>"<h1>code</h1>"</script><h2 title="x > y">실제 <strong>제목</strong></h2><p id="block-one">문단</p><h2>실제 제목</h2>';
  const markdown='\ufeff# 첫 제목\r\n\r\n```md\n# 코드 아님\n```\n\n두 번째\n---\n\n본문 ^block-two\n';
  const h=w.noteAnchors(html,"html"),m=w.noteAnchors(markdown,"markdown");
  const notes=[{id:"a",title:"강의 기록",updated_at:30},{id:"b",title:"강의 자료 모음",updated_at:20},{id:"c",title:"주간 기록",updated_at:40}];
  const reorder='# A\n\nA body\n\n# B\n\nB body\n';
  return {h,m,offsets:h.filter((a:any)=>a.kind==="heading").map((a:any)=>html.slice(a.sourceOffset,a.sourceOffset+3)), mdOffsets:m.filter((a:any)=>a.kind==="heading").map((a:any)=>markdown.slice(a.sourceOffset).split(/\r?\n/)[0]), moved:w.reorderMarkdownHeading(reorder,1,"up"), ranked:w.rankNotes(notes,"강자",[]).map((n:any)=>n.id), recent:w.rankNotes(notes,"",["b","a"]).map((n:any)=>n.id), unicode:w.fuzzyScore("ＡＢＣ","abc"), date:w.localDate(new Date(2026,0,2,3,4)),time:w.localTime(new Date(2026,0,2,3,4))};
 });
 assert.deepEqual(result.h.filter((a:any)=>a.kind==="heading").map((a:any)=>[a.text,a.level,a.index]),[["실제 제목",2,0],["실제 제목",2,1]]);
 assert.deepEqual(result.offsets,["<h2","<h2"]);assert.equal(result.h.find((a:any)=>a.kind==="block").id,"block-one");
 assert.deepEqual(result.m.filter((a:any)=>a.kind==="heading").map((a:any)=>[a.text,a.level]),[["첫 제목",1],["두 번째",2]]);
 assert.deepEqual(result.mdOffsets,["\ufeff# 첫 제목","두 번째"]);assert.equal(result.m.find((a:any)=>a.kind==="block").id,"block-two");
 assert.deepEqual(result.ranked,["b"]);assert.deepEqual(result.recent,["b","a","c"]);assert.ok(result.unicode>0);assert.equal(result.date,"2026-01-02");assert.equal(result.time,"03:04");
 assert.equal(result.moved,"# B\n\nB body\n# A\n\nA body\n\n");
 console.log("PASS writing tools: local calendar date/time, Korean fuzzy ranking, recent order, HTML comments/raw-text exclusion, duplicate heading indexes, Markdown fences/BOM/CRLF/setext/blocks with exact offsets");
} finally {await browser.close();}
