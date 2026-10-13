import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';

const base=process.env.INKISM_URL||'http://127.0.0.1:49323';
const rpc=async(op:string,args={})=>{const result=await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})}).then(r=>r.json());assert.equal(result.ok,true,JSON.stringify(result));return result.data;};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
const until=async(fn:()=>Promise<boolean>)=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(80);}throw Error('condition timeout');};
const modal=page.locator('.writing-tools-dialog'),title=page.getByRole('textbox',{name:'노트 제목',exact:true});
try{
 let config=await rpc('knowledge_settings_get');
 // A pre-existing same-named definition of another type must be refused, not overwritten.
 config=await rpc('knowledge_settings_set',{version:config.version,collection_update:{operation:'save',definition:{id:'company-number',name:'회사',type:'number'},notes:[]}});
 const start=await rpc('save',{note:{title:'Preset start',content:'<p>x</p>',content_format:'html'}});
 await rpc('workspace_set',{ids:[start.id],active:start.id,locations:{}});await page.goto(base);await page.locator('.tiptap').waitFor();
 await libraryTool(page,'템플릿');
 const presets=modal.getByRole('group',{name:'유형 프리셋',exact:true});
 for(let i=0;i<2;i++){await presets.getByRole('button',{name:'독서 노트 만들기',exact:true}).click();await modal.locator('.writing-template-row').filter({hasText:'독서 노트'}).waitFor();await until(async()=>await presets.getByRole('button',{name:'독서 노트 만들기',exact:true}).isEnabled());}
 assert.equal(await modal.locator('.writing-template-row').filter({hasText:'독서 노트'}).count(),1,'re-run reuses template');
 config=await rpc('knowledge_settings_get');
 const defs=config.property_definitions.map((d:any)=>[d.name,d.type]);
 assert.deepEqual(defs,[['회사','number'],['저자','text'],['독서 상태','select'],['평점','number']],'schema created once');
 assert.equal(config.views.filter((v:any)=>v.name==='독서 노트').length,1,'collection view created once');
 await presets.getByRole('button',{name:'사람 만들기',exact:true}).click();
 await modal.getByRole('alert').filter({hasText:'회사'}).waitFor();
 const after=await rpc('knowledge_settings_get');assert.equal(after.version,config.version,'clash writes nothing');assert.equal(after.template_ids.length,config.template_ids.length);
 await modal.locator('.writing-template-row').getByRole('button',{name:'템플릿으로 새 노트: 독서 노트',exact:true}).click();
 const prompt=page.getByRole('dialog',{name:'템플릿으로 새 노트',exact:true});await prompt.waitFor();await prompt.getByRole('textbox',{name:'노트 제목',exact:true}).fill('데미안');await prompt.getByRole('button',{name:'확인',exact:true}).click();
 await until(async()=>await title.inputValue()==='데미안');
 await page.locator('.tiptap h2',{hasText:'인상 깊은 구절'}).waitFor();await page.locator('.tiptap h1',{hasText:'데미안'}).waitFor();
 const notes=await rpc('list',{view:'all',limit:100}),created=notes.items.find((n:any)=>n.title==='데미안');
 const meta=await rpc('knowledge_get',{id:created.id});
 assert.deepEqual(meta.properties.map((p:any)=>[p.name,p.value]),[['저자',''],['독서 상태','읽을 예정'],['평점',0]],'defaults filled');
 assert.ok(meta.properties.every((p:any)=>config.property_definitions.some((d:any)=>d.id===p.definition_id)),'bound to shared schema');
 assert.deepEqual(errors,[]);console.log('PASS type presets: one click creates schema+defaults+template+view, idempotent re-run, type clash refused atomically, new note gets layout and default properties');
}finally{await browser.close();}
