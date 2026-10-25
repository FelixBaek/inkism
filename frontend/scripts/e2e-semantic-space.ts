import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const rpc=async(op:string,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const endpoint=(port:number)=>`http://127.0.0.1:${port}/v1/chat/completions`;
const space=(port:number,model:string,dimensions:number)=>'semantic-v1:'+createHash('sha256').update(JSON.stringify([`http://127.0.0.1:${port}/v1/embeddings`,model,dimensions])).digest('hex');
await rpc('save',{note:{title:'Server identity',content:'<p>Unique original content for switching servers.</p>',content_format:'html'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.ai.config',JSON.stringify({endpoint:'http://127.0.0.1:49998/v1/chat/completions',model:'chat',embedModel:'same',enabled:true}));});
 let entered!:()=>void,release!:()=>void;
 const held=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 let dimensions=3;
 await page.route(/^http:\/\/127\.0\.0\.1:4999[89]\/v1\/embeddings/,async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const {input}=JSON.parse(request.postData()!);const old=request.url().includes(':49998/');
  if(old&&input.some((text:string)=>text.includes('Unique original'))){entered();await gate;}
  const dim=old?2:dimensions;
  await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({data:input.map((_:string,index:number)=>({index,embedding:Array.from({length:dim},(_,i)=>i===0?1:0)}))})}).catch(()=>{});
 });
 await page.goto(base);await held;
 await page.getByRole('button',{name:'설정 열기',exact:true}).click();
 await page.locator('.settings-nav').getByRole('button',{name:'AI 연결',exact:true}).click();
 await page.getByLabel('AI 요청 주소',{exact:true}).fill(endpoint(49999));
 await page.getByRole('button',{name:'AI 연결 저장',exact:true}).click();release();
 const waitIndexed=async(model:string)=>{for(let i=0;i<150;i++){const s=await rpc('semantic_status',{model});if(s.indexed===1&&s.pending===0)return;await page.waitForTimeout(100);}assert.fail('namespace did not finish indexing: '+model);};
 await waitIndexed(space(49999,'same',3));
 assert.deepEqual(await rpc('semantic_status',{model:space(49998,'same',2)}),{indexed:0,pending:1},'late old-server response cannot become a completed index');
 assert.equal((await rpc('semantic_search',{model:space(49999,'same',3),vector:[1,0,0],limit:3})).items.length,1);
 // Same address/name but a changed dimension is detected on explicit rebuild.
 dimensions=4;await page.getByRole('button',{name:'의미 색인 다시 만들기',exact:true}).click();
 await waitIndexed(space(49999,'same',4));
 assert.equal((await rpc('semantic_search',{model:space(49999,'same',3),vector:[1,0,0],limit:3})).items.length,0);
 await page.getByLabel('임베딩 모델 (선택)',{exact:true}).fill('second-model');
 await page.getByRole('button',{name:'AI 연결 저장',exact:true}).click();
 await waitIndexed(space(49999,'second-model',4));
 assert.deepEqual(errors,[]);
 console.log('PASS semantic spaces: switch while embedding, reject old result, reindex same name on new server, dimension rebuild, model change');
}finally{await browser.close();}
