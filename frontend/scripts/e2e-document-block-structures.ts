// 창형(가상 스크롤) 편집기에서 서식 블록 전체(table, details, bulletList, taskList,
// blockquote, codeBlock)를 대상으로 블록 메뉴(복제 · 아래로 이동 · 삭제 · 아래에
// 문단 추가)와 실행 취소가 원문을 정확히 보존하는지 검증한다. 블록 메뉴의 현재
// 범위만 검증하며, 구현되지 않은 동작은 만들지 않는다.
//   INKISM_URL   — 실제 React 앱 + Go/Rust bridge 서버
//   CHROMIUM_PATH — Chromium 실행 파일
//   INKISM_LAZY  — '0'이 아니면 ?virtual=1&lazy=1 로 열어 앱의 전체 본문 읽기를 차단
// canonical fixture는 앱 스키마에서 직접 얻는다. 짧은 임시 HTML 노트를 열고
// [텍스트] 버튼을 명시 클릭한 뒤 editor.commands.setContent(snippet) →
// editor.getHTML() 결과(전체 모드 trailing 빈 문단만 제외)를 대상 블록 문자열로
// 쓰고, 같은 문자열을 다시 넣어도 getHTML이 불변인지 확인해 유효성을 보장한다.
// 예상 원문은 canonical 대상 문자열과 filler 배열을 독립적으로 재배열해 계산하고,
// RPC get의 전체 원문과 정확히 비교해 잘리지 않은 서식 원문 보존을 확인한다.
// lazy 환경에서는 앱 요청 중 get/revision_body/document_render를 차단하고
// document_blocks/document_segments는 limit<=32, document_block_window는
// limit<=65536으로만 읽히는지 확인한다. 문서 전체 DOM은 만들지 않는다.
import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
import {waitForPredicate} from './wait-for-predicate.ts';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL;assert.ok(base);
const lazy=process.env.INKISM_LAZY!=='0';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const root=page.locator('.tiptap-prose');
let lastNote;
const ready=()=>page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized&&Array.from(document.querySelectorAll<any>('.window-controls button')).some(button=>button.textContent==='이동'&&!button.disabled));
// 블록 손잡이: 커서가 있는 블록에 마우스를 올려 손잡이를 띄운 뒤 메뉴를 쓴다. 이동은 Alt+Shift+↑/↓.
const hoverBlock=async()=>{await page.waitForTimeout(100);const p=await page.locator('.tiptap-prose').first().evaluate((el: any)=>{const {state,view}=el.editor,$f=state.selection.$from,pos=$f.depth?$f.before(1):state.selection.from,b=view.nodeDOM(pos).getBoundingClientRect();return {x:b.left+Math.min(40,b.width/2),y:b.top+Math.min(8,b.height/2)};});await page.mouse.move(p.x-2,p.y);await page.mouse.move(p.x,p.y);await page.locator('.block-handle').waitFor({state:'visible'});};
const action=async(name)=>{
 if(name==='위로 이동'||name==='아래로 이동'){await page.locator('.tiptap-prose').first().evaluate((el: any)=>el.editor.view.focus());await page.keyboard.press(name==='위로 이동'?'Alt+Shift+ArrowUp':'Alt+Shift+ArrowDown');return;}
 await hoverBlock();
 if(name==='아래에 문단 추가'){await page.getByRole('button',{name:'블록 넣기',exact:true}).click();await page.getByRole('option',{name:'블록 삽입: 본문',exact:true}).click();return;}
 await page.getByRole('button',{name:'블록 동작',exact:true}).click();await page.getByRole('menuitem',{name:{'블록 복제':'복제','블록 삭제':'삭제'}[name]??name,exact:true}).click();
};
const undo=()=>historyKey(page,'undo');
// 편집한 블록은 영구 블록 ID를 얻는다. ID를 뺀 나머지 원문은 정확히 같아야 한다.
const withoutIds=html=>html.replace(/ id="ink-block-[0-9a-f-]{36}"/g,'');
const stored=async(id,expected)=>{await waitForPredicate(async()=>(withoutIds((await rpc('get',{id})).content)===expected),'블록 동작이 원문을 정확히 보존하지 않았습니다',15000);await ready();};
// 실행 취소로 돌아간 원문은 ID 없이 바이트 그대로여야 한다.
const restored=async(id,expected)=>{await waitForPredicate(async()=>((await rpc('get',{id})).content===expected),'실행 취소가 원문을 정확히 되돌리지 않았습니다',15000);await ready();};
const openWindow=async(note)=>{lastNote=note.id;await page.goto(base+'/?virtual=1'+(lazy?'&lazy=1':''));await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await ready();};
const jump=async(ordinal)=>{await page.getByRole('textbox',{name:'이동할 블록 번호',exact:true}).fill(String(ordinal+1));await page.getByRole('button',{name:'이동',exact:true}).click();await page.locator('[data-window-start="'+ordinal+'"]').waitFor();await ready();};
try{
 // 1) 스키마 캐노니컬 fixture — 각 스니펫을 실제 편집기 스키마로 정규화한다.
 const snippets=[
  ['table','<table><tbody><tr><th><p>머리글 셀</p></th></tr><tr><td><p>데이터 셀 &amp; 😀</p></td></tr></tbody></table>'],
  ['details','<details><summary>요약 제목 &amp; 😀</summary><div data-type="detailsContent"><p>접힌 본문 내용</p></div></details>'],
  ['bulletList','<ul><li><p>목록 항목 하나</p></li><li><p>목록 항목 둘 &amp;</p></li></ul>'],
  ['taskList','<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>완료한 항목</p></li><li data-type="taskItem" data-checked="false"><p>미완료 항목</p></li></ul>'],
  ['blockquote','<blockquote><p>인용 문단 &amp; 😀</p></blockquote>'],
  ['codeBlock','<pre><code>한글 코드 &lt;태그&gt; &amp;amp; "따옴표" 😀</code></pre>'],
 ];
 const canonical={};
 for(const [kind,snippet] of snippets){
  const temp=await rpc('save',{note:{title:'블록 구조 기준 '+kind+' '+Date.now(),content:'<p>기준 샘플</p>',content_format:'html'}});await rpc('wait_index');
  await page.goto(base+'/');await page.getByRole('button',{name:'노트 열기: '+temp.title,exact:true}).click();
  await page.getByRole('button',{name:'텍스트',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isInitialized);
  canonical[kind]=await root.evaluate((el: any,code)=>{
   const editor=el.editor;
   if(!editor.commands.setContent(code))throw new Error('스니펫을 스키마로 해석하지 못했습니다: '+code);
   // setContent도 편집이라 블록 ID가 붙는다. fixture는 ID 없는 원문으로 만든다.
   const strip=html=>html.replace(/ id="ink-block-[0-9a-f-]{36}"/g,'');
   const full=strip(editor.getHTML());
   const last=editor.state.doc.lastChild;
   // 전체 모드 편집기의 trailing node가 문서 끝에 붙인 빈 문단만 떼어 블록 하나로 만든다.
   const tail=last&&last.type.name==='paragraph'&&!last.content.size&&full.endsWith('<p></p>')?'<p></p>':'';
   if(!tail)throw new Error('trailing 빈 문단이 없어 블록 경계를 확정할 수 없습니다');
   const target=full.slice(0,full.length-tail.length);
   // 같은 문자열을 다시 넣어도 getHTML 결과가 불변이어야 캐노니컬하다.
   if(!editor.commands.setContent(target)||strip(editor.getHTML())!==full)throw new Error('캐노니컬 HTML이 안정적이지 않습니다: '+editor.getHTML());
   return target;
  },snippet);
 }
 // 2) 각 대상 블록을 선행 p와 70개의 4000자 ASCII filler p 사이에 넣어 저장한다.
 const prefix='<p>선행 문단 &amp; 😀</p>';
 const fillers=Array.from({length:70},(_,index)=>'<p>f-'+String(index).padStart(3,'0')+' '+'a'.repeat(3994)+'</p>');
 assert.equal(new Set(fillers).size,fillers.length,'filler는 서로 달라야 swap을 구분할 수 있습니다');
 for(const [kind] of snippets){
  const target=canonical[kind];
  const source=[prefix,target,...fillers].join('');
  assert.ok(Buffer.byteLength(source)>200*1024,'노트가 200KiB를 넘지 않습니다: '+kind);
  // 예상 원문은 대상 문자열과 filler 배열의 독립적인 재배열로만 계산한다.
  const expectations={
   duplicate:[prefix,target,target,...fillers].join(''),
   movedDown:[prefix,fillers[0],target,...fillers.slice(1)].join(''),
   removed:[prefix,...fillers].join(''),
   inserted:[prefix,target,'<p></p>',...fillers].join(''),
  };
  const note=await rpc('save',{note:{title:'블록 구조 '+kind+' '+Date.now(),content:source,content_format:'html'}});await rpc('wait_index');
  await openWindow(note);await jump(1);
  assert.equal(await root.locator(':scope > *').count(),32,'문서 전체가 아니라 32블록 창만 마운트되어야 합니다');
  const reads=[];
  await page.route('**/api/rpc',route=>{const v=route.request().postDataJSON();if(v.id===note.id){
   if(lazy&&['get','revision_body','document_render'].includes(v.op))return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});
   if(['document_blocks','document_segments','document_block_window'].includes(v.op))reads.push(v);}return route.continue();});
  // 블록 번호 2(서수 1) 창의 첫 번째 top-level 대상 블록을 노드 선택한다.
  await root.evaluate((el: any)=>{el.editor.commands.setNodeSelection(0);el.editor.view.focus();});
  const selection=await root.evaluate((el: any)=>el.editor.state.selection.toJSON().type);
  // 표 플러그인은 전체 표의 NodeSelection을 CellSelection으로 정규화한다.
  assert.ok(selection==='node'||(kind==='table'&&selection==='cell'),'대상 블록이 선택되어야 합니다: '+selection);
  await action('블록 복제');await stored(note.id,expectations.duplicate);
  await undo();await restored(note.id,source);
  await action('아래로 이동');await stored(note.id,expectations.movedDown);
  await undo();await restored(note.id,source);
  await action('블록 삭제');await stored(note.id,expectations.removed);
  await undo();await restored(note.id,source);
  await action('아래에 문단 추가');await stored(note.id,expectations.inserted);
  await undo();await restored(note.id,source);
  assert.ok(reads.length>0,'블록 원문 읽기가 기록되어야 합니다');
  assert.ok(reads.every(v=>v.op==='document_block_window'?v.limit<=65536:(v.limit??1)<=32),JSON.stringify(reads.slice(0,4)));
  await page.unroute('**/api/rpc');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS 서식 블록(table/details/bulletList/taskList/blockquote/codeBlock) 전체 단위 블록 복제·아래로 이동·삭제·아래에 문단 추가와 실행 취소가 캐노니컬 원문을 정확히 보존; bounded window/read; lazy='+lazy);
}catch(error){
 console.error(await page.evaluate(()=>({error:document.querySelector<any>('.window-error')?.textContent,selection:document.querySelector<any>('.tiptap-prose')?.editor?.state.selection.toJSON()})).catch(()=>null));
 if(lastNote){const savedNote=await rpc('get',{id:lastNote}).catch(()=>null);if(savedNote)console.error({length:savedNote.content.length,first:savedNote.content.slice(0,120),last:savedNote.content.slice(-200)});}
 throw error;
}finally{await browser.close();}
