import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
const base=process.env.INKISM_URL!;
// A sandboxed cross-process frame may bypass Playwright's page routing.
// Serve the external-site fixture over real HTTPS so this also exercises
// redirects and X-Frame-Options through the browser's network stack.
const temporary=mkdtempSync(path.join(os.tmpdir(),'inkism-viewer-'));
const key=path.join(temporary,'key.pem'),cert=path.join(temporary,'cert.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=viewer.example','-days','1'],{stdio:'ignore'});
const received:string[]=[];
const fixture=createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
 received.push(req.url??'');
 if(req.url==='/redirect'){res.writeHead(302,{location:base+'/webviewer-attack'});res.end();return;}
 if(req.url==='/blocked'){res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'DENY'});res.end('Forbidden embedding');return;}
 res.writeHead(200,{'Content-Type':'text/html'});
 res.end(`<h1>External website</h1><script>parent.postMessage('unsafe','*');fetch('${base}/webviewer-attack');top.location='${base}/webviewer-attack'</script><a href="${base}/webviewer-attack">Local escape</a>`);
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const origin=`https://viewer.example:${(fixture.address() as import('node:net').AddressInfo).port}`;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--no-proxy-server','--ignore-certificate-errors','--host-resolver-rules=MAP viewer.example 127.0.0.1']});
 const page=await browser.newPage({viewport:{width:1400,height:1000}});await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));
 const hostile:string[]=[];page.on('request',r=>{if(r.url().includes('/webviewer-attack'))hostile.push(r.url());});

 await page.goto(base);await page.getByRole('button',{name:'웹 보기',exact:true}).click();const dialog=page.getByRole('dialog',{name:'웹 보기',exact:true}),input=dialog.getByLabel('웹사이트 주소'),open=dialog.getByRole('button',{name:'열기',exact:true});
 for(const bad of ['http://localhost:1234/','http://127.0.0.1/','https://user:pass@example.com/']){await input.fill(bad);await open.click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.locator('iframe').count(),0);}
 await input.fill(origin+'/one');await open.click();await page.frameLocator('iframe[title="웹사이트 미리보기"]').frameLocator('iframe').getByText('External website',{exact:true}).waitFor();assert.equal(await dialog.locator('iframe').getAttribute('sandbox'),'');assert.equal(await dialog.getByRole('link',{name:'외부 브라우저에서 열기'}).getAttribute('rel'),'noopener noreferrer');
 await page.frameLocator('iframe[title="웹사이트 미리보기"]').frameLocator('iframe').getByText('Local escape',{exact:true}).click();await page.waitForTimeout(200);assert.deepEqual(hostile,[]);assert.ok(page.url().startsWith(base));
 await input.fill(origin+'/redirect');await open.click();await page.waitForTimeout(300);assert.deepEqual(hostile,[]);
 await input.fill(origin+'/blocked');await open.click();await page.waitForTimeout(200);await dialog.getByText(/표시가 차단된 사이트/).waitFor();assert.equal(await dialog.getByRole('link',{name:'외부 브라우저에서 열기'}).getAttribute('href'),origin+'/blocked');
 await dialog.getByRole('button',{name:'뒤로',exact:true}).click();assert.equal(await input.inputValue(),origin+'/redirect');await dialog.getByRole('button',{name:'앞으로',exact:true}).click();assert.equal(await input.inputValue(),origin+'/blocked');
 await page.setViewportSize({width:390,height:844});const box=await dialog.boundingBox();assert.ok(box&&box.width<=390);await dialog.getByRole('button',{name:'닫기',exact:true}).click();assert.equal(await page.locator('.web-viewer-dialog iframe').count(),0);assert.deepEqual(hostile,[]);
 assert.ok(received.includes('/one')&&received.includes('/redirect')&&received.includes('/blocked'),'real fixture served all external navigation cases');
 console.log('PASS live web viewer: separate entry, sandbox script blocking, local URL rejection, CSP blocks local link/redirect, X-Frame fallback, address back/forward, external link isolation, mobile sizing, close cleanup');
}finally{
 await browser?.close();
 fixture.closeAllConnections();
 await new Promise<void>((resolve,reject)=>fixture.close(error=>error?reject(error):resolve()));
 rmSync(temporary,{recursive:true,force:true});
}
