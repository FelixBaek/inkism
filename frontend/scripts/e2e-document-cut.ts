import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:48024';
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 for(const mode of ['normal','lazy','denied','typing','switch']) {
  const content=Array.from({length:10000},(_,i)=>`<p><strong>블록 ${i}</strong> 본문😀</p>`).join('');
  const note=await rpc('save',{note:{title:'잘라내기 '+mode+' '+Date.now(),content,text:Array.from({length:10000},(_,i)=>`블록 ${i} 본문😀`).join('\n'),tags:['유지태그']}});
  const other=await rpc('save',{note:{title:'다른 노트 '+mode+' '+Date.now(),content:'<p>별도 본문</p>',text:'별도 본문'}});
  await rpc('workspace_set',{ids:[note.id,other.id],active:note.id,locations:{}});
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:960}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?virtual=1'+(mode==='lazy'?'&lazy=1':''));
  await page.locator('[data-window-start="0"]').waitFor();
  const saved=()=>page.waitForFunction(()=>document.querySelector('.status-save')?.textContent.includes('모든 변경 사항 저장됨'));
  if(mode==='denied')await page.evaluate(()=>{navigator.clipboard.write=async()=>{throw new DOMException('denied','NotAllowedError');};});
  if(mode==='typing'||mode==='switch')await page.evaluate(()=>{navigator.clipboard.write=()=>new Promise(resolve=>{(window as any).finishCut=resolve;});});
  await page.getByRole('button',{name:'문서 전체 잘라내기',exact:true}).click();
  if(mode==='typing') {await page.locator('.tiptap-prose p').first().click();await page.keyboard.insertText('변경내용');await page.evaluate(()=>(window as any).finishCut());await page.getByText('복사하는 동안 문서가 변경되어 잘라내기를 취소했습니다.',{exact:true}).waitFor();await saved();assert.ok((await rpc('get',{id:note.id})).content.includes('변경내용'));assert.ok((await rpc('get',{id:note.id})).content.includes('블록 9999'));}
  else if(mode==='switch') {await page.getByRole('tab',{name:'노트 탭: '+other.title,exact:true}).click();await page.waitForFunction(t=>document.querySelector<any>('.title-input')?.value===t,other.title);await page.evaluate(()=>(window as any).finishCut());await page.waitForTimeout(300);assert.equal((await rpc('get',{id:note.id})).content,content);assert.equal((await rpc('get',{id:other.id})).content,'<p>별도 본문</p>');}
  else if(mode==='denied') {await page.getByRole('alert').filter({hasText:'문서를 복사하지 못했습니다.'}).waitFor();assert.equal((await rpc('get',{id:note.id})).content,content);assert.ok((await page.locator('.tiptap-prose').textContent()).includes('블록 0'));}
  else {
   await page.getByRole('button',{name:'전체 잘라내기 취소',exact:true}).waitFor();await saved();
   const clipped=await page.evaluate(async()=>{const [x]=await navigator.clipboard.read();return {html:await(await x.getType('text/html')).text(),text:await(await x.getType('text/plain')).text()};});
   assert.equal((clipped.html.match(/<p>/g)||[]).length,10000);assert.ok(clipped.text.includes('블록 9999'));let stored=await rpc('get',{id:note.id});assert.equal(stored.content,'');assert.equal(stored.title,note.title);assert.deepEqual(stored.tags,note.tags);
   await page.getByRole('button',{name:'전체 잘라내기 취소',exact:true}).click();await saved();assert.equal((await rpc('get',{id:note.id})).content,content);
   await page.getByRole('button',{name:'전체 잘라내기 다시 적용',exact:true}).click();await saved();assert.equal((await rpc('get',{id:note.id})).content,'');
   await page.reload();await page.locator('.tiptap-prose').waitFor();assert.equal((await rpc('get',{id:note.id})).content,'');
  }
  assert.deepEqual(errors,[]);await context.close();console.log('PASS whole-document cut:',mode);
 }
}finally{await browser.close();}
