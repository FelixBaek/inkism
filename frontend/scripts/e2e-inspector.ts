import {waitForPredicate} from './wait-for-predicate.ts';
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48175';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const stamp=Date.now();let first=await rpc('save',{note:{title:'속성 노트 '+stamp,content:'<p>원래 본문</p>',text:'원래 본문',tags:[]}});
first=await rpc('save',{note:{...first,content:'<p>최신 본문</p>',text:'최신 본문'}});
const second=await rpc('save',{note:{title:'다른 속성 '+stamp,content:'<p>다른 본문</p>',text:'다른 본문',tags:[]}});
await rpc('workspace_set',{ids:[first.id,second.id],active:first.id,locations:{}});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
const panel=()=>p.locator('.note-inspector');
const title=()=>p.getByLabel('노트 제목',{exact:true});
async function noOverflow(){assert.deepEqual(await p.evaluate(()=>({x:scrollX,over:document.documentElement.scrollWidth>innerWidth})),{x:0,over:false});}
// Start from the saved closed-panel preference; opening it must consume only its own width.
try{
 await p.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await p.goto(base);await title().waitFor();assert.equal(await panel().count(),0);const fullWidth=(await p.locator('.editor-pane').boundingBox()).width;assert.ok(fullWidth>760);
 await p.getByRole('button',{name:'HTML',exact:true}).click();const body=p.locator('.cm-content');await body.click();await p.keyboard.press('End');await p.keyboard.insertText(' 입력 보존');
 await p.getByRole('button',{name:'노트 속성 열기',exact:true}).click();await panel().waitFor();assert.equal((await panel().boundingBox()).width,280);assert.equal((await p.locator('.editor-pane').boundingBox()).width,fullWidth-280);await noOverflow();assert.match(await body.innerText(),/입력 보존/);
 assert.equal(await panel().getByRole('checkbox').count(),4);assert.match(await panel().innerText(),/만든 날짜/);assert.match(await panel().innerText(),/수정한 날짜/);
 await panel().getByRole('checkbox',{name:'위로 고정',exact:true}).click();await waitForPredicate(async()=>(await rpc('get',{id:first.id})).pinned,'고정 속성의 실제 저장을 기다리는 시간이 초과됐습니다.');assert.match((await rpc('get',{id:first.id})).content,/입력 보존/);
 await panel().getByRole('checkbox',{name:'즐겨찾기',exact:true}).click();await p.waitForTimeout(300);assert.equal((await rpc('get',{id:first.id})).favorite,true);
 await p.getByRole('tab',{name:'노트 탭: '+second.title,exact:true}).click();await p.waitForFunction(t=>document.querySelector<any>('[aria-label="노트 제목"]')?.value===t,second.title);assert.equal(await panel().getByRole('checkbox',{name:'위로 고정',exact:true}).isChecked(),false);assert.match(await panel().locator('.inspector-note-title').innerText(),/다른 속성/);
 await p.getByRole('tab',{name:'노트 탭: '+first.title,exact:true}).click();await p.waitForFunction(t=>document.querySelector<any>('[aria-label="노트 제목"]')?.value===t,first.title);assert.equal(await panel().getByRole('checkbox',{name:'위로 고정',exact:true}).isChecked(),true);
 await panel().getByRole('button',{name:/버전 복원:/}).last().click();await p.getByRole('dialog',{name:'버전 복원',exact:true}).getByRole('button',{name:'취소',exact:true}).click();assert.match((await rpc('get',{id:first.id})).content,/입력 보존/);
 await panel().getByRole('button',{name:/버전 복원:/}).last().click();await p.getByRole('dialog',{name:'버전 복원',exact:true}).getByRole('button',{name:'복원',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.cm-content')?.textContent==='<p>원래 본문</p>');await panel().getByRole('button',{name:/버전 복원:/}).first().click();await p.getByRole('dialog',{name:'버전 복원',exact:true}).getByRole('button',{name:'복원',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('입력 보존'));
 await p.setViewportSize({width:1024,height:900});await p.waitForFunction(()=>document.querySelector('.note-inspector')?.getAttribute('role')==='dialog');assert.equal(await panel().getAttribute('role'),'dialog');assert.equal((await p.locator('.editor-pane').boundingBox()).width,(await p.locator('.editor-workspace').boundingBox()).width);await noOverflow();await panel().getByRole('button',{name:'노트 속성 닫기',exact:true}).focus();await p.keyboard.press('Escape');assert.equal(await panel().count(),0);
 for(const width of [800,900,1024,1440]){await p.setViewportSize({width,height:900});await noOverflow();const modes=await p.locator('.mode-btn:not(.editor-compatibility-switch)').allTextContents();assert.deepEqual(modes.map(x=>x.trim()),['텍스트','HTML','MARKDOWN']);assert.equal(await p.locator('.editor-compatibility-switch').getAttribute('aria-label'),'MARKDOWN 에디터로 변환');}
 await body.click();await p.keyboard.press('End');await p.getByRole('button',{name:'노트 속성 열기',exact:true}).click();await panel().getByRole('button',{name:'노트 속성 닫기',exact:true}).click();await p.waitForFunction(()=>document.activeElement?.classList.contains('cm-content'));await p.keyboard.insertText(' 닫은 뒤 입력');assert.match(await body.innerText(),/닫은 뒤 입력/);
 const menu=p.locator('.note-row.is-selected .note-row-main');await menu.focus();await p.keyboard.press('Shift+F10');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('role')),'menuitem');const initial=await p.evaluate(()=>document.activeElement.textContent);await p.keyboard.press('ArrowDown');assert.notEqual(await p.evaluate(()=>document.activeElement.textContent),initial);await p.keyboard.press('End');await p.keyboard.press('Home');assert.equal(await p.evaluate(()=>document.activeElement.textContent),initial);await p.keyboard.press('Escape');assert.equal(await menu.evaluate(e=>e===document.activeElement),true);
 await p.getByRole('button',{name:'노트 속성 열기',exact:true}).click();await p.screenshot({path:process.env.INKISM_INSPECTOR_SCREENSHOT||'/tmp/inkism-ui-audit-20261004/inspector-open.png'});
 // Observe the edited bytes in the real engine before restarting. Visible
 // editor text can precede SourceEditor's idle flush and store autosave.
 await waitForPredicate(async()=>(await rpc('get',{id:first.id})).content.includes('닫은 뒤 입력'),'재시작 전 입력의 실제 저장을 기다리는 시간이 초과됐습니다.');
 await p.reload();await title().waitFor();await panel().waitFor();assert.equal(await panel().count(),1);assert.match(await body.innerText(),/닫은 뒤 입력/);assert.deepEqual(errors,[]);
 console.log('PASS: inspector closed preference, 280px desktop/overlay resize, saved property toggles, note switching, history cancel/restore/current snapshot, editor focus, exact mode labels, source-only editing, keyboard menus and no 800–1440px overflow');
}finally{await b.close();}
