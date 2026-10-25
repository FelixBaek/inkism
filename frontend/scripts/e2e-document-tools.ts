import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import {waitForAsync} from './async-browser-condition.ts';
import assert from 'node:assert/strict';

const base=process.env.INKISM_URL||'http://127.0.0.1:49324';
const rpc=async(op:string,args:any={})=>{const res=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const env=await res.json();assert.equal(env.ok,true,JSON.stringify(env));return env.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
const dialog=page.getByRole('dialog',{name:'지식 도구',exact:true});const close=()=>dialog.getByRole('button',{name:'닫기',exact:true}).click();
try{
 const parent=await rpc('save',{note:{title:'Document design',content:'<p id="existing-block">Original paragraph</p><p>Another paragraph</p><p>Prepare this paragraph</p>',content_format:'html'}});
 await rpc('workspace_set',{ids:[parent.id],active:parent.id,locations:{}});await page.goto(base);await page.locator('.tiptap').waitFor();
 await page.getByRole('button',{name:'문서 설정',exact:true}).click();await page.getByRole('radiogroup',{name:'문서 너비',exact:true}).getByRole('radio',{name:'전체 너비',exact:true}).check();await page.getByRole('radiogroup',{name:'문단 간격',exact:true}).getByRole('radio',{name:'여유롭게',exact:true}).check();await page.getByRole('radiogroup',{name:'문서 배경',exact:true}).getByRole('radio',{name:'부드럽게',exact:true}).check();
 await page.locator('.editor-pane[data-document-width="full"]').waitFor();assert.equal((await rpc('get',{id:parent.id})).content,parent.content);assert.equal(await page.locator('.rich-editor').evaluate(el=>getComputedStyle(el).maxWidth),'none');
 await page.getByRole('button',{name:'스타일 메뉴',exact:true}).click();
 await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitem');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='문서 스타일 이름');
 await page.getByRole('textbox',{name:'문서 스타일 이름',exact:true}).fill('Keyboard style');await page.keyboard.press('Enter');
 await waitForAsync(page,async({base})=>{const e=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'knowledge_settings_get'})})).json();return e.data.style_presets.some((p:any)=>p.name==='Keyboard style');},{base});
 await page.getByRole('textbox',{name:'하위 페이지 제목',exact:true}).fill('Child page');await page.getByRole('button',{name:'하위 페이지 만들기',exact:true}).click();await page.getByRole('navigation',{name:'하위 페이지',exact:true}).getByRole('button',{name:'Child page',exact:true}).waitFor();
 const child=(await rpc('knowledge_list')).items.find((n:any)=>n.title==='Child page');assert.equal(child.document.parent_id,parent.id);
 await page.getByRole('navigation',{name:'하위 페이지',exact:true}).getByRole('button',{name:'Child page',exact:true}).click();await page.getByRole('navigation',{name:'상위 페이지 경로',exact:true}).getByRole('button',{name:'Document design /',exact:true}).waitFor();
 await page.getByRole('button',{name:'문서 설정',exact:true}).click();await page.getByRole('radiogroup',{name:'카드 크기',exact:true}).getByRole('radio',{name:'크게',exact:true}).check();await page.getByRole('checkbox',{name:'카드 그림자',exact:true}).check();await waitForAsync(page,async({base,id})=>{const e=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'knowledge_get',id})})).json();return e.data.document.card_shadow===true;},{base,id:child.id});
 await libraryTool(page,'속성과 노트 연결');await page.getByRole('button',{name:'속성 추가',exact:true}).click();await page.getByRole('textbox',{name:'속성 이름',exact:true}).fill('Status');await page.getByRole('combobox',{name:'속성 종류',exact:true}).selectOption('select');await page.getByRole('textbox',{name:'선택 항목 (쉼표로 구분)',exact:true}).fill('Todo, Done');await page.getByRole('textbox',{name:'선택 항목 (쉼표로 구분)',exact:true}).press('Tab');await page.getByRole('combobox',{name:'속성 값',exact:true}).selectOption('Todo');await page.getByRole('button',{name:'속성 저장',exact:true}).click();await dialog.getByText('저장됨',{exact:true}).waitFor();
 await page.getByRole('button',{name:'속성 추가',exact:true}).click();const row=page.locator('.knowledge-property').nth(1);await row.getByRole('textbox',{name:'속성 이름',exact:true}).fill('Related');await row.getByRole('combobox',{name:'속성 종류',exact:true}).selectOption('relation');await row.getByRole('listbox',{name:'속성 값',exact:true}).selectOption(parent.id);await page.getByRole('button',{name:'속성 저장',exact:true}).click();await dialog.getByText('저장됨',{exact:true}).waitFor();assert.deepEqual((await rpc('knowledge_get',{id:child.id})).properties[1].value,[parent.id]);await close();
 await page.getByRole('navigation',{name:'상위 페이지 경로',exact:true}).getByRole('button',{name:'Document design /',exact:true}).click();await page.locator('.document-children [data-size="large"][data-shadow]').waitFor();
 await page.locator('.tiptap p').first().click();await page.keyboard.press('End');await page.keyboard.type(' edited');
 // Save and reopen verifies the ID remains in the stored HTML and rich admission.
 await libraryTool(page,'속성과 노트 연결');await page.getByRole('button',{name:'속성 저장',exact:true}).click();await dialog.getByText('저장됨',{exact:true}).waitFor();await close();assert.match((await rpc('get',{id:parent.id})).content,/<p id="existing-block">Original paragraph edited<\/p>/);

 // Create a new stable ID through the actual block action and copy its link.
 await page.locator('.tiptap p').nth(1).click();await page.locator('.tiptap p').nth(1).hover();await page.getByRole('button',{name:'블록 동작',exact:true}).click();await page.getByRole('menuitem',{name:'문단 링크 복사',exact:true}).click();
 let copied='';for(let i=0;i<30;i++){copied=await page.evaluate(()=>navigator.clipboard.readText());if(copied.startsWith('note://'))break;await page.waitForTimeout(100);}
 assert.ok(copied.startsWith(`note://${parent.id}#%5Eink-block-`),copied);
 const blockId=decodeURIComponent(copied.split('#')[1]).slice(1);assert.ok((await rpc('get',{id:parent.id})).content.includes(`id="${blockId}"`));
 await page.locator('.tiptap p').nth(1).hover();await page.getByRole('button',{name:'블록 동작',exact:true}).click();
 await page.getByRole('textbox',{name:'문단 스타일 이름',exact:true}).fill('Reusable paragraph');await page.getByRole('button',{name:'문단 스타일 저장',exact:true}).click();await page.getByRole('button',{name:'Reusable paragraph',exact:true}).waitFor();
 assert.ok((await rpc('knowledge_settings_get')).block_styles.some((x:any)=>x.name==='Reusable paragraph'));
 await page.getByRole('button',{name:'Reusable paragraph',exact:true}).click();
 await libraryTool(page,'속성과 노트 연결');await page.getByRole('button',{name:'이 노트의 문단 링크 준비',exact:true}).click();
 await waitForAsync(page,async({base,id})=>{const x=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'get',id})})).json();return /<p id="ink-block-[^"]+">Prepare this paragraph<\/p>/.test(x.data.content);},{base,id:parent.id});await close();
 await page.reload();await page.locator('.editor-pane[data-document-width="full"]').waitFor();await page.locator('.tiptap p[id="existing-block"]').waitFor();await page.getByRole('button',{name:'문서 설정',exact:true}).click();await page.screenshot({path:'/tmp/inkism-craft-document.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>{const tag=document.querySelector('.note-classification .tag-editor')!.getBoundingClientRect(),mode=document.querySelector('.editor-pane > .meta-right')!.getBoundingClientRect();return mode.top>=tag.bottom||mode.bottom<=tag.top;}),true,'mobile modes overlap tags');await page.screenshot({path:'/tmp/inkism-craft-mobile.png'});assert.deepEqual(errors,[]);
 console.log('PASS document UI: style persistence without body rewrite, child creation/breadcrumb/cards, select/relation editing, persistent block IDs, reload and mobile width');
}finally{await browser.close();}
