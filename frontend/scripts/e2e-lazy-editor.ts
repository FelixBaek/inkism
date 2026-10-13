import {chromium} from './browser-env.ts';
import {trackSaves} from './save-state.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47958';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const title='지연 편집 '+Date.now(),blocks=Array.from({length:10000},(_,i)=>`<p><strong>한글😀 ${i}</strong> 본문</p>`);
const note=await rpc('save',{note:{title,content:blocks.join(''),text:'검사'}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));let fullReads=0,allowFull=false,denySave=false;let release=null,entered=null;
await page.route('**/api/rpc',async route=>{
 const req=route.request().postDataJSON();
 if(req.id===note.id && ['get','revision_body','document_render'].includes(req.op)){fullReads++;if(!allowFull)return route.fulfill({status:403,json:{ok:false,error:'unexpected full body read'}});}
 if(req.op==='document_splice_html'){
   assert.ok(Array.isArray(req.edits));assert.ok(JSON.stringify(req).length<4096);
   if(denySave)return route.fulfill({status:503,json:{ok:false,error:'offline'}});
   if(entered){const signal=entered;entered=null;await new Promise(resolve=>{release=resolve;signal();});}
 }
 await route.continue();
});
const at=n=>page.waitForFunction(n=>document.querySelector('[data-window-start]')?.getAttribute('data-window-start')===String(n),n);
const saves=trackSaves(page),saved=()=>saves.saved();
const jump=async n=>{await page.getByLabel('이동할 블록 번호').fill(String(n+1));await page.getByRole('button',{name:'이동',exact:true}).click();await at(n);};
try{
 await page.goto(process.env.INKISM_LAZY_FLAG==='1'?base:base+'/?virtual=1&lazy=1');await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await at(0);assert.equal(fullReads,0);
 await jump(5000);await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');
 const inFlight=new Promise(resolve=>entered=resolve);
 await page.keyboard.insertText('첫입력 ');await page.keyboard.press('Control+s');await inFlight;
 await page.keyboard.insertText('후속입력 ');release();await page.keyboard.press('Control+s');await saved();
 let stored=await rpc('get',{id:note.id});assert.ok(stored.content.includes('첫입력 후속입력 '));assert.equal(fullReads,0);
 await jump(9000);await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('먼구간 ');await page.keyboard.press('Control+s');await saved();
 await page.keyboard.press('Control+z');await saved();assert.equal((await rpc('get',{id:note.id})).content.includes('먼구간 '),false);
 await page.keyboard.press('Control+z');await at(5000);await saved();
 await page.keyboard.press('Control+y');await saved();assert.ok((await rpc('get',{id:note.id})).content.includes('첫입력'));
 assert.equal(fullReads,0);
 // Metadata changes advance the same queue revision without fetching a body.
 // The note action menu was removed; the inspector's favorite toggle is the metadata entry point.
 // It is controlled by the stored note, so it turns checked only after the metadata RPC.
 const favorite=page.getByRole('checkbox',{name:'즐겨찾기',exact:true});await favorite.click();await page.waitForFunction(el=>el.checked,await favorite.elementHandle());
 for(let i=0;i<100 && !(await rpc('get',{id:note.id})).favorite;i++)await new Promise(r=>setTimeout(r,20));
 await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('메타이후 ');await page.keyboard.press('Control+s');await saved();
 assert.ok((await rpc('get',{id:note.id})).content.includes('메타이후'));
 assert.equal(fullReads,0);
 // Native close flushes a partial draft; restart restores it without a full get.
 await page.route('**/api/close',route=>route.fulfill({status:200,body:'{}'}));
 await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('닫기보존 ');
 const closed=page.waitForResponse('**/api/close');await page.evaluate(()=>window.dispatchEvent(new Event('native-close-request')));await closed;
 assert.ok((await rpc('get',{id:note.id})).content.includes('닫기보존'));
 await page.reload();await at(5000);assert.ok((await page.locator('.tiptap-prose').textContent()).includes('닫기보존'));assert.equal(fullReads,0);
 // Failed save keeps the local window; explicit copy may read the full body.
 denySave=true;await page.locator('.tiptap-prose p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('실패보존 ');await page.keyboard.press('Control+s');await page.getByRole('button',{name:'다시 저장',exact:true}).waitFor();
 await page.getByRole('button',{name:'다음 구간',exact:true}).click();await page.locator('.window-error').filter({hasText:'저장하지 못해 현재 구간을 유지'}).waitFor();await at(5000);
 allowFull=true;await page.getByRole('button',{name:'문서 전체 복사',exact:true}).click();await page.getByText('문서 전체를 복사했습니다.',{exact:true}).waitFor();
 const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(copied.includes('실패보존'));assert.ok(copied.includes('한글😀 9999'));assert.equal(fullReads,1);
 denySave=false;await page.keyboard.press('Control+s');await saved();
 await page.getByRole('button',{name:'HTML',exact:true}).click();await page.locator('.cm-editor').waitFor();assert.equal(fullReads,2);
 assert.deepEqual(errors,[]);console.log('PASS: no whole-body reads during lazy opening/edit/save/history; typing during save, failed-save retention, explicit full copy and source mode');
}catch(e){console.error({errors,fullReads,state:await page.evaluate(()=>({title:document.querySelector<any>('.title-input')?.value,status:document.querySelector('.status-save')?.textContent,error:document.querySelector('.window-error')?.textContent,offset:document.querySelector('[data-window-start]')?.getAttribute('data-window-start')}))});throw e;}finally{await browser.close();}
