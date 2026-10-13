import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const note=await rpc('save',{note:{title:'Named version UI',content:'<p>original exact content</p>'}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','true');});await page.goto(base);
 const open=async()=>page.getByRole('button',{name:'전체 버전 기록 보기',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'버전 기록',exact:true});await open();
 await dialog.getByLabel('버전 이름',{exact:true}).fill('Release one');await dialog.getByRole('button',{name:'현재 버전 보관',exact:true}).click();await dialog.getByRole('button',{name:/보관: Release one/}).waitFor();
 let h=(await rpc('history',{id:note.id})).find(x=>x.label==='Release one');assert.ok(h);assert.equal((await rpc('get',{id:note.id})).revision,note.revision);
 await dialog.getByLabel('버전 이름',{exact:true}).fill('Release approved');await dialog.getByRole('button',{name:'버전 이름 변경',exact:true}).click();await dialog.getByRole('button',{name:/보관: Release approved/}).waitFor();
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();let current=await rpc('get',{id:note.id});await rpc('save',{note:{...current,content:'<p>later version</p>'}});await page.reload();await open();
 await dialog.getByRole('button',{name:/보관: Release approved/}).click();await dialog.getByRole('button',{name:'사본으로 저장',exact:true}).waitFor({state:'visible'});await dialog.getByRole('button',{name:'사본으로 저장',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[aria-label="노트 제목"]')?.value.includes('이전 버전 사본'));
 const list=await rpc('list',{view:'all'});const copy=list.items.find(x=>x.title.includes('이전 버전 사본'));assert.equal((await rpc('get',{id:copy.id})).content,note.content);assert.equal((await rpc('get',{id:note.id})).content,'<p>later version</p>');
 await page.getByRole('button',{name:'노트 열기: '+note.title,exact:true}).click();await open();await dialog.getByRole('button',{name:/보관: Release approved/}).click();await dialog.getByRole('button',{name:'이 버전으로 되돌리기',exact:true}).click();await page.getByRole('dialog',{name:'버전 복원',exact:true}).getByRole('button',{name:'복원',exact:true}).click();
 let deadline=Date.now()+10000;while(Date.now()<deadline){if((await rpc('get',{id:note.id})).content===note.content)break;await new Promise(r=>setTimeout(r,50));}assert.equal((await rpc('get',{id:note.id})).content,note.content);
 await page.reload();await open();await dialog.getByRole('button',{name:/보관: Release approved/}).click();await dialog.getByRole('button',{name:'선택한 보관 버전 삭제',exact:true}).click();await dialog.getByRole('button',{name:/보관: Release approved/}).waitFor({state:'hidden'});assert.equal((await rpc('history',{id:note.id})).some(x=>x.id===h.id),false);assert.equal((await rpc('get',{id:note.id})).content,note.content);assert.deepEqual(errors,[]);
 console.log('PASS named version creation/rename/reload/exact snapshot copy/restore/delete through real history UI; canonical source preserved');
}finally{await browser.close();}
