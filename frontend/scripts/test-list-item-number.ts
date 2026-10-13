import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from './browser-env.ts';
const bundle=await build({stdin:{contents:"export {inspectRichHTML} from './lib/rich-document';",resolveDir:new URL('../src/',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'admission',platform:'browser',loader:{'.css':'empty'},logLevel:'silent'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const inspect=(window as any).admission.inspectRichHTML;
  return {valid:['2','0','-3','+04'].map(value=>inspect(`<ol><li id="fn-a" value="${value}"><p>Footnote</p></li></ol>`).editable),invalid:['NaN','2.5','2147483648','1 onclick=bad'].map(value=>inspect(`<ol><li value="${value}"><p>Footnote</p></li></ol>`).editable)};
 });
 assert.deepEqual(result.valid,[true,true,true,true]);assert.deepEqual(result.invalid,[false,false,false,false]);
 console.log('PASS explicit list numbers preserve rich admission; invalid values cannot silently normalize');
}finally{await browser.close();}
