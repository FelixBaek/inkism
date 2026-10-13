// Actual Rust cache + shipped React/Tiptap editor + source projection. This
// bounded-model fixture is not integration of the production window navigator.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';
import {createServer} from 'vite';
import {chromium} from './browser-env.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const fixtureDir=await mkdtemp(join(tmpdir(),'inkism-rich-segments-'));
const executable=process.env.INKISM_SEGMENT_ENGINE;
assert.ok(executable,'INKISM_SEGMENT_ENGINE must point at the current Rust engine');
const engine=spawn(executable,['--db',join(fixtureDir,'notes.db')],{stdio:['pipe','pipe','pipe']});
const pending=[];let engineError='';
engine.stderr.on('data',data=>{engineError+=data.toString();});
createInterface({input:engine.stdout}).on('line',line=>{
 const task=pending.shift();if(!task)return;
 try{const response=JSON.parse(line);response.ok?task.resolve(response.data):task.reject(Error(response.error));}catch(error){task.reject(error);}
});
engine.on('error',error=>{while(pending.length)pending.shift().reject(error);});
engine.on('exit',code=>{while(pending.length)pending.shift().reject(Error(`engine exit ${code}: ${engineError}`));});
const call=request=>new Promise<any>((resolve,reject)=>{pending.push({resolve,reject});engine.stdin.write(JSON.stringify(request)+'\n');});
const wait=async()=>{assert.equal((await call({op:'wait_index'})).pending,0);};
const requests=[];
function sameSource(actual,expected,label='source') {
 if(actual===expected)return;
 let at=0;while(at<Math.min(actual.length,expected.length)&&actual[at]===expected[at])at++;
 assert.fail(`${label} differs at UTF-16 ${at}; lengths ${actual.length}/${expected.length}; actual=${JSON.stringify(actual.slice(Math.max(0,at-40),at+70))}; expected=${JSON.stringify(expected.slice(Math.max(0,at-40),at+70))}`);
}
const server=await createServer({root,cacheDir:join(fixtureDir,'vite'),server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{
 name:'rich-segments-fixture',enforce:'pre',
 resolveId(source,importer){if(source==='../store'&&importer?.includes('/components/'))return '\0segments-store';},
 load(id){if(id==='\0segments-store')return `export function useStore(){return {prompt:async()=>null,showError:async()=>{throw Error('Unexpected fixture operation')}}}`;},
 configureServer(vite){
  vite.middlewares.use('/api/rpc',async(req,res)=>{
   try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(request.op);
    const data=await call(request);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data}));
   }catch(error){res.statusCode=400;res.end(JSON.stringify({ok:false,error:error.message}));}
  });
  vite.middlewares.use('/__rich-segments',async(req,res,next)=>{
   if(req.url.includes('html-proxy'))return next();
   try{const html=await vite.transformIndexHtml('/__rich-segments',`<div id="root"></div><script type="module">
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {RichEditor} from '/src/components/RichEditor.tsx';
    import {renderSegment,projectSegment} from '/src/lib/rich-segment.ts';
    import {canonicalRichHTML,inspectRichHTML} from '/src/lib/rich-document.ts';
    import {rpc} from '/src/api.ts';
    const root=createRoot(document.getElementById('root'));
    const f=window.fixture={editor:null,pending:null,deliveries:0,error:null,project:projectSegment,render:renderSegment,canonical:canonicalRichHTML,inspect:inspectRichHTML};
    f.mount=(id,revision,segment)=>{
     f.id=id;f.revision=revision;f.segment=segment;f.pending=null;f.error=null;f.editor=null;
     const html=renderSegment(segment), inspection=inspectRichHTML(html);
     if(!inspection.editable)throw Error('Fixture source does not preserve rich structure');
     root.render(React.createElement(RichEditor,{key:id+':'+segment.ordinal,embedded:true,internalWindow:true,initialContent:html,
      onEditor:editor=>f.editor=editor,
      onChange:html=>{try{f.pending=projectSegment(f.segment,html);f.deliveries++;}catch(error){f.error=error.message;}},
     }));
    };
    f.save=async()=>{
     window.dispatchEvent(new Event('inkism-flush-editor'));
     if(f.error)throw Error(f.error);
     if(f.pending===null)throw Error('No edit to save');
     const replacement=f.pending, expected=f.segment.source, start=f.segment.byte_offset;
     const result=await rpc('document_splice_html',{id:f.id,revision:f.revision,content:{start,expected,replacement}});
     f.segment={...f.segment,source:replacement};f.revision=result.revision;f.pending=null;
     return {start,expected,replacement,revision:result.revision};
    };
   </script>`);res.setHeader('Content-Type','text/html');res.end(html);}catch(error){next(error);}
  });
 },
}]});
let browser;
const errors=[];
try{
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}/__rich-segments`);
 await page.waitForFunction(()=>(window as any).fixture);
 const source='<p><strong>'+'한글😀&amp;'.repeat(50000)+'</strong></p>';
 const note=await call({op:'save',note:{title:'synthetic segment',content:source,text:'한글'}});await wait();
 const first=await call({op:'document_segments',id:note.id,revision:1,ordinal:0});
 const middle=await call({op:'document_segments',id:note.id,revision:1,ordinal:0,offset:Math.floor(first.total_segments/2)});
 const segment=middle.segments[0];assert.ok(Buffer.byteLength(segment.source)<=32768);
 await page.evaluate(({id,segment})=>(window as any).fixture.mount(id,1,segment),{id:note.id,segment});
 await page.waitForFunction(()=>(window as any).fixture.editor?.isInitialized);
 assert.equal(await page.evaluate(()=>(window as any).fixture.deliveries),0,'mount never saves normalized source');
 assert.equal(await page.evaluate(()=>(window as any).fixture.project((window as any).fixture.segment,(window as any).fixture.canonical((window as any).fixture.render((window as any).fixture.segment)))),segment.source);
 let expected=source;
 const verify=async edit=>{
  const bytes=Buffer.from(expected),end=edit.start+Buffer.byteLength(edit.expected);
  assert.equal(bytes.subarray(edit.start,end).toString(),edit.expected);
  expected=Buffer.concat([bytes.subarray(0,edit.start),Buffer.from(edit.replacement),bytes.subarray(end)]).toString();
  const saved=await call({op:'get',id:note.id});sameSource(saved.content,expected,'saved');assert.equal(saved.revision,edit.revision);
  assert.ok(expected.startsWith('<p><strong>한글😀&amp;'));assert.ok(expected.endsWith('한글😀&amp;</strong></p>'));
 };
 await page.evaluate(()=>{const f=(window as any).fixture;const at=f.editor.state.doc.firstChild.textContent.indexOf('한글')+1;f.editor.commands.setTextSelection(at);f.editor.commands.insertContent('입력😀');});
 const inserted=await page.evaluate(()=>(window as any).fixture.save());await verify(inserted);
 assert.ok(inserted.replacement.includes('입력😀'));assert.ok(!inserted.replacement.startsWith('<p>'));
 // Select the whole visible paragraph, then remove its inherited bold mark.
 await page.evaluate(()=>{const f=(window as any).fixture;f.editor.commands.setTextSelection({from:1,to:f.editor.state.doc.content.size-1});f.editor.commands.toggleBold();});
 const unbold=await page.evaluate(()=>(window as any).fixture.save());await verify(unbold);
 assert.ok(unbold.replacement.startsWith('</strong>'));assert.ok(unbold.replacement.endsWith('<strong>'));
 assert.ok(!/<strong>/.test(unbold.replacement.slice(0,-8)),'unseen text keeps bold while the edited slice loses it');
 await page.evaluate(()=>{(window as any).fixture.editor.commands.undo();});
 const undone=await page.evaluate(()=>(window as any).fixture.save());await verify(undone);
 sameSource(undone.replacement,inserted.replacement,'undo');
 // Enter creates two paragraphs without storing any of the virtual wrappers.
 await page.evaluate(()=>{const f=(window as any).fixture;const at=f.editor.state.doc.firstChild.textContent.indexOf('한글')+2;f.editor.commands.setTextSelection(at);assertSplit(f.editor.commands.splitBlock());function assertSplit(ok){if(!ok)throw Error('split refused');}});
 const split=await page.evaluate(()=>(window as any).fixture.save());await verify(split);
 assert.ok(split.replacement.includes('</p><p>'));
 await wait();
 const blocks=await call({op:'document_blocks',id:note.id,revision:split.revision,limit:8,bounded:true});
 assert.ok(blocks.total_blocks>=2,'worker reindexes the real paragraph split');
 assert.deepEqual(requests,Array(4).fill('document_splice_html'),'editing never reads the entire primary body');
 // The real table schema supplies a colgroup. Repeated ordinary rows exercise
 // retained table wrapper structure rather than replacing it with plain text.
 const table=await page.evaluate(()=>(window as any).fixture.canonical('<table><tbody><tr><td><p>셀😀&amp;</p></td><td><p>옆</p></td></tr></tbody></table>'));
 const body=/<tbody>([\s\S]*)<\/tbody>/.exec(table)[1];
 const tableSource=table.replace(body,body.repeat(15000));
 const tableNote=await call({op:'save',note:{title:'table segment',content:tableSource,text:'셀'}});await wait();
 const tablePage=await call({op:'document_segments',id:tableNote.id,revision:1,ordinal:0,offset:5});
 const tableSegment=tablePage.segments[0];
 await page.evaluate(({id,segment})=>(window as any).fixture.mount(id,1,segment),{id:tableNote.id,segment:tableSegment});
 await page.waitForFunction(()=>(window as any).fixture.editor?.isInitialized);
 await page.evaluate(()=>{const f=(window as any).fixture;f.editor.commands.setTextSelection(5);f.editor.commands.insertContent('표수정');});
 let tableEdit;
 try{tableEdit=await page.evaluate(()=>(window as any).fixture.save());}
 catch(error){
  console.error('table projection diagnostic',await page.evaluate(()=>{
   const f=(window as any).fixture, edited=f.editor.getHTML();
   const core=edited.replace(/^<table[^>]*><colgroup>[\s\S]*?<\/colgroup><tbody>/,'').replace(/<\/tbody><\/table>$/,'');
   const projected=f.canonical(f.render({...f.segment,source:core}));
   let at=0;while(at<Math.min(projected.length,edited.length)&&projected[at]===edited[at])at++;
   return {start:f.segment.start_context,end:f.segment.end_context,sourceHead:f.segment.source.slice(0,150),sourceTail:f.segment.source.slice(-150),editedHead:edited.slice(0,200),at,projected:projected.slice(Math.max(0,at-40),at+100),edited:edited.slice(Math.max(0,at-40),at+100)};
  }));throw error;
 }
 const tableBytes=Buffer.from(tableSource),tail=tableEdit.start+Buffer.byteLength(tableEdit.expected);
 const savedTable=await call({op:'get',id:tableNote.id});
 sameSource(savedTable.content,Buffer.concat([tableBytes.subarray(0,tableEdit.start),Buffer.from(tableEdit.replacement),tableBytes.subarray(tail)]).toString(),'table');
 assert.ok(!tableEdit.replacement.includes('<table'));
 assert.deepEqual(errors,[]);
 console.log('PASS: live Rust internal cache, bounded React/Tiptap input, edge formatting, exact splice, native undo, paragraph split and table edit; production navigator and Windows IME not exercised');
}finally{
 await browser?.close();await server.close();engine.stdin.end();
 if(engine.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{engine.kill();resolve();},2000);engine.once('exit',()=>{clearTimeout(timer);resolve();});});
 await rm(fixtureDir,{recursive:true,force:true});
}
