import {waitForAsync} from './async-browser-condition.ts';
// /?virtual=1&lazy=1 부분 편집 경로 재연결 인증 검사. 실제 React + Go/Rust 런타임 대상이며
// 제품 코드는 일절 수정하지 않는다. 합성 노트만 만들고 기존 데이터는 건드리지 않는다:
// 시작 시 작업 공간을 스냅샷하고, 종료 시 이 검사가 만든 노트만 삭제한 뒤 복원한다.
// INKISM_URL / CHROMIUM_PATH 로 대상을 바꿀 수 있다.
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
import {historyKey} from './history-keys.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:48291';
const chromiumPath=process.env.CHROMIUM_PATH;
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const value=await response.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const paragraph=i=>`<p><strong>한글😀 ${i}</strong> 본문</p>`;
// 5000번 문단만 브라우저 스키마가 표현할 수 없다: 알 수 없는 data-* 속성, 주석, 알 수 없는 태그.
// (하이픈 있는 태그명은 엔진 분할기가 문서 전체를 opaque 처리하므로 의도와 다르게 단일 블록이 된다.)
const anomaly=`<p data-admission="미지원-속성"><!--주석 보존 표식--><admission id="표식5000"><strong>한글😀 5000</strong></admission> 본문</p>`;
const blocks=Array.from({length:10000},(_,i)=>i===5000?anomaly:paragraph(i));
const title='부분 재연결 '+Date.now();
const note=await rpc('save',{note:{title,content:blocks.join(''),text:'검사'}});
const hugeBody='<p>시작표식-'+'거대문단'.repeat(51200)+'-끝표식</p>'; // 단일 문단 ≈600KiB (>512KiB 블록 상한)
let huge,opaque,mixed;
const workspaceBefore=await rpc('workspace_get');
const browser=await chromium.launch({executablePath:chromiumPath,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// 전체 본문 읽기(op=get)를 세고, 명시적 원문 전환 전에는 403으로 거부해 위반을 즉시 실패로 만든다.
let fullReads=0,allowFull=false;
const oversizedResponses=[];
await page.route('**/api/rpc',async route=>{
 const request=route.request().postDataJSON();
 if([note.id,huge?.id,opaque?.id].includes(request.id)&&['get','revision_body','document_render'].includes(request.op)){fullReads++;if(!allowFull)return route.fulfill({status:403,json:{ok:false,error:'unexpected full body read'}});}
 if(request.op==='document_blocks'&&[huge?.id,mixed?.id].includes(request.id)){
  assert.equal(request.bounded,true,'화면 요청은 큰 블록 전체 전송을 금지한다');
  const response=await route.fetch(),raw=await response.text(),data=JSON.parse(raw).data;
  if(data.oversized_block){
   assert.equal(data.blocks.length,0,'거대 블록을 빈 HTML로 위장하지 않는다');
   assert.ok(Buffer.byteLength(raw)<2048,'거대 블록은 크기 정보만 전송한다');
   oversizedResponses.push({id:request.id,offset:request.offset,bytes:Buffer.byteLength(raw)});
  }
  return route.fulfill({response,body:raw});
 }
 await route.continue();
});
const rich=page.locator('.tiptap-prose');
const at=n=>page.waitForFunction(n=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(n),n,{timeout:30000});
const exactSource=async expected=>{
 await page.locator('.split-primary .cm-content').focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
 await waitForAsync(page,async expected=>(await navigator.clipboard.readText())===expected,expected);
};
const saved=()=>page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')),undefined,{timeout:30000});
try{
 await rpc('wait_index');
 // 1) 처음 부분만 열고 정상 구간을 편집·저장한다. 전체 본문 읽기는 0회, 미방문 문단은 원문 그대로.
 await page.goto(base+'/?virtual=1&lazy=1');
 await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 await at(0);await rich.waitFor();
 assert.equal(fullReads,0,'열기에서 전체 본문을 읽으면 안 된다');
 assert.equal(await rich.locator(':scope > p').count(),32);
 assert.ok(!(await rich.textContent()).includes('한글😀 5000'),'미방문 문단은 마운트되지 않는다');
 await rich.locator('p').first().click();await page.keyboard.press('Home');
 await page.keyboard.insertText('부분편집 ');await page.keyboard.press('Control+s');await saved();
 const afterEdit=await rpc('get',{id:note.id});
 const blockId=/^<p id="(ink-block-[0-9a-f-]{36})">/.exec(afterEdit.content)?.[1];assert.ok(blockId,'편집한 문단에는 영구 블록 ID가 부여된다');
 const expected='<p id="'+blockId+'"><strong>부분편집 한글😀 0</strong> 본문</p>'+blocks.slice(1).join('');
 assert.ok(afterEdit.content===expected,'저장은 편집한 문단만 바꾸고 나머지 원문을 바이트 그대로 보존한다');
 assert.equal(fullReads,0,'편집/저장 중에도 전체 본문을 읽으면 안 된다');
 console.log('phase1 부분 열기/편집/저장: 전체 get 0회, 미방문 구간 보존');

 // 2) 문제 문단으로의 이동은 명확한 보존 오류로 중단되고 기존 편집 구간을 유지한다.
 await page.getByLabel('이동할 블록 번호').fill('5001');
 await page.getByRole('button',{name:'이동',exact:true}).click();
 const jumpError=page.locator('.window-error').filter({hasText:'이 구간에는 그대로 보존할 수 없는 서식'});
 await jumpError.waitFor({timeout:30000});
 assert.ok((await jumpError.textContent()).includes('HTML 원문 모드에서 편집해 주세요'));
 assert.equal(await page.locator('[data-window-start]').getAttribute('data-window-start'),'0','실패 시 구간이 바뀌면 안 된다');
 assert.ok((await rich.textContent()).includes('부분편집 '),'기존 편집 구간을 유지한다');
 const afterJump=await rpc('get',{id:note.id});
 assert.equal(afterJump.content,expected);assert.equal(afterJump.revision,afterEdit.revision);
 assert.equal(fullReads,0);
 console.log('phase2 문제 구간 이동 중단 + 기존 구간 유지');

 // 3) Ctrl+A 전체 서식 적용은 화면 밖 미지원 속성으로 오류 표시되고 본문/revision이 그대로다.
 await rich.locator('p').first().click();
 await page.keyboard.press('Control+a');
 await page.locator('.document-selection-status').filter({hasText:'문서 전체 선택됨'}).waitFor({timeout:30000});
 await page.keyboard.press('Control+i');
 const markError=page.locator('.window-error').filter({hasText:'선택 범위에 그대로 보존할 수 없거나'});
 await markError.waitFor({timeout:60000});
 assert.ok((await page.locator('.document-selection-status').textContent()).includes('문서 전체 선택됨'),'실패 후에도 선택 상태를 유지한다');
 const afterMark=await rpc('get',{id:note.id});
 assert.equal(afterMark.content,expected);
 assert.equal(afterMark.revision,afterEdit.revision,'전체 서식 적용은 본문과 revision을 바꾸지 않는다');
 assert.equal(fullReads,0);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('.document-selection-status'),undefined,{timeout:30000});
 console.log('phase3 Ctrl+A 서식 적용 오류 표시 + 본문/revision 무변경');

 // 4) HTML 원문 전환만 전체 읽기를 명시적으로 허용하고 저장된 원문과 정확히 같은 것을 표시한다.
 allowFull=true;
 await page.getByRole('button',{name:'HTML',exact:true}).click();
 await page.locator('.split-primary .cm-content').waitFor({timeout:60000});
 assert.equal(fullReads,1,'원문 전환은 정확히 한 번의 전체 읽기를 허용한다');
 const fullNote=await rpc('get',{id:note.id});
 assert.equal(fullNote.content,expected);
 await exactSource(fullNote.content);
 assert.equal(await page.locator('.status-words').textContent(),'30,001 words');
 assert.ok(fullNote.content.includes('data-admission="미지원-속성"'));
 allowFull=false;
 console.log('phase4 HTML 원문 전환: 명시적 full get 1회 + 정확 원문 표시');

 // 5) 600KiB 단일 문단은 내부의 작은 구간만 읽고 원문을 그대로 보존한다.
 huge=await rpc('save',{note:{title:'거대 단락 '+Date.now(),content:hugeBody,text:'거대'}});
 await rpc('wait_index');
 await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(huge.title);
 await page.getByRole('button',{name:'노트 열기: '+huge.title,exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')==='0');
 assert.equal(await rich.count(),1);assert.ok((await rich.textContent()).length<32769);
 assert.equal((await rpc('get',{id:huge.id})).content,hugeBody);
 assert.equal(fullReads,1,'거대 노트 열기에서도 전체 본문을 읽으면 안 된다');
 allowFull=true;
 await page.getByRole('button',{name:'HTML',exact:true}).click();
 await page.locator('.split-primary .cm-content').waitFor({timeout:60000});
 await exactSource(hugeBody);
 assert.equal(fullReads,2);
 assert.ok(oversizedResponses.some(r=>r.id===huge.id),'실제 거대 블록 응답을 확인해야 한다');
 // An offscreen giant block can be selected and formatted through bounded
 // source spans. Undo must restore its exact original bytes.
 const mixedBody=Array.from({length:32},(_,i)=>paragraph(i)).join('')+hugeBody+'<p>마지막</p>';
 mixed=await rpc('save',{note:{title:'화면 밖 거대 블록 '+Date.now(),content:mixedBody,text:'검사'}});
 await rpc('wait_index');allowFull=false;
 await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(mixed.title);
 await page.getByRole('button',{name:'노트 열기: '+mixed.title,exact:true}).click();await at(0);
 await page.getByLabel('이동할 블록 번호').fill('33');
 await page.getByRole('button',{name:'이동',exact:true}).click();await at(32);
 await page.waitForFunction(()=>document.querySelector('[data-segment-start]')?.getAttribute('data-segment-start')==='0');
 assert.ok((await rich.textContent()).length<32769);
 await page.getByLabel('이동할 블록 번호').fill('1');await page.getByRole('button',{name:'이동',exact:true}).click();await at(0);
 await rich.evaluate((el: any)=>{const e=el.editor;e.view.focus();e.commands.setTextSelection(e.state.doc.content.size-1);e.view.focus();});
 await page.keyboard.press('Shift+ArrowRight');
 await at(32);await page.locator('.document-selection-status').waitFor();
 assert.equal((await rpc('get',{id:mixed.id})).content,mixedBody);
 await page.keyboard.press('Escape');await page.keyboard.press('Control+Home');await at(0);
 await page.keyboard.press('Control+a');
 await page.locator('.document-selection-status').filter({hasText:'문서 전체 선택됨'}).waitFor();
 await page.keyboard.press('Control+i');await page.waitForFunction(()=>Array.from(document.querySelectorAll<any>('.window-controls button')).some(b=>b.textContent==='이동'&&!b.disabled));await saved();await at(0);
 const formatted=await rpc('get',{id:mixed.id});
 assert.ok(formatted.content.includes('<em>시작표식-'));
 await historyKey(page,'undo');await saved();
 assert.equal((await rpc('get',{id:mixed.id})).content,mixedBody);
 assert.ok(oversizedResponses.some(r=>r.id===mixed.id&&r.offset===32));
 assert.equal(fullReads,2);await page.keyboard.press('Escape');
 // The Rust cache deliberately keeps unbalanced HTML opaque. Browser repair
 // could otherwise turn one cached block into thousands of mounted paragraphs.
 const opaqueBody=Array.from({length:10000},(_,i)=>paragraph(i)).join('').slice(0,-4);
 opaque=await rpc('save',{note:{title:'불투명 HTML '+Date.now(),content:opaqueBody,content_format:'html'}});
 await rpc('wait_index');allowFull=false;
 await page.getByRole('searchbox',{name:'노트 검색',exact:true}).fill(opaque.title);
 await page.getByRole('button',{name:'노트 열기: '+opaque.title,exact:true}).click();
 await page.locator('.window-error').filter({hasText:'이 구간에는 그대로 보존할 수 없는 서식'}).waitFor();
 assert.equal(await rich.count(),0);assert.equal(fullReads,2);
 const untouched=await rpc('get',{id:opaque.id});assert.equal(untouched.content,opaqueBody);assert.equal(untouched.revision,opaque.revision);
 assert.deepEqual(errors,[]);
 console.log('PASS ?virtual=1&lazy=1: 부분 열기·편집·저장에서 전체 get 0회와 미방문 원문 보존, 문제 구간 이동 중단과 기존 구간 유지, Ctrl+A 전체 서식 오류 표시와 본문/revision 무변경, HTML 원문 전환의 명시적 full get과 정확 원문, 600KiB 단일 문단의 내부 구간 마운트와 원문 보존');
}catch(e){
 console.error({errors,fullReads});
 try{console.error(await page.evaluate(()=>({url:location.href,title:document.querySelector<any>('.title-input')?.value,status:document.querySelector<any>('.status-save')?.textContent,error:document.querySelector<any>('.window-error')?.textContent,start:document.querySelector<any>('[data-window-start]')?.getAttribute('data-window-start'),controls:document.querySelector<any>('.window-controls')?.textContent,selection:document.querySelector<any>('.document-selection-status')?.textContent,sourceHead:document.querySelector<any>('.split-primary .cm-content')?.textContent?.slice(0,160)})));}catch{}
 throw e;
}finally{
 await browser.close();
 // 뒤처리: 작업 공간을 시작 상태로 복원하고 이 검사가 만든 합성 노트만 삭제한다.
 try{await rpc('workspace_set',{ids:(workspaceBefore.tabs??[]).map(t=>t.id),active:workspaceBefore.active??null,locations:workspaceBefore.locations??{}});}catch{}
 for(const target of [note,huge,opaque,mixed]){
  if(!target)continue;
  try{await rpc('patch',{id:target.id,changes:{trashed:true},summary_only:true});await rpc('delete',{id:target.id});}catch(error){console.error('cleanup',target.id,String(error));}
 }
}
