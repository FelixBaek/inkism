import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from './browser-env.ts';

const bundle=await build({stdin:{contents:`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import EmojiPicker from './components/toolbar/EmojiPicker';
  export {lang,preferredLanguage} from './i18n';
  export function mount(){createRoot(document.getElementById('root')).render(React.createElement(EmojiPicker,{onPick:()=>{}}));}
`,resolveDir:new URL('../src/',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'iife',globalName:'languageTest',platform:'browser',logLevel:'silent'});
const labels=['표정','사람과 신체','동물','음식','활동','여행','사물','기호','국기'];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
  for(const fixture of [
    {locale:'en-US',expected:'en'},
    {locale:'ko-KR',expected:'ko'},
    {locale:'ja-JP',expected:'ja'},
    {locale:'zh-Hans',expected:'zh'},
    {locale:'zh-Hant',expected:'zh'},
    {locale:'fr-FR',expected:'ko'},
    {locale:'en-US',saved:'ja',expected:'ja'},
    {locale:'ja-JP',saved:'ko',expected:'ko'},
    {locale:'en-US',saved:'toString',expected:'en'},
    {locale:'en-US',blocked:true,expected:'en'},
  ]) {
    const context=await browser.newContext({locale:fixture.locale});
    try {
      const page=await context.newPage();
      await page.route('http://localhost/language-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
      await page.goto('http://localhost/language-test');
      await page.evaluate(({saved,blocked})=>{
        if(saved)localStorage.setItem('inkism.lang',saved);
        if(blocked)Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}});
      },{saved:fixture.saved,blocked:fixture.blocked});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      const language=await page.evaluate(()=>{
        const api=(window as any).languageTest;
        api.mount();
        return {lang:api.lang,htmlLang:document.documentElement.lang};
      });
      assert.deepEqual(language,{lang:fixture.expected,htmlLang:fixture.expected},JSON.stringify(fixture));
      await page.locator('.tb-emoji').waitFor();
      const dict=fixture.expected==='ko'?{}:JSON.parse(readFileSync(new URL('../src/locales/'+fixture.expected+'.json',import.meta.url),'utf8'));
      const expected=labels.map(label=>dict[label]??label);
      assert.deepEqual(await page.locator('.tb-emoji-tabs button').evaluateAll(buttons=>buttons.slice(1).map(button=>button.getAttribute('aria-label'))),expected);
      assert.deepEqual(await page.locator('.tb-emoji-body section h4').allTextContents(),[dict['자주 쓴 것']??'자주 쓴 것',...expected]);
      if(!fixture.blocked)assert.equal(await page.evaluate(()=>localStorage.getItem('inkism.lang')),fixture.saved??null,'system detection must preserve the saved-choice state');
      if(fixture.locale==='en-US'&&!fixture.saved&&!fixture.blocked) {
        assert.deepEqual(await page.evaluate(()=>{
          const choose=(window as any).languageTest.preferredLanguage;
          return [choose(null,['de-DE','ja-JP','en-US']),choose(null,['fr-FR','de-DE']),choose('zh',['en-US']),choose('__proto__',['zh-Hant']),choose(null,[]),choose(null,['EN-us'])];
        }),['ja','ko','zh','zh','ko','en']);
      }
    } finally {await context.close();}
  }
  console.log('PASS system language variants/order/fallback, saved choice precedence, unavailable storage and localized emoji category controls');
} finally {await browser.close();}
