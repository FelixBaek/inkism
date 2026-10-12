import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL!;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}});await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));
 const hostile:string[]=[];page.on('request',r=>{if(r.url().includes('/webviewer-attack'))hostile.push(r.url());});
 await page.route('https://viewer.example/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/redirect')return route.fulfill({status:302,headers:{location:base+'/webviewer-attack'}});if(path==='/blocked')return route.fulfill({headers:{'X-Frame-Options':'DENY'},contentType:'text/html',body:'Forbidden embedding'});return route.fulfill({contentType:'text/html',body:`<h1>External website</h1><script>parent.postMessage('unsafe','*');fetch('${base}/webviewer-attack');top.location='${base}/webviewer-attack'</script><a href="${base}/webviewer-attack">Local escape</a>`});});
 await page.goto(base);await page.getByRole('button',{name:'웹 보기',exact:true}).click();const dialog=page.getByRole('dialog',{name:'웹 보기',exact:true}),input=dialog.getByLabel('웹사이트 주소'),open=dialog.getByRole('button',{name:'열기',exact:true});
 for(const bad of ['http://localhost:1234/','http://127.0.0.1/','https://user:pass@example.com/']){await input.fill(bad);await open.click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.locator('iframe').count(),0);}
 await input.fill('https://viewer.example/one');await open.click();await page.frameLocator('iframe[title="웹사이트 미리보기"]').frameLocator('iframe').getByText('External website',{exact:true}).waitFor();assert.equal(await dialog.locator('iframe').getAttribute('sandbox'),'');assert.equal(await dialog.getByRole('link',{name:'외부 브라우저에서 열기'}).getAttribute('rel'),'noopener noreferrer');
 await page.frameLocator('iframe[title="웹사이트 미리보기"]').frameLocator('iframe').getByText('Local escape',{exact:true}).click();await page.waitForTimeout(200);assert.deepEqual(hostile,[]);assert.ok(page.url().startsWith(base));
 await input.fill('https://viewer.example/redirect');await open.click();await page.waitForTimeout(300);assert.deepEqual(hostile,[]);
 await input.fill('https://viewer.example/blocked');await open.click();await page.waitForTimeout(200);await dialog.getByText(/표시가 차단된 사이트/).waitFor();assert.equal(await dialog.getByRole('link',{name:'외부 브라우저에서 열기'}).getAttribute('href'),'https://viewer.example/blocked');
 await dialog.getByRole('button',{name:'뒤로',exact:true}).click();assert.equal(await input.inputValue(),'https://viewer.example/redirect');await dialog.getByRole('button',{name:'앞으로',exact:true}).click();assert.equal(await input.inputValue(),'https://viewer.example/blocked');
 await page.setViewportSize({width:390,height:844});const box=await dialog.boundingBox();assert.ok(box&&box.width<=390);await dialog.getByRole('button',{name:'닫기',exact:true}).click();assert.equal(await page.locator('.web-viewer-dialog iframe').count(),0);assert.deepEqual(hostile,[]);
 console.log('PASS live web viewer: separate entry, sandbox script blocking, local URL rejection, CSP blocks local link/redirect, X-Frame fallback, address back/forward, external link isolation, mobile sizing, close cleanup');
}finally{await browser.close();}
