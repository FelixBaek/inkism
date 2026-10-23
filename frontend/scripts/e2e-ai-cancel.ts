import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48289';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1300,height:900}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};let calls=0;
 // The completion answers late so the cancel button is visible while it runs.
 await p.route(/^http:\/\/localhost:11434\//,async route=>{const r=route.request();if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});calls++;await new Promise(x=>setTimeout(x,2500));await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({choices:[{message:{content:'늦게 온 결과'}}]})}).catch(()=>{});});
 await p.goto(base);
 await p.getByRole('button',{name:'설정 열기',exact:true}).click();await p.locator('.settings-nav').getByRole('button',{name:'AI 연결',exact:true}).click();
 await p.getByLabel('서비스 예시',{exact:true}).selectOption({label:'Ollama'});await p.getByLabel('AI 모델',{exact:true}).fill('cancel-model');
 await p.getByRole('button',{name:'AI 연결 저장',exact:true}).click();await p.locator('p.settings-msg').getByText('저장됨',{exact:true}).waitFor();await p.keyboard.press('Escape');
 await p.getByRole('button',{name:'새 노트',exact:true}).first().click();
 const prose=p.locator('.tiptap-prose');await p.waitForFunction(()=>document.querySelector<any>('.tiptap-prose')?.editor?.isEditable);
 await prose.click();await p.keyboard.insertText('취소 시험 문장');await p.keyboard.press('Shift+Home');
 await p.locator('.format-menu').getByRole('button',{name:'문장 다듬기',exact:true}).click();
 const busy=p.locator('.fm-row.is-busy');await busy.getByText('AI가 작업하는 중…',{exact:true}).waitFor();
 await busy.getByRole('button',{name:'취소',exact:true}).click();
 await busy.waitFor({state:'detached'});
 await p.waitForTimeout(3500); // past the late answer
 assert.equal(calls,1);
 assert.equal((await prose.textContent())?.trim(),'취소 시험 문장','late result discarded');
 assert.equal(await p.getByText('늦게 온 결과').count(),0);
 for(const action of ['prompt','말투 바꾸기','번역하기','이어 쓰기','할 일 뽑기']){
   await prose.click();await p.keyboard.press('Home');await p.keyboard.press('Shift+End');
   await p.locator('.format-menu').getByRole('button',{name:'AI에게 요청',exact:true}).click();
   if(action==='prompt'){
     await p.getByRole('textbox',{name:'AI에게 요청할 내용',exact:true}).fill('이 문장을 다시 써 주세요');
     await p.getByRole('button',{name:'AI에게 보내기',exact:true}).click();
   }else{
     await p.getByRole('menuitem',{name:action,exact:true}).click();
     if(action==='말투 바꾸기')await p.getByRole('menuitem',{name:'정중하게',exact:true}).click();
     if(action==='번역하기')await p.getByRole('menuitem',{name:'영어',exact:true}).click();
   }
   await busy.getByText('AI가 작업하는 중…',{exact:true}).waitFor();
   await busy.getByRole('button',{name:'취소',exact:true}).click();
   await busy.waitFor({state:'detached'});
   await p.waitForTimeout(3500);
   assert.equal((await prose.textContent())?.trim(),'취소 시험 문장',action+' cancellation preserves text');
   assert.equal(await p.getByText('늦게 온 결과').count(),0,action+' discards late completion');
 }
 assert.equal(calls,6,'quick action and every advanced action reached the provider');
 assert.deepEqual(errors,[]);
 console.log('PASS ai cancel: running row shows 취소, cancel clears busy state, late result never reaches the note');
}finally{await browser.close();}
