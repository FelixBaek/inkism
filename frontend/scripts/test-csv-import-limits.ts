import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from './browser-env.ts';
const bundle=await build({stdin:{contents:`import {Editor} from '@tiptap/core';import {contentExtensions} from './extensions/content-schema';import {BLOCK_ITEMS,setBlockContext} from './extensions/block-items';window.start=()=>{window.problem='';window.done=false;window.editor?.destroy();window.editor=new Editor({element:document.body.appendChild(document.createElement('div')),extensions:contentExtensions(),content:'<p>Keep original</p>'});setBlockContext(window.editor,{prompt:async()=>null,showError:(_,message)=>{window.problem=message;}});Promise.resolve(BLOCK_ITEMS.find(x=>x.id==='table').run(window.editor,{choice:'csv'})).then(()=>window.done=true).catch(error=>{window.problem="EXCEPTION: "+error.stack;window.done=true;});};`,resolveDir:new URL('../src/',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},logLevel:'silent'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.route('http://localhost/csv-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://localhost/csv-test');await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const [rows,columns,accepted] of [[500,2,true],[501,2,false],[2,31,false]] as const){
  const chooser=page.waitForEvent('filechooser');await page.evaluate(()=>(window as any).start());
  const content=Array.from({length:rows},(_,r)=>Array.from({length:columns},(_,c)=>`r${r}c${c}`).join(',')).join('\n');
  await(await chooser).setFiles({name:'data.csv',mimeType:'text/csv',buffer:Buffer.from(content)});
  await page.waitForFunction(()=>(window as any).done);
  const result=await page.evaluate(()=>({html:(window as any).editor.getHTML(),text:(window as any).editor.getText(),problem:(window as any).problem}));
  if(accepted){assert.equal(result.problem,'');assert(result.text.includes(`r${rows-1}c${columns-1}`));assert.equal((result.html.match(/<tr\b/g)||[]).length,rows);}
  else{assert.equal(result.html,'<p>Keep original</p>');assert(result.problem.includes('내용을 자르지 않았습니다.'));assert(result.problem.includes(`${rows}행·${columns}열`));}
 }
 console.log('PASS CSV import: boundary retained completely; oversized rows/columns explicitly rejected without changing original');
}finally{await browser.close();}
