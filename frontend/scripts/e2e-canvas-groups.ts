import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';import {libraryTool} from './library-tools.ts';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:Record<string,unknown>={})=>{const r=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
const note=await rpc('save',{note:{title:'Canvas group fixture',content:'<p>canonical untouched</p>',content_format:'html'}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const previousWorkspace=await rpc('workspace_tools_get');await rpc('workspace_tools_set',{canvas:{version:1,nodes:[],edges:[]},expected_updated_at:{workspace_canvas:previousWorkspace.canvas.updated_at}});
try{
 await page.goto(base);await page.locator('.tiptap').waitFor();await libraryTool(page,'캔버스');
 const dialog=page.getByRole('dialog',{name:'라이브러리 도구',exact:true});const board=dialog.locator('.canvas-board');
 await board.getByRole('button',{name:'그룹 추가',exact:true}).click();assert.equal(await board.locator('.canvas-group').count(),1);
 await board.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await board.locator('.canvas-group').count(),0);
 await board.getByRole('button',{name:'다시 실행',exact:true}).click();assert.equal(await board.locator('.canvas-group').count(),1);
 const fixture={nodes:[{id:'g',type:'group',x:30,y:30,width:620,height:430,label:'Research',background:'assets/grid.png',backgroundStyle:'repeat'},{id:'nested',type:'group',x:360,y:200,width:250,height:200,label:'Nested'},{id:'child',type:'text',x:100,y:290,width:220,height:130,text:'Inside'},{id:'partial',type:'text',x:620,y:100,width:220,height:130,text:'Partial'},{id:'outside',type:'link',x:850,y:100,width:220,height:130,url:'https://example.com/'}],edges:[{id:'e',fromNode:'g',toNode:'child'}]};
 await board.locator('.canvas-import input').setInputFiles({name:'groups.canvas',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 const group=board.locator('[data-canvas-node="g"]');await group.waitFor();assert.equal(await board.locator('.canvas-warning').count(),0);
 assert.deepEqual(await board.locator('[data-canvas-node]').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-canvas-node'))),['g','nested','child','partial','outside']);
 const pos=()=>board.locator('[data-canvas-node]').evaluateAll(ns=>ns.map(n=>({id:n.getAttribute('data-canvas-node'),x:parseFloat((n as HTMLElement).style.left),y:parseFloat((n as HTMLElement).style.top)})));
 const before=await pos();const handle=await group.locator(':scope > strong').boundingBox();assert.ok(handle);await page.mouse.move(handle.x+20,handle.y+10);await page.mouse.down();await page.mouse.move(handle.x+60,handle.y+30,{steps:8});await page.mouse.up();
 const moved=await pos();for(let i=0;i<before.length;i++){const inside=['g','nested','child'].includes(before[i].id!);assert.equal(moved[i].x,before[i].x+(inside?40:0));assert.equal(moved[i].y,before[i].y+(inside?20:0));}
 await board.getByRole('button',{name:'실행 취소',exact:true}).click();assert.deepEqual(await pos(),before,'one undo restores entire drag including nested group');
 await board.getByRole('button',{name:'다시 실행',exact:true}).click();assert.deepEqual(await pos(),moved);
 await group.focus();await page.keyboard.press('ArrowRight');assert.equal((await pos())[2].x,moved[2].x+10);await board.getByRole('button',{name:'실행 취소',exact:true}).click();
 await group.locator(':scope > strong').click();await board.getByRole('textbox',{name:'그룹 이름',exact:true}).fill('Project');
 await board.getByRole('spinbutton',{name:'카드 너비',exact:true}).fill('700');await board.getByRole('spinbutton',{name:'카드 높이',exact:true}).fill('500');
 await board.getByRole('combobox',{name:'배경 표시 방식',exact:true}).selectOption('ratio');
 // Missing imported paths are retained without external image requests.
 assert.equal(await group.locator('img').count(),0);
 await board.getByRole('button',{name:'삭제',exact:true}).click();assert.equal(await board.locator('[data-canvas-node]').count(),4);assert.equal(await board.locator('[data-canvas-node="child"]').count(),1);
 await board.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await board.locator('[data-canvas-node]').count(),5);
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/rpc')&&r.request().postDataJSON()?.op==='workspace_tools_set');await dialog.getByRole('button',{name:'작업공간 저장',exact:true}).click();assert.equal((await(await response).json()).ok,true);await dialog.getByText('저장됨',{exact:true}).waitFor();};
 await save();const stored=(await rpc('workspace_tools_get')).canvas.value;assert.deepEqual(stored.nodes.map(n=>n.id),['g','nested','child','partial','outside']);assert.equal(stored.nodes[0].label,'Project');assert.equal(stored.nodes[0].width,700);assert.equal(stored.nodes[0].height,500);assert.equal(stored.nodes[0].background,'assets/grid.png');assert.equal(stored.nodes[0].backgroundStyle,'ratio');assert.equal(stored.edges.length,1);
 const download=page.waitForEvent('download');await board.getByRole('button',{name:'내보내기',exact:true}).click();const path=await(await download).path();const exported=JSON.parse(await readFile(path!,'utf8'));assert.equal(exported.nodes[0].type,'group');assert.equal(exported.nodes[0].label,'Project');assert.equal(exported.nodes[0].backgroundStyle,'ratio');assert.deepEqual(exported.nodes.map(n=>n.id),fixture.nodes.map(n=>n.id));
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.reload();await page.locator('.tiptap').waitFor();await libraryTool(page,'캔버스');await group.waitFor();assert.equal(await group.locator(':scope > strong').textContent(),'▱ Project');assert.equal(await group.evaluate(n=>(n as HTMLElement).style.width),'700px');assert.deepEqual((await rpc('workspace_tools_get')).canvas.value,stored);assert.equal((await rpc('get',{id:note.id})).content,'<p>canonical untouched</p>');assert.deepEqual(errors,[]);
 // Upload through the existing file-card flow, then use its actual local UUID
 // for a group background; all three render styles must stay local and load.
 await board.locator('input[type="file"]').first().setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/mkAAAAASUVORK5CYII=','base64')});
 await board.locator('[data-canvas-kind="file"]').waitFor();await save();const asset=(await rpc('workspace_tools_get')).canvas.value.nodes.find(n=>n.kind==='file');assert.ok(asset.attachmentId);
 await group.locator(':scope > strong').click();await board.getByRole('textbox',{name:'배경 첨부 ID 또는 경로',exact:true}).fill(asset.attachmentId);
 for(const style of ['cover','ratio','repeat']){
  await board.getByRole('combobox',{name:'배경 표시 방식',exact:true}).selectOption(style);
  await page.waitForFunction(()=>{const img=document.querySelector<HTMLImageElement>('[data-canvas-node="g"] img');return img?.complete&&img.naturalWidth===1;});
  assert.equal(await group.locator('img').getAttribute('src'),'/api/attachments/'+asset.attachmentId+'?preview=1');
 }
 await board.getByRole('textbox',{name:'배경 첨부 ID 또는 경로',exact:true}).fill('00000000-0000-4000-8000-000000000099');
 await group.getByText('배경 경로는 보존됩니다. 미리보려면 이 라이브러리의 이미지 첨부 ID를 사용하세요.',{exact:true}).waitFor();
 await board.getByRole('textbox',{name:'배경 첨부 ID 또는 경로',exact:true}).fill(asset.attachmentId);await save();assert.equal((await rpc('workspace_tools_get')).canvas.value.nodes[0].background,asset.attachmentId);
 assert.deepEqual(errors,[]);
 console.log('PASS actual Canvas groups: create, nested move, partial exclusion, keyboard, gesture undo/redo, label/resize/background, delete children retained, SQLite save/reload, JSON export and source unchanged');
}finally{await browser.close();}
