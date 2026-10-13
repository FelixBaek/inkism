import assert from 'node:assert/strict';
import {chromium} from './browser-env.ts';
const base=process.env.INKISM_URL!;
const rpc=async(op:string,args:any={})=>{const env=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(env.ok,true,JSON.stringify(env));return env.data;};
const notes=[];for(const title of ['Discovery A','Discovery B','Discovery C'])notes.push(await rpc('save',{note:{title,content:'<p>Original '+title+'</p>',tags:['discovery-test'],content_format:'html'}}));
await rpc('save',{note:{title:'Outside filter',content:'<p>Keep</p>'}});
await rpc('workspace_set',{ids:[notes[0].id],active:notes[0].id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.addInitScript(()=>{localStorage.setItem('inkism.lang','ko');const OriginalDate=Date;class FixedDate extends OriginalDate{constructor(...args:any[]){super(...(args.length?args:[2026,9,13,12,0,0]) as [any]);}};(window as any).Date=FixedDate;});await page.goto(base);await page.locator('.tiptap').waitFor();
 const command=async(name:string)=>{await page.keyboard.press('Control+Shift+p');await page.getByRole('combobox',{name:'명령 검색어'}).fill(name);await page.getByRole('option',{name,exact:true}).click();};
 // Filter by the active sidebar tag; random must not visit an outside note.
 await page.getByRole('tab',{name:'태그',exact:true}).click();await page.locator('button.side-item').filter({has:page.locator('.side-label',{hasText:'discovery-test'})}).click();
 const visited=new Set(['Discovery A']);
 for(let i=0;i<2;i++){await command('무작위 노트 열기');await page.waitForFunction(known=>{const title=(document.querySelector('[aria-label="노트 제목"]') as HTMLInputElement)?.value;return title?.startsWith('Discovery ')&&!known.includes(title);},[...visited]);visited.add(await page.getByLabel('노트 제목',{exact:true}).inputValue());}
 assert.equal(visited.size,3,'all three eligible notes visited before repetition');
 const previous=await page.getByLabel('노트 제목',{exact:true}).inputValue();await command('무작위 노트 열기');await page.waitForFunction(previous=>(document.querySelector('[aria-label="노트 제목"]') as HTMLInputElement)?.value!==previous,previous);assert.ok(visited.has(await page.getByLabel('노트 제목',{exact:true}).inputValue()));
 const waitTitle=async(title:string)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const list=await rpc('list',{view:'all',limit:30});const note=list.items.find((n:any)=>n.title===title);const ws=await rpc('workspace_get');if(note&&ws.active===note.id)return note;await new Promise(r=>setTimeout(r,50));}throw Error('timestamp did not persist: '+title);};
 await command('시간 코드 제목으로 새 노트');await waitTitle('20261013-120000');await command('시간 코드 제목으로 새 노트');await waitTitle('20261013-120000-2');
 assert.equal(await page.getByLabel('노트 제목',{exact:true}).inputValue(),'20261013-120000-2');
 await page.reload();await page.getByLabel('노트 제목',{exact:true}).waitFor();assert.equal(await page.getByLabel('노트 제목',{exact:true}).inputValue(),'20261013-120000-2');
 for(const note of notes)assert.equal((await rpc('get',{id:note.id})).content,note.content);
 console.log('PASS filtered random discovery avoids recent/current notes, timestamp same-second collision suffix autosave/restart, canonical source unchanged');
}finally{await browser.close();}
