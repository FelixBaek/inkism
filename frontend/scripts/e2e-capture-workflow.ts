import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args={})=>{const r=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const template=await rpc('save',{note:{title:'Workflow template',content:'<h1>{{title}}</h1><p>Original template</p>',content_format:'html'}});
const config=await rpc('knowledge_settings_get');await rpc('knowledge_settings_set',{version:config.version,template_ids:[template.id],daily_template_id:null});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));await p.goto(base);
 await p.getByRole('button',{name:'빠른 기록',exact:true}).click();const capture=p.getByRole('dialog',{name:'빠른 기록',exact:true});await capture.getByLabel('기록할 내용').fill('Captured workflow original');
 await p.route('**/api/rpc',async route=>{const r=route.request().postDataJSON();if(r.op==='get'&&r.id===template.id){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'template service unavailable'})});return;}await route.continue();});
 await capture.getByRole('button',{name:'템플릿으로 새 노트',exact:true}).click();const templates=p.locator('dialog.writing-tools-dialog:not(.wiki-update-dialog)');await templates.getByRole('alert').getByText('template service unavailable',{exact:true}).waitFor();
 await p.keyboard.press('Escape');await p.unroute('**/api/rpc');await p.keyboard.press('Control+Shift+N');await capture.waitFor();assert.equal(await capture.getByLabel('기록할 내용').inputValue(),'Captured workflow original');
 await capture.getByRole('button',{name:'템플릿으로 새 노트',exact:true}).click();await templates.getByRole('button',{name:'템플릿으로 새 노트: Workflow template',exact:true}).click();
 const prompt=p.getByRole('dialog',{name:'템플릿으로 새 노트',exact:true});await prompt.getByRole('textbox',{name:'노트 제목',exact:true}).fill('New from template');await prompt.getByRole('button',{name:'확인',exact:true}).click();await prompt.waitFor({state:'hidden'});await templates.waitFor({state:'hidden'});
 await p.keyboard.press('Control+Shift+N');await capture.waitFor();assert.equal(await capture.getByLabel('기록할 내용').inputValue(),'Captured workflow original');await capture.getByLabel('제목 (선택)').fill('Connected capture');await capture.getByRole('checkbox',{name:'저장 후 속성과 노트 연결 열기'}).check();await capture.getByRole('button',{name:'저장하고 열기'}).click();
 const knowledge=p.getByRole('dialog',{name:'지식 도구',exact:true});await knowledge.waitFor();await knowledge.getByRole('button',{name:'속성 추가',exact:true}).click();await knowledge.getByRole('textbox',{name:'속성 이름',exact:true}).fill('Reference');await knowledge.getByRole('combobox',{name:'속성 종류',exact:true}).selectOption('relation');await knowledge.getByRole('listbox',{name:'속성 값',exact:true}).selectOption(template.id);await knowledge.getByRole('button',{name:'속성 저장',exact:true}).click();await knowledge.getByText('저장됨',{exact:true}).waitFor();
 await knowledge.getByRole('button',{name:'나가는 관계 Reference: Workflow template 열기',exact:true}).waitFor();
 const notes=(await rpc('list',{view:'all'})).items;const saved=notes.find((n:any)=>n.title==='Connected capture');assert.ok(saved);assert.equal((await rpc('get',{id:saved.id})).content,'Captured workflow original');const meta=await rpc('knowledge_get',{id:saved.id});assert.deepEqual(meta.properties[0].value,[template.id]);assert.equal((await rpc('get',{id:template.id})).revision,template.revision);assert.ok(notes.some((n:any)=>n.title==='New from template'));
 await p.screenshot({path:'/tmp/inkism-capture-connections.png'});
 await p.route('**/api/rpc',async route=>{if(route.request().postDataJSON().op==='relations'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'relation refresh unavailable'})});return;}await route.continue();});
 await p.evaluate(()=>window.dispatchEvent(new Event('inkism-knowledge-changed')));await knowledge.getByRole('alert').getByText('relation refresh unavailable',{exact:true}).waitFor();assert.equal(await knowledge.getByRole('button',{name:'나가는 관계 Reference: Workflow template 열기',exact:true}).count(),0);
 await p.unroute('**/api/rpc');await p.evaluate(()=>window.dispatchEvent(new Event('inkism-knowledge-changed')));await knowledge.getByRole('button',{name:'나가는 관계 Reference: Workflow template 열기',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS capture -> template -> retained draft -> save -> explicit relation; template failure visible and original untouched');
}finally{await browser.close();}
