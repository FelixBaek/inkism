import assert from 'node:assert/strict';
import {WindowHistory} from '../src/lib/window-history.ts';
const a='<p>앞😀</p>', b='<p>뒤</p>', editedA='<p><strong>앞😀 수정</strong></p>', editedB='<p>뒤 수정</p>';
const h=new WindowHistory();
h.record({from:0,offset:0,before:a,after:editedA,beforeCount:1,afterCount:1,session:1,group:1,time:1});
h.record({from:editedA.length,offset:1,before:b,after:editedB,beforeCount:1,afterCount:1,session:2,group:1,time:2});
let source=editedA+editedB;
source=h.apply('undo',source).content;assert.equal(source,editedA+b);
source=h.apply('undo',source).content;assert.equal(source,a+b);
source=h.apply('redo',source).content;assert.equal(source,editedA+b);
source=h.apply('redo',source).content;assert.equal(source,editedA+editedB);
assert.throws(()=>h.apply('undo','changed outside history'));assert.equal(h.canUndo,true);assert.equal(h.canRedo,false);
source=h.apply('undo',source).content;
h.record({from:0,offset:0,before:editedA,after:a,beforeCount:1,afterCount:1,session:3,group:1,time:3});assert.equal(h.canRedo,false);
const grouped=new WindowHistory();
grouped.record({from:0,offset:0,before:'a',after:'ab',beforeCount:1,afterCount:1,session:1,group:1,time:1});
grouped.record({from:0,offset:0,before:'ab',after:'abc',beforeCount:1,afterCount:1,session:1,group:1,time:20});
assert.equal(grouped.apply('undo','abc').content,'a');assert.equal(grouped.canUndo,false);
const bounded=new WindowHistory();for(let i=1;i<=110;i++) bounded.record({from:0,offset:0,before:String(i-1),after:String(i),beforeCount:1,afterCount:1,session:i,group:1,time:i*1000});
source='110';let count=0;while(bounded.canUndo){source=bounded.apply('undo',source).content;count++;}assert.equal(count,100);assert.equal(source,'10');
console.log('PASS: cross-window UTF-16 history, grouping, redo invalidation, mismatch protection and bounded retention');
// A distant move retains just the two changed ranges. Undo must reverse their
// order and a mismatch in either range must leave the history intact.
const original='앞😀|대상|중간 원문|뒤',target='대상|',middle='중간 원문|';
const moved='앞😀|'+middle+target+'뒤',start='앞😀|'.length,destination=start+middle.length;
const moveEdit={from:start,offset:1,before:'',after:'',beforeCount:1,afterCount:1,session:80,group:0,time:100,
 edits:[{start,expected:target,replacement:''},{start:destination,expected:'',replacement:target}]};
const moves=new WindowHistory();moves.record(moveEdit);assert.ok(moves.canUndo);
assert.equal(moves.apply('undo',moved).content,original);assert.equal(moves.apply('redo',original).content,moved);
const loaded=WindowHistory.restore(JSON.parse(JSON.stringify(moves.serialize())));
assert.equal(loaded.apply('undo',moved).content,original);assert.equal(loaded.apply('redo',original).content,moved);
assert.throws(()=>loaded.apply('undo',moved.replace(target,'변경됨|')));assert.ok(loaded.canUndo);assert.equal(loaded.canRedo,false);
// Move toward the beginning, including a negative preview offset and a failure
// at the second inverse splice. Nothing is committed on partial validation.
const backwards=new WindowHistory(),shifted='대상|앞😀|중간 원문|뒤';
backwards.record({...moveEdit,afterPreview:{html:'<p>대상</p>',count:1,relativeFrom:-start},
 edits:[{start,expected:target,replacement:''},{start:0,expected:'',replacement:target}]});
const restored=WindowHistory.restore(JSON.parse(JSON.stringify(backwards.serialize())));
assert.equal(restored.apply('undo',shifted).content,original);assert.equal(restored.apply('redo',original).content,shifted);
assert.equal(WindowHistory.restore({done:[{...moveEdit,edits:[{start:-1,expected:'',replacement:'x'},moveEdit.edits[1]]}],undone:[]}).canUndo,false);
console.log('PASS: distant move undo/redo, persisted batch history, mismatch protection and negative preview');
const partial=new WindowHistory();partial.record({...moveEdit,
 edits:[{...moveEdit.edits[0],start:10000},moveEdit.edits[1]]});
assert.throws(()=>partial.apply('undo',moved));assert.ok(partial.canUndo);assert.equal(partial.canRedo,false);
console.log('PASS: invalid second inverse splice cannot consume a move history group');
