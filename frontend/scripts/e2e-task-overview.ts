import {chromium} from './browser-env.ts';
import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{const e=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(e.ok,true,JSON.stringify(e));return e.data;};
const html=await rpc('save',{note:{title:'Project checklist',content:'<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>공유 초안</p></li><li data-type="taskItem" data-checked="true"><p>배포 준비</p></li></ul>',content_format:'html',tags:['work']}});
const md=await rpc('save',{note:{title:'Markdown checklist',content:'- [ ] 공유 초안\n  - [x] Child done\n\n```\n- [ ] Code only\n```',content_format:'markdown'}});
const hidden=await rpc('save',{note:{title:'Locked candidate',content:'<ul data-type="taskList"><li data-type="taskItem"><p>Secret task</p></li></ul>',content_format:'html'}});
const locked=await rpc('save',{note:{title:'Real locked checklist',content:'<ul data-type="taskList"><li data-type="taskItem"><p>Locked actual</p></li></ul>',content_format:'html'}});
await rpc('vault_create',{password:'test-password-123'});await rpc('vault_lock_note',{id:locked.id,revision:locked.revision});
const trashed=await rpc('save',{note:{title:'Trash checklist',content:'- [ ] Trashed task',content_format:'markdown'}});await rpc('patch',{id:trashed.id,changes:{trashed:true}});
const broken=await rpc('save',{note:{title:'Unread candidate',content:'<p>unread</p>',content_format:'html'}});
for(let i=0;i<101;i++)await rpc('save',{note:{title:'Padding '+i,content:'- [ ] literal',content_format:'text'}});
await rpc('workspace_set',{ids:[html.id],active:html.id,locations:{}});
const original=await rpc('get',{id:html.id}),originalMd=await rpc('get',{id:md.id});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
 let fail=true,delay=false,pages=0,hiddenReads=0;
 await p.route('**/api/rpc',async route=>{
  const req=route.request().postDataJSON();
  if(req.op==='get'&&[hidden.id,locked.id,trashed.id].includes(req.id))hiddenReads++;
  if(req.op==='get'&&req.id===broken.id&&fail)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic unavailable'})});
  if(req.op==='list'&&req.limit===100){pages++;if(delay)await new Promise(r=>setTimeout(r,1000));const response=await route.fetch();const e=await response.json();e.data.items=e.data.items.map((n:any)=>n.id===hidden.id?{...n,locked:true}:n);return route.fulfill({response,json:e}).catch(()=>{});}
  await route.continue();
 });
 await p.goto(base);await libraryTool(p,'할 일 모아보기');
 const panel=p.getByRole('region',{name:'할 일 모아보기',exact:true});
 const finished=()=>panel.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor();await finished();
 assert.ok(pages>=2);assert.equal(hiddenReads,0);assert.equal(await panel.locator('li').count(),2);await panel.getByText('읽지 못한 노트: 1. 큰 문서는 원문에서 확인해 주세요.',{exact:true}).waitFor();
 await panel.getByLabel('완료 상태',{exact:true}).selectOption('done');assert.equal(await panel.locator('li').count(),2);
 await panel.getByLabel('완료 상태',{exact:true}).selectOption('all');assert.equal(await panel.locator('li').count(),4);
 await panel.getByLabel('할 일 검색',{exact:true}).fill('work');assert.equal(await panel.locator('li').count(),2);
 await panel.getByLabel('할 일 검색',{exact:true}).fill('not found');await panel.getByText('표시할 할 일이 없습니다.',{exact:true}).waitFor();
 await panel.getByLabel('할 일 검색',{exact:true}).fill('');fail=false;await panel.getByRole('button',{name:'다시 불러오기',exact:true}).click();await finished();assert.equal(await panel.getByRole('alert').count(),0);
 await p.setViewportSize({width:390,height:844});assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await p.screenshot({path:'/tmp/inkism-tasks-mobile.png'});
 delay=true;await panel.getByRole('button',{name:'다시 불러오기',exact:true}).click();await panel.getByRole('button',{name:'취소',exact:true}).click();await p.waitForTimeout(1200);assert.equal(await panel.locator('li').count(),0);await panel.getByRole('status').getByText(/중단됨/).waitFor();
 delay=false;await panel.getByRole('button',{name:'다시 불러오기',exact:true}).click();await finished();
 await p.setViewportSize({width:1440,height:1000});await p.screenshot({path:'/tmp/inkism-tasks-desktop.png'});
 const row=panel.getByRole('button',{name:'공유 초안 Markdown checklist',exact:true});await row.focus();await p.keyboard.press('Enter');await panel.waitFor({state:'detached'});await p.locator('[role=tab][aria-selected=true]').filter({hasText:'Markdown checklist'}).waitFor();
 assert.equal((await rpc('get',{id:html.id})).content,original.content);assert.equal((await rpc('get',{id:html.id})).revision,original.revision);assert.equal((await rpc('get',{id:md.id})).content,originalMd.content);assert.deepEqual(errors,[]);
 await rpc('save',{note:{title:'Bounded checklist',content:'<ul data-type="taskList">'+Array.from({length:5001},(_,i)=>`<li data-type="taskItem" data-checked="false"><p>Task ${i}</p></li>`).join('')+'</ul>',content_format:'html'}});
 await libraryTool(p,'할 일 모아보기');await finished();assert.equal(await panel.locator('li').count(),5000);await panel.getByText('할 일 5,000개까지 표시합니다. 나머지는 원문에서 확인해 주세요.',{exact:true}).waitFor();
 await p.getByRole('dialog',{name:'라이브러리 도구',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();

 console.log('PASS task overview: pagination, duplicate/nested HTML/Markdown tasks, status/tag/text filters, locked exclusion, read failure/retry, cancellation, keyboard open, narrow layout and unchanged originals and 5000-row limit');
}finally{await browser.close();}
