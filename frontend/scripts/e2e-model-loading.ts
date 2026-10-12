import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{const r=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const mesh=Buffer.alloc(42);[0,0,0,1,0,0,0,1,0].forEach((n,i)=>mesh.writeFloatLE(n,i*4));[0,1,2].forEach((n,i)=>mesh.writeUInt16LE(n,36+i*2));
const gltf=JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{uri:'data:application/octet-stream;base64,'+mesh.toString('base64'),byteLength:42}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36,target:34962},{buffer:0,byteOffset:36,byteLength:6,target:34963}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5123,count:3,type:'SCALAR'}]});
const source='<p>Keep before</p><div data-type="inkism-model3d" data-src="https://model-test.invalid/missing.glb" data-title="missing.glb"><a href="https://model-test.invalid/missing.glb">missing.glb</a></div><p>Keep after</p>';
const note=await rpc('save',{note:{title:'Explicit model loading',content:source,content_format:'html'}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});let requests=0;
 await page.route('https://model-test.invalid/**',route=>{requests++;return route.fulfill({status:requests===1?404:200,body:requests===1?'missing':gltf,contentType:'model/gltf+json',headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.goto(base);const load=page.getByRole('button',{name:'3D 모델 불러오기',exact:true});await load.waitFor();console.log("initial model control ready");
 assert.equal(await page.locator('model-viewer').count(),0);assert.equal(requests,0);
 await load.click();console.log("requested renderer");await page.waitForFunction(()=>customElements.get('model-viewer')!==undefined,undefined,{timeout:15000});console.log('renderer registered');await page.getByText('모델을 불러오지 못했습니다',{exact:true}).waitFor();assert.ok(requests>=1);const first=requests;
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();await page.getByText('끌어서 돌리기 · 휠로 확대',{exact:true}).waitFor();assert.equal(await page.locator('model-viewer').evaluate((el:any)=>el.loaded),true);assert.ok(requests>first,'retry must fetch the missing asset again');
 await page.getByRole('button',{name:'3D 보기 닫기',exact:true}).click();await load.waitFor();assert.equal(await page.locator('model-viewer').count(),0);assert.equal((await rpc('get',{id:note.id})).content,source);
 await page.reload();await load.waitFor();assert.equal(await page.locator('model-viewer').count(),0);assert.equal((await rpc('get',{id:note.id})).content,source);
 console.log('PASS model loading: zero model requests before explicit load, real renderer missing-file state/retry to valid triangle, unmount on close, reload stays unloaded, canonical source unchanged');
} finally {await browser.close();}
