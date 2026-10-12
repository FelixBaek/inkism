import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47842';
const rpc=async(op,args={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const out=await r.json();assert.equal(out.ok,true);return out.data;};
// HTML emitted by the v2 schema used in Inkism. A v3 edit must preserve it.
const content='<h2>기존 제목</h2><p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u> <s>취소선</s> <mark>강조</mark> <a href="https://example.com">링크</a></p><blockquote><p>인용문</p></blockquote><pre><code>const value = 1;</code></pre><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>완료 항목</p></li></ul><table><tbody><tr><th colspan="2" rowspan="1" colwidth="120,120"><p>병합 제목</p></th></tr><tr><td><p>왼쪽</p></td><td><p>오른쪽</p></td></tr></tbody></table><p>마지막 문단</p>';
const title='v2 서식 호환 '+Date.now();
const original=await rpc('save',{note:{title,content,text:'기존 문서',tags:[]}});await rpc('wait_index');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='warning'&&/duplicate extension/i.test(m.text()))errors.push(m.text());});
async function check(){
 const root=page.locator('.tiptap-prose');
 for(const [selector,text] of [['h2','기존 제목'],['strong','굵게'],['em','기울임'],['u','밑줄'],['s','취소선'],['mark','강조'],['a','링크'],['blockquote','인용문'],['pre code','const value = 1;'],['li[data-checked="true"] > div p','완료 항목'],['th[colspan="2"]','병합 제목']])assert.equal(await root.locator(selector).textContent(),text);
 assert.equal(await root.locator('a').getAttribute('href'),'https://example.com');
 assert.match(await root.textContent(),/왼쪽오른쪽/);
}
try{
 await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});await page.goto(base);await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();await check();
 // Old task/table markup has different schema wrappers. It remains byte-exact; editing uses an explicit copy.
 assert.equal(await page.locator('.tiptap-prose').getAttribute('contenteditable'),'false');
 assert.equal((await rpc('get',{id:original.id})).content,content);
 await page.getByRole('button',{name:'서식 편집 사본 만들기',exact:true}).click();await page.getByRole('dialog',{name:'서식 편집 사본 만들기',exact:true}).getByRole('button',{name:'사본 만들기',exact:true}).click();
 await page.waitForFunction(t=>document.querySelector<HTMLInputElement>('.title-input')?.value===t,title+' (서식 편집 사본)');await check();
 assert.equal(await page.locator('.tiptap-prose').getAttribute('contenteditable'),'true');
 await page.locator('.tiptap-prose > p').last().click();await page.keyboard.press('End');await page.keyboard.insertText(' 수정 보존');
 await page.keyboard.press('Control+s');
 await page.waitForFunction(()=>document.querySelector('.status-save')?.classList.contains('ok'));
 const stored=(await rpc('list',{view:'all',query:title+' (서식 편집 사본)'})).items[0];assert.ok((await rpc('get',{id:stored.id})).content.includes('수정 보존'));
 await page.reload();await page.getByRole('button',{name:'노트 열기: '+title+' (서식 편집 사본)',exact:true}).click();await page.getByRole('button',{name:'텍스트',exact:true}).click();await check();
 assert.equal((await rpc('get',{id:original.id})).content,content);
 assert.match(await page.locator('.tiptap-prose').textContent(),/수정 보존/);
 assert.deepEqual(errors,[]);
 console.log('PASS: v2 saved headings, marks, links, tasks, code, merged table survive explicit v3 copy/edit/reopen; original bytes preserved');
}finally{await browser.close();}
