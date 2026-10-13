import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from './browser-env.ts';
const bundle=await build({stdin:{contents:"export * from './lib/command-history';export * from './lib/app-commands';",resolveDir:new URL('../src/',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'commands',platform:'browser',logLevel:'silent'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.route('http://localhost/history-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://localhost/history-test');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const c=(window as any).commands;
  const corrupt=c.parseCommandHistory('{oops'),invalid=c.parseCommandHistory('{"favorites":[null,3,"ok","ok"],"usage":{"bad":{"count":-1,"at":0},"good":{"count":2,"at":5}}}');
  for(let i=0;i<140;i++)c.recordCommand('test.'+i);for(let i=0;i<70;i++)c.toggleCommandFavorite('test.'+i);const bounded=c.commandHistory();c.clearCommandHistory();const cleared=c.commandHistory();
  let runs=0;c.registerCommands([{id:'enabled',label:'Enabled',run:()=>runs++,shortcut:'alt+q'},{id:'disabled',label:'Disabled',enabled:()=>false,run:()=>runs++,shortcut:'alt+w'}]);const stop=c.listenCommandShortcuts(()=>{throw Error('unexpected');});
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'q',altKey:true,cancelable:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',altKey:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));stop();return {corrupt,invalid,bounded,cleared,runs,final:c.commandHistory()};
 });
 assert.equal(Object.keys(result.corrupt.usage).length,0);assert.deepEqual(result.invalid.favorites,['ok']);assert.deepEqual(Object.keys(result.invalid.usage),['good']);assert.equal(Object.keys(result.bounded.usage).length,128);assert.equal(result.bounded.favorites.length,64);assert.equal(Object.keys(result.cleared.usage).length,0);assert.equal(result.cleared.favorites.length,64);assert.equal(result.runs,1);assert.equal(result.final.usage.enabled.count,1);assert.equal(result.final.usage.disabled,undefined);
 console.log('PASS command history validation, bounded retention, clear preserves favorites, enabled shortcut tracking and disabled exclusion');
}finally{await browser.close();}
