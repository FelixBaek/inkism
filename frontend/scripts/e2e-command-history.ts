import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:object={})=>{const value=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(value.ok,true,JSON.stringify(value));return value.data;};
const note=await rpc('save',{note:{title:'Command history fixture',content:'<p>Keep exact</p>',content_format:'html'}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));await page.goto(base);await page.locator('.tiptap').waitFor();
 const open=async()=>{await page.keyboard.press('Control+Shift+p');await page.getByRole('dialog',{name:'명령 검색',exact:true}).waitFor();};
 const dialog=page.getByRole('dialog',{name:'명령 검색',exact:true}),query=page.getByRole('combobox',{name:'명령 검색어'});
 await open();await query.fill('무작위 노트 열기');await dialog.getByRole('button',{name:'선택 명령 즐겨찾기',exact:true}).click();await query.press('Enter');await dialog.waitFor({state:'hidden'});
 await open();await dialog.getByRole('button',{name:'최근 실행',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),1);assert((await dialog.getByRole('option').textContent())?.includes('무작위 노트 열기'));await dialog.getByRole('option').click();
 await open();await dialog.getByRole('button',{name:'자주 실행',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),1);await page.keyboard.press('Escape');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('inkism.command-history.v1')!));assert.equal(saved.usage['note.random'].count,2);assert(saved.favorites.includes('note.random'));
 await page.reload();await page.locator('.tiptap').waitFor();await open();await dialog.getByRole('button',{name:'즐겨찾는 명령',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),1);
 await dialog.getByRole('button',{name:'명령 사용 기록 지우기',exact:true}).click();await dialog.getByRole('button',{name:'최근 실행',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),0);await dialog.getByRole('button',{name:'즐겨찾는 명령',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),1);
 await dialog.getByRole('button',{name:'선택 명령 즐겨찾기',exact:true}).click();assert.equal(await dialog.getByRole('option').count(),0);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await open();const box=await dialog.boundingBox();assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=391&&box.y+box.height<=845,'mobile dialog fits viewport');await dialog.getByRole('button',{name:'명령창 닫기',exact:true}).click();
 assert.equal((await rpc('get',{id:note.id})).content,note.content);
 console.log('PASS command favorites/recent/frequent, keyboard execution, restart, clear history preserves favorites, unpin and original source');
}finally{await browser.close();}
