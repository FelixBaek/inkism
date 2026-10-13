import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';

const temporary=mkdtempSync(join(tmpdir(),'inkism-error-localization-'));
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),cacheDir:temporary,server:{port:0,host:'127.0.0.1',hmr:false}});
let browser;
try {
  await server.listen();
  const base='http://127.0.0.1:'+(server.httpServer!.address() as AddressInfo).port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
  for(const lang of ['ko','en','ja','zh']) {
    // Workers have no localStorage. The main client's saved choice must still
    // win even when the system/worker language is English.
    const context=await browser.newContext({locale:'en-US'});
    try {
      const page=await context.newPage(),errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(lang=>localStorage.setItem('inkism.lang',lang),lang);
      await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div role="alert" id="error"></div>'}));
      const requests:{op:string;fixture:number}[]=[];
      const dict=lang==='ko'?{}:JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8'));
      const translated=(key:string,values:Record<string,string>={})=>(dict[key]??key).replace(/\{(\w+)\}/g,(match:string,key:string)=>values[key]??match);
      const conflict='conflict: note n-1 revision 3 != current 4';
      const readonly='conflict: 읽기 전용 노트입니다. 읽기 전용을 해제한 뒤 편집하세요';
      const cases:{raw:string;code?:string;conflict:boolean;text:string;status?:number;budget?:boolean;duplicate?:boolean}[]=[
        {raw:conflict,code:'conflict',conflict:true,text:translated('충돌: {error}',{error:translated('노트 {id}의 버전이 바뀌었습니다 (요청 {expected}, 현재 {current}). 다시 불러와 주세요.',{id:'n-1',expected:'3',current:'4'})})},
        {raw:'storage engine: '+readonly,code:'conflict',conflict:true,text:translated('저장소 오류: {error}',{error:translated('충돌: {error}',{error:translated('읽기 전용 노트입니다. 읽기 전용을 해제한 뒤 편집하세요')})})},
        {raw:'runtime config: 금고 비밀번호가 맞지 않습니다',code:'runtime_config',conflict:false,text:translated('앱 설정 오류: {error}',{error:translated('금고 비밀번호가 맞지 않습니다')})},
        {raw:'not_found: note n-404',code:'not_found',conflict:false,text:translated('찾을 수 없음: {error}',{error:translated('노트를 찾을 수 없습니다: {id}',{id:'n-404'})})},
        {raw:'authentication failed',code:undefined,conflict:false,status:401,text:translated('인증에 실패했습니다. 다시 로그인해 주세요.')},
        {raw:'첨부파일이 없습니다.',code:undefined,conflict:false,text:translated('첨부파일이 없습니다.')},
        {raw:'internal: sqlite: disk full /tmp/library.sqlite:77',code:'internal',conflict:false,text:translated('내부 오류: {error}',{error:'sqlite: disk full /tmp/library.sqlite:77'})},
        {raw:'새 진단: /tmp/source.html (예상 11, 실제 12)',code:undefined,conflict:false,text:'새 진단: /tmp/source.html (예상 11, 실제 12)'},
        {raw:'constructor',code:undefined,conflict:false,text:'constructor'},
        {raw:'invalid: note body exceeds read budget',code:'invalid',conflict:false,budget:true,text:translated('잘못된 요청: {error}',{error:translated('노트 본문이 조회 용량 제한을 초과했습니다. 구간별로 불러옵니다.')})},
        {raw:'invalid: duplicate block ID "copy-id": rename the duplicate block ID before merging',code:'invalid',conflict:false,duplicate:true,text:translated('잘못된 요청: {error}',{error:translated('중복 문단 ID {id}: 병합 전에 ID를 바꿔 주세요.',{id:'"copy-id"'})})},
        {raw:'invalid: note body exceeds read budget',code:'invalid',conflict:false,status:403,text:translated('잘못된 요청: {error}',{error:translated('노트 본문이 조회 용량 제한을 초과했습니다. 구간별로 불러옵니다.')})},
        {raw:'internal: note body exceeds read budget',code:'internal',conflict:false,status:500,text:translated('내부 오류: {error}',{error:translated('노트 본문이 조회 용량 제한을 초과했습니다. 구간별로 불러옵니다.')})},
      ];
      await page.route(base+'/api/rpc',route=>{
        const request=route.request().postDataJSON();requests.push(request);
        const fixture=cases[request.fixture];
        return route.fulfill({status:fixture.status??400,contentType:'application/json',body:JSON.stringify({ok:false,error:fixture.raw})});
      });
      await page.goto(base);
      for(let fixture=0;fixture<cases.length;fixture++) {
        const actual=await page.evaluate(async fixture=>{
          // @ts-expect-error -- browser import served by Vite
          const {rpc,RpcError,hasRpcDiagnostic}=await import('/src/api.ts');
          try {await rpc('save',{fixture});throw new Error('fixture unexpectedly succeeded');}
          catch(error) {
            if(!(error instanceof RpcError))throw error;
            document.getElementById('error')!.textContent=error.message;
            return {code:error.code,raw:error.rawMessage,conflict:error.isConflict,status:error.status,budget:hasRpcDiagnostic(error,'body_read_budget'),duplicate:hasRpcDiagnostic(error,'duplicate_block_id')};
          }
        },fixture);
        const expected=cases[fixture];
        assert.deepEqual(actual,{code:expected.code,raw:expected.raw,conflict:expected.conflict,status:expected.status??400,budget:expected.budget??false,duplicate:expected.duplicate??false},lang+' RPC metadata '+fixture);
        assert.equal(await page.getByRole('alert').textContent(),expected.text,lang+' UI message '+fixture);
      }
      assert.deepEqual(requests,cases.map((_,fixture)=>({op:'save',fixture})),'production rpc client must send the requested operation');
      assert.deepEqual(await page.evaluate(async()=>{
        // @ts-expect-error -- browser import served by Vite
        const {RpcError,hasRpcDiagnostic}=await import('/src/api.ts');
        const known=new RpcError('get','storage engine: invalid: note body exceeds read budget',400);
        known.message='Display text is independent of the protocol';
        return [
          hasRpcDiagnostic(known,'body_read_budget'),
          hasRpcDiagnostic(new Error('invalid: note body exceeds read budget'),'body_read_budget'),
          hasRpcDiagnostic(new RpcError('get','invalid: diagnostic mentions note body exceeds read budget',400),'body_read_budget'),
          hasRpcDiagnostic(new RpcError('get','invalid: internal: note body exceeds read budget',400),'body_read_budget'),
          hasRpcDiagnostic(new RpcError('merge_preview','invalid: diagnostic mentions duplicate block ID',400),'duplicate_block_id'),
        ];
      }),[true,false,false,false,false],'semantic fallback must not depend on display text or incidental diagnostic mentions');
      const workers=await page.evaluate(async()=>{
        // @ts-expect-error -- browser imports served by Vite
        const {deriveTextInWorker}=await import('/src/lib/plaintext-client.ts');
        // @ts-expect-error -- browser imports served by Vite
        const {deriveSplices}=await import('/src/lib/splice-client.ts');
        // @ts-expect-error -- browser imports served by Vite
        const {scanSourceInWorker}=await import('/src/lib/source-scan-client.ts');
        const capture=async(work:Promise<unknown>)=>{try{await work;throw Error('bad worker input unexpectedly succeeded');}catch(error){return error instanceof Error?error.message:String(error);}};
        const failures=await Promise.all([
          capture(deriveTextInWorker(null as any)),
          capture(deriveSplices({content:null as any,text:''},{content:'',text:''})),
          capture(scanSourceInWorker({source:'<p><strong>x</p>',byteOffset:0,context:[]},()=>{})),
        ]);
        const text=await deriveTextInWorker('<p>다시😀</p>');
        const splices=await deriveSplices({content:'one',text:'one'},{content:'two',text:'two'});
        const source=Array.from(await scanSourceInWorker({source:'<p>retry😀</p>',byteOffset:0,context:[]},()=>{})).map(segment=>segment.source).join('');
        return {failures,text,source,splices};
      });
      assert(workers.failures[0].startsWith(translated('검색용 텍스트를 추출하지 못했습니다.')+'\n'));
      assert.match(workers.failures[0],/replace/,'plaintext failure must retain its actual cause');
      assert(workers.failures[1].startsWith(translated('변경 구간을 계산하지 못했습니다.')+'\n'));
      assert.match(workers.failures[1],/length/,'splice failure must retain its actual cause');
      assert.equal(workers.failures[2],translated('문서 구간을 계산하지 못했습니다.')+'\n'+translated('표시 구간의 태그가 맞지 않습니다.'));
      assert.equal(workers.text,'다시😀');assert.equal(workers.source,'<p>retry😀</p>');
      assert.deepEqual(workers.splices,{content:{start:0,expected:'one',replacement:'two'},text:{start:0,expected:'one',replacement:'two'}});
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }
  console.log('PASS ko/en/ja/zh RPC error UI, raw diagnostic/code/conflict preservation, saved-language worker errors, actual failure causes and retries');
} finally {await browser?.close();await server.close();rmSync(temporary,{recursive:true,force:true});}
