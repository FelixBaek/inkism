import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const rpc=async(op:string,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const word='Quokka'+Date.now().toString(36).replace(/\d/g,c=>'abcdefghij'[+c]);
const content=`<h1>Intro</h1><p id="other">unrelated paragraph</p><p id="target">${word} stores vectors for retrieval.</p>`;
const note=await rpc('save',{note:{title:'Answer source',content,content_format:'html'}});
await rpc('save',{note:{title:'Noise',content:'<p>secret unrelated note</p>',content_format:'html'}});
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');localStorage.setItem('inkism.ai.config',JSON.stringify({enabled:true,endpoint:'http://127.0.0.1:49999/chat',model:'test-model'}));});
 const sent:string[]=[];
 await p.route('http://127.0.0.1:49999/chat',async route=>{if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return;}sent.push(route.request().postData()??'');await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({choices:[{message:{content:`${word}는 검색용 벡터를 저장합니다 [1]. 없는 출처 [7].`}}]})});});
 await p.goto(base);await p.locator('.ProseMirror').first().waitFor();
 await libraryTool(p,'전체 검색');
 const input=p.getByLabel('전역 검색어',{exact:true});
 // No evidence: nothing is sent to the model.
 await input.fill('Zzyzxnotfound 뭐야?');await p.getByRole('button',{name:'내 노트에 묻기',exact:true}).click();
 await p.getByText('근거가 될 노트를 찾지 못해 AI에 보내지 않았습니다.',{exact:true}).waitFor();assert.equal(sent.length,0);
 await input.fill(`${word}는 무엇이야?`);await p.getByRole('button',{name:'내 노트에 묻기',exact:true}).click();
 const answer=p.locator('.note-answer-text');await answer.waitFor();
 assert.equal(sent.length,1);const body=JSON.parse(sent[0]),user=body.messages[1].content as string;
 assert.match(user,/Question: .*무엇이야\?/);assert.ok(user.includes(`[1] Answer source\n`)&&user.includes(`${word} stores vectors`),'retrieved passage is sent');
 assert.ok(!user.includes('secret unrelated note'),'unretrieved notes are not sent');
 assert.equal(await answer.locator('.note-answer-cite').count(),1,'invented source numbers stay plain text');
 assert.match(await answer.textContent()??'',/없는 출처 \[7\]/);
 assert.equal(await p.locator('.note-answer-sources li').count(),1);
 await answer.getByRole('button',{name:'근거 1: Answer source 열기',exact:true}).click();
 await p.waitForFunction(w=>getSelection()?.toString()===w,word);
 const at=await p.evaluate(()=>{const n=getSelection()?.anchorNode;return (n instanceof Element?n:n?.parentElement)?.closest('p')?.outerHTML;});assert.ok(at?.includes('stores vectors'),String(at));
 assert.equal((await rpc('get',{id:note.id})).content,content,'answering never edits the note');
 assert.deepEqual(errors,[]);
 console.log('PASS note answer: FTS retrieval only, no-evidence short circuit, numbered citations, invented citations ignored, citation opens exact source, note unchanged');
}finally{await browser.close();}
