import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:49298';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const stamp=Date.now(),old='preview-'+stamp,target='merged-'+stamp;
const make=async(title,tags=[old])=>rpc('save',{note:{title,content:'<p>Exact '+title+'</p>',text:title,tags}});
const a=await make('active '+stamp,[old,target]),b=await make('trash '+stamp),ro=await make('readonly '+stamp),locked=await make('locked '+stamp);
await rpc('patch',{id:b.id,changes:{archived:true,trashed:true}});await rpc('patch',{id:ro.id,revision:ro.revision,changes:{readonly:true}});
const vault=await rpc('vault_status');assert.equal(vault.exists,false,'run against an isolated fresh database');await rpc('vault_create',{password:'test-password-123'});await rpc('vault_lock_note',{id:locked.id,revision:locked.revision});
await rpc('defaults_set',{tag:old});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{if(window.top===window&&/^https?:$/.test(location.protocol))localStorage.setItem('inkism.lang','ko');});await page.goto(base);
 await page.getByRole('button',{name:'노트 열기: '+a.title,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'태그 변경 미리보기와 기록',exact:true});
 const show=async(detail?:any)=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('inkism-tag-change',{detail})),detail);
 const close=async()=>dialog.getByRole('button',{name:'닫기',exact:true}).click();
 const apply=async()=>dialog.getByRole('button',{name:'확인한 태그 변경 적용',exact:true}).click();
 const receipt=()=>dialog.locator('.tag-change-receipt').filter({hasText:old}).first();
 await show({name:old,replacement:target});await dialog.getByText('변경 2개 · 제외 2개 · 전체 4개',{exact:true}).waitFor();
 assert.equal(await dialog.locator('.tag-change-items li').count(),4);assert.equal(await dialog.locator('.tag-change-items').getByText('읽기 전용',{exact:true}).count(),1);
 assert.ok(await dialog.getByText('새 노트의 기본 태그도 함께 변경합니다.',{exact:false}).isVisible());
 await apply();await dialog.getByRole('status').filter({hasText:'2개 노트의 태그를 변경했습니다.'}).waitFor();
 assert.deepEqual((await rpc('get',{id:a.id})).tags,[target]);assert.deepEqual((await rpc('get',{id:b.id})).tags,[target]);assert.deepEqual((await rpc('get',{id:ro.id})).tags,[old]);
 await receipt().getByRole('button',{name:'이 태그 변경 되돌리기',exact:true}).click();await dialog.getByRole('status').filter({hasText:'이전 태그를 복원했습니다'}).waitFor();
 assert.deepEqual((await rpc('get',{id:a.id})).tags,a.tags);assert.deepEqual((await rpc('get',{id:b.id})).tags,[old]);assert.equal((await rpc('get',{id:a.id})).content,a.content);
 await close();await page.reload();await page.getByRole('tab',{name:'태그',exact:true}).waitFor();await show();await receipt().getByRole('button',{name:'복원됨',exact:true}).waitFor();assert.equal(await receipt().getByRole('button').isDisabled(),true);await close();
 // Adding a matching note after preview invalidates the entire operation.
 await show({name:old,replacement:target});await dialog.getByText('변경 2개 · 제외 2개 · 전체 4개',{exact:true}).waitFor();
 const newer=await make('new target '+stamp);await apply();await dialog.getByRole('alert').waitFor();
 assert.deepEqual((await rpc('get',{id:a.id})).tags,a.tags);assert.deepEqual((await rpc('get',{id:b.id})).tags,[old]);assert.deepEqual((await rpc('get',{id:newer.id})).tags,[old]);
 await dialog.getByRole('button',{name:'태그 변경 미리보기 새로고침',exact:true}).click();await dialog.getByText('변경 3개 · 제외 2개 · 전체 5개',{exact:true}).waitFor();await apply();await dialog.getByRole('status').filter({hasText:'3개 노트의 태그를 변경했습니다.'}).waitFor();
 // A later change to any target makes undo atomic: no unaffected peer is reverted.
 await rpc('patch',{id:newer.id,changes:{color:'#ff0000'}});await receipt().getByRole('button',{name:'이 태그 변경 되돌리기',exact:true}).click();await dialog.getByRole('alert').waitFor();
 assert.deepEqual((await rpc('get',{id:a.id})).tags,[target]);assert.deepEqual((await rpc('get',{id:b.id})).tags,[target]);assert.deepEqual((await rpc('get',{id:newer.id})).tags,[target]);assert.deepEqual(errors,[]);
 console.log('PASS: actual UI preview/exclusions/default notice, exact merge undo, reload history, new-target apply CAS, atomic undo revision conflict');
}finally{await browser.close();}
