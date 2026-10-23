import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result=await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:['src/lib/global-search-load.ts','src/lib/global-search-core.ts'],bundle:true,write:false,format:'esm',platform:'node',outdir:'out'});
const modules=await Promise.all(result.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const {loadSearchTexts,searchPages}=modules[0];const {searchText}=modules[1];
const notes=Array.from({length:12},(_,i)=>({id:String(i),title:'Note '+i,tags:i%2?['odd']:['even'],content_format:'markdown',preview:'preview',trashed:false}));
let active=0,peak=0,calls=0;
const loaded=await loadSearchTexts(notes,'tag:odd needle',async(n:any)=>{calls++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;return 'needle '+n.id;});
assert.equal(calls,6);assert.equal(peak,4);assert.deepEqual(loaded.notes.map((n:any)=>n.id),['1','3','5','7','9','11']);assert.equal(searchText(loaded.notes,(n:any)=>loaded.texts[n.id],'tag:odd needle').length,6);
calls=0;await loadSearchTexts(notes,'tag:even',async()=>{calls++;return '';});assert.equal(calls,0);
const guarded=await loadSearchTexts([{...notes[0],locked:true},{...notes[1],trashed:true},notes[2]],'needle',async()=>{calls++;return 'needle';});assert.equal(calls,1);assert.equal(guarded.notes[0].id,'2');
const controller=new AbortController();calls=0;
await assert.rejects(loadSearchTexts(notes,'needle',async()=>{calls++;controller.abort();return 'needle';},{signal:controller.signal}),{name:'AbortError'});assert.ok(calls<=4);
await assert.rejects(loadSearchTexts(notes,'needle',async()=> 'long text',{maxBytes:4}),/64 MiB/);
await assert.rejects(loadSearchTexts(notes,'x'.repeat(1001),async()=>''),/1,000/);
const later=searchText([notes[0]],()=>Array.from({length:300},()=> 'needle').join('\n'),'line:250 needle');assert.equal(later.length,1);assert.equal(later[0].line,250);
console.log('PASS global search: metadata prefilter, 4 bounded concurrent reads, metadata-only no I/O, locked/trash exclusion, cancellation, size/query limits');

const library=Array.from({length:10001},(_,i)=>({...notes[0],id:String(i),title:'Item '+i,tags:i===10000?['last']:[]}));
let pages=0,bodyReads=0;const progress:number[]=[];
const paged=await searchPages(async(cursor:any)=>{pages++;const start=Number(cursor??0);return {items:library.slice(start,start+200),next_cursor:start+200<library.length?String(start+200):null};},'tag:last needle',async()=>{bodyReads++;return 'needle';},async(ns:any,ts:any)=>searchText(ns,(n:any)=>ts[n.id],'tag:last needle'),{signal:new AbortController().signal,onProgress:(n:number)=>progress.push(n)});
assert.equal(pages,51);assert.equal(bodyReads,1);assert.equal(paged[0].note.id,'10000');assert.equal(progress.at(-1),10001);
const cancelled=new AbortController();let readsAfterCancel=0;
await assert.rejects(searchPages(async()=>({items:notes,next_cursor:'next'}),'needle',async()=>{readsAfterCancel++;cancelled.abort();return 'needle';},async()=>[],{signal:cancelled.signal,onProgress:()=>assert.fail('stale progress')}),{name:'AbortError'});assert.ok(readsAfterCancel<=4);
console.log('PASS paged candidates: 10,001st note, 51 bounded pages, metadata filtering, progress, cancellation');

let limitedPages=0;const limitHits=await searchPages(async()=>{limitedPages++;return {items:[notes[0]],next_cursor:'later'};},'needle',async()=> 'needle',async()=>Array.from({length:5000},()=>({note:notes[0],index:0,line:1,snippet:'needle'})),{signal:new AbortController().signal,onProgress:()=>{}});assert.equal(limitHits.length,5000);assert.equal(limitedPages,1);
console.log('PASS result bound stops candidate paging at 5,000 hits');

// created:/updated: 날짜 조건(로컬 시각, 끝 날짜 포함)
const {dateRange}=modules[1];
const at=(y:number,m:number,d:number,h=12)=>new Date(y,m-1,d,h).getTime();
assert.deepEqual(dateRange('2026-10-15'),[at(2026,10,15,0),at(2026,10,16,0)]);
assert.deepEqual(dateRange('2026-10'),[at(2026,10,1,0),at(2026,11,1,0)]);
assert.deepEqual(dateRange('2026-10-12..2026-10-15'),[at(2026,10,12,0),at(2026,10,16,0)]);
assert.deepEqual(dateRange('..2026-10-15'),[-Infinity,at(2026,10,16,0)]);
assert.throws(()=>dateRange('2026-02-30'),/created:/);assert.throws(()=>dateRange('어제'),/created:/);assert.throws(()=>dateRange('..'),/created:/);
const dated=[{...notes[0],id:'old',created_at:at(2026,9,1),updated_at:at(2026,9,30)},{...notes[1],id:'new',created_at:at(2026,10,1),updated_at:at(2026,10,14)}];
assert.deepEqual(searchText(dated,()=> 'x','updated:2026-10-12..2026-10-15').map((h:any)=>h.note.id),['new']);
assert.deepEqual(searchText(dated,()=> 'x','created:2026-09').map((h:any)=>h.note.id),['old']);
assert.equal(searchText(dated,()=> 'needle','needle created:2026-10').length,1);
console.log('PASS date conditions: created:/updated: day, month, open ranges, invalid dates');
