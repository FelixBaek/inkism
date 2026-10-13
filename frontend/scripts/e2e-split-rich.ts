// 분할 오른쪽 창의 서식 편집기(Figma 05): 다른 노트·같은 노트 저장과 충돌, 원문 전환, 제목·태그, 창별 찾기.
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48139';
const rpc=async(op:string,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const stamp=Date.now();
// 서식 편집기는 문단에 블록 ID를 붙인다(왼쪽 편집기와 같음). 비교는 ID를 뺀 본문으로.
const plain=(html:string)=>html.replace(/ id="[^"]*"/g,'');
const body=async(id:string)=>plain((await rpc('get',{id})).content);
const a=await rpc('save',{note:{title:'Rich A '+stamp,content:'<p>left</p>',text:'left'}});
const b=await rpc('save',{note:{title:'Rich B '+stamp,content:'<p>right</p>',text:'right'}});await rpc('wait_index');
await rpc('workspace_set',{ids:[a.id,b.id],active:a.id,locations:{}});
await rpc('split_set',{id:b.id,mode:'source'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const right=page.getByRole('region',{name:'분할 편집기'}),left=page.locator('.split-primary');
const until=async(fn:()=>Promise<boolean>,what:string)=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100);}throw new Error('timeout: '+what);};
const typeRight=async(text:string)=>{await right.locator('.tiptap p').last().click();await page.keyboard.press('End');await page.keyboard.insertText(text);};
const save=()=>right.getByRole('button',{name:'분할 저장',exact:true}).click();
try{
 await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
 await page.goto(base);await page.getByLabel('노트 제목',{exact:true}).waitFor();
 // 1. 다른 노트: 오른쪽은 서식 편집기 + 도구줄 + 제목 + 태그. 저장은 B만 바꾸고 A는 그대로.
 await right.locator('.tiptap').waitFor();await right.getByRole('toolbar',{name:'서식 도구 모음'}).waitFor();
 assert.equal(await right.getByLabel('분할 노트 제목',{exact:true}).inputValue(),b.title);
 assert.equal(await right.getByRole('button',{name:'분할 서식 편집',exact:true}).getAttribute('aria-pressed'),'true');
 await typeRight(' rich');await save();
 await until(async()=>(await body(b.id))==='<p>right rich</p>','B rich save');
 assert.equal((await rpc('get',{id:a.id})).content,'<p>left</p>');
 // 제목·태그도 같은 분할 저장 경로로 간다.
 await right.getByLabel('분할 노트 제목',{exact:true}).fill('Rich B renamed '+stamp);
 await right.locator('.split-tags input').fill('splittag');await page.keyboard.press('Enter');await save();
 await until(async()=>{const n=await rpc('get',{id:b.id});return n.title==='Rich B renamed '+stamp&&n.tags.includes('splittag');},'title/tag save');
 // 2. 원문 전환: 서식에서 막 친 글자도 원문 편집기에 그대로 보이고, 다시 서식으로 돌아와도 남는다.
 await typeRight(' more');await right.getByRole('button',{name:'분할 원문 편집',exact:true}).click();
 await right.locator('.cm-content').waitFor();assert.equal(plain(await right.locator('.cm-content').innerText()),'<p>right rich more</p>');
 await right.getByRole('button',{name:'분할 서식 편집',exact:true}).click();await right.locator('.tiptap').waitFor();
 assert.equal(await right.locator('.tiptap').innerText(),'right rich more');await save();
 await until(async()=>(await body(b.id))==='<p>right rich more</p>','mode switch save');
 // 3. 창별 찾기: 오른쪽에 초점을 두고 Ctrl+F → 오른쪽 찾기 판만 열린다.
 await right.locator('.tiptap').click();await page.keyboard.press('Control+f');
 await right.locator('.find-replace').waitFor();assert.equal(await left.locator('.find-replace').count(),0);await page.keyboard.press('Escape');
 // 4. 같은 노트를 양쪽에: 오른쪽이 먼저 저장하면 왼쪽의 오래된 revision 저장은 충돌로 멈추고 서버 본문을 덮지 않는다.
 await right.getByLabel('분할 노트',{exact:true}).selectOption(a.id);await until(async()=>(await right.getByLabel('분할 노트 제목',{exact:true}).inputValue())===a.title,'open A on right');
 await right.locator('.tiptap').waitFor();await typeRight(' fromRight');await save();
 await until(async()=>(await body(a.id))==='<p>left fromRight</p>','right save on shared note');
 await left.locator('.tiptap p').last().click();await page.keyboard.press('End');await page.keyboard.insertText(' fromLeft');await page.keyboard.press('Control+s');
 await until(async()=>await page.evaluate(()=>document.querySelector<HTMLElement>('.status-save')?.dataset.saveState==='conflict'),'left conflict');
 assert.equal(await body(a.id),'<p>left fromRight</p>');
 // 반대로: 왼쪽이 서버 버전을 쓰면 오른쪽의 오래된 초안 저장은 오른쪽 창 안 경고로 멈춘다.
 await page.getByRole('button',{name:'서버 버전으로 교체',exact:true}).click();
 await until(async()=>await page.evaluate(()=>document.querySelector<HTMLElement>('.status-save')?.dataset.saveState!=='conflict'),'left resolved');
 const before=(await rpc('get',{id:a.id})).revision;
 await rpc('save',{note:{...(await rpc('get',{id:a.id})),content:'<p>server wins</p>',text:'server wins'}});
 await typeRight(' stale');await save().catch(()=>{});
 await right.getByRole('alert').waitFor();
 assert.equal((await rpc('get',{id:a.id})).content,'<p>server wins</p>');assert.ok((await rpc('get',{id:a.id})).revision>before);
 await right.getByRole('alert').getByRole('button',{name:'다시 저장',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS split rich: other-note save isolation, title/tags, rich↔source switch keeps unsaved text, pane-scoped find, shared-note conflicts in both directions without overwriting the server');
}catch(e){console.log('DEBUG',JSON.stringify({b:(await rpc('get',{id:b.id})).content,a:(await rpc('get',{id:a.id})).content,rightHtml:await right.locator('.tiptap').innerHTML().catch(()=>null),alert:await right.getByRole('alert').allInnerTexts(),status:await page.locator('.status-save').innerText()}));throw e;}finally{await browser.close();}
