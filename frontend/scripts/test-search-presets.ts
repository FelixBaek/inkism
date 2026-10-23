import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/search-presets';export * from './lib/global-search-core';",resolveDir:new URL('../src',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'cjs'});
const m={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(m,m.exports);
const {searchQuery,readSearchPresets,periodRange,dateRange,prepareSearch}=m.exports as typeof import('../src/lib/search-presets') & typeof import('../src/lib/global-search-core');
const preset={id:'a',name:'Work',query:'needle',regex:false,period:'custom' as const,custom:['2026-10-01','2026-10-31'] as [string,string],tag:'say "hello" \\ notes',notebook:'book-1'};
const query=searchQuery(preset),prepared=prepareSearch(query);
assert.equal(prepared.term,'needle');
const note:any={tags:[preset.tag],notebook_ids:['book-1'],updated_at:new Date(2026,9,15).getTime(),title:'t'};
assert.ok(prepared.matches(note));assert.ok(!prepared.matches({...note,notebook_ids:['book-2']}));assert.ok(!prepared.matches({...note,tags:['other']}));
assert.deepEqual(readSearchPresets(JSON.stringify([preset])),[preset]);
assert.deepEqual(readSearchPresets('{bad'),[]);
assert.deepEqual(readSearchPresets(JSON.stringify([preset,preset,{...preset,id:'b',custom:['2026-10-31','2026-10-01']}])) ,[preset]);
assert.deepEqual(readSearchPresets(JSON.stringify([{...preset,regex:'false'},{...preset,period:'random'}])),[]);
assert.equal(readSearchPresets(JSON.stringify(Array.from({length:25},(_,i)=>({...preset,id:String(i)})))).length,20);
assert.deepEqual(periodRange('week',['',''],new Date(2026,9,25)),['2026-10-19','2026-10-25']);
assert.deepEqual(periodRange('last-month',['',''],new Date(2026,0,1)),['2025-12-01','2025-12-31']);
assert.notEqual(searchQuery({...preset,period:'today'},new Date(2026,9,23)),searchQuery({...preset,period:'today'},new Date(2026,9,24)),'relative saved periods follow the current day');
for(const bad of ['2026-10-31..2026-10-01','2026-13','2025-02-29','2026-00-10'])assert.throws(()=>dateRange(bad));
const old=process.env.TZ;
try{
 for(const zone of ['Asia/Seoul','America/New_York','UTC']){
  process.env.TZ=zone;
  for(const day of ['2026-03-08','2026-11-01']){
   const [start,end]=dateRange(day),test=prepareSearch('updated:'+day);
   assert.ok(test.matches({...note,updated_at:start}));assert.ok(test.matches({...note,updated_at:end-1}));assert.ok(!test.matches({...note,updated_at:end}));
   if(zone==='America/New_York')assert.equal((end-start)/3600000,day.includes('03-08')?23:25,'DST boundary uses local calendar days');
  }
  assert.equal(new Date(dateRange('0099-01-01')[0]).getFullYear(),99);
 }
}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
console.log('PASS saved searches: roundtrip, escaped tags, notebook filter, corrupt data, limits, relative dates, invalid dates, years under 100 and DST/UTC/Seoul boundaries');
