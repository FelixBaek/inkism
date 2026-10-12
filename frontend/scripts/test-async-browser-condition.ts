import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {waitForAsync} from './async-browser-condition.ts';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto('about:blank');
 await page.evaluate(()=>{(window as any).attempts=0;(window as any).active=0;(window as any).peak=0;});
 await waitForAsync(page,async()=>{const w=window as any;w.peak=Math.max(w.peak,++w.active);await new Promise(resolve=>setTimeout(resolve,15));w.active--;return ++w.attempts>=3;},undefined,{timeout:2000,interval:1});
 assert.deepEqual(await page.evaluate(()=>({attempts:(window as any).attempts,peak:(window as any).peak})),{attempts:3,peak:1});
 await assert.rejects(waitForAsync(page,async()=>false,undefined,{timeout:50,interval:1}),/remained false/);
 await assert.rejects(waitForAsync(page,async()=>{throw new Error('predicate failure');},undefined),/predicate failure/);
 console.log('PASS async browser polling: awaits false→true, never overlaps predicates, rejects timeout and evaluation failure');
}finally{await browser.close();}
