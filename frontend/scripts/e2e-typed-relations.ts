import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const rpc=async(op:string,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const word='Rel'+Date.now().toString(36).replace(/\d/g,c=>'abcdefghij'[+c]);
const bookTitle=`${word} 소설`;
const person=await rpc('save',{note:{title:'사람 Kim',content:'<p>부산에서 자랐다.</p>',content_format:'html'}});
const secret=await rpc('save',{note:{title:'잠긴 공저자',content:'<p>금고 속 비밀 경력</p>',content_format:'html'}});
const book=await rpc('save',{note:{title:bookTitle,content:'<p>장편 소설이다.</p>',content_format:'html'}});
const company=await rpc('save',{note:{title:'회사 Orbit',content:'<p>본사는 판교에 있다.</p>',content_format:'html'}});
await rpc('knowledge_set',{id:person.id,revision:person.revision,version:0,aliases:[],properties:[{name:'소속',type:'relation',value:[company.id]}]});
await rpc('knowledge_set',{id:book.id,revision:book.revision,version:0,aliases:[],properties:[{name:'저자',type:'relation',value:[person.id,secret.id]}]});
await rpc('vault_create',{password:'relation-password'});
await rpc('vault_lock_note',{id:secret.id,revision:(await rpc('get',{id:secret.id})).revision});
await rpc('workspace_set',{ids:[book.id],active:book.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');localStorage.setItem('inkism.ai.config',JSON.stringify({enabled:true,endpoint:'http://127.0.0.1:49999/chat',model:'test-model'}));});
 const sent:string[]=[];
 await p.route('http://127.0.0.1:49999/chat',async route=>{if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return;}sent.push(route.request().postData()??'');await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({choices:[{message:{content:'저자는 부산 출신입니다 [1][2].'}}]})});});
 await p.goto(base);await p.locator('.ProseMirror').first().waitFor();
 const dialog=p.getByRole('dialog',{name:'지식 도구',exact:true});
 // Typed edge, outgoing from the book; the locked co-author never appears.
 await libraryTool(p,'속성과 노트 연결');
 const relations=dialog.getByRole('region',{name:'관계',exact:true});
 await relations.getByRole('button',{name:'나가는 관계 저자: 사람 Kim 열기',exact:true}).waitFor();
 assert.ok(!(await relations.innerText()).includes('잠긴 공저자'),'locked related note is hidden');
 await relations.getByRole('combobox',{name:'관계 속성',exact:true}).selectOption('저자');
 await relations.getByRole('button',{name:'나가는 관계 저자: 사람 Kim 열기',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('.ProseMirror')?.textContent?.includes('부산에서 자랐다'));
 // Same edge seen from the person: incoming.
 await libraryTool(p,'속성과 노트 연결');
 await relations.getByRole('button',{name:`들어오는 관계 저자: ${bookTitle} 열기`,exact:true}).waitFor();
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 // Multi-hop answer: the question names only the book; the person's fact arrives through the relation.
 await libraryTool(p,'전체 검색');
 await p.getByLabel('전역 검색어',{exact:true}).fill(`${word}의 저자는 어디 출신이야?`);
 await p.getByRole('button',{name:'내 노트에 묻기',exact:true}).click();
 await p.locator('.note-answer-text').waitFor();
 assert.equal(sent.length,1);
 const user=JSON.parse(sent[0]).messages[1].content as string;
 assert.ok(user.includes(bookTitle)&&user.includes('부산에서 자랐다'),'book and related person passages are sent');
 assert.match(user,new RegExp(String.raw`Relations:\n\[\d\] ${bookTitle} —저자→ \[\d\] 사람 Kim`));
 assert.ok(!user.includes('금고 속 비밀')&&!user.includes('잠긴 공저자'),'locked related note is never sent');
 assert.equal(await p.locator('.note-answer-text .note-answer-cite').count(),2,'both sources are citable');
 // Two hops: book —저자→ person —소속→ company; only the company note holds the answer and no question word matches it.
 await p.getByLabel('전역 검색어',{exact:true}).fill(`${word} 저자의 직장은 어디야?`);
 await p.getByRole('button',{name:'내 노트에 묻기',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('.note-answer-text')?.getAttribute('aria-label')?.includes('직장'));
 assert.equal(sent.length,2);
 const chain=JSON.parse(sent[1]).messages[1].content as string;
 assert.ok(chain.includes('본사는 판교에 있다'),'second-hop note passage is sent');
 assert.match(chain,new RegExp(String.raw`\[\d\] ${bookTitle} —저자→ \[\d\] 사람 Kim \(hop 1\)`));
 assert.match(chain,/\[\d\] 사람 Kim —소속→ \[\d\] 회사 Orbit \(hop 2\)/);
 assert.ok(!chain.includes('금고 속 비밀'),'locked note stays out on deeper hops');
 assert.deepEqual(errors,[]);
 console.log('PASS typed relations: outgoing/incoming typed edge UI, property filter, locked exclusion, relation hop in AI prompt with numbered relation line, 2-hop chain with hop depth');
}finally{await browser.close();}
