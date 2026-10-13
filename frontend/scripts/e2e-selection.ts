import {chromium} from './browser-env.ts';
import {waitSaved} from './save-state.ts';
import assert from 'node:assert/strict';
const base=process.env.INKISM_URL||'http://127.0.0.1:47846';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage();
// Same isolated profile as the other UI tests: Korean UI and the note inspector closed (at 1280px it opens as a modal overlay over the editor).
await page.addInitScript(()=>{if(window.top!==window||!/^https?:$/.test(location.protocol))return;localStorage.setItem('inkism.lang','ko');if(localStorage.getItem('inkism.inspector')===null)localStorage.setItem('inkism.inspector','false');});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const title='선택 도구 검증 '+Date.now();
const root=page.locator('.tiptap-prose');
const menu=page.getByRole('toolbar',{name:'선택한 글자 서식'});// the selection menu is an ARIA toolbar now
try {
 await page.goto(base);await page.getByRole('button',{name:'새 노트 만들기',exact:true}).first().click();
 await page.getByLabel('노트 제목',{exact:true}).fill(title);
 await root.click();await page.keyboard.insertText('한글 선택 서식');
 await page.keyboard.press('Control+a');
 await menu.waitFor({state:'visible'});
 await menu.getByRole('button',{name:'선택 글자 굵게',exact:true}).click();
 assert.equal(await root.locator('strong').textContent(),'한글 선택 서식');
 assert.equal(await menu.getByRole('button',{name:'선택 글자 굵게',exact:true}).getAttribute('aria-pressed'),'true');
 await menu.getByRole('button',{name:'선택 글자 기울임',exact:true}).click();
 assert.equal(await root.locator('strong em, em strong').textContent(),'한글 선택 서식');
 await page.keyboard.press('ArrowRight');
 await menu.waitFor({state:'hidden'});
 await waitSaved(page);
 await page.reload();await page.getByRole('button',{name:'노트 열기: '+title,exact:true}).click();
 assert.equal(await root.locator('strong em, em strong').textContent(),'한글 선택 서식');
 await root.click();await page.keyboard.press('Control+a');await menu.waitFor({state:'visible'});
 await menu.getByRole('button',{name:'선택 글자 밑줄',exact:true}).click();
 assert.equal(await root.locator('u').textContent(),'한글 선택 서식');
 await page.keyboard.press('Control+z');
 assert.equal(await root.locator('u').count(),0);
 await page.keyboard.press('ArrowRight');await menu.waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:844});
 await root.click();await page.keyboard.press('Control+a');await menu.waitFor({state:'visible'});
 await page.waitForFunction(()=>{const r=document.querySelector('.selection-toolbar')?.getBoundingClientRect();return r && r.width>0 && r.x>=0 && r.right<=390;});
 await page.screenshot({path:'../.impeccable/review/react-selection-mobile.png',fullPage:true});
 await menu.getByRole('button',{name:'선택 글자 굵게',exact:true}).focus();await page.keyboard.press('Escape');
 await menu.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 console.log('PASS: React selection menu preserves Korean selection, combines marks, updates state, hides on collapse, saves and reopens through Rust');
} finally {await browser.close();}
