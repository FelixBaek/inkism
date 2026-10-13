import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from './browser-env.ts';
import {captureDOM} from './capture-dom.ts';
const dir=await mkdtemp(join(tmpdir(),'inkism-dom-helper-'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 await page.setContent('<style>dialog::backdrop{background:rgba(0,0,0,.4)}.hidden{display:none}</style><input aria-label="synthetic" value="SYNTHETIC"><span class="hidden">EXCLUDED</span><iframe title="sandbox fixture" sandbox="" srcdoc="<p>FRAME FIXTURE</p>"></iframe><dialog><p>VISIBLE DIALOG</p></dialog>');
 await page.locator('iframe').waitFor();await page.frameLocator('iframe').getByText('FRAME FIXTURE').waitFor();
 await page.locator('dialog').evaluate((e: any)=>e.showModal());
 const main=await captureDOM(page,dir,'fixture','synthetic-helper-test');
 assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');
 assert.equal(main.dpr,1);assert.equal(main.viewport.width,1440);
 assert.ok(main.nodes.some(n=>n.controlValue&&n.text==='SYNTHETIC'));
 assert.ok(!main.nodes.some(n=>n.text==='EXCLUDED'));
 const top=main.topLayers[0],ids=main.nodes.map(n=>n.id);
 assert.equal(ids.indexOf(top.nodeId),ids.indexOf(top.backdropNodeId)+1);
 assert.equal(top.backdropStyle.backgroundColor,'rgba(0, 0, 0, 0.4)');
 assert.equal(main.frames.length,1);assert.equal(main.frames[0].status,'captured');
 assert.equal(main.frames[0].element.sandbox,'');assert.ok(main.frames[0].origin.width>0);
 const frame=JSON.parse(await readFile(join(dir,main.frames[0].file),'utf8'));
 assert.ok(frame.nodes.some(n=>n.text==='FRAME FIXTURE'));assert.equal(frame.clipToFrame,true);
 console.log('PASS synthetic DOM: visible text/control/style, hidden exclusion, dialog backdrop ordering, sandbox unchanged, separate frame DOM and clip origin; '+dir);
}finally{await browser.close()}
