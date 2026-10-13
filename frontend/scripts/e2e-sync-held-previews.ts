// Real settings UI; synthetic key-wait status and bounded preview responses.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL!;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));
 let phase='cancel',active=0,peak=0,requests=0,fullReads=0;
 const ids=Array.from({length:12},(_,i)=>`waiting-${i}`);
 await page.route('**/api/rpc',async route=>{
  const q=route.request().postDataJSON();
  if(q.op==='sync_status')return route.fulfill({json:{ok:true,data:{configured:true,paused:false,running:false,pending:0,last_sync:Date.now(),error:null,server_url:'https://synthetic.invalid',vault_key_required:ids}}});
  if(typeof q.id==='string'&&q.id.startsWith('waiting-')){
   if(q.op==='get'){fullReads++;return route.fulfill({status:403,json:{ok:false,error:'whole body read forbidden'}});}
   if(q.op==='note_preview'){
    requests++;active++;peak=Math.max(peak,active);
    try{
     await new Promise(resolve=>setTimeout(resolve,phase==='cancel'?1000:100));
     await route.fulfill({json:{ok:true,data:{id:q.id,title:`Title ${q.id}`,preview:'',revision:1}}}).catch(()=>{});
    }finally{active--;}
    return;
   }
  }
  await route.continue();
 });
 const open=async()=>{await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'동기화',exact:true}).click();await page.locator('.sync-settings').waitFor();};
 await page.goto(base);await open();
 const deadline=Date.now()+10000;
 while(requests<4){assert.ok(Date.now()<deadline,'preview requests began');await page.waitForTimeout(20);}
 await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
 await page.waitForTimeout(1300);assert.equal(requests,4,'closing stops queued title reads');assert.equal(active,0);
 phase='complete';requests=0;peak=0;await open();
 await page.locator('.sync-held-list').getByText('Title waiting-11',{exact:true}).waitFor();
 assert.equal(requests,12);assert.ok(peak<=4,`preview concurrency ${peak}`);assert.equal(fullReads,0,'no canonical body fetched for titles');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS sync held previews: 12 titles, bounded requests <=4, no full-body reads, close cancels queued work, mobile width');
}finally{await browser.close();}
