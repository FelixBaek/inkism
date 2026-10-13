// Tests use Korean UI labels unless a case selects another browser locale.
// Keep the real Playwright browser and permit explicit locale overrides.
import {chromium as nativeChromium} from 'playwright-core';
export type {Page} from 'playwright-core';
export const chromium:typeof nativeChromium=new Proxy(nativeChromium,{
 get(target,key,receiver){
  if(key!=='launch')return Reflect.get(target,key,receiver);
  return async(options:Parameters<typeof nativeChromium.launch>[0])=>{
   const browser=await nativeChromium.launch(options);
   const page=browser.newPage.bind(browser),context=browser.newContext.bind(browser);
   browser.newPage=(options={})=>page({locale:'ko-KR',...options});
   browser.newContext=(options={})=>context({locale:'ko-KR',...options});
   return browser;
  };
 }
});
