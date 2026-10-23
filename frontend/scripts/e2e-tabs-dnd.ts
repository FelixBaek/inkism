import {chromium} from './browser-env.ts';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const base=process.env.INKISM_URL||'http://127.0.0.1:48171';
const shots=process.env.INKISM_TABS_SHOTS||path.join(os.tmpdir(),'inkism-tabs-dnd');mkdirSync(shots,{recursive:true});
const rpc=async(op,args={})=>{const v=await(await fetch(base+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...args})})).json();assert.equal(v.ok,true,JSON.stringify(v));return v.data;};
const prefix='탭 끌기 '+Date.now();
const notes=[];for(const n of ['A','B','C','D'])notes.push(await rpc('save',{note:{title:prefix+' '+n,content:`<p>${n} 본문</p>`,text:n+' 본문',tags:[]}}));
await rpc('workspace_set',{ids:notes.map(n=>n.id),active:notes[0].id,locations:{}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const tab=n=>page.getByRole('tab',{name:'노트 탭: '+n.title,exact:true});
const order=()=>page.locator('.note-tabs [role=tab]').evaluateAll(els=>els.map(e=>e.getAttribute('title')));
const selected=async n=>{await page.waitForFunction(t=>document.querySelector<any>('[aria-label="노트 제목"]')?.value===t,n.title);assert.equal(await tab(n).getAttribute('aria-selected'),'true');};
// 실제 마우스로 끌기(Chromium은 마우스 이동으로 HTML5 끌기를 만든다); before는 놓기 직전에 실행한다.
const drag=async(from,x,y,before?)=>{const box=await from.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2,{steps:3});await page.mouse.move(x,y,{steps:8});await page.mouse.move(x+2,y+2,{steps:2});await page.mouse.move(x,y,{steps:2});if(before)await before();await page.mouse.up();};
try{
await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');localStorage.setItem('inkism.inspector','false');localStorage.setItem('inkism.split.mode','source');});
 await page.goto(base);await selected(notes[0]);
 // 1. 키보드 전환과 가운데 클릭 닫기
 await page.locator('body').click({position:{x:2,y:2}}).catch(()=>{});
 await page.keyboard.press('Control+Tab');await selected(notes[1]);
 await page.keyboard.press('Control+Shift+Tab');await selected(notes[0]);
 await page.keyboard.press('Control+Shift+Tab');await selected(notes[3]);
 await page.keyboard.press('Control+PageDown');await selected(notes[0]);
 await page.keyboard.press('Control+PageUp');await selected(notes[3]);
 await page.keyboard.press('Control+1');await selected(notes[0]);
 await page.keyboard.press('Control+9');await selected(notes[3]);
 await page.keyboard.press('Control+3');await selected(notes[2]);
 await page.keyboard.press('Control+1');await selected(notes[0]);
 await tab(notes[3]).click({button:'middle'});await tab(notes[3]).waitFor({state:'detached'});await selected(notes[0]);
 // 2. 순서 바꾸기: A를 C 오른쪽 끝으로
 const cBox=await tab(notes[2]).boundingBox();
 await drag(tab(notes[0]),cBox.x+cBox.width-10,cBox.y+cBox.height/2,async()=>{await page.locator('.note-tab.is-drop-after').waitFor();await page.screenshot({path:path.join(shots,'1-reorder-marker.png')});});
 assert.deepEqual(await order(),[notes[1].title,notes[2].title,notes[0].title]);
 for(let i=0;i<50&&JSON.stringify((await rpc('workspace_get')).tabs.map(t=>t.id))!==JSON.stringify([notes[1].id,notes[2].id,notes[0].id]);i++)await page.waitForTimeout(100);
 assert.deepEqual((await rpc('workspace_get')).tabs.map(t=>t.id),[notes[1].id,notes[2].id,notes[0].id],'order persisted');
 await page.reload();await selected(notes[0]);assert.deepEqual(await order(),[notes[1].title,notes[2].title,notes[0].title],'order restored');
 // 3. 편집기 오른쪽 가장자리 쪽에 놓으면 오른쪽 분할로 연다
 const area=await page.locator('.split-workspace').boundingBox();
 await drag(tab(notes[1]),area.x+area.width*0.75,area.y+area.height/2,async()=>{await page.locator('.split-drop-zone').waitFor();await page.screenshot({path:path.join(shots,'2-drop-zone.png')});});
 const right=page.getByRole('region',{name:'분할 편집기'});await right.getByRole('heading',{name:notes[1].title}).waitFor();
 assert.equal(await page.locator('.split-drop-zone').count(),0);await selected(notes[0]);assert.equal(await tab(notes[1]).count(),1,'drop on editor keeps the top tab');
 await page.screenshot({path:path.join(shots,'3-split-result.png')});
 // 분할 탭 줄에 놓으면 그 탭을 분할로 옮긴다(위쪽 탭에서 빠진다)
 const strip=await right.locator('.split-tabs').boundingBox();
 await drag(tab(notes[2]),strip.x+strip.width/2,strip.y+strip.height/2,async()=>{await page.locator('.split-tabs.is-drop-target').waitFor();await page.screenshot({path:path.join(shots,'4-split-strip-target.png')});});
 await right.getByRole('heading',{name:notes[2].title}).waitFor();await tab(notes[2]).waitFor({state:'detached'});
 assert.deepEqual(await right.locator('.split-tabs [role=tab]').allTextContents(),[notes[1].title,notes[2].title]);
 assert.equal((await rpc('split_get')).id,notes[2].id);
 await page.screenshot({path:path.join(shots,'5-moved-to-split.png')});
 // 4. 여러 방향·여러 창: 왼쪽·위·아래로 나눠 4개, 이어서 8개까지; 창 닫기는 자리를 합친다
 await page.goto('about:blank');
 const m=[];for(let i=0;i<7;i++)m.push(await rpc('save',{note:{title:'M'+i+' '+String(Date.now()).slice(-5),content:`<p>M${i}</p>`,text:'M'+i,tags:[]}}));
 await rpc('split_set',{id:null,mode:'source'});await rpc('workspace_set',{ids:m.map(n=>n.id),active:m[0].id,locations:{}});
 await page.setViewportSize({width:1800,height:1000});await page.goto(base);await selected(m[0]);
 const regions=page.getByRole('region',{name:'분할 편집기'}),primary=page.locator('.split-primary');
 const pane=n=>page.locator('.split-secondary').filter({has:page.getByRole('heading',{name:n.title})});
 const box=l=>l.boundingBox();
 const edge=(b,side)=>({left:[b.x+b.width*0.08,b.y+b.height/2],right:[b.x+b.width*0.92,b.y+b.height/2],top:[b.x+b.width/2,b.y+b.height*0.15],bottom:[b.x+b.width/2,b.y+b.height*0.92]})[side];
 const dropOn=async(n,target,side,count)=>{const [x,y]=edge(await box(target),side);await drag(tab(n),x,y,async()=>{await page.locator('.split-drop-zone').waitFor();});await pane(n).waitFor();assert.equal(await regions.count(),count);};
 await dropOn(m[1],primary,'left',1);assert.ok((await box(pane(m[1]))).x<(await box(primary)).x,'left split puts the new pane left');
 await dropOn(m[2],primary,'top',2);assert.ok((await box(pane(m[2]))).y<(await box(primary)).y,'top split puts the new pane above');
 await dropOn(m[3],pane(m[1]),'bottom',3);assert.ok((await box(pane(m[3]))).y>(await box(pane(m[1]))).y,'bottom split puts the new pane below');
 await page.screenshot({path:process.env.INKISM_SPLIT4_SHOT||path.join(shots,'split4.png')});
 for(let i=0;i<50&&(await rpc('split_get')).panes?.length!==2;i++)await page.waitForTimeout(100);
 const four=await rpc('split_get');assert.equal(four.panes.length,2,'4 panes = main + top-level pane + 2 more');assert.ok(four.tree);
 await page.reload();await pane(m[3]).waitFor();assert.equal(await regions.count(),3,'4-pane layout restored after reload');
 assert.ok((await box(pane(m[3]))).y>(await box(pane(m[1]))).y,'restored layout keeps the bottom split');
 await dropOn(m[4],primary,'right',4);await dropOn(m[5],pane(m[2]),'right',5);await dropOn(m[6],pane(m[1]),'right',6);await dropOn(m[0],pane(m[3]),'right',7);
 await page.screenshot({path:process.env.INKISM_SPLIT8_SHOT||path.join(shots,'split8.png')});
 // 8개가 다 차면 더 나누지 않는다
 const [fx,fy]=edge(await box(primary),'left');await drag(tab(m[1]),fx,fy,async()=>{await page.waitForTimeout(200);assert.equal(await page.locator('.split-drop-zone').count(),0,'no drop zone at 8 panes');});
 assert.equal(await regions.count(),7);
 // 한 창을 닫으면 그 자리를 이웃 창이 채운다
 const before=await box(pane(m[4]));
 await pane(m[0]).getByRole('button',{name:'분할 창 닫기',exact:true}).click();await pane(m[0]).waitFor({state:'detached'});assert.equal(await regions.count(),6);
 await pane(m[6]).getByRole('button',{name:'분할 창 닫기',exact:true}).click();await pane(m[6]).waitFor({state:'detached'});assert.equal(await regions.count(),5);
 for(let i=0;i<50&&(await rpc('split_get')).panes?.length!==4;i++)await page.waitForTimeout(100);assert.equal((await rpc('split_get')).panes.length,4);
 assert.deepEqual(await box(pane(m[4])),before,'unrelated pane keeps its place');
 // 칸막이를 끌면 크기가 바뀐다
 const sep=page.locator('.split-divider').first(),sb=await sep.boundingBox(),w0=(await box(pane(m[1]))).width;
 await page.mouse.move(sb.x+sb.width/2,sb.y+sb.height/4);await page.mouse.down();await page.mouse.move(sb.x+sb.width/2+120,sb.y+sb.height/4,{steps:5});await page.mouse.up();
 assert.ok((await box(pane(m[1]))).width>w0+60,'divider drag resizes panes');
 // 같은 노트는 두 분할 창에 열지 않는다
 await pane(m[1]).getByLabel('분할 노트',{exact:true}).selectOption(m[2].id);await pane(m[1]).getByRole('alert').waitFor();
 assert.match(await pane(m[1]).getByRole('alert').innerText(),/이미 열려/);
 await page.getByRole('button',{name:'분할 닫기',exact:true}).click();await regions.first().waitFor({state:'detached'});assert.equal(await regions.count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: Ctrl+Tab/PageUp/PageDown/1..9 switching, middle-click close, drag reorder with marker and persistence, right drop opens split, split tab strip drop moves the tab, left/top/bottom splits, 4 and 8 panes with restore, 8-pane cap, pane close collapses, divider resize, one note per split pane');
}catch(e){await page.screenshot({path:path.join(shots,'failure.png')}).catch(()=>{});throw e;}finally{await browser.close();}
