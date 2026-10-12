import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:`export {Schema,DOMParser,DOMSerializer} from '@tiptap/pm/model';export {serializeModelMapped} from './src/lib/segment-model';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'serializer',loader:{'.css':'empty'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const results=await page.evaluate(()=>{const {Schema,DOMParser,DOMSerializer,serializeModelMapped}=(window as any).serializer;
  const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{group:'block',content:'inline*',parseDOM:[{tag:'p'}],toDOM:()=>['p',0]},blockquote:{group:'block',content:'block+',parseDOM:[{tag:'blockquote'}],toDOM:()=>['blockquote',0]},text:{group:'inline'}},marks:{strong:{parseDOM:[{tag:'strong'}],toDOM:()=>['strong',0]},em:{parseDOM:[{tag:'em'}],toDOM:()=>['em',0]}}});
  const cases=['<p><strong>한😀&amp; &lt;</strong></p><p>end</p>','<blockquote><p><strong><em>nested</em></strong></p><p>tail</p></blockquote>','<p><strong>'+('a'.repeat(65536))+'</strong></p><p>untouched</p>'];
  return cases.map(source=>{const template=document.createElement('template');template.innerHTML=source;const doc=DOMParser.fromSchema(schema).parse(template.content);const host=document.createElement('div');host.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));const result=serializeModelMapped(doc.content,source.includes('한')?[2]:[]);return {expected:host.innerHTML,actual:result.html,points:result.points,byteBeforeEmoji:new TextEncoder().encode(result.html.slice(0,result.html.indexOf('😀'))).length};});
 });for(const result of results){assert.equal(result.actual,result.expected,'bounded serializer must match complete DOMSerializer without losing closing delimiters');assert.ok(!result.actual.includes('inkism:content'));}assert.equal(results[0].points[0].byte,results[0].byteBeforeEmoji);console.log('PASS bounded model serializer: exact paragraph/nested marks/blockquote/64KiB text closing tags and UTF-8 mapped cursor');
}finally{await browser.close();}
