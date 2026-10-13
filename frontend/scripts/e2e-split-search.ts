import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48149';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const a=await rpc('save',{note:{title:'find left',content:'left unique',content_format:'html'}}),b=await rpc('save',{note:{title:'find right',content:'right unique',content_format:'markdown'}});
await rpc('workspace_set',{ids:[a.id],active:a.id,locations:{}});await rpc('split_set',{id:b.id,mode:'source'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const p=await browser.newPage({viewport:{width:1600,height:1000}});
const left=p.locator('.split-primary'),right=p.locator('.split-secondary');
const close=async pane=>{await pane.locator('.cm-search input[name=search]').focus();await p.keyboard.press('Escape');await pane.locator('.cm-search').waitFor({state:'hidden'});};
try{
 await p.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await p.goto(base);await right.locator('.cm-content').waitFor();await left.getByRole('button',{name:'HTML',exact:true}).click();await left.locator('.cm-content').waitFor();
 await left.locator('.cm-content').focus();await p.keyboard.press('Control+f');await left.locator('.cm-search').waitFor();assert.equal(await right.locator('.cm-search').count(),0);await close(left);
 await right.locator('.cm-content').focus();await p.keyboard.press('Control+f');await right.locator('.cm-search').waitFor();assert.equal(await left.locator('.cm-search').count(),0);await close(right);
 await right.getByLabel('분할 노트',{exact:true}).focus();await p.keyboard.press('Control+h');await right.locator('.cm-search').waitFor();assert.equal(await left.locator('.cm-search').count(),0);await close(right);
 await left.getByRole('button',{name:'원문에서 찾기·바꾸기 (Ctrl+F)',exact:true}).click();await left.locator('.cm-search').waitFor();assert.equal(await right.locator('.cm-search').count(),0);await close(left);
 await right.getByRole('button',{name:'원문에서 찾기·바꾸기 (Ctrl+F)',exact:true}).click();await right.locator('.cm-search').waitFor();assert.equal(await left.locator('.cm-search').count(),0);
 assert.equal((await rpc('get',{id:a.id})).content,a.content);assert.equal((await rpc('get',{id:b.id})).content,b.content);
 console.log('PASS: Ctrl+F, global Ctrl+H, and toolbar find are scoped to the intended pane');
}finally{await browser.close();}
