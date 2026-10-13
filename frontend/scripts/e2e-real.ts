import { chromium } from './browser-env.ts';
import {waitSaved} from "./save-state.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
const base=process.env.INKISM_URL || "http://127.0.0.1:47833";
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1440,height:900}});
// Same isolated profile as the other UI tests: Korean UI and the note inspector closed (at 1280px it opens as a modal overlay over the editor).
await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
async function rpc(op,args={}) {
 const r=await fetch(base+"/api/rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op,...args})});
 const out=await r.json();assert.equal(out.ok,true,JSON.stringify(out));return out.data;
}
async function saved(){await waitSaved(page,{timeout:15000});}
const run=Date.now().toString();
try{
 await page.goto(base,{waitUntil:"networkidle"});
 await page.getByRole("button",{name:"새 노트 만들기",exact:true}).first().click();
 await page.getByLabel("노트 제목").fill("Inkism 실저장 검증 "+run);
 await page.locator(".tiptap-prose").fill("한국어 실제 저장과 검색 검증 토성탐사자료"+run);
 await saved();await rpc("wait_index");
 const found=await rpc("list",{view:"all",query:"토성탐사자료"+run});
 assert.equal(found.items.length,1);const id=found.items[0].id;
 assert.equal(Object.hasOwn(found.items[0],"content"),false);
 await page.reload({waitUntil:"networkidle"});
 await page.getByRole("searchbox",{name:"노트 검색",exact:true}).fill("토성탐사자료"+run);
 await page.locator(".note-row-main",{hasText:run}).click();
 assert.match(await page.locator(".tiptap-prose").textContent(),/실제 저장/);
 let fail=true,failures=0;
 await page.route("**/api/rpc",async route=>{
  if(["save","patch"].includes(route.request().postDataJSON().op)&&fail&&++failures)await route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({ok:false,error:"검증용 저장 실패"})});
  else await route.continue();
 });
 await page.getByLabel("노트 제목").fill("저장 실패 중 편집 보존 "+run);
 await page.waitForFunction(()=>document.querySelector(".status-save")?.textContent.includes("저장 실패"));
 // The new-note flush must itself fail (journal checkpoint runs first) before saves recover.
 const failed=failures;await page.getByRole("button",{name:"새 노트 만들기",exact:true}).first().click();while(failures===failed)await page.waitForTimeout(25);
 await page.waitForFunction(()=>document.querySelector(".status-save")?.textContent.includes("저장 실패"));
 assert.equal(await page.getByLabel("노트 제목").inputValue(),"저장 실패 중 편집 보존 "+run);
 fail=false;await page.keyboard.press("Control+s");await saved();await page.unroute("**/api/rpc");
 // Note actions live in the note row menu (right click / Shift+F10).
 await page.locator(".note-row.is-selected .note-row-main").click({button:"right"});
 await page.getByRole("menuitemcheckbox",{name:"즐겨찾기",exact:true}).click();
 await page.waitForTimeout(200);
 await page.locator(".tiptap-prose").press("End");
 await page.locator(".tiptap-prose").pressSequentially(" 변경");
 assert.match(await page.locator(".tiptap-prose").textContent(),/ 변경$/);
 // The rich editor buffers input; Ctrl+S flushes it instead of racing the previous "saved" status.
 await page.keyboard.press("Control+s");await saved();
 const note=await rpc("get",{id});assert.equal(note.favorite,true);assert.match(note.text,/변경/);
 assert.ok((await rpc("history",{id})).length>0);
 const content=Array.from({length:100000},(_,i)=>"<p>연구 기록 "+i+" 가상화 검증</p>").join("\n");
 const big=await rpc("save",{note:{title:"십만 줄 문서 "+run,content,text:"연구 기록",tags:[]}});
 await page.reload({waitUntil:"networkidle"});
 await page.getByRole("searchbox",{name:"노트 검색",exact:true}).fill("십만");
 await page.getByRole("button",{name:"노트 열기: 십만 줄 문서 "+run,exact:true}).click();
 // HTML notes open in the rich view first; it must stay windowed too, then the source view is checked.
 await page.waitForSelector(".tiptap-prose");await page.waitForTimeout(500);
 const rich=await page.evaluate(()=>document.querySelector(".editor-pane").querySelectorAll("*").length);assert.ok(rich<4000,JSON.stringify({richNodes:rich}));
 await page.getByRole("button",{name:"HTML",exact:true}).click();
 await page.waitForSelector(".cm-editor");
 const metrics=await page.evaluate(()=>({lines:document.querySelectorAll(".cm-line").length,nodes:document.querySelector(".editor-pane").querySelectorAll("*").length}));
 assert.ok(metrics.lines<500&&metrics.nodes<4000,JSON.stringify(metrics));
 await page.locator(".cm-content").click();const latency=[];
 for(let i=0;i<20;i++){const t=performance.now();await page.keyboard.press("a");latency.push(performance.now()-t);}
 await page.keyboard.press("Control+s");await saved();
 assert.match((await rpc("get",{id:big.id})).content,/a/);
 latency.sort((a,b)=>a-b);
 console.log(JSON.stringify({largeDocument:{...metrics,keyRoundTripP50ms:latency[10],keyRoundTripP95ms:latency[18]}}));
 await page.getByRole("searchbox",{name:"노트 검색",exact:true}).fill("저장 실패 중");
 await page.getByRole("button",{name:"노트 열기: 저장 실패 중 편집 보존 "+run,exact:true}).click();
 await page.waitForFunction(title=>document.querySelector<HTMLInputElement>('[aria-label="노트 제목"]')?.value===title,"저장 실패 중 편집 보존 "+run);
 const frame=await page.evaluate(()=>({scrollX,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,boxes:['.sidebar','.note-list','.editor-pane'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,width:r.width};})}));
 assert.equal(frame.scrollX,0,'desktop frame must not scroll horizontally');
 assert.equal(frame.scrollWidth,frame.width,'desktop horizontal overflow');
 // Desktop shell widths come from shell.css (--sidebar-w 232px, --list-w 300px).
 assert.deepEqual(frame.boxes,[{x:0,width:232},{x:232,width:300},{x:532,width:908}]);
 fs.mkdirSync("../.impeccable/review",{recursive:true});
 await page.screenshot({path:"../.impeccable/review/desktop.png"});
 await page.setViewportSize({width:412,height:915});
 await page.screenshot({path:"../.impeccable/review/mobile.png"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"mobile horizontal overflow");
 await page.getByLabel("노트 목록으로 돌아가기").click();assert.ok(await page.locator(".note-list").isVisible());
 await page.getByLabel("탐색 열기").click();assert.ok(await page.locator(".sidebar").isVisible());
 await page.getByRole("button",{name:"설정 열기",exact:true}).click();
 // Settings sections are in .settings-nav; device sync opens from the sync section.
 await page.locator(".settings-nav").getByRole("button",{name:"동기화",exact:true}).click();
 await page.getByRole("dialog",{name:"설정"}).getByRole("button",{name:"기기 동기화",exact:true}).click();
 assert.ok(await page.getByRole("dialog",{name:"기기 동기화"}).isVisible());
 assert.deepEqual(errors,[]);
 console.log("PASS: real storage, Korean search, reopen, save failure preservation, metadata revision, history, 100k-line virtualization, mobile navigation");
} finally {await browser.close();}
