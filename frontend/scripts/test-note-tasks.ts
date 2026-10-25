import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chromium} from './browser-env.ts';
const bundle=await build({stdin:{contents:"export {noteTasks,TASK_SCAN_BYTES} from './lib/note-tasks';",resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'tasks',platform:'browser',loader:{'.css':'empty'},external:['mermaid','@google/model-viewer'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const scan=(source:string,format:string)=>page.evaluate(({source,format})=>(window as any).tasks.noteTasks(source,format),{source,format});
 const li=(label:string,checked=false)=>`<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"></label><div><p>${label}</p></div></li>`;
 assert.deepEqual(await scan(`<ul data-type="taskList">${li('한글 &amp; 😀')}${li('같은 이름')}${li('같은 이름',true)}</ul>`,'html'),[{ordinal:0,text:'한글 & 😀',checked:false},{ordinal:1,text:'같은 이름',checked:false},{ordinal:2,text:'같은 이름',checked:true}]);
 assert.deepEqual(await scan(`<ul><li data-type="taskItem" data-checked="false"><div><p>Parent</p><ul>${li('Child',true)}</ul></div></li></ul>`,'html'),[{ordinal:0,text:'Parent',checked:false},{ordinal:1,text:'Child',checked:true}]);
 assert.deepEqual(await scan(`<!-- ${li('Comment')} --><template>${li('Hidden')}</template><pre>${li('Code')}</pre><script>window.executed=true</script><ul>${li('Visible')}</ul>`,'html'),[{ordinal:0,text:'Visible',checked:false}]);
 assert.equal(await page.evaluate(()=>(window as any).executed),undefined);
 const md='\uFEFF- [ ] **Parent**\r\n  - [x] Child\r\n\r\n```md\r\n- [ ] Code\r\n```\r\n\r\n<!--\r\n- [ ] Comment\r\n-->\r\n\r\n- [X] Done\r\n';
 assert.deepEqual(await scan(md,'markdown'),[{ordinal:0,text:'Parent',checked:false},{ordinal:1,text:'Child',checked:true},{ordinal:2,text:'Done',checked:true}]);
 assert.deepEqual(await scan('- [ ] literal\n'+li('literal'),'text'),[]);
 assert.deepEqual(await scan('plain paragraph','markdown'),[]);
 assert.equal(await page.evaluate(()=>(window as any).tasks.noteTasks('- [ ] One\n- [ ] Two','markdown',1).length),1);
 assert.equal(await page.evaluate(()=>(window as any).tasks.noteTasks('<ul>'+('<li data-type="taskItem"><p>One</p></li>'.repeat(100))+'</ul>','html',2).length),2);
 assert.equal(await page.evaluate(()=>{try{(window as any).tasks.noteTasks('한'.repeat(3*1024*1024),'html');return '';}catch(e){return (e as Error).message;}}),'TASK_SCAN_TOO_LARGE');
 console.log('PASS note task projection: HTML/Markdown, nested/duplicate/Unicode tasks, code/comment exclusion, inert content, plain-text preservation and byte limit');
} finally {await browser.close();}
