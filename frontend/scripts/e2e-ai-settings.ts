import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1300,height:900}}),errors:string[]=[],logs:string[]=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>logs.push(m.text()));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};let reply:{status:number,body:unknown}|'abort'={status:200,body:{}};const auth:string[]=[];
 await p.route(/^http:\/\/(localhost:11434|127\.0\.0\.1:49999)\//,async route=>{const r=route.request();if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});auth.push(r.headers().authorization??'');if(reply==='abort')return route.abort('connectionrefused');await route.fulfill({status:reply.status,contentType:'application/json',headers:cors,body:JSON.stringify(reply.body)});});
 await p.goto(base);
 await p.getByRole('button',{name:'설정 열기',exact:true}).click();await p.locator('.settings-nav').getByRole('button',{name:'AI 연결',exact:true}).click();
 const endpoint=p.getByLabel('AI 요청 주소',{exact:true}),model=p.getByLabel('AI 모델',{exact:true}),status=p.getByRole('status');
 const disclosure=p.getByLabel('AI로 보내는 내용',{exact:true});
 assert.match(await disclosure.textContent()??'',/등록한 서버로.*고른 글.*용어 풀이.*내 노트에 묻기: 질문과 검색으로 찾은 노트 구절/s);
 await p.getByText('이 환경에서는 API 키를 저장하지 않습니다. 키는 메모리에만 두며 앱을 닫으면 지워집니다.',{exact:true}).waitFor(); // no desktop key store here
 // Preset fills the endpoint; the models list comes from the derived /v1/models.
 await p.getByLabel('서비스 예시',{exact:true}).selectOption({label:'Ollama'});
 assert.equal(await endpoint.inputValue(),'http://localhost:11434/v1/chat/completions');
 await disclosure.getByText('아래 내용이 이 기기(localhost:11434)로 전송됩니다.',{exact:false}).waitFor();
 reply={status:200,body:{object:'list',data:[{id:'qwen3:8b'},{id:'llama3.2'}]}};
 const listed=p.waitForRequest(r=>r.method()==='GET'&&r.url()==='http://localhost:11434/v1/models');
 await p.getByRole('button',{name:'모델 불러오기',exact:true}).click();await listed;
 await status.getByText('모델 2개를 불러왔습니다.',{exact:true}).waitFor();
 await p.getByLabel('불러온 모델',{exact:true}).selectOption('qwen3:8b');assert.equal(await model.inputValue(),'qwen3:8b');
 await model.fill('manual-model');assert.equal(await model.inputValue(),'manual-model','manual entry still allowed');
 // Failures name the cause and keep the HTTP status.
 await endpoint.fill('http://127.0.0.1:49999/v1/chat/completions');await p.getByLabel('AI API 키',{exact:true}).fill('sk-test-secret');
 reply={status:401,body:{error:'bad key'}};await p.getByRole('button',{name:'모델 불러오기',exact:true}).click();
 await status.getByText(/^AI 서버 응답 401: API 키가 없거나 맞지 않습니다/).waitFor();assert.equal(auth.at(-1),'Bearer sk-test-secret');
 reply='abort';await p.getByRole('button',{name:'모델 불러오기',exact:true}).click();
 await status.getByText(/^127\.0\.0\.1:49999에 연결하지 못했습니다.*CORS/).waitFor();
 await p.getByRole('button',{name:'AI 연결 저장',exact:true}).click();await status.getByText('저장됨',{exact:true}).waitFor();
 reply={status:429,body:{}};await p.getByRole('button',{name:'AI 연결 테스트',exact:true}).click();
 await status.getByText(/^AI 서버 응답 429: 요청 한도/).waitFor();
 reply={status:404,body:{}};await p.getByRole('button',{name:'AI 연결 테스트',exact:true}).click();
 await status.getByText(/^AI 서버 응답 404: 주소나 모델을 찾지 못했습니다/).waitFor();
 reply={status:200,body:{choices:[]}};await p.getByRole('button',{name:'AI 연결 테스트',exact:true}).click();
 await status.getByText(/의 응답 형식을 읽지 못했습니다/).waitFor();
 reply={status:200,body:{choices:[{message:{content:'OK'}}]}};await p.getByRole('button',{name:'AI 연결 테스트',exact:true}).click();
 await status.getByText('연결됨: OK',{exact:true}).waitFor();
 const stored=await p.evaluate(()=>JSON.stringify({...localStorage}));
 assert.ok(stored.includes('manual-model')&&!stored.includes('sk-test-secret'),'config saved, key never stored');
 assert.ok(!logs.some(l=>l.includes('sk-test-secret')),'key never logged');
 assert.deepEqual(errors,[]);
 console.log('PASS ai settings: preset endpoint, /models list + manual model, classified 401/network/429/404/shape failures with status, per-feature send disclosure, memory-only key (no desktop store) not stored or logged');
}finally{await browser.close();}
