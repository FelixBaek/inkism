import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {chromium} from './browser-env.ts';
import {trackSaves} from './save-state.ts';

const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{
 const reply=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();
 assert.equal(reply.ok,true,JSON.stringify(reply));return reply.data;
};
const artifacts=process.env.INKISM_ARTIFACT_DIR??await mkdtemp(join(tmpdir(),'inkism-footnote-pdf-'));
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const evidence:any[]=[];
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');});
 const dialog=page.getByRole('dialog',{name:'라이브러리 도구',exact:true});
 const open=async(note:any)=>{
  await page.goto('about:blank');await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
  await page.goto(base);await page.locator('.tiptap, .cm-content').first().waitFor();
  await page.getByRole('button',{name:'PDF·각주',exact:true}).click();await dialog.waitFor();
 };
 const exact=async(note:any,source:string)=>assert.equal((await rpc('get',{id:note.id})).content,source);
 const pdf=async(note:any,name:string,source:string,expected:string[])=>{
  const saved=await rpc('get',{id:note.id});assert.equal(saved.content,source);
  const response=await fetch(base+'/api/export/html',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:note.id,revision:saved.revision})});
  assert.equal(response.status,200);const html=await response.text(),file=join(artifacts,name+'.html');await writeFile(file,html);
  const print=await browser.newPage(),network:string[]=[];
  print.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});
  try{
   await print.goto(pathToFileURL(file).href);await print.emulateMedia({media:'print'});await print.evaluate(()=>document.fonts.ready);
   const bytes=await print.pdf({format:'A4',printBackground:true,path:join(artifacts,name+'.pdf')});
   assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert.deepEqual(network,[]);
   const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const document=await loading.promise;
   const pages:string[]=[];const items:any[]=[];
   for(let n=1;n<=document.numPages;n++){
    const content=await(await document.getPage(n)).getTextContent();items.push(...content.items);
    pages.push(content.items.map((item:any)=>item.str??'').join(' '));
   }
   const text=pages.join('\n'),compact=text.replace(/\s+/g,'');
   for(const value of expected)assert(compact.includes(value.replace(/\s+/g,'')),`PDF ${name} lost ${value}: ${text}`);
   let scientificPositions:any;
   if(name.startsWith('html-')){
    const baseline=items.find(item=>item.str?.includes('isotope; E=mc'));
    const isotope=items.find(item=>item.str==='13');assert(baseline&&isotope,`PDF ${name} lost scientific text items`);
    const above=items.find(item=>item.str==='2'&&item.transform[5]>baseline.transform[5]+1&&item.transform[5]<baseline.transform[5]+10);
    const below=items.find(item=>item.str==='2'&&item.transform[5]<baseline.transform[5]-1&&item.transform[5]>baseline.transform[5]-10);
    assert(isotope.transform[5]>baseline.transform[5]+1&&isotope.height<baseline.height,`PDF ${name} flattened isotope superscript`);
    assert(above&&above.height<baseline.height,`PDF ${name} flattened exponent superscript`);
    assert(below&&below.height<baseline.height,`PDF ${name} flattened chemical subscript`);
    scientificPositions={baselineY:baseline.transform[5],isotopeY:isotope.transform[5],exponentY:above.transform[5],subscriptY:below.transform[5]};
    assert.equal(await print.locator('#fn-a').count(),1,'export lost stable footnote definition ID');
    assert.equal(await print.locator('a[href="#fn-a"]').count(),1,'export lost internal reference href');
   }else{
    assert.equal(await print.locator('.footnote-definition').count(),2);
    assert.equal(await print.locator('sup.footnote-reference a').count(),3,'Markdown generated references lost internal links');
   }
   await writeFile(join(artifacts,name+'.txt'),text);await writeFile(join(artifacts,name+'.items.json'),JSON.stringify(items,null,2));
   evidence.push({name,pages:document.numPages,bytes:bytes.length,text,networkRequests:network.length,scientificPositions});await loading.destroy();
  }finally{await print.close();}
  const after=await rpc('get',{id:note.id});assert.equal(after.content,source);assert.equal(after.revision,saved.revision);
 };
 const body='<p data-id="body-stable">First <sup><a href="#fn-b">9</a></sup> twice <a href="#fn-b">9</a> and <a href="#fn-a">8</a>.</p>\r\n';
 const alpha='<li id="fn-a" value="8"><p><sup>13</sup>C isotope; E=mc<sup>2</sup>; H<sub>2</sub>O.</p><a class="footnote-backref" href="#fnref-a">↩</a></li>';
 const beta='<li id="fn-b" value="9"><p>Beta definition</p><a href="#fnref-b">↩</a></li>';
 const original='\ufeff'+body+'<ol>'+alpha+'\r\n'+beta+'</ol>\r\n<p data-id="tail-stable">Outside &amp; exact😀</p>';
 const note=await rpc('save',{note:{title:'Footnote PDF HTML',content:original,content_format:'html'}});
 await pdf(note,'html-original',original,['First9twice9and8.','8.13C isotope; E=mc2; H2O.','9.Beta definition','Outside & exact']);
 await open(note);const saves=trackSaves(page);
 await dialog.locator('summary').filter({hasText:'a ·'}).click();
 assert.equal(await dialog.getByRole('textbox',{name:'a 각주 수정',exact:true}).inputValue(),'13C isotope; E=mc2; H2O.');
 await exact(note,original);
 await dialog.getByRole('button',{name:'참조 순서로 각주 배치',exact:true}).click();await saves.saved();
 const arranged=original.replace(alpha+'\r\n'+beta,beta+'\r\n'+alpha);await exact(note,arranged);
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).click();await saves.saved();await exact(note,original);
 await page.getByRole('button',{name:'전체 바꾸기 다시 적용',exact:true}).click();await saves.saved();await exact(note,arranged);
 await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).click();await saves.saved();await exact(note,original);
 await page.getByRole('button',{name:'PDF·각주',exact:true}).click();
 await dialog.getByRole('textbox',{name:'각주 이름',exact:true}).fill('c');await dialog.getByRole('textbox',{name:'각주 내용',exact:true}).fill('Gamma first\nsecond');
 await dialog.getByRole('button',{name:'추가',exact:true}).click();await saves.saved();
 const added=original+'<p><sup><a href="#fn-c">c</a></sup></p><p id="fn-c"><sup>c</sup> Gamma first<br>second</p>';await exact(note,added);
 await dialog.locator('summary').filter({hasText:'b ·'}).click();
 const edit=dialog.getByRole('textbox',{name:'b 각주 수정',exact:true});await edit.fill('Beta revised\nsecond line');await edit.press('Tab');await saves.saved();
 const edited=added.replace(beta,'<li id="fn-b" value="9">Beta revised<br>second line<a href="#fnref-b">↩</a></li>');await exact(note,edited);
 await dialog.getByRole('button',{name:'참조 순서로 각주 번호 정리',exact:true}).click();await saves.saved();
 const numbered=edited.replaceAll('<a href="#fn-b">9</a>','<a href="#fn-b">1</a>').replace('<a href="#fn-a">8</a>','<a href="#fn-a">2</a>').replace('<li id="fn-a" value="8">','<li id="fn-a" value="2">').replace('<li id="fn-b" value="9">','<li id="fn-b" value="1">').replace('<a href="#fn-c">c</a>','<a href="#fn-c">3</a>').replace('<p id="fn-c"><sup>c</sup>','<p id="fn-c"><sup>3</sup>');
 await exact(note,numbered);await pdf(note,'html-numbered',numbered,['First1twice1and2.','2.13C isotope; E=mc2; H2O.','1.Beta revisedsecond line','3Gamma firstsecond']);
 await dialog.getByRole('button',{name:'b 삭제',exact:true}).click();await saves.saved();
 const deleted=numbered.replace('<li id="fn-b" value="1">Beta revised<br>second line<a href="#fnref-b">↩</a></li>','').replaceAll('<a href="#fn-b">1</a>','');
 await exact(note,deleted);assert.equal(await dialog.locator('summary').filter({hasText:'b ·'}).count(),0);
 await pdf(note,'html-deleted',deleted,['Firsttwiceand2.','13C isotope; E=mc2; H2O.','Gamma firstsecond']);
 assert(!evidence.at(-1).text.includes('Beta revised'));
 await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).click();await saves.saved();await exact(note,numbered);
 await page.getByRole('button',{name:'전체 바꾸기 다시 적용',exact:true}).click();await saves.saved();await exact(note,deleted);
 await page.getByRole('button',{name:'최근 전체 바꾸기 취소',exact:true}).click();await saves.saved();await exact(note,numbered);
 const markdown='First [^b] twice [^b] and [^a].\r\n\r\n[^a]: Alpha first\r\n    continuation E=mc2\r\n\r\n[^b]: Beta Markdown\r\n';
 const md=await rpc('save',{note:{title:'Footnote PDF Markdown',content:markdown,content_format:'markdown'}});
 await pdf(md,'markdown-original',markdown,['First1twice1and2.','Alpha firstcontinuation E=mc2','Beta Markdown']);
 await open(md);const mdSaves=trackSaves(page);
 await dialog.getByRole('button',{name:'참조 순서로 각주 번호 정리',exact:true}).click();await mdSaves.saved();
 const mdNumbered=markdown.replaceAll('[^a]','[^2]').replaceAll('[^b]','[^1]');await exact(md,mdNumbered);
 await dialog.getByRole('button',{name:'참조 순서로 각주 배치',exact:true}).click();await mdSaves.saved();
 const mdArranged='First [^1] twice [^1] and [^2].\r\n\r\n[^1]: Beta Markdown\r\n\r\n[^2]: Alpha first\r\n    continuation E=mc2\r\n';await exact(md,mdArranged);
 await pdf(md,'markdown-numbered',mdArranged,['First1twice1and2.','Alpha firstcontinuation E=mc2','Beta Markdown']);
 const refNamed='<p><sup id="fnref-x"><a href="#fn-x">x</a></sup> <a href="#fn-ref-x">ref-x</a></p><p id="fn-x"><sup>x</sup>First <a href="#fnref-x">back</a></p><p id="fn-ref-x"><sup>ref-x</sup>Second</p>';
 const namespaced=await rpc('save',{note:{title:'Footnote backlink namespace',content:refNamed,content_format:'html'}});await open(namespaced);const namespaceSaves=trackSaves(page);
 await dialog.locator('summary').filter({hasText:'ref-x ·'}).click();await dialog.getByRole('button',{name:'ref-x 삭제',exact:true}).click();await namespaceSaves.saved();
 await exact(namespaced,refNamed.replace('<a href="#fn-ref-x">ref-x</a>','').replace('<p id="fn-ref-x"><sup>ref-x</sup>Second</p>',''));
 for(const [name,malformed,action] of [
  ['unclosed-opening','<script type="unfinished','add'],
  ['duplicate-id','<p id="fn-x" id="other">Original definition</p>','add'],
  ['nested-reference','<p>prefix <a href="#fn-x">one<a href="#fn-x">two</a>three</a> tail exact</p><p id="fn-x"><sup>x</sup> Footnote</p>','delete'],
  ['nested-other-reference','<p>prefix <a href="#fn-x">one<a href="#fn-y">two</a>three</a> tail exact</p><p id="fn-x"><sup>x</sup> Footnote</p>','delete'],
 ] as const){
  const bad=await rpc('save',{note:{title:'Footnote guard '+name,content:malformed,content_format:'html'}});await open(bad);const badSaves=trackSaves(page);
  if(action==='add'){
   await dialog.getByRole('textbox',{name:'각주 이름',exact:true}).fill('new');await dialog.getByRole('textbox',{name:'각주 내용',exact:true}).fill('Added');await dialog.getByRole('button',{name:'추가',exact:true}).click();
  }else{await dialog.locator('summary').filter({hasText:'x ·'}).click();await dialog.getByRole('button',{name:'x 삭제',exact:true}).click();}
  await dialog.getByRole('alert').waitFor();await exact(bad,malformed);assert.equal(badSaves.count,0,'unsafe operation sent a body-save RPC');
 }
 await writeFile(join(artifacts,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log('PASS real app footnotes: read scientific superscripts, add/edit/number/reorder/delete, exact BOM/CRLF/IDs and Undo/Redo, unsafe UI no-write guards; real saved HTML/Markdown export printed by Chromium and PDF.js text verified',JSON.stringify(evidence.map(({name,pages,bytes})=>({name,pages,bytes}))));
}finally{await browser.close();if(!process.env.INKISM_ARTIFACT_DIR)await rm(artifacts,{recursive:true,force:true});}
