import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';

const base=process.env.INKISM_URL||'http://127.0.0.1:49320';
const rpc=async(op:string,args={})=>{const res=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const env=await res.json();assert.equal(env.ok,true,JSON.stringify(env));return env.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
const close=()=>page.getByRole('dialog',{name:'지식 도구',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();
const closeGraph=()=>page.getByRole('button',{name:'관계 그래프 닫기',exact:true}).click();
try{
 const target=await rpc('save',{note:{title:'Target '+Date.now(),content:'# Alpha\n\nReferenced content\n\n## Detail\n\nBlock text ^piece\n\n# Other\n\nExcluded section',content_format:'markdown'}});
 const original=await rpc('save',{note:{title:'Knowledge '+Date.now(),content:'<h1>첫 제목</h1><p>Original</p><h2>둘째 제목</h2><p>Text</p>',content_format:'html'}});
 await rpc('workspace_set',{ids:[original.id],active:original.id,locations:{}});await page.goto(base);await page.locator('.tiptap').waitFor();
 await libraryTool(page,'속성과 노트 연결');
 await page.getByRole('textbox',{name:'별칭 (쉼표로 구분)',exact:true}).pressSequentially('alias-one, alias-two');
 await page.getByRole('button',{name:'속성 추가',exact:true}).click();await page.getByRole('textbox',{name:'속성 이름',exact:true}).fill('Score');await page.getByRole('combobox',{name:'속성 종류',exact:true}).selectOption('number');await page.getByRole('spinbutton',{name:'속성 값',exact:true}).fill('42');
 await page.getByRole('button',{name:'속성 저장',exact:true}).click();await page.getByRole('dialog',{name:'지식 도구',exact:true}).getByText('저장됨',{exact:true}).waitFor();
 const meta=await rpc('knowledge_get',{id:original.id});assert.deepEqual(meta.aliases,['alias-one','alias-two']);assert.deepEqual(meta.properties,[{name:'Score',type:'number',value:42}]);assert.equal((await rpc('get',{id:original.id})).content,original.content);
 await page.getByRole('combobox',{name:'연결할 노트',exact:true}).selectOption(target.id);await page.getByRole('combobox',{name:'연결할 제목 또는 문단',exact:true}).selectOption('Alpha');await page.getByRole('checkbox',{name:'내용 가져와 보기',exact:true}).check();await page.getByRole('button',{name:'노트 끝에 연결 추가',exact:true}).click();await page.getByRole('dialog',{name:'지식 도구',exact:true}).getByLabel('참조한 노트 내용',{exact:true}).waitFor();
 assert.match(await page.getByRole('dialog',{name:'지식 도구',exact:true}).getByLabel('참조한 노트 내용',{exact:true}).innerText(),/Referenced content/);assert.doesNotMatch(await page.getByRole('dialog',{name:'지식 도구',exact:true}).getByLabel('참조한 노트 내용',{exact:true}).innerText(),/Excluded section/);
 const changedTarget=await rpc('save',{note:{...target,content:target.content.replace('Referenced content','Updated source')}});await page.getByRole('dialog',{name:'지식 도구',exact:true}).getByRole('button',{name:'참조 새로고침',exact:true}).click();await page.getByRole('dialog',{name:'지식 도구',exact:true}).getByLabel('참조한 노트 내용',{exact:true}).getByText('Updated source',{exact:true}).waitFor();
 await close();
 const preserved=await rpc('get',{id:original.id});await page.locator('.inline-note-embed').first().waitFor();assert.match(await page.locator('.inline-note-embed').first().innerText(),/Referenced content|Updated source/);await page.locator('.inline-note-embed').getByRole('button',{name:'참조 새로고침',exact:true}).click();await page.locator('.inline-note-embed').getByText('Updated source',{exact:true}).waitFor();await page.waitForTimeout(300);assert.deepEqual(await rpc('get',{id:original.id}),preserved,'inline preview mutated canonical body');
 await page.getByRole('button',{name:'관계 그래프',exact:true}).first().click();await page.getByRole('combobox',{name:'표시 범위',exact:true}).selectOption('local');
 // Indexing is asynchronous; explicitly refresh until the saved link is indexed.
 for(let i=0;i<20&&!await page.locator('.note-graph line').count();i++){await page.waitForTimeout(150);await page.getByRole('button',{name:'새로고침',exact:true}).click();}
 assert.ok(await page.locator('.note-graph line').count()>0);assert.equal(await page.locator('.note-graph [data-node]').count(),2);await closeGraph();
 await libraryTool(page,'목차');await page.getByRole('dialog',{name:'목차',exact:true}).getByRole('button',{name:/둘째 제목/}).click();assert.equal(await page.getByRole('dialog',{name:'목차',exact:true}).isVisible(),false);
 await page.keyboard.press('Control+o');await page.getByRole('combobox',{name:'노트 제목 검색',exact:true}).fill(target.title);await page.getByRole('dialog',{name:'빠른 전환',exact:true}).getByRole('option',{name:target.title,exact:true}).click();await page.waitForFunction(title=>(document.querySelector('.title-input') as HTMLInputElement)?.value===title,target.title);
 await libraryTool(page,'일일 노트');await page.waitForTimeout(300);const daily1=await rpc('list',{view:'all',limit:100});await libraryTool(page,'일일 노트');await page.waitForTimeout(300);const daily2=await rpc('list',{view:'all',limit:100});assert.equal(daily1.items.length,daily2.items.length,'daily action duplicated note');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'관계 그래프',exact:true}).first().click();await page.locator('.graph-screen').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await closeGraph();
 assert.deepEqual(errors,[]);console.log('PASS knowledge UI: aliases/properties preserve source, live section embed, actual graph edges, heading navigation, keyboard quick switch, idempotent daily note, mobile width');
}finally{await browser.close();}
