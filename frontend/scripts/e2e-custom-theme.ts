import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
const base=process.env.INKISM_URL||'http://127.0.0.1:48128';
const color=()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
// 사용자 테마는 설정 창의 '모양' 항목 안에 있다. 테마 창을 닫아도 설정 창은 열려 있다.
const open=async()=>{if(!(await page.locator('dialog.settings-dialog[open]').count())){await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'모양',exact:true}).click();}await page.getByRole('button',{name:'사용자 테마',exact:true}).click();};
const input=()=>page.locator('.custom-theme input[type=file]');
const colors={canvas:'#fff9ee',surface:'#f5f6f5',text:'#202624',muted:'#626b66',green:'#087f5b',border:'#e4e7e5'};
try{
 // 저장한 선택이 없으면 다크가 기본이다. 이 검사는 라이트 모드에서 시작한다.
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await page.evaluate(()=>localStorage.setItem('inkism-theme','light'));await page.reload();await open();
 await page.getByLabel('본문 배경 색상',{exact:true}).fill('#fff9ee');await page.getByRole('button',{name:'취소',exact:true}).click();
 // The light theme from storage can settle after the dialog opens; wait for it instead of sampling once.
 await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()==='#f7f6f3',null,{timeout:5000}).catch(()=>{});assert.equal(await color(),'#f7f6f3');
 await open();await page.getByLabel('본문 배경 색상',{exact:true}).fill('#fff9ee');await page.getByRole('button',{name:'테마 저장',exact:true}).click();assert.equal(await color(),'#fff9ee');
 await page.reload();await open();assert.equal(await color(),'#fff9ee');
 await page.getByLabel('글자 색상',{exact:true}).fill('#fff9ee');await page.getByRole('button',{name:'테마 저장',exact:true}).click();await page.getByRole('alert').filter({hasText:'명암비'}).waitFor();assert.equal(await color(),'#fff9ee');
 await page.getByRole('button',{name:'취소',exact:true}).click();await open();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'테마 내보내기',exact:true}).click();const download=await downloadPromise;const stream=await download.createReadStream();let data='';for await(const chunk of stream)data+=chunk;assert.equal(JSON.parse(data).light.canvas,'#fff9ee');
 await input().setInputFiles({name:'hostile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,light:{...colors,canvas:'url(https://example.invalid/track)'}}))});await page.getByRole('alert').filter({hasText:'#RRGGBB'}).waitFor();assert.equal(await color(),'#fff9ee');
 await input().setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(4097)});await page.getByRole('alert').filter({hasText:'4KB'}).waitFor();
 await input().setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,light:{...colors,canvas:'#eef9ff'}}))});assert.equal(await color(),'#fff9ee');await page.getByRole('button',{name:'테마 저장',exact:true}).click();assert.equal(await color(),'#eef9ff');
 await page.getByRole('button',{name:'다크 모드로 전환',exact:true}).click();assert.equal(await color(),'#232221');await page.getByRole('button',{name:'라이트 모드로 전환',exact:true}).click();assert.equal(await color(),'#eef9ff');
 await open();await page.getByRole('button',{name:'기본값 복원',exact:true}).click();assert.equal(await color(),'#f7f6f3');await page.reload();await open();assert.equal(await color(),'#f7f6f3');
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('quota');};});await page.getByLabel('본문 배경 색상',{exact:true}).fill('#fff9ee');await page.getByRole('button',{name:'테마 저장',exact:true}).click();await page.getByRole('alert').filter({hasText:'저장하지 못'}).waitFor();assert.equal(await color(),'#f7f6f3');
 console.log('PASS custom theme: save/reload, cancel, contrast, JSON export/import, hostile/oversized input, independent modes, reset and storage failure preserve active colors');
}finally{await browser.close();}
