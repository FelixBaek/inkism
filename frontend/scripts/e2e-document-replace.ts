import {waitForAsync} from './async-browser-condition.ts';
import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47974';
const rpc=async(op,args={})=>{
 const v=await (await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(v.ok,true,JSON.stringify(v));return v.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 for(const scenario of ['replace','replace-oversized','replace-remote','typing','cancel','remote']){
  const replacing=scenario.startsWith('replace');
  const title='전체 치환 '+scenario+' '+Date.now();
  const unchanged='<p data-custom="그대로">다른 문단</p>\n';
  const giant=scenario==='replace-oversized'?'<p>대상😀 '+'x'.repeat(600000)+'</p>':'';
  const replacements=giant?2001:2000;
  const content=Array.from({length:2000},(_,i)=>'<p><strong>대</strong>상😀 '+i+' '+('긴본문 '.repeat(25))+'</p>').join('')+giant+unchanged;
  const note=await rpc('save',{note:{title,content,text:'대상'}});await rpc('wait_index');
  const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('inkism.inspector','false'));const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?virtual=1&lazy=1');
  await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
  await page.locator('[data-window-start="0"]').waitFor();
  await page.getByRole('button',{name:'문서 전체 찾기',exact:true}).click();
  await page.getByLabel('문서 전체에서 찾을 내용',{exact:true}).fill('대상😀');
  await page.getByLabel('문서 전체에서 바꿀 내용',{exact:true}).fill('교체<&>');
  let release,entered;
  const held=new Promise(r=>entered=r);
  if(!replacing)await page.route('**/api/rpc',async route=>{
   const req=route.request().postDataJSON();
   if(req.op==='document_blocks' && req.offset>0){
    await new Promise(r=>{release=r;entered();});
   }
   await route.continue();
  });
  await page.getByRole('button',{name:'문서 전체 바꾸기',exact:true}).click();
  if(!replacing){
   await held;
   if(scenario==='typing'){
    await page.locator('.tiptap-prose p').first().click();
    await page.keyboard.press('Home');await page.keyboard.insertText('후속입력 ');
   }else if(scenario==='cancel')await page.getByRole('button',{name:'전체 바꾸기 취소',exact:true}).click();
   else await rpc('save',{note:{id:note.id,revision:note.revision,content:content+'<p>원격추가</p>',text:'원격추가'}});
   release();
   await page.getByRole('alert').filter({hasText:'전체 바꾸기를 취소했습니다.'}).waitFor();
   await page.keyboard.press('Control+s');
  }
  if(replacing)await page.getByRole('button',{name:'문서 전체 바꾸기',exact:true}).waitFor({state:'hidden',timeout:60000});
  // The status from the previous saved draft can survive one React commit.
  // Wait for the actual new canonical revision before checking its contents.
  if(replacing)await waitForAsync(page,async id=>{
   const reply=await(await fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'get',id})})).json();
   return reply.ok&&reply.data.revision>1;
  },note.id,{timeout:60000});
  if(replacing || scenario==='typing')await page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')),null,{timeout:60000});
  const stored=await rpc('get',{id:note.id});
  if(replacing){
   // Whole-source save keeps source-format text byte-identical to content.
   // The rendered replacement is escaped HTML; derived plaintext is only
   // produced by the separate rich-splice path.
   assert.equal(stored.text,stored.content);
   assert.equal((stored.content.match(/교체&lt;&amp;&gt;/g)||[]).length,replacements);
   assert.equal(stored.text.includes('대상😀'),false);
   assert.ok(stored.content.endsWith(unchanged),'unchanged HTML must remain byte-identical');
   assert.ok(stored.content.includes('&lt;&amp;&gt;'),'replacement must be text, not markup');
   assert.equal(stored.revision,note.revision+1);
   assert.equal((await rpc('revision_body',{id:note.id,revision:note.revision})).content,content);
   await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).click();
   await page.getByRole('button',{name:'전체 바꾸기 다시 적용',exact:true}).waitFor();
   await page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
   assert.equal((await rpc('get',{id:note.id})).content,content,'whole undo must restore exact original HTML');
   await page.getByRole('button',{name:'전체 바꾸기 다시 적용',exact:true}).click();
   await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).waitFor();
   await page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
   assert.equal((await rpc('get',{id:note.id})).content,stored.content,'whole redo must restore exact replacement');
   if(scenario==='replace-remote'){
    const latest=await rpc('get',{id:note.id});
    const remote=await rpc('save',{note:{id:note.id,revision:latest.revision,content:latest.content+'<p>다른기기</p>',text:latest.text+' 다른기기'}});
    await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).click();
    await page.getByRole('button',{name:'서버 버전으로 교체',exact:true}).waitFor();
    assert.equal((await rpc('get',{id:note.id})).content,remote.content,'undo must never overwrite a concurrent server revision');
   }else{
   await page.locator('.tiptap-prose p').first().click();await page.keyboard.insertText('새입력 ');
   await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).waitFor({state:'hidden'});
   await page.keyboard.press('Control+s');
   await page.waitForFunction(()=>Boolean(document.querySelector('.status-save.ok time')));
   assert.ok((await rpc('get',{id:note.id})).content.includes('새입력'));
   }
  }else{
   assert.equal(stored.content.includes('교체'),false);
   if(scenario==='typing')assert.ok(stored.content.includes('후속입력'));
   else assert.equal(stored.content,content+(scenario==='remote'?'<p>원격추가</p>':''));
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: whole-document literal replacement across marks, unchanged HTML, one revision/history, typing and cancellation preserve drafts');
}finally{await browser.close();}
