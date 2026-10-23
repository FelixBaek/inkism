// 페르소나 검토 6가지 변경 화면 캡처(수동 확인용). INKISM_URL, OUT 필요.
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL!,out=process.env.OUT!;
const rpc=async(op:string,args={})=>{const e=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(e.ok,true,JSON.stringify(e));return e.data;};
const titles=['여백을 수집하는 일','잉크 한 방울의 규칙','바우하우스, 읽다 만 곳','파랑 하나의 이유','타이포그래피 메모','종이 세 종류'];
for(let i=0;i<128;i++)await rpc('save',{note:{title:i<titles.length?titles[i]:'노트 '+i,content:'<p>흔적을 남기는 작은 간격에 대한 기록. 여백</p>',content_format:'html'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const shot=async(p:any,name:string)=>{await p.waitForTimeout(400);await p.screenshot({path:`${out}/${name}.png`});};
try{
 const p=await browser.newPage({viewport:{width:1440,height:900}});
 await p.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
 await p.goto(base);await p.locator('.note-row').first().waitFor();
 // 5 무한 스크롤
 const before=await p.locator('.note-row').count();
 await p.locator('.list-more').scrollIntoViewIfNeeded();await p.locator('.list-body').evaluate((el:HTMLElement)=>el.scrollTop=el.scrollHeight);
 await p.waitForFunction((n:number)=>document.querySelectorAll('.note-row').length>n,before);
 console.log('rows',before,'->',await p.locator('.note-row').count(),'|',await p.locator('.list-more').textContent());
 await shot(p,'5-infinite-scroll');
 await p.locator('.list-body').evaluate((el:HTMLElement)=>el.scrollTop=0);
 // 6 목록 우클릭 메뉴
 await p.locator('.note-row-main').nth(1).click({button:'right'});await shot(p,'6a-context-menu');await p.keyboard.press('Escape');
 // 6 상단 ⋯ 메뉴
 await p.locator('.note-row-main').first().click();await p.locator('.app-topbar').getByRole('button',{name:/더 보기|더보기|메뉴/}).first().click();await shot(p,'6b-top-menu');await p.keyboard.press('Escape');
 // 6 F2 이름 바꾸기
 await p.locator('.note-row-main').nth(2).focus();await p.keyboard.press('F2');await shot(p,'6c-rename-f2');await p.keyboard.press('Escape');
 // 3 지운 직후 알림 + Ctrl Z
 await p.locator('.note-row-main').nth(2).focus();await p.keyboard.press('Delete');await p.locator('.deleted-toast').waitFor();
 console.log('toast',await p.locator('.deleted-toast').textContent());await shot(p,'3-deleted-toast');
 await p.locator('body').click({position:{x:700,y:5}});await p.keyboard.press('Control+z');await p.locator('.deleted-toast').waitFor({state:'hidden'});
 await p.waitForTimeout(500);console.log('restored',(await p.locator('.note-row-title').allTextContents()).includes('노트 125'));
 // 4 전체 검색 기간 칩
 await p.locator('.app-topbar').getByRole('button',{name:/더 보기|더보기|메뉴/}).first().click();await p.getByRole('menuitem',{name:'라이브러리 도구'}).click();
 await p.getByRole('button',{name:'전체 검색',exact:true}).click();await p.getByLabel('전역 검색어').fill('여백');await p.getByRole('button',{name:'이번 주',exact:true}).click();await p.getByRole('button',{name:'검색',exact:true}).click();
 await p.locator('.global-search-results li').first().waitFor();await shot(p,'4-search-period');
 await p.keyboard.press('Escape');await p.reload();await p.locator('.note-row').first().waitFor();
 // 2 엔진 연결 실패
 await p.locator('.note-row-main').first().click();await p.locator('.status-save').waitFor();
 await p.route('**/api/**',route=>route.fulfill({status:502,body:'bad gateway'}));
 await p.getByLabel('노트 제목',{exact:true}).fill('여백을 수집하는 일 (수정)');
 await p.waitForFunction(()=>document.querySelector('.status-save')?.textContent?.includes('연결되면'),undefined,{timeout:10000});console.log('status',await p.locator('.status-save').textContent());await shot(p,'2-engine-down');
 await p.unroute('**/api/**');await p.waitForFunction(()=>!document.querySelector('.conn-banner'),undefined,{timeout:15000});
 await p.waitForFunction(()=>document.querySelector('.status-save')?.getAttribute('data-save-state')==='saved',undefined,{timeout:10000});
 console.log('after reconnect',await p.locator('.status-save').getAttribute('data-save-state'));
 // 1 모바일 목록
 const m=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await m.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');});
 await m.goto(base);await m.locator('.note-row').first().waitFor();await shot(m,'1-mobile-list');
 await m.locator('.list-fab-new').click();await m.getByLabel('노트 제목',{exact:true}).waitFor();console.log('fab new ok');
}finally{await browser.close();}
