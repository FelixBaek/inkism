import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48131';
const rpc=async(op,args={})=>{const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));return body.data;};
const source='\ufeff# 원문 미리보기\r\n\r\n**굵은 글자** 한글 😀\r\n<script>globalThis.pwned=true</script>\r\n';
const note=await rpc('save',{note:{title:'미리보기 검증 '+Date.now(),content:source,content_format:'markdown',tags:[]}});
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
let renders=0;page.on('request',r=>{if(r.url().includes('/api/export/'))renders++;});
const dialog=()=>page.getByRole('dialog',{name:'내보내기',exact:true});
async function exportAs(format){await dialog().getByRole('radio',{name:format,exact:true}).check();}
async function openPreview(){await page.keyboard.press('Control+Shift+P').then(()=>page.getByRole('option',{name:'미리보기',exact:true}).click());await dialog().getByRole('button',{name:'미리보기',exact:true}).click();}
async function downloaded(label){const wait=page.waitForEvent('download');if(label==='원문 내보내기'){await page.keyboard.press('Control+Shift+P');await page.getByRole('option',{name:'Export as',exact:true}).click();await exportAs('원문');await dialog().getByRole('button',{name:'원문 내보내기',exact:true}).click();}else await page.getByRole('button',{name:label,exact:true}).click();const file=await wait;if(label==='원문 내보내기')await dialog().getByRole('button',{name:'미리보기 닫기',exact:true}).click();const stream=await file.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);return {name:file.suggestedFilename(),bytes:Buffer.concat(chunks)};}
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await page.getByLabel('노트 제목',{exact:true}).waitFor();assert.equal(renders,0,'opening source does not render');
 const raw=await downloaded('원문 내보내기');assert.ok(raw.name.endsWith('.md'));assert.deepEqual(raw.bytes,Buffer.from(source));assert.equal(renders,0,'raw export does not render');
 await openPreview();await dialog().locator('iframe').waitFor();
 const preview=page.frameLocator('iframe[title="저장된 원문의 미리보기"]');await preview.getByText('굵은 글자',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);
 await exportAs('서식 HTML');const formatted=await downloaded('서식 HTML 내보내기');assert.ok(formatted.name.endsWith('.html'));assert.match(formatted.bytes.toString(),/Content-Security-Policy/);assert.doesNotMatch(formatted.bytes.toString(),/<script[\s>]/i);
 await page.route('**/api/export/pdf',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic PDF unavailable'})}));await exportAs('PDF');await page.getByRole('button',{name:'PDF 내보내기',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'synthetic PDF unavailable'}).waitFor();await page.unroute('**/api/export/pdf');
 await page.getByRole('button',{name:'미리보기 닫기',exact:true}).click();assert.equal((await rpc('get',{id:note.id})).content,source);
 let delayed;await page.route('**/api/export/html',async route=>{await new Promise(resolve=>{delayed=resolve;});try{await route.continue();}catch{}});
 await openPreview();await dialog().getByRole('status').waitFor();await dialog().getByRole('button',{name:'작업 취소',exact:true}).click();assert.equal(await dialog().locator('iframe').count(),0);delayed?.();await page.getByRole('button',{name:'미리보기 닫기',exact:true}).click();await page.unroute('**/api/export/html');
 // Failed saves use the current draft-recovery download, not the saved-source export.
 await page.route('**/api/rpc',route=>{const op=route.request().postDataJSON().op;return ['save','patch','document_splice','document_splice_html','document_splice_source'].includes(op)?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic disk failure'})}):route.continue();});
 await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('미저장 복구');
 await openPreview();await dialog().getByRole('alert').filter({hasText:'저장하지 못했습니다'}).waitFor();await page.getByRole('button',{name:'미리보기 닫기',exact:true}).click();
 const rescued=JSON.parse((await downloaded('미저장 편집 파일로 보관')).bytes.toString());assert.equal(rescued.body.kind,'complete');assert.equal(rescued.body.content,source+'미저장 복구');assert.equal((await rpc('get',{id:note.id})).content,source);
 await page.unroute('**/api/rpc');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 // Saved-source export reads the whole note; unsaved partial edits use a recovery file.
 const largeSource=Array.from({length:4500},(_,i)=>`<p>구간 원문 ${i} 한글 😀 &amp; 본문</p>`).join('');
 const large=await rpc('save',{note:{title:'구간 내보내기 '+Date.now(),content:largeSource,content_format:'html'}});await rpc('wait_index');
 await page.goto(base+'/?virtual=1&lazy=1');await page.getByRole('button',{name:'노트 열기: '+large.title,exact:true}).click();
 await page.getByRole('button',{name:'텍스트',exact:true}).click();await page.getByTestId('windowed-rich-editor').locator('.tiptap').waitFor();
 let bodyReads=0;page.on('request',r=>{if(r.url().endsWith('/api/rpc')){const req=r.postDataJSON();if(req.op==='get'&&req.id===large.id)bodyReads++;}});
 const complete=await downloaded('원문 내보내기');assert.ok(complete.name.endsWith('.html'));assert.deepEqual(complete.bytes,Buffer.from(largeSource));assert.ok(bodyReads<=1,'export reads the body at most once');const exportReads=bodyReads;
 await page.route('**/api/rpc',route=>{const req=route.request().postDataJSON();return ['save','patch','document_splice','document_splice_html','document_splice_source'].includes(req.op)?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic disk failure'})}):route.continue();});
 await page.getByTestId('windowed-rich-editor').locator('.tiptap').click();await page.keyboard.press('Control+Home');
 // Windowed Ctrl+Home is asynchronous (flush, then navigate to the first window); type only once the caret reached the document start.
 await page.waitForFunction(()=>{const s=getSelection(),p=document.querySelector('[data-testid="windowed-rich-editor"] .tiptap p');return Boolean(p&&s.anchorOffset===0&&p.contains(s.anchorNode)&&p.textContent.startsWith('구간 원문 0 '));});
 await page.keyboard.insertText('미저장 복구😀 ');await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('bad'));
 const recovered=JSON.parse((await downloaded('미저장 편집 파일로 보관')).bytes.toString());assert.equal(recovered.body.kind,'partial');let rebuilt=Buffer.from(largeSource);for(const edit of recovered.body.edits){const end=edit.start+Buffer.byteLength(edit.expected);assert.equal(rebuilt.subarray(edit.start,end).toString(),edit.expected);rebuilt=Buffer.concat([rebuilt.subarray(0,edit.start),Buffer.from(edit.replacement),rebuilt.subarray(end)]);}const changedTag=rebuilt.toString().match(/^<p id="ink-block-[a-f0-9-]+">/)?.[0];assert.ok(changedTag,'only the edited first block gains an identity');assert.equal((rebuilt.toString().match(/ id="ink-block-/g)||[]).length,1);assert.equal(rebuilt.toString(),largeSource.replace('<p>',changedTag+'미저장 복구😀 '));assert.equal(bodyReads,exportReads,'rescue does not read the body');
 assert.equal((await rpc('get',{id:large.id})).content,largeSource,'raw rescue must not save or change the baseline');
 console.log('PASS preview/export: raw BOM/CRLF bytes, no implicit rendering, real safe HTML preview/export, PDF error, cancellation, and complete/partial unsaved-source rescue without mutating stored notes');
}finally{await browser.close();}
