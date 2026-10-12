import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(process.env.INKISM_FRONTEND_DIR||path.join(root,'frontend'),'package.json'));
const {chromium}=require('playwright-core');
const {build}=require('esbuild');
const apiBundle=await build({entryPoints:[path.join(root,'frontend/src/api.ts')],bundle:true,write:false,format:'iife',globalName:'inkismAPI',platform:'browser',logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 await page.route('http://inkism.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body>Mobile bridge</body>'}));
 await page.route('https://remote.invalid/**',route=>route.fulfill({contentType:'text/plain',body:'external',headers:{'access-control-allow-origin':'*'}}));
 await page.goto('http://inkism.test/');
 await page.evaluate(()=>{
  window.calls=[];
  window.__TAURI__={core:{invoke:async(command,{request})=>{
   window.calls.push({command,request});
   if(request.path==='/api/error')return{status:409,headers:[['content-type','application/json']],body:Array.from(new TextEncoder().encode('{"ok":false,"error":"conflict"}'))};
   return{status:200,headers:[['content-type','application/octet-stream']],body:[0,1,255]};
  }}};
 });
 await page.addScriptTag({content:readFileSync(path.join(root,'desktop-tauri/src-tauri/src/mobile-bridge.js'),'utf8')});
 await page.addScriptTag({content:apiBundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const saved=await fetch('/api/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'save',note:{content:'# 한글\r\n'}})});
  const output=Array.from(new Uint8Array(await saved.arrayBuffer()));
  const form=new FormData();form.set('file',new File([new Uint8Array([0,1,255])],'image.bin',{type:'application/octet-stream'}));await fetch('/api/attachments',{method:'POST',body:form});
  const failed=await fetch('/api/error',{method:'POST'});
  const controller=new AbortController();controller.abort();let aborted=false;try{await fetch('/api/rpc',{method:'POST',signal:controller.signal,body:'discard'});}catch(error){aborted=error.name==='AbortError';}
  const external=await fetch('https://remote.invalid/test').then(r=>r.text());
  const beforeGuard=window.calls.length;let oversized='';try{await window.inkismAPI.api.uploadAttachment(new File(Array(64).fill(new Uint8Array(1024*1024)),'large.bin'),new AbortController().signal);}catch(error){oversized=error.message;}
  return{oversized,beforeGuard,output,failed:failed.status,aborted,external,calls:window.calls,mobile:window.__INKISM_MOBILE__};
 });
 assert.match(result.oversized,/63MB/);assert.equal(result.beforeGuard,result.calls.length,'oversized mobile upload called native bridge');
 assert.deepEqual(result.output,[0,1,255]);assert.equal(result.failed,409);assert.equal(result.aborted,true);assert.equal(result.external,'external');assert.equal(result.mobile,true);assert.equal(result.calls.length,3);
 assert.equal(result.calls[0].command,'mobile_api');assert.equal(JSON.parse(new TextDecoder().decode(new Uint8Array(result.calls[0].request.body))).note.content,'# 한글\r\n');
 const attachment=result.calls[1].request;assert.match(attachment.headers.find(([key])=>key==='content-type')[1],/^multipart\/form-data; boundary=/);assert.ok(new Uint8Array(attachment.body).includes(255));
 console.log('PASS mobile IPC bridge: same-origin API routing, exact UTF-8/CRLF JSON, multipart binary, error status, pre-abort, external fetch unchanged, oversized files rejected before native dispatch');
}finally{await browser.close();}
