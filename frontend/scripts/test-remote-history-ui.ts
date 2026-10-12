import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {RemoteHistoryPanel} from './components/RemoteHistoryPanel';createRoot(document.getElementById('root')).render(<RemoteHistoryPanel noteId="source"/>);`,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-store',setup(b){b.onResolve({filter:/^\.\.\/store$/},()=>({path:'store',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export function useStore(){return {closeDialog(){window.closedHistory=true},refreshList(){window.refreshed=true},async selectNote(id){window.selected=id}}}`,loader:'js'}));}}]});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();const requests:any[]=[];let failRestore=true;
 await page.route('https://history.test/**',async route=>{
  if(!route.request().url().endsWith('/api/rpc'))return route.fulfill({contentType:'text/html',body:'<html lang="ko"><body><div id="root"></div></body></html>'});
  const req=route.request().postDataJSON();requests.push(req);let data:any;
  if(req.op==='remote_history_list')data={items:req.after?[]:[{seq:1,record_id:'record',title:'Historical note',created_at:12345,device_id:'peer',content_format:'markdown'}],cursor:1,done:!!req.after};
  else if(req.op==='remote_history_preview')data={content:'<script>window.UNSAFE=true</script>\nexact Markdown'};
  else if(failRestore)return route.fulfill({json:{ok:false,error:'attachment chunk missing on relay'}});
  else data={id:'restored',attachment_count:1};
  return route.fulfill({json:{ok:true,data}});
 });
 await page.goto('https://history.test');await page.evaluate(()=>localStorage.setItem('inkism.locale','ko'));await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.locator('summary').click();await page.getByRole('button',{name:'다음 서버 기록 조회'}).click();
 await page.getByRole('button',{name:/Historical note/}).click();await page.locator('textarea').waitFor();assert.match(await page.locator('textarea').inputValue(),/exact Markdown/);assert.equal(await page.evaluate(()=>(window as any).UNSAFE),undefined);
 await page.getByRole('button',{name:'첨부파일과 함께 새 노트로 복원'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/missing/);assert.equal(await page.evaluate(()=>(window as any).selected),undefined);
 failRestore=false;await page.getByRole('button',{name:'첨부파일과 함께 새 노트로 복원'}).click();await page.waitForFunction(()=>(window as any).selected==='restored');
 assert.equal(requests.filter(r=>r.op==='remote_history_restore').every(r=>r.confirmed===true&&r.seq===1&&r.record_id==='record'),true);
 await page.getByRole('button',{name:'다음 서버 기록 조회'}).click();await page.getByRole('button',{name:'서버 기록 조회 완료'}).waitFor();assert.equal(await page.getByRole('button',{name:'서버 기록 조회 완료'}).isDisabled(),true);
 console.log('PASS remote history UI pagination, exact inert preview, failed attachment restore stays open, explicit successful copy selection');
} finally {await browser.close();}
