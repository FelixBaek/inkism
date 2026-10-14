import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const rpc=async(op:string,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const u=Date.now().toString(36).replace(/\d/g,c=>'abcdefghij'[+c]);
// The fake embedder puts N<u> (note wording) and Q<u> (question wording) on the same axis; keyword search cannot link them.
const content=`<p id="target">N${u} 반려묘는 오후 내내 소파에서 쉰다.</p>`;
const note=await rpc('save',{note:{title:'Pet habits',content,content_format:'html'}});
await rpc('save',{note:{title:'Noise',content:'<p>unrelated budget memo</p>',content_format:'html'}});
const secret=await rpc('save',{note:{title:'Diary',content:`<p>N${u} lockedsecret${u}</p>`,content_format:'html'}});
await rpc('vault_create',{password:'password123'});await rpc('vault_lock_note',{id:secret.id,revision:secret.revision});
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');localStorage.setItem('inkism.ai.config',JSON.stringify({enabled:true,endpoint:'http://127.0.0.1:49999/v1/chat/completions',model:'chat',embedModel:'emb'}));});
 const embedded:string[]=[],chats:string[]=[];
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
 await p.route('http://127.0.0.1:49999/v1/**',async route=>{
  const r=route.request();
  if(r.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
  const body=JSON.parse(r.postData()??'{}');
  if(r.url().endsWith('/embeddings')){
   const input=body.input as string[];embedded.push(...input);
   await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({data:input.map((s,index)=>({index,embedding:[s.includes('N'+u)||s.includes('Q'+u)?1:0,s.includes('budget')?1:0,0.01]}))})});
   return;
  }
  chats.push(r.postData()??'');
  await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({choices:[{message:{content:'소파에서 쉰다고 적혀 있습니다 [1].'}}]})});
 });
 await p.goto(base);await p.locator('.ProseMirror').first().waitFor();
 // Indexing starts with the app; locked notes are not eligible, so two notes complete it.
 for(let i=0;i<100;i++){const s=await rpc('semantic_status',{model:'emb'});if(s.indexed===2&&s.pending===0)break;await p.waitForTimeout(100);}
 assert.deepEqual(await rpc('semantic_status',{model:'emb'}),{indexed:2,pending:0});
 assert.ok(embedded.some(s=>s.includes('N'+u+' 반려묘')),'note chunks were embedded');
 assert.ok(!embedded.some(s=>s.includes('lockedsecret')),'locked note text never sent');
 const stored=(await rpc('semantic_search',{model:'emb',vector:[1,0,0.01],limit:50})).items;
 assert.equal(stored[0].note.id,note.id);assert.ok(stored.every((h:any)=>h.note.id!==secret.id),'locked note never stored');
 await libraryTool(p,'전체 검색');
 await p.getByLabel('전역 검색어',{exact:true}).fill(`Q${u} 습성은 어때?`);
 await p.getByRole('button',{name:'내 노트에 묻기',exact:true}).click();
 const answer=p.locator('.note-answer-text');await answer.waitFor();
 assert.equal(chats.length,1);const user=JSON.parse(chats[0]).messages[1].content as string;
 assert.ok(user.includes('[1] Pet habits\n')&&user.includes(`N${u} 반려묘는`),'semantic-only passage is the cited source');
 assert.ok(!user.includes('lockedsecret'),'locked note never sent to chat');
 const matched=`N${u} 반려묘는 오후 내내 소파에서 쉰다.`.slice(0,30).trimEnd();
 await answer.getByRole('button',{name:'근거 1: Pet habits 열기',exact:true}).click();
 await p.waitForFunction(w=>getSelection()?.toString()===w,matched);
 const at=await p.evaluate(()=>{const n=getSelection()?.anchorNode;return (n instanceof Element?n:n?.parentElement)?.closest('p')?.textContent;});assert.ok(at?.includes('소파에서 쉰다'),String(at));
 assert.deepEqual(errors,[]);
 console.log('PASS semantic answer: background indexing, locked note never embedded or stored, semantic-only match cited, citation opens source');
}finally{await browser.close();}
