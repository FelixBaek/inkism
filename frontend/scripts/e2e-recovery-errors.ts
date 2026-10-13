import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from './browser-env.ts';

const base=process.env.INKISM_URL||'http://127.0.0.1:47972';
const rpc=async(op:string,args:object={})=>{
  const response=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});
  const envelope=await response.json();assert.equal(envelope.ok,true,JSON.stringify(envelope));return envelope.data;
};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
  for(const lang of ['ko','en','ja','zh']) {
    const dict=lang==='ko'?{}:JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8'));
    const text=(key:string,values:Record<string,string|number>={})=>(dict[key]??key).replace(/\{(\w+)\}/g,(match:string,key:string)=>values[key]===undefined?match:String(values[key]));
    const original='<p>기준😀</p><p>원문을 유지</p>',title='Recovery classification '+lang+' '+Date.now();
    const note=await rpc('save',{note:{title,content:original,text:'기준😀 원문을 유지',content_format:'html'}});
    await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
    const snapshot={format:'inkism-draft',version:1,note:{id:note.id,title,notebook_id:null,tags:['recovery'],content_format:'html'},
      body:{kind:'partial',revision:999999,offset_encoding:'utf-8',edit_order:'sequential',edits:[
        {start:0,expected:'<p>기준😀</p>',replacement:'<p>첫 편집😀</p>'},
        {start:20,expected:'<p>원문을 유지</p>',replacement:''},
      ]}};
    const missing=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'revision_body',id:note.id,revision:snapshot.body.revision})})).json();
    assert.equal(missing.ok,false);assert.match(missing.error,/^not_found:/,'missing-baseline case must come from the actual engine');
    const context=await browser.newContext({locale:lang==='zh'?'zh-Hans':lang+'-'+({ko:'KR',en:'US',ja:'JP'} as Record<string,string>)[lang]});
    try {
      const page=await context.newPage(),pageErrors:string[]=[],writes:string[]=[];
      page.on('pageerror',error=>pageErrors.push(error.message));
      page.on('request',request=>{if(request.url().endsWith('/api/rpc'))try{
        const op=request.postDataJSON()?.op;
        if(['save','patch','delete','restore','document_splice','document_splice_html','document_splice_source','vault_save'].includes(op))writes.push(op);
      }catch{/* Non-RPC requests are irrelevant to note mutation. */}});
      await page.addInitScript(lang=>{localStorage.setItem('inkism.lang',lang);localStorage.setItem('inkism.inspector','false');},lang);
      let failure:{status?:number;error?:string;abort?:boolean}|undefined;
      await page.route('**/api/rpc',route=>{
        if(route.request().postDataJSON()?.op!=='revision_body'||!failure)return route.continue();
        return failure.abort?route.abort('failed'):route.fulfill({status:failure.status,contentType:'application/json',body:JSON.stringify({ok:false,error:failure.error})});
      });
      await page.goto(base);await page.locator('.title-input').waitFor();
      assert.equal(await page.locator('.title-input').inputValue(),title);
      await page.getByRole('button',{name:text('설정 열기'),exact:true}).click();
      await page.locator('.settings-nav').getByRole('button',{name:text('가져오기'),exact:true}).click();
      const upload=async(data:unknown)=>page.getByLabel(text('편집 보관 파일'),{exact:true}).setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      const before=await rpc('stats'),writesBefore=writes.length;
      await upload(snapshot);
      await page.getByRole('button',{name:text('편집 구간 복구'),exact:true}).waitFor();
      await page.getByText(text('기준 본문이 없어 문서 전체를 복구할 수 없습니다. 파일에 남은 편집 구간을 변경 순서대로 새 노트에 담을까요? 삭제한 구간도 별도로 표시합니다.'),{exact:true}).waitFor();
      await page.getByRole('button',{name:text('취소'),exact:true}).click();
      assert.equal(writes.length,writesBefore);assert.deepEqual(await rpc('stats'),before,'declined missing-baseline recovery must make no writes');
      for(const injected of [
        {status:500,error:'internal: not_found: misleading trace (sqlite failure)'},
        {abort:true},
        {status:403,error:'not_found: baseline hidden by access policy'},
        {status:503,error:'not_found: baseline service unavailable'},
      ]) {
        failure=injected;
        const startWrites=writes.length;
        await upload(snapshot);
        await page.getByRole('button',{name:text('확인'),exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:text('편집 구간 복구'),exact:true}).count(),0,'transport/permission/database failures must not open partial recovery');
        if(injected.abort)await page.getByText(text('네트워크 오류: 엔진에 연결할 수 없습니다'),{exact:true}).waitFor();
        assert.equal(writes.length,startWrites,'an error must never write a recovered note');
        assert.deepEqual(await rpc('stats'),before);
        assert.equal((await rpc('get',{id:note.id})).content,original);
        await page.getByRole('button',{name:text('확인'),exact:true}).click();
      }
      failure=undefined;
      // A translated suffix must fit the engine's 2,000-code-point title limit.
      const long=structuredClone(snapshot);long.note.title='제목😀'.repeat(666)+'끝';
      const suffix=text(' (편집 구간 복구)'),recoveredTitle=Array.from(long.note.title).slice(0,2000-Array.from(suffix).length).join('')+suffix;
      await upload(long);
      await page.getByRole('button',{name:text('편집 구간 복구'),exact:true}).click();
      await page.getByText(text('새 노트로 복구했습니다: {title}',{title:recoveredTitle}),{exact:true}).waitFor();
      assert.equal(writes.length,writesBefore+1);assert.equal(writes.at(-1),'save');
      const summary=(await rpc('list',{view:'all',limit:1000})).items.find((item:any)=>item.title===recoveredTitle);
      assert.ok(summary);assert.notEqual(summary.id,note.id);assert.equal(Array.from(summary.title).length,2000);
      const recovered=await rpc('get',{id:summary.id});
      assert.equal(recovered.content,'<p>'+text('기준 본문이 없어 편집한 구간만 복구했습니다. 아래 구간은 변경 순서이며 서로 겹칠 수 있습니다.')+'</p><h2>'+text('편집 구간 {n}',{n:1})+'</h2><p>첫 편집😀</p><h2>'+text('편집 구간 {n}',{n:2})+'</h2><p>'+text('이 구간을 삭제했습니다.')+'</p>');
      assert.deepEqual(recovered.tags,['recovery']);assert.equal(recovered.content_format,'html');
      assert.equal((await rpc('get',{id:note.id})).content,original);
      assert.equal(await page.locator('.title-input').inputValue(),title,'import must preserve the original editor');
      assert.deepEqual(pageErrors,[]);
    } finally {await context.close();}
  }
  console.log('PASS ko/en/ja/zh actual missing baseline confirm/cancel/recover, internal/network/403/503 no-confirm/no-save, localized recovery/title limit and original preservation');
} finally {await browser.close();}
