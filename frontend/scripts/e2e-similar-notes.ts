import {chromium} from './browser-env.ts';
import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const space='semantic-v1:'+createHash('sha256').update(JSON.stringify(['http://127.0.0.1:49999/v1/embeddings','emb',2])).digest('hex');
const rpc=async(op:string,args={})=>{const value=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const save=(title:string,content:string)=>rpc('save',{note:{title,content,content_format:'text'}});
const source=await save('Source','cats source text'),related=await save('Related cats','cats related evidence. '.repeat(100)),other=await save('Other topic','budget evidence');
const hidden=await save('Secret cats','cats secret'),trash=await save('Trash cats','cats trash'),archive=await save('Archived cats','cats archive');
await rpc('patch',{id:trash.id,changes:{trashed:true}});await rpc('patch',{id:archive.id,changes:{archived:true}});
await rpc('vault_create',{password:'password123'});await rpc('vault_lock_note',{id:hidden.id,revision:hidden.revision});
await rpc('workspace_set',{ids:[source.id],active:source.id,locations:{}});
const before=await rpc('get',{id:source.id});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.ai.config',JSON.stringify({enabled:true,endpoint:'http://127.0.0.1:49999/v1/chat/completions',model:'chat',embedModel:'emb'}));});
 const sent:string[]=[];
 await p.route('http://127.0.0.1:49999/v1/**',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const texts=route.request().postDataJSON().input as string[];sent.push(...texts);
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({data:texts.map((text,index)=>({index,embedding:text.includes('cats')?[1,0]:[0,1]}))})});
 });
 await p.goto(base);await p.locator('.ProseMirror').first().waitFor();
 for(let i=0;i<200;i++){if((await rpc('semantic_status',{model:space})).pending===0)break;await p.waitForTimeout(100);}
 assert.equal((await rpc('semantic_status',{model:space})).pending,0);
 await libraryTool(p,'비슷한 노트');const panel=p.getByRole('region',{name:'비슷한 노트',exact:true});
 await panel.getByRole('button',{name:'비슷한 노트 찾기',exact:true}).click();
 await panel.getByRole('button',{name:'Related cats',exact:true}).waitFor();
 assert.equal(await panel.locator('li').count(),1);assert.ok((await panel.locator('blockquote').innerText()).includes('cats related evidence'));
 assert.ok(!sent.some(s=>s.includes('secret')||s.includes('trash')));
 await p.screenshot({path:'/tmp/inkism-similar-desktop.png'});
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'/tmp/inkism-similar-mobile.png'});
 assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await p.setViewportSize({width:1440,height:1000});
 // Cancel an actual RPC response held at the browser boundary; it must not repopulate the list.
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 await p.route('**/api/rpc',async route=>{if(route.request().postDataJSON().op!=='semantic_related'){await route.continue();return;}const response=await route.fetch();entered();await held;await route.fulfill({response}).catch(()=>{});});
 await panel.getByRole('button',{name:'비슷한 노트 찾기',exact:true}).click();await started;
 await panel.getByRole('button',{name:'취소',exact:true}).click();release();await p.waitForTimeout(150);
 assert.equal(await panel.locator('li').count(),0);assert.equal(await panel.locator('output').innerText(),'중단됨');
 await p.unroute('**/api/rpc');
 await panel.getByRole('button',{name:'비슷한 노트 찾기',exact:true}).click();await panel.getByRole('button',{name:'Related cats',exact:true}).waitFor();
 await panel.getByRole('button',{name:'Related cats',exact:true}).focus();await p.keyboard.press('Enter');
 await panel.waitFor({state:'hidden'});await p.waitForFunction(()=>document.querySelector('.ProseMirror')?.textContent?.includes('cats related evidence'));
 assert.deepEqual(await rpc('get',{id:source.id}),before);
 assert.equal((await rpc('get',{id:related.id})).content,related.content);
 // Editing a candidate after searching must not open stale evidence.
 await libraryTool(p,'비슷한 노트');
 await panel.getByRole('button',{name:'비슷한 노트 찾기',exact:true}).click();await panel.getByRole('button',{name:'Source',exact:true}).waitFor();
 await rpc('save',{note:{...before,content:'changed source cats'}});
 await panel.getByRole('button',{name:'Source',exact:true}).click();await panel.getByRole('alert').waitFor();
 assert.equal(await panel.locator('li').count(),0);
 await p.locator('.library-more-dialog').getByRole('button',{name:'닫기',exact:true}).click();
 // A source without a complete index is explained instead of presented as no matches.
 await rpc('semantic_reset');await libraryTool(p,'비슷한 노트');
 await panel.getByRole('button',{name:'비슷한 노트 찾기',exact:true}).click();await panel.getByText('이 노트의 의미 색인이 아직 준비되지 않았습니다. 잠시 후 다시 찾아 주세요.',{exact:true}).waitFor();
 await p.locator('.library-more-dialog').getByRole('button',{name:'닫기',exact:true}).click();
 const disconnected=await browser.newPage();
 await disconnected.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.ai.config',JSON.stringify({enabled:false}));});
 await disconnected.goto(base);await disconnected.locator('.ProseMirror').first().waitFor();await libraryTool(disconnected,'비슷한 노트');
 assert.equal(await disconnected.getByRole('region',{name:'비슷한 노트',exact:true}).getByRole('button',{name:'비슷한 노트 찾기',exact:true}).isDisabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS similar notes: actual index, distinct evidence, hidden/archive/source exclusion, cancellation, keyboard open, unchanged source, readiness, desktop/mobile');
}finally{await browser.close();}
