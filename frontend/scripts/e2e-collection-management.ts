import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:49329';
const rpc=async(op:string,args:any={})=>{const env=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(env.ok,true,JSON.stringify(env));return env.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
try {
 const a=await rpc('save',{note:{title:'Collection A',content:'<p>Keep exactly</p>',content_format:'html'}});
 const b=await rpc('save',{note:{title:'Collection B',content:'# Keep exactly\r\n',content_format:'markdown'}});
 await rpc('workspace_set',{ids:[a.id],active:a.id,locations:{}});await page.goto(base);await page.locator('.tiptap').waitFor();
 await page.getByRole('button',{name:'문서 설정',exact:true}).click();await page.getByRole('combobox',{name:'문서 너비',exact:true}).selectOption('wide');await page.getByRole('textbox',{name:'문서 스타일 이름',exact:true}).fill('Reading preset');await page.getByRole('button',{name:'현재 스타일 저장',exact:true}).click();await page.getByRole('combobox',{name:'저장한 문서 스타일',exact:true}).locator('option').filter({hasText:'Reading preset'}).waitFor({state:'attached'});
 await page.getByRole('combobox',{name:'문서 너비',exact:true}).selectOption('standard');await page.getByRole('button',{name:'스타일 불러오기',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'문서 너비',exact:true}).inputValue(),'wide');await page.getByRole('button',{name:'문서 설정 저장',exact:true}).click();await page.locator('.editor-pane[data-document-width="wide"]').waitFor();assert.equal((await rpc('get',{id:a.id})).content,a.content);
 assert.equal((await rpc('get',{id:a.id})).content,a.content);assert.equal((await rpc('get',{id:b.id})).content,b.content);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS style preset UI, source preservation and mobile viewport');
}finally{await browser.close();}
