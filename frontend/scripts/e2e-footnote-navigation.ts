import {chromium} from './browser-env.ts';import {libraryTool} from './library-tools.ts';
import assert from 'node:assert/strict';

const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{const reply=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(reply.ok,true,JSON.stringify(reply));return reply.data;};
const source='<p>References <a href="#fn:b">Beta reference</a> again <a href="#fn:b">Beta reference</a> and <a href="#fn:a">Alpha reference</a>.</p><ol><li id="fn:a"><p>Alpha definition</p></li>\r\n<li id="fn:b"><p>Beta definition</p></li></ol>';
const note=await rpc('save',{note:{title:'Footnote navigation fixture',content:source,content_format:'html'}});await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');window.addEventListener('inkism-navigate-anchor',(e:any)=>{(window as any).lastAnchor=e.detail.anchor;});});await page.goto(base);await page.locator('.tiptap').waitFor();
 await libraryTool(page,'PDF·각주');const dialog=page.getByRole('dialog',{name:'라이브러리 도구',exact:true});await dialog.locator('summary').filter({hasText:'b ·'}).click();
 await dialog.getByRole('button',{name:'각주 정의로 이동',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>(window as any).lastAnchor?.searchText==='Beta definition');
 await page.waitForFunction(()=>window.getSelection()?.toString()==='Beta definition');
 assert.equal(await page.evaluate(()=>(window as any).lastAnchor.sourceOffset),source.indexOf('<li id="fn:b">'));
 assert.equal((await rpc('get',{id:note.id})).content,source);
 await libraryTool(page,'PDF·각주');await dialog.locator('summary').filter({hasText:'b ·'}).click();await dialog.getByRole('button',{name:'본문 참조로 이동 2',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>window.getSelection()?.toString()==='Beta reference'&&(window as any).lastAnchor.searchOccurrence===1);
 assert.equal(await page.evaluate(()=>{const selection=window.getSelection()!;const range=document.createRange();range.selectNodeContents(document.querySelector('.tiptap')!);range.setEnd(selection.anchorNode!,selection.anchorOffset);return range.toString().split('Beta reference').length-1;}),1);
 await libraryTool(page,'PDF·각주');await dialog.getByRole('button',{name:'참조 순서로 각주 번호 정리',exact:true}).click();
 const deadline=Date.now()+10000;let saved:any;do{saved=await rpc('get',{id:note.id});if(saved.content.includes('value="2"'))break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.locator('.tiptap[contenteditable="true"]').waitFor();
 assert(saved.content.includes('<a href="#fn:b">1</a>'));assert(saved.content.includes('<li id="fn:a" value="2">'));assert(saved.content.includes('\r\n'));
 await rpc('patch',{id:note.id,revision:saved.revision,changes:{readonly:true},summary_only:true});await page.reload();await page.locator('.tiptap').waitFor();await libraryTool(page,'PDF·각주');
 assert.equal(await dialog.getByRole('button',{name:'참조 순서로 각주 번호 정리',exact:true}).count(),0);await dialog.locator('summary').filter({hasText:'b ·'}).click();await dialog.getByRole('button',{name:'각주 정의로 이동',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>window.getSelection()?.toString()==='Beta definition');
 const markdown='First [^b] and [^a].\n\n[^a]: Alpha definition\n\n[^b]: Beta definition';const md=await rpc('save',{note:{title:'Markdown footnote fixture',content:markdown,content_format:'markdown'}});await page.goto('about:blank');await rpc('workspace_set',{ids:[md.id],active:md.id,locations:{}});await page.goto(base);await page.locator('.cm-content').waitFor();await libraryTool(page,'PDF·각주');await dialog.locator('summary').filter({hasText:'[^b] ·'}).click();await dialog.getByRole('button',{name:'각주 정의로 이동',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const selection=window.getSelection();return selection?.anchorNode?.parentElement?.closest('.cm-line')?.textContent==='[^b]: Beta definition'&&selection.anchorOffset===0;});assert.equal((await rpc('get',{id:md.id})).content,markdown);
 const previewSource='<p data-external="keep">References <a href="#fn:z">Z reference</a></p><p id="fn-z"><sup>z</sup> Preview definition</p>';const preview=await rpc('save',{note:{title:'Preview footnote fixture',content:previewSource,content_format:'html'}});await page.goto('about:blank');await rpc('workspace_set',{ids:[preview.id],active:preview.id,locations:{}});await page.goto(base);await page.locator('.tiptap[contenteditable="false"]').waitFor();await libraryTool(page,'PDF·각주');await dialog.locator('summary').filter({hasText:'z ·'}).click();await dialog.getByRole('button',{name:'각주 정의로 이동',exact:true}).click();await page.waitForFunction(()=>window.getSelection()?.toString()==='Preview definition');assert.equal((await rpc('get',{id:preview.id})).content,previewSource);
 console.log('PASS app footnotes: actual definition/repeated reference selection, readonly and preview navigation, Markdown caret, exact source preservation, guarded HTML numbering retains rich editing');
}finally{await browser.close();}
