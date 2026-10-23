import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args={})=>{const result=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(result.ok,true,JSON.stringify(result));return result.data;};
const temporary=await mkdtemp(path.join(os.tmpdir(),'inkism-backup-browser-'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const bytes=Buffer.alloc(2*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const upload=new FormData();upload.append('file',new Blob([bytes]),'한글.bin');upload.append('size',String(bytes.length));
 const asset=await(await fetch(base+'/api/attachments',{method:'POST',body:upload})).json();assert.equal(asset.ok,true,JSON.stringify(asset));
 const content=`<p>백업 원문</p><a href="/api/attachments/${asset.data.id}">한글.bin</a>`;
 const note=await rpc('save',{note:{title:'Backup roundtrip',content,content_format:'html'}});
 await rpc('workspace_set',{ids:[note.id],active:note.id,locations:{}});
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('inkism.lang','ko'));await page.goto(base);
 await page.getByRole('button',{name:'설정 열기',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.getByRole('button',{name:'백업과 복원',exact:true}).click();
 await page.screenshot({path:path.join(os.tmpdir(),'inkism-backup-settings.png')});
 const downloadPromise=page.waitForEvent('download');
 const button=dialog.getByRole('button',{name:'노트·첨부파일 백업 다운로드',exact:true});await button.focus();await button.press('Enter');
 const download=await downloadPromise;assert.equal(await download.failure(),null);
 const file=path.join(temporary,'backup.zip');await download.saveAs(file);
 execFileSync('python3',['-c',`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 notes=json.loads(z.read('notes.json'))
 assert any(n['title']=='Backup roundtrip' and '백업 원문' in n['content'] for n in notes['notes'])
 assert z.read('attachments/'+sys.argv[2])==bytes(i%251 for i in range(2*1024*1024))`,file,asset.data.id]);
 await rpc('save',{note:{...note,content:'changed after backup'}});
 const restore=new FormData();restore.append('file',new Blob([await readFile(file)]),'backup.zip');
 const response=await fetch(base+'/api/restore',{method:'POST',body:restore});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true);
 const exported=await(await fetch(base+'/api/export')).json();
 const restored=exported.notes.find((n:{title:string,content:string})=>n.title==='Backup roundtrip'&&n.content.includes('백업 원문'));assert.ok(restored,'backup original restored');
 const restoredId=restored.content.match(/\/api\/attachments\/([a-f0-9-]+)/)?.[1];assert.ok(restoredId);
 assert.deepEqual(Buffer.from(await(await fetch(base+'/api/attachments/'+restoredId)).arrayBuffer()),bytes);
 assert.deepEqual(errors,[]);console.log('PASS keyboard backup download, ZIP integrity, original note and binary attachment restore');
}finally{await browser.close();await rm(temporary,{recursive:true,force:true});}
