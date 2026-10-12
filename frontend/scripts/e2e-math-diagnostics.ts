import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.INKISM_URL!;
async function rpc(op:string,args:any={}){const r=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
const latex='x +\n\\badcommand{z}';
const source='<p>Before exact</p><div data-type="block-math" data-latex="'+latex+'">'+latex+'</div><p>After exact</p>';
const note=await rpc('save',{note:{title:'Math diagnostics browser',content:source,content_format:'html'}});
await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});await page.goto(base);
 const math=page.locator('.ProseMirror .inkism-math').first();await math.waitFor();assert.equal(await math.textContent(),latex);assert.equal((await rpc('get',{id:note.id})).content,source);await math.click();
 const dialog=page.locator('dialog.math-dialog');await dialog.waitFor();const field=dialog.locator('textarea');assert.equal(await field.inputValue(),latex);const location=dialog.getByRole('button',{name:/수식 오류 위치:/});await location.click();const selected=await field.evaluate((el:HTMLTextAreaElement)=>({text:el.value.slice(el.selectionStart,el.selectionEnd),focus:document.activeElement===el}));assert.equal(selected.focus,true);assert(selected.text.includes('badcommand'));assert.equal((await rpc('get',{id:note.id})).content,source);
 await field.fill('\\frac{1}{2}');await dialog.locator('.katex').waitFor();assert.equal(await location.count(),0);assert.equal((await rpc('get',{id:note.id})).content,source);await page.keyboard.press('Escape');assert.equal(await math.textContent(),latex);assert.equal((await rpc('get',{id:note.id})).content,source);
 await math.click();await field.fill('\\frac{1}{2}');await dialog.getByRole('button',{name:'적용',exact:true}).click();await dialog.waitFor({state:'hidden'});await math.locator('.katex').waitFor();await page.keyboard.press('Control+s');
 let saved:any;for(let i=0;i<80;i++){saved=await rpc('get',{id:note.id});if(saved.content.includes('\\frac{1}{2}'))break;await new Promise(r=>setTimeout(r,100));}assert(saved.content.includes('\\frac{1}{2}'));assert(saved.content.includes('Before exact'));assert(saved.content.includes('After exact'));assert(!saved.content.includes('badcommand'));
 await math.click();await field.fill(latex);await location.waitFor();await dialog.getByRole('button',{name:'적용',exact:true}).click();await page.keyboard.press('Control+s');for(let i=0;i<80;i++){saved=await rpc('get',{id:note.id});if(saved.content.includes('badcommand'))break;await new Promise(r=>setTimeout(r,100));}assert(saved.content.includes('badcommand'));await page.reload();await math.waitFor();assert.equal(await math.textContent(),latex);
 console.log('PASS math invalid source survives load/save/reload, exact error selection, corrected preview and cancel preserve canonical source, explicit apply persists');
}finally{await browser.close();}
