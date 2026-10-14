import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL||'http://127.0.0.1:48131';
const rpc=async(op:string,args={})=>{const res=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
 const v=await res.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');
 // Deterministic browser font service. Native Windows enumeration is checked separately.
 Object.defineProperty(window,'queryLocalFonts',{configurable:true,value:async()=>[{family:'Arial'},{family:'Arial'},{family:'Georgia'}]});
});
const settings=async()=>{await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.getByRole('button',{name:'편집기',exact:true}).click();};
const close=()=>page.getByRole('button',{name:'설정 닫기',exact:true}).click();
const until=async(fn:()=>Promise<boolean>)=>{for(let i=0;i<200;i++){if(await fn())return;await page.waitForTimeout(50);}throw new Error('condition timeout');};
const find=async(title:string)=>(await rpc('list',{view:'all',limit:100})).items.find((n:any)=>n.title===title);
// The format menu floats only over a text selection (Ctrl+A after a click selects the block instead), so select the line's text.
const openMore=async()=>{const more=page.getByRole('button',{name:'서식 더보기',exact:true});for(let n=0;n<10;n++){await page.locator('.tiptap p').first().click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');if(await more.waitFor({timeout:1000}).then(()=>true,()=>false))break;}await more.click();};// a plugin toggle can refresh the editor and drop the selection, so retry
try {
 const existing=await rpc('save',{note:{title:'기존 HTML 보존',content:'<p><span style="color: rgb(1, 2, 3);">원본</span></p>',content_format:'html'}});
 await rpc('workspace_set',{ids:[existing.id],active:existing.id,locations:{}});await page.goto(base);await page.getByLabel('노트 제목',{exact:true}).waitFor();
 await settings();
 assert.equal(await page.getByRole('radio',{name:'HTML 에디터',exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'설치된 폰트 불러오기',exact:true}).click();
 await page.getByLabel('설치된 폰트',{exact:true}).selectOption('Arial');
 await page.getByLabel('등록할 폰트명',{exact:true}).fill('Comic Sans MS');await page.getByRole('button',{name:'직접 등록',exact:true}).click();
 await page.getByLabel('색 이름',{exact:true}).fill('사용자 포인트');await page.getByLabel('색상값',{exact:true}).fill('#123456');
 await page.getByRole('button',{name:'추가',exact:true}).click();
 await page.getByRole('radio',{name:'MARKDOWN 에디터',exact:true}).click();
 await close();assert.deepEqual(await rpc('get',{id:existing.id}),existing,'default changed an existing note');
 await page.getByRole('button',{name:'새 노트 만들기',exact:true}).first().click();
 await page.locator('[data-editor-tools="markdown"]').waitFor({state:'attached'});
 assert.equal(await page.getByRole('button',{name:'글자색 고르기',exact:true}).count(),0);
 await page.getByLabel('노트 제목',{exact:true}).fill('MD 설정 검증');
 await page.locator('.tiptap').click();await page.keyboard.insertText('Markdown 본문');
 await page.keyboard.press('Control+a');await page.getByRole('button',{name:'굵게',exact:true}).click();
 await until(async()=>{const n=await find('MD 설정 검증');if(!n)return false;return (await rpc('get',{id:n.id})).content.includes('**Markdown 본문**');});
 let note=await rpc('get',{id:(await find('MD 설정 검증')).id});
 assert.equal(note.content_format,'markdown');assert.doesNotMatch(note.content,/<[a-z]/i);
 await page.locator('.tiptap').click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.insertText('새 문단');await page.keyboard.press('Enter');await page.keyboard.press('Control+s');
 await until(async()=> (await rpc('get',{id:note.id})).content.includes('새 문단'));
 const image=Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x10\x80\xc0\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;','binary');
 await page.getByLabel('첨부할 파일 선택',{exact:true}).setInputFiles({name:'pixel.gif',mimeType:'image/gif',buffer:image});
 await until(async()=> (await rpc('get',{id:note.id})).content.includes('![pixel.gif]'));
 await page.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.tiptap img');return image?.complete&&image.naturalWidth===1;});
 note=await rpc('get',{id:note.id});assert.doesNotMatch(note.content,/<[a-z]/i);
 let release:()=>void,entered:()=>void;
 const gate=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>entered=r);
 await page.route('**/api/rpc',async route=>{
   if(route.request().postDataJSON().op==='convert_content'){entered();await gate;await route.continue();}
   else await route.continue();
 });
 await page.getByRole('button',{name:'HTML 에디터로 변환',exact:true}).click();await arrived;
 await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[aria-label="노트 제목"]')?.readOnly===true);
 assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'),'false','conversion must lock editing');
 release();
 await until(async()=> (await rpc('get',{id:note.id})).content_format==='html');
 await page.unroute('**/api/rpc');
 await page.getByRole('button',{name:'MARKDOWN 에디터로 변환',exact:true}).waitFor();
 const converted=await rpc('get',{id:note.id});
 const old=await rpc('revision_body',{id:note.id,revision:note.revision});
 assert.equal(old.content,note.content);assert.equal(old.content_format,'markdown');
 await page.route('**/api/rpc',route=>route.request().postDataJSON().op==='convert_content'
   ? route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic conversion failure'})})
   : route.continue());
 await page.getByRole('button',{name:'MARKDOWN 에디터로 변환',exact:true}).click();
 await page.getByText('synthetic conversion failure',{exact:true}).waitFor();
 assert.deepEqual(await rpc('get',{id:note.id}),converted,'failed conversion changed canonical data');
 await page.getByRole('button',{name:'확인',exact:true}).click();await page.unroute('**/api/rpc');
 
 await openMore();await page.getByRole('button',{name:/^글꼴:/}).click();await page.getByRole('option',{name:'Comic Sans MS',exact:true}).click();
 if(!await page.getByRole('button',{name:'글자색 고르기',exact:true}).count())await page.getByRole('button',{name:'서식 더보기',exact:true}).click();
 await page.getByRole('button',{name:'글자색 고르기',exact:true}).click();await page.getByRole('button',{name:'사용자 포인트',exact:true}).click();
 await until(async()=>{const n=await rpc('get',{id:note.id});return n.content.includes('Comic Sans MS')&&n.content.includes('rgb(18, 52, 86)');});
 const styled=await rpc('get',{id:note.id});
 await page.getByRole('button',{name:'MARKDOWN 에디터로 변환',exact:true}).click();
 await page.getByText('이 서식은 Markdown 에디터에서 보존할 수 없습니다. HTML 에디터나 원문 편집을 이용해 주세요.',{exact:true}).waitFor();
 assert.deepEqual(await rpc('get',{id:note.id}),styled,'refused conversion altered the note');
 await page.getByRole('button',{name:'확인',exact:true}).click();
 // Settings and registered resources survive reopening the app.
 await page.reload();await page.getByLabel('노트 제목',{exact:true}).waitFor();await settings();
 assert.equal(await page.getByRole('radio',{name:'MARKDOWN 에디터',exact:true}).isChecked(),true);
 await page.getByRole('radio',{name:'HTML 에디터',exact:true}).click();
 await page.getByRole('button',{name:'Arial 삭제',exact:true}).waitFor();await page.getByRole('button',{name:'Comic Sans MS 삭제',exact:true}).waitFor();
 await page.getByRole('button',{name:'사용자 포인트 삭제',exact:true}).waitFor();
 await close();await page.getByRole('button',{name:'새 노트 만들기',exact:true}).first().click();
 await page.getByRole('button',{name:'MARKDOWN 에디터로 변환',exact:true}).waitFor();
 await page.getByRole('button',{name:'MARKDOWN 에디터로 변환',exact:true}).click();
 await page.locator('[data-editor-tools="markdown"]').waitFor({state:'attached'});
 await page.getByRole('button',{name:'HTML 에디터로 변환',exact:true}).click();
 await page.locator('[data-editor-tools="rich"]').waitFor({state:'attached'});
 assert.deepEqual(errors,[]);
 console.log('PASS real editor settings: fonts/colors/defaults, visual Markdown save, empty switching, conversion input lock/history/failure/format guard, source preserved');
} finally {await browser.close()}
