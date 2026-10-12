import assert from 'node:assert/strict';
import {Schema} from '@tiptap/pm/model';
import {EditorState,TextSelection,Selection} from '@tiptap/pm/state';
import {history,undo,redo,closeHistory,undoDepth,redoDepth} from '@tiptap/pm/history';
import {importTestModule} from './import-test-module.ts';
const {acquireRichHistory,releaseRichHistory,restoreRichHistory,advanceRichHistory,forgetRichHistory} = await importTestModule(new URL('../src/lib/rich-history-cache.ts',import.meta.url));
const schema=()=>new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*',group:'block'},text:{group:'inline'}},marks:{strong:{}}});
const initial=()=>{const s=schema();return EditorState.create({schema:s,doc:s.node('doc',null,[s.node('paragraph',null,s.text('한글 😀 본문'))]),plugins:[history()]});};
const command=(s,cmd)=>{let next=s;assert.ok(cmd(s,tr=>next=s.apply(tr)));return next;};
const fresh=s=>{const doc=schema().nodeFromJSON(s.doc.toJSON());return EditorState.create({doc,selection:Selection.fromJSON(doc,s.selection.toJSON()),plugins:[history()]});};
const save=(id,s)=>{const c=acquireRichHistory(id,1);releaseRichHistory(id,c.handle,s);return acquireRichHistory(id,1);};
let state=initial();
state=state.apply(closeHistory(state.tr).insertText('첫째',1));
state=state.apply(closeHistory(state.tr).addMark(1,3,state.schema.marks.strong.create()));
state=state.apply(closeHistory(state.tr).insertText('둘째',3));
state=command(state,undo);
const c=save('note',state);assert.ok(c.value);
let restored=restoreRichHistory(fresh(state),c.value);
assert.notEqual(restored.schema,state.schema);
assert.equal(undoDepth(restored),undoDepth(state));assert.equal(redoDepth(restored),redoDepth(state));
for(const cmd of [redo,undo,undo,undo,redo,redo,redo]){
 state=command(state,cmd);restored=command(restored,cmd);
 assert.deepEqual(restored.doc.toJSON(),state.doc.toJSON());
 assert.deepEqual(restored.selection.toJSON(),state.selection.toJSON());
}
advanceRichHistory('note',1,2);releaseRichHistory('note',c.handle,restored);
assert.ok(acquireRichHistory('note',2).value);
forgetRichHistory('note');releaseRichHistory('note',c.handle,restored);
assert.equal(acquireRichHistory('note',2).value,undefined);
// Changes excluded from history still map older undo positions.
let mapped=initial();
mapped=mapped.apply(closeHistory(mapped.tr).insertText('edit',2));
mapped=mapped.apply(mapped.tr.insertText('untracked',1).setMeta('addToHistory',false));
mapped=mapped.apply(closeHistory(mapped.tr).split(5));
const mc=save('mapped',mapped);let mr=restoreRichHistory(fresh(mapped),mc.value);
for(const cmd of [undo,undo,redo,redo]){
 mapped=command(mapped,cmd);mr=command(mr,cmd);assert.deepEqual(mr.doc.toJSON(),mapped.doc.toJSON());
}
const v=save('stale',state);releaseRichHistory('stale',v.handle,state);
assert.equal(acquireRichHistory('stale',9).value,undefined);
const old=save('old',state);releaseRichHistory('old',old.handle,state);
for(let i=0;i<17;i++){const c=acquireRichHistory('cap'+i,1);releaseRichHistory('cap'+i,c.handle,initial());}
assert.equal(acquireRichHistory('old',1).value,undefined);
let huge=initial();huge=huge.apply(huge.tr.insertText('가'.repeat(5*1024*1024),1));
assert.equal(save('huge',huge).value,undefined);
assert.equal(undoDepth(huge),1,'capture never changes active history');
console.log('PASS: rich history rebuilt across schemas, exact marks/selection, redo branch, revisions, stale cleanup, count/byte cap, active history unaffected');
