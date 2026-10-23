import {chromium} from './browser-env.ts';
import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args={})=>{const r=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const notebook=await rpc('save_notebook',{name:'Capture research'});
const original=await rpc('save',{note:{title:'Keep original',content:'Untouched original',content_format:'text'}});
await rpc('workspace_set',{ids:[original.id],active:original.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));await p.goto(base);
 await p.getByRole('button',{name:'빠른 기록',exact:true}).click();
 const d=p.getByRole('dialog',{name:'빠른 기록',exact:true});
 assert.equal(await d.getByRole('button',{name:'저장하고 열기'}).isDisabled(),true);
 const body='  capture needle <p>문자 그대로</p>\n둘째 줄  ';
 await d.getByLabel('기록할 내용',{exact:true}).fill(body);
 await d.getByLabel('제목 (선택)',{exact:true}).fill('Captured note');
 await d.getByLabel('폴더',{exact:true}).selectOption(notebook.id);
 await d.getByLabel('태그 (쉼표로 구분)',{exact:true}).fill('research, 한글, research');
 await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});
 await p.keyboard.press('Control+Shift+N');await d.waitFor();assert.equal(await d.getByLabel('기록할 내용').inputValue(),body);
 let fail=true,loseResponse=false;
 await p.route('**/api/rpc',async route=>{const request=route.request().postDataJSON();if(request.op==='save'&&request.note?.title==='Captured note'){
  if(fail){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'internal: sqlite: database or disk is full'})});return;}
  if(loseResponse){await route.fetch();await route.abort();return;}
 }await route.continue();});
 await d.getByRole('button',{name:'저장하고 열기'}).click();await d.getByRole('alert').waitFor();assert.equal(await d.getByRole('alert').textContent(),'저장 공간이 부족합니다. 저장소가 있는 드라이브의 공간을 확보한 뒤 다시 시도해 주세요.');assert.equal(await d.getByLabel('기록할 내용').inputValue(),body);
 await p.screenshot({path:'/tmp/inkism-capture-desktop.png'});
 await p.setViewportSize({width:390,height:844});assert.equal(await d.evaluate(el=>el.scrollWidth>el.clientWidth+2),false);await p.screenshot({path:'/tmp/inkism-capture-mobile.png'});
 fail=false;loseResponse=true;await d.getByRole('button',{name:'저장하고 열기'}).focus();await p.keyboard.press('Enter');await d.waitFor({state:'hidden'});
 const rows=(await rpc('list',{view:'all'})).items.filter((n:any)=>n.title==='Captured note');assert.equal(rows.length,1);
 const saved=await rpc('get',{id:rows[0].id});assert.equal(saved.content,body);assert.equal(saved.content_format,'text');assert.equal(saved.notebook_id,notebook.id);assert.deepEqual([...saved.tags].sort(),['research','한글'].sort());
 assert.equal((await rpc('get',{id:original.id})).content,'Untouched original');
 await p.unroute('**/api/rpc');await p.setViewportSize({width:1440,height:1000});
 await libraryTool(p,'전체 검색');const search=p.getByRole('region',{name:'전역 검색',exact:true});
 await search.getByLabel('전역 검색어',{exact:true}).fill('capture needle');await search.getByRole('combobox',{name:'태그 조건',exact:true}).selectOption('research');await search.getByRole('combobox',{name:'노트북 조건',exact:true}).selectOption(notebook.id);await search.getByRole('button',{name:'검색',exact:true}).click();await search.getByText('Captured note',{exact:true}).waitFor();
 await p.keyboard.press('Escape');await p.locator('dialog[open]').waitFor({state:'hidden'});await p.keyboard.press('Control+Shift+N');await d.waitFor();await d.getByLabel('기록할 내용').fill('😀'.repeat(81));await d.getByRole('button',{name:'저장하고 열기'}).click();await d.waitFor({state:'hidden'});assert.equal((await rpc('list',{view:'all'})).items.filter((n:any)=>n.title==='😀'.repeat(80)).length,1);
 assert.deepEqual(errors,[]);console.log('PASS quick capture: keyboard, retained input, failed save, lost response reconciliation without duplicates, original untouched, exact text, folder/tag search, narrow layout');
}finally{await browser.close();}
