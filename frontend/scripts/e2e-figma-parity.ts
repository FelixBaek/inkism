import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));
  await page.goto(process.env.INKISM_URL||'http://127.0.0.1:48128');
  await page.getByRole('button',{name:'설정 열기',exact:true}).click();
  const dialog=page.locator('dialog.settings-dialog[open]');
  const nav=dialog.locator('.settings-nav');
  const select=async(name:string)=>{await nav.getByRole('button',{name,exact:true}).click();await dialog.locator('.settings-top h3').filter({hasText:name}).waitFor();};
  for(const theme of ['다크 모드로 전환','라이트 모드로 전환']){
    await select('모양');await dialog.getByRole('button',{name:theme,exact:true}).click();
    await select('일반');
    const box=await dialog.boundingBox();assert.ok(box);
    assert.ok(Math.abs(box.width-760)<=2,'settings width follows Figma');
    assert.ok(Math.abs(box.height-520)<=2,'settings height follows Figma');
    assert.ok(Math.abs(box.x-(1440-box.width)/2)<=2,'settings is centered horizontally');
    assert.ok(Math.abs(box.y-(900-box.height)/2)<=2,'settings is centered vertically');
    const navBox=await nav.boundingBox();assert.ok(navBox);assert.ok(Math.abs(navBox.width-200)<=2);
    assert.equal((await nav.getByRole('button').first().textContent())?.trim(),'AI 연결');
    const cards=dialog.locator('.settings-content > .settings-card');
    const first=await cards.nth(0).boundingBox(),second=await cards.nth(1).boundingBox(),third=await cards.nth(2).boundingBox();
    assert.ok(first&&second&&third);
    assert.ok(second.y>=first.y+first.height && third.y>=second.y+second.height,'general controls stack in one column');
    assert.ok(Math.abs(first.x-second.x)<1 && Math.abs(first.width-second.width)<1);
    assert.equal(await dialog.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
    assert.notEqual(await dialog.evaluate(e=>getComputedStyle(e,'::backdrop').backgroundColor),'rgba(0, 0, 0, 0)');
  }
  await dialog.locator('.settings-content').evaluate(e=>e.scrollTop=200);
  await select('백업과 복원');
  assert.equal(await dialog.locator('.settings-content').evaluate(e=>e.scrollTop),0,'switching settings starts at the top');
  await dialog.getByRole('button',{name:'외부 편집 폴더 선택',exact:true}).waitFor();
  await select('가져오기');
  assert.equal(await dialog.getByRole('button',{name:'외부 편집 폴더 선택',exact:true}).count(),0);
  await select('동기화');assert.equal(await dialog.locator('.sync-settings').count(),2);
  await page.setViewportSize({width:390,height:844});
  const mobile=await dialog.boundingBox();assert.ok(mobile);
  assert.ok(mobile.x>=0 && mobile.x+mobile.width<=390 && mobile.y>=0 && mobile.y+mobile.height<=844,'mobile settings stays inside viewport');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS Figma settings: both themes, centered modal, 200px navigation, stacked controls, category placement, mobile bounds');
} finally {await browser.close();}
