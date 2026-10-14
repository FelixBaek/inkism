import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL || 'http://127.0.0.1:49349';
const rpc=async(op:string,args={})=>{const e=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})}).then(r=>r.json());assert.equal(e.ok,true,JSON.stringify(e));return e.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');localStorage.setItem('inkism.ai.config',JSON.stringify({enabled:true,endpoint:'http://127.0.0.1:49999/chat',model:'test-model'}));});
const dialog=page.getByRole('dialog',{name:'용어 설명',exact:true});
async function until(fn:()=>Promise<boolean>){for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(80);}throw Error('condition timed out');}
async function select(word:string){await page.locator('.tiptap[contenteditable=true]').first().evaluate((root,word)=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const at=n.textContent?.indexOf(word)??-1;if(at>=0){(root as HTMLElement).focus();const range=document.createRange();range.setStart(n,at);range.setEnd(n,at+word.length);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));return;}}throw Error('Missing term '+word);},word);await page.waitForTimeout(100);}
async function open(word:string){await select(word);await page.keyboard.press('Control+g');await dialog.waitFor();}
async function save(){await dialog.getByRole('button',{name:'설명 저장',exact:true}).click();await dialog.waitFor({state:'hidden'});}
async function edit(){await page.locator('.tiptap [data-term-id]').first().click();await dialog.getByRole('button',{name:'설명 수정',exact:true}).click();}
try{
 const note=await rpc('save',{note:{title:'Term definition integration',content:'<p>에이전트는 도구를 선택한다. cache는 임시 저장소다.</p>',content_format:'html'}});
 const count=(await rpc('list',{view:'all',limit:100})).items.length;
 await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});await page.goto(base);await page.locator('.tiptap[contenteditable=true]').waitFor();
 await open('에이전트');await dialog.getByLabel('짧은 설명',{exact:true}).fill('목표를 이루기 위해 판단하고 도구를 사용하는 AI 시스템.');await save();
 await until(async()=>/data-term-definition/.test((await rpc('get',{id:note.id})).content));
 assert.equal((await rpc('list',{view:'all',limit:100})).items.length,count,'short definition must not create a note');
 await page.reload();await page.locator('.tiptap [data-term-id]').waitFor();assert.equal(await page.locator('.tiptap [data-term-id]').count(),1);
 await edit();await dialog.locator('summary').click();await dialog.getByLabel('용어집에도 저장',{exact:true}).check();await save();
 await until(async()=>/data-term-glossary-id/.test((await rpc('get',{id:note.id})).content));
 let glossary=(await rpc('knowledge_settings_get')).glossary;assert.equal(glossary.length,1);
 await edit();await dialog.locator('summary').click();await dialog.getByLabel('설명을 새 노트로 확장',{exact:true}).check();await save();
 await until(async()=>/data-term-note-id/.test((await rpc('get',{id:note.id})).content));
 const content=(await rpc('get',{id:note.id})).content;const linked=content.match(/data-term-note-id="([^"]+)"/)![1];
 assert.equal((await rpc('get',{id:linked})).title,'에이전트');assert.equal((await rpc('list',{view:'all',limit:100})).items.length,count+1);
 assert.equal((await rpc('knowledge_settings_get')).glossary[0].noteId,linked,'expansion preserves glossary detail link');
 // A generic AI answer stays a preview until the user explicitly saves it.
 await page.route('http://127.0.0.1:49999/chat',async route=>{await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({choices:[{message:{content:'cache: 재사용할 데이터를 잠시 보관하는 저장소.'}}]})});});
 await open('cache');await dialog.getByRole('button',{name:'AI로 설명',exact:true}).click();await dialog.getByText('AI 초안입니다. 확인한 뒤 저장하세요.',{exact:true}).waitFor();
 assert.doesNotMatch((await rpc('get',{id:note.id})).content,/cache: 재사용/);await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.doesNotMatch((await rpc('get',{id:note.id})).content,/cache: 재사용/);
 await open('cache');await dialog.getByRole('button',{name:'AI로 설명',exact:true}).click();await dialog.getByText('AI 초안입니다. 확인한 뒤 저장하세요.',{exact:true}).waitFor();await save();
 await until(async()=>/cache: 재사용/.test((await rpc('get',{id:note.id})).content));
 // Unlink/remove the annotation only; the promoted note and glossary remain.
 await edit();await dialog.getByRole('button',{name:'본문 설명 제거',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await until(async()=>!new RegExp('data-term-note-id="'+linked+'"').test((await rpc('get',{id:note.id})).content));
 assert.equal((await rpc('get',{id:linked})).title,'에이전트');assert.equal((await rpc('knowledge_settings_get')).glossary.length,1);
 // Mobile popup stays on screen, including the expanded glossary area.
 await page.setViewportSize({width:390,height:844});await open('에이전트');await dialog.locator('summary').click();
 await until(async()=>{const box=await dialog.boundingBox();return !!box && box.x>=0 && box.x+box.width<=390 && box.y>=0 && box.y+box.height<=844;});
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 // Without a selection, Ctrl+G must leave the editor alone.
 await page.mouse.move(0,0);await select('에이전트');await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.keyboard.press('Control+g');assert.equal(await dialog.count(),0);
 // Hover card: shows on hover without a title, hides after the pointer leaves; the eraser removes the mark undoably.
 const term=page.locator('.tiptap [data-term-id]').first();
 await term.hover();await dialog.waitFor();assert.equal(await dialog.getByText('용어 설명',{exact:true}).count(),0);
 assert.ok((await dialog.boundingBox())!.width<=280,'hover card stays small');
 await page.mouse.move(2,2);await dialog.waitFor({state:'hidden'});
 await term.hover();await dialog.getByRole('button',{name:'설명 제거',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(await page.locator('.tiptap [data-term-id]').count(),0);
 await page.locator('.tiptap[contenteditable=true]').first().focus();await page.keyboard.press('Control+z');await page.locator('.tiptap [data-term-id]').first().waitFor();
 // A read-only document still exposes saved definitions, but never edit controls.
 const saved=await rpc('get',{id:note.id});await rpc('patch',{id:note.id,revision:saved.revision,changes:{readonly:true},summary_only:true});
 await page.reload();await page.locator('.tiptap [data-term-id]').first().click();await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'설명 수정',exact:true}).count(),0);await page.keyboard.press('Escape');
 const md=await rpc('save',{note:{title:'Term markdown integration',content:'에이전트는 도구를 사용한다.\n',content_format:'markdown'}});
 await rpc('workspace_set',{ids:[md.id],active:md.id,locations:{}});await page.setViewportSize({width:1440,height:1000});await page.reload();await page.getByRole('button',{name:'노트 열기: '+md.title,exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();await page.locator('.tiptap[contenteditable=true]').waitFor();
 await open('에이전트');await dialog.getByLabel('짧은 설명',{exact:true}).fill('문맥을 읽고 행동하는 시스템.');await save();
 await until(async()=>/data-term-definition/.test((await rpc('get',{id:md.id})).content));await page.reload();await page.getByRole('button',{name:'텍스트',exact:true}).click();await page.locator('.tiptap [data-term-id]').waitFor();assert.equal((await rpc('get',{id:md.id})).content_format,'markdown');
 assert.deepEqual(errors,[]);console.log('PASS term UI: inline persistence/reopen, no implicit notes, glossary, note expansion, AI preview/cancel/save, annotation-only removal, mobile bounds');
}finally{await browser.close();}
