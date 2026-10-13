import { chromium } from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import assert from 'node:assert/strict';
import {assertBlockBytes} from './block-identity-bytes.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:47888';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='부분저장 '+Date.now();
const note=await rpc('save',{note:{title,content:'<p>앞 😀 한글 뒤</p>',text:'앞 😀 한글 뒤',tags:[]}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();const requests=[];const errors=[];
// Same isolated profile as the other UI tests: Korean UI and the note inspector closed (at 1280px it opens as a modal overlay over the editor).
await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().endsWith('/api/rpc'))requests.push(r.postDataJSON());});
const root=page.locator('.tiptap-prose');
const saved=()=>waitSaved(page);
try {
 await page.goto(base);await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await root.waitFor();
 await root.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 첫😀');await page.keyboard.press('Control+s');await saved();
 // Rich autosave sends a raw-source splice (document_splice_source); stored text == content (raw HTML), plain text is derived lazily.
 // The edited paragraph also receives its persistent identity, so the minimal
 // splice now starts right after "<p" and carries the new id attribute.
 let stored=await rpc('get',{id:note.id});const [blockId]=assertBlockBytes(stored.content,'<p>앞 😀 한글 뒤 첫😀</p>',{added:1,message:'first partial save'});assert.equal(stored.text,stored.content);
 let splices=requests.filter(x=>x.op==='document_splice_source');assert.equal(splices.length,1);assert.equal(splices[0].content_format,'html');assert.equal(splices[0].content.replacement,` id="${blockId}">앞 😀 한글 뒤 첫😀`);assert.equal(splices[0].content.expected,'>앞 😀 한글 뒤');assert.equal(splices[0].content.start,Buffer.byteLength('<p'));
 // Hold one real engine response while the user continues typing.
 let release,started,finished;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r),handled=new Promise(r=>finished=r);
 await page.route('**/api/rpc',async route=>{const req=route.request().postDataJSON();if(req.op==='document_splice_source'){const response=await route.fetch();started();await gate;await route.fulfill({response});finished();}else await route.continue();});
 await page.keyboard.insertText(' 둘');await page.keyboard.press('Control+s');await ready;
 await page.keyboard.insertText(' 셋😁');release();await handled;await page.unroute('**/api/rpc');await page.keyboard.press('Control+s');
 await waitSaved(page);
 stored=await rpc('get',{id:note.id});assert.equal(stored.content,`<p id="${blockId}">앞 😀 한글 뒤 첫😀 둘 셋😁</p>`,'later edits keep the same identity');assert.equal(stored.text,stored.content);
 await page.reload();await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await root.waitFor();assert.equal(await root.textContent(),'앞 😀 한글 뒤 첫😀 둘 셋😁');
 // Remote changes must survive a rejected local save.
 await rpc('save',{note:{id:note.id,revision:stored.revision,content:'<p>다른 기기의 변경</p>',text:'다른 기기의 변경'}});
 await root.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 충돌편집');await page.keyboard.press('Control+s');
 await page.getByText('저장 충돌 — 다른 곳에서 이 노트가 변경되었습니다',{exact:false}).waitFor();
 assert.equal((await rpc('get',{id:note.id})).content,'<p>다른 기기의 변경</p>');assert.ok((await root.textContent()).includes('충돌편집'));
 // A worker that cannot load must preserve storage and the user's dirty draft.
 const failed=await browser.newPage();await failed.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});
 await failed.route('**/assets/splice.worker-*.js',route=>route.abort());
 await failed.goto(base);await failed.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 const failedRoot=failed.locator('.tiptap-prose');await failedRoot.click();await failed.keyboard.press('Control+End');await failed.keyboard.insertText(' 보존할 편집');await failed.keyboard.press('Control+s');
 await failed.getByText('변경 구간을 계산하지 못했습니다. 다시 저장해 주세요.',{exact:false}).first().waitFor();
 assert.equal((await rpc('get',{id:note.id})).content,'<p>다른 기기의 변경</p>');assert.ok((await failedRoot.textContent()).includes('보존할 편집'));await failed.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: UTF-8 partial autosave, edits during in-flight save, reopen, remote conflict preserves both versions');
} finally {await browser.close();}
