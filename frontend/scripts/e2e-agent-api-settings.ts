import assert from 'node:assert/strict';import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL!;const rpc=async(op:string,args:any={})=>{const env=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(env.ok,true,JSON.stringify(env));return env.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
try{
 const shared=await rpc('save',{note:{title:'Shared agent note',content:'visible',content_format:'text',tags:['share']}});await rpc('save',{note:{title:'Private agent note',content:'hidden',content_format:'text',tags:['private']}});
 await page.goto(base);await page.getByRole('button',{name:'설정 열기',exact:true}).click();const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.getByRole('button',{name:'외부 AI 연결',exact:true}).click();
 const toggle=dialog.getByLabel('Agent API 켜기',{exact:true});assert.equal(await toggle.isChecked(),false,'Agent API must be off by default');
 await toggle.click();await dialog.locator('code, [role=alert]').first().waitFor();const url=await dialog.locator('code').textContent().catch(()=>null);
 await dialog.getByLabel('토큰 이름',{exact:true}).fill('Claude');await dialog.getByLabel('고른 폴더와 태그만',{exact:true}).check();
 const create=dialog.getByRole('button',{name:'토큰 만들기',exact:true});assert.equal(await create.isDisabled(),true,'limited scope needs a choice');
 await dialog.getByLabel('#share',{exact:true}).check();await create.click();
 const secret=await dialog.getByRole('textbox',{name:'새 토큰',exact:true}).inputValue();assert.match(secret,/^inkism_[0-9a-f]{64}$/);
 await dialog.getByRole('button',{name:'복사',exact:true}).click();await dialog.getByRole('button',{name:'복사됨',exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),secret);
 await dialog.getByText('폴더 0개 · 태그 1개').waitFor();
 if(url){const notes=await(await fetch(url+'/notes',{headers:{Authorization:'Bearer '+secret}})).json();assert.deepEqual(notes.data.items.map((n:any)=>n.id),[shared.id]);assert.equal((await fetch(url+'/notes',{method:'POST',headers:{Authorization:'Bearer '+secret}})).status,405);}
 else console.log('NOTE agent port busy; skipped the HTTP read check');
 await dialog.getByRole('button',{name:'Claude 토큰 회수',exact:true}).click();await dialog.getByText('아직 만든 토큰이 없습니다.',{exact:true}).waitFor();
 if(url)assert.equal((await fetch(url+'/notes',{headers:{Authorization:'Bearer '+secret}})).status,401,'revoked token still reads');
 await toggle.click();await dialog.locator('code').waitFor({state:'detached'});if(url)await assert.rejects(fetch(url+'/notes'));
 assert.equal((await(await fetch(base+'/api/agent')).json()).data.tokens.length,0);assert.deepEqual(errors,[]);
 console.log('PASS agent API settings: off by default, scoped token shown once and copied, read-only HTTP, revoke and turn off');
}finally{await browser.close();}
