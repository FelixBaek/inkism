import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['frontend/src/lib/list-sort.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {groupItems,groupTitle,readSort,writeSort,DEFAULT_SORT}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const now=new Date(2026,9,8,12).getTime(),day=86400000;
const note=(title,ago,pinned=false)=>({title,pinned,created_at:now-ago*day,updated_at:now-ago*day});
const sort=(groupBy,sortBy='updated_at')=>({sortBy,sortDirection:'desc',groupBy});
assert.deepEqual(groupItems([note('a',0,true),note('b',1),note('c',3),note('d',9),note('e',30)],sort('default'),now).map(g=>[g.title,g.items.length]),
  [['고정됨',1],['최근',2],['지난주',1],['이전',1]]);
assert.equal(groupTitle(note('가나',0),sort('abc'),now),'ㄱ');
assert.equal(groupTitle(note('힣',0),sort('abc'),now),'ㅎ');
assert.equal(groupTitle(note('apple',0),sort('abc'),now),'A');
assert.equal(groupTitle(note('',0),sort('abc'),now),'-');
assert.equal(groupTitle(note('x',0),sort('year'),now),'2026년');
assert.equal(groupTitle(note('x',0),sort('month'),now),'2026년 10월');
assert.equal(groupTitle(note('x',0),sort('week'),now),'10월 5일 – 2026년 10월 11일'); // 2026-10-08 is a Thursday; weeks start Monday
assert.equal(groupTitle(note('x',0),sort('none'),now),'전체');
// localStorage: per view, invalid values fall back to the default
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))} as any;
writeSort({type:'notebook',id:'n1'},{sortBy:'title',sortDirection:'asc',groupBy:'abc'});
assert.deepEqual(readSort({type:'notebook',id:'n1'}),{sortBy:'title',sortDirection:'asc',groupBy:'abc'});
assert.deepEqual(readSort({type:'notebook',id:'n2'}),DEFAULT_SORT);
store.set('inkism.listSort.all','{"sortBy":"DROP","sortDirection":"asc","groupBy":"abc"}');
assert.deepEqual(readSort({type:'all'}),DEFAULT_SORT);
console.log('list-sort ok');
