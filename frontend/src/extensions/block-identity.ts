import {Extension} from '@tiptap/core';
import {NodeSelection,Plugin,PluginKey,type EditorState,type Transaction} from '@tiptap/pm/state';
import {Fragment,type Node as PMNode} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {Transform,type Mapping} from '@tiptap/pm/transform';
import {isHistoryTransaction} from '@tiptap/pm/history';
import {cloneSliceIdentity,newBlockId} from '../lib/block-identity';
import type {EditWork} from '../lib/edit-work';
type Range=[number,number];
/** Blocks touched by IME composition, waiting for the composition to end. */
type PendingIdentity={ranges:Range[];composition?:number}|null;
const pendingIdentity=new PluginKey<PendingIdentity>('blockIdentityPending');
/** How a transaction carries block identities (attributes only): `appended`
 * to the edit that touched the blocks, or `deferred` until an IME composition
 * that touched them had ended. */
export const blockIdentityTransaction=(tr:Transaction):'appended'|'deferred'|undefined=>{
 const meta=tr.getMeta(pendingIdentity);
 if(meta==='appended')return 'appended';
 return meta==='assigned'?'deferred':undefined;
};
/** Real user edits (or a user paste). Windowed editor projection/reconciliation
 * transactions deliberately do not enter history and never acquire IDs. */
const userEdit=(tr:Transaction)=>tr.docChanged&&!(tr.getMeta('addToHistory')===false&&tr.getMeta('uiEvent')!=='paste');
/** Ranges changed by the maps of `mapping` from `first` on, in the coordinates
 * of its resulting document. */
function mappingRanges(mapping:Mapping,first=0):Range[]{
 const ranges:Range[]=[];
 mapping.maps.forEach((map,index)=>{
  if(index<first)return;
  const rest=mapping.slice(index+1);
  map.forEach((_oldFrom,_oldTo,newFrom,newTo)=>{ranges.push([rest.map(newFrom,-1),rest.map(newTo,1)]);});
 });
 return ranges;
}
/** Ranges changed by `tr`, in the coordinates of its resulting document. */
const touchedRanges=(tr:Transaction)=>mappingRanges(tr.mapping);
/** Ranges changed by user edits among `transactions`, in the final document. */
function editedRanges(transactions:readonly Transaction[],include:(tr:Transaction)=>boolean):Range[]{
 let ranges:Range[]=[];
 for(const tr of transactions){
  if(!tr.docChanged)continue;
  ranges=ranges.map(([from,to])=>[tr.mapping.map(from,-1),tr.mapping.map(to,1)]);
  if(include(tr))ranges.push(...touchedRanges(tr));
 }
 return ranges;
}
/** Give the blocks a change touched an identity: blocks overlapping inserted or
 * replaced content, or, for a pure deletion, the blocks around the deletion
 * point (e.g. the paragraph two blocks were joined into). A block that merely
 * borders an inserted, moved or deleted block is not touched. */
function assignIds(doc:PMNode,tr:Transform,ranges:Range[],allow:(pos:number)=>boolean=()=>true){
 const size=doc.content.size;
 const give=(node:PMNode,pos:number)=>{
  if(node.isText||!Object.hasOwn(node.attrs,'id')||node.attrs.id||!allow(pos))return;
  if(tr.doc.nodeAt(pos)?.attrs.id)return;
  tr.setNodeMarkup(pos,undefined,{...node.attrs,id:newBlockId()});
 };
 for(const [rawFrom,rawTo] of ranges){
  const from=Math.max(0,Math.min(size,rawFrom)),to=Math.max(from,Math.min(size,rawTo));
  if(to>from)doc.nodesBetween(from,to,give);
  else{const $pos=doc.resolve(from);for(let depth=1;depth<=$pos.depth;depth++)give($pos.node(depth),$pos.before(depth));}
 }
}
/** The same rule for an edit computed outside a mounted editor (a document
 * selection or boundary replayed on a bounded detached model): blocks touched
 * by the maps of `mapping` from `first` on receive a new identity, limited to
 * blocks whose opening token lies in [`from`, `to`) — the span the caller
 * writes back. Attribute changes keep every position, so selections and the
 * mapping stay valid for the returned document. */
export function identifyTouchedBlocks(doc:PMNode,mapping:Mapping,options:{first?:number;from?:number;to?:number}={}):PMNode{
 const tr=new Transform(doc),from=options.from??0,to=options.to??doc.content.size;
 assignIds(doc,tr,mappingRanges(mapping,options.first??0),pos=>pos>=from&&pos<to);
 return tr.doc;
}
/** Detached large edits use short batches and one immutable model rebuild.
 * The mounted IME/history plugin below keeps its synchronous transaction rule. */
export function* identifyTouchedBlocksWork(doc:PMNode,mapping:Mapping,options:{first?:number;from?:number;to?:number}={}):EditWork<PMNode>{
 const first=options.first??0,from=options.from??0,to=options.to??doc.content.size;
 if(first>=mapping.maps.length)return doc;
 // Native textblock formats replace only their one-position opening/closing
 // tokens. Such maps leave every integer position unchanged. Without mirrors
 // they need no quadratic pass through all later maps. Other edits keep the
 // original mapping rule (including insertion/deletion biases).
 const integerIdentity=yield* integerIdentityMapping(mapping);
 const ranges=yield* changedRanges(mapping,first,integerIdentity);
 const allowed=(node:PMNode,pos:number)=>!node.isText&&Object.hasOwn(node.attrs,'id')&&!node.attrs.id&&pos>=from&&pos<to;
 const {intervals,zero}=yield* splitRanges(doc,ranges,allowed);
 const merged=yield* mergeIntervals(intervals);
 const zeroPositions=[...zero].sort((a,b)=>a-b);
 return yield* rebuildTouched(doc,-1,{
  allowed,zero,
  overlaps:(pos,end)=>{const at=lowerBound(merged.length,i=>merged[i][1]<=pos);return at<merged.length&&merged[at][0]<end;},
  containsZero:(pos,end)=>{const at=lowerBound(zeroPositions.length,i=>zeroPositions[i]<pos);return at<zeroPositions.length&&zeroPositions[at]<end;},
 });
}
/** Whether every map only replaces one-position tokens, without mirrors. */
function* integerIdentityMapping(mapping:Mapping):EditWork<boolean>{
 let integerIdentity=true;
 for(let i=0;i<mapping.maps.length;i++){
  if(mapping.getMirror(i)!==undefined)integerIdentity=false;
  mapping.maps[i].forEach((a,b,c,d)=>{
   if(![a,b,c,d].every(Number.isSafeInteger)||b-a!==d-c||(b-a!==0&&b-a!==1))integerIdentity=false;
  });
  yield;
 }
 return integerIdentity;
}
function* changedRanges(mapping:Mapping,first:number,integerIdentity:boolean):EditWork<Range[]>{
 const ranges:Range[]=[];
 for(let i=0;i<mapping.maps.length;i++){
  if(i<first)continue;
  const rest=integerIdentity?undefined:mapping.slice(i+1);
  mapping.maps[i].forEach((_a,_b,a,b)=>{ranges.push(rest?[rest.map(a,-1),rest.map(b,1)]:[a,b]);});
  yield;
 }
 return ranges;
}
/** Non-empty ranges, and the allowed blocks around each pure deletion point. */
function* splitRanges(doc:PMNode,ranges:Range[],allowed:(node:PMNode,pos:number)=>boolean):EditWork<{intervals:Range[];zero:Set<number>}>{
 const size=doc.content.size,intervals:Range[]=[],zero=new Set<number>();
 for(const [rawFrom,rawTo] of ranges){
  const a=Math.max(0,Math.min(size,rawFrom)),b=Math.max(a,Math.min(size,rawTo));
  if(b>a)intervals.push([a,b]);
  else{
   const point=doc.resolve(a);
   for(let depth=1;depth<=point.depth;depth++)if(allowed(point.node(depth),point.before(depth)))zero.add(point.before(depth));
  }
  yield;
 }
 return {intervals,zero};
}
function* mergeIntervals(intervals:Range[]):EditWork<Range[]>{
 intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const merged:Range[]=[];
 for(const interval of intervals){
  const last=merged.at(-1);
  if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else merged.push(interval);
  yield;
 }
 return merged;
}
/** First index in [0, length) for which `before` is false (binary search). */
function lowerBound(length:number,before:(index:number)=>boolean){
 let low=0,high=length;
 while(low<high){const mid=(low+high)>>>1;if(before(mid))low=mid+1;else high=mid;}
 return low;
}
type TouchedBlocks={
 allowed:(node:PMNode,pos:number)=>boolean;
 zero:Set<number>;
 overlaps:(pos:number,end:number)=>boolean;
 containsZero:(pos:number,end:number)=>boolean;
};
function* rebuildTouched(node:PMNode,pos:number,touched:TouchedBlocks):EditWork<PMNode>{
 const assign=pos>=0&&touched.allowed(node,pos)&&(touched.overlaps(pos,pos+node.nodeSize)||touched.zero.has(pos));
 let children:PMNode[]|undefined,offset=pos+1;
 for(let i=0;i<node.childCount;i++){
  const child=node.child(i),end=offset+child.nodeSize;
  const next=touched.overlaps(offset,end)||touched.containsZero(offset,end)?yield* rebuildTouched(child,offset,touched):child;
  if(next!==child&&!children)children=Array.from({length:i},(_,j)=>node.child(j));
  children?.push(next);offset=end;
  yield;
 }
 const content=children?Fragment.fromArray(children):node.content;
 yield;
 if(assign)return node.type.create({...node.attrs,id:newBlockId()},content,node.marks);
 return children?node.copy(content):node;
}
/** Attribute-only changes keep positions, but ProseMirror maps a NodeSelection
 * through a markup change as deleted. Keep the user's selected block selected
 * (e.g. a just-duplicated block that typing should replace). */
function keepNodeSelection(state:EditorState,tr:Transaction){
 const selected=state.selection;
 if(tr.docChanged&&selected instanceof NodeSelection&&!(tr.selection instanceof NodeSelection))
  tr.setSelection(NodeSelection.create(tr.doc,selected.from));
}
/** IDs are added to edited/new blocks, never merely by opening a document. */
export const BlockIdentity=Extension.create({
 name:'blockIdentity',
 addOptions(){return {automaticIds:true};},
 addGlobalAttributes(){return [{types:['paragraph','heading','blockquote','bulletList','orderedList','listItem','taskList','taskItem','codeBlock','horizontalRule','table','tableRow','tableCell','tableHeader','details','detailsSummary','detailsContent','callout','image','attachment'],attributes:{id:{default:null,keepOnSplit:false,parseHTML:el=>el.getAttribute('id'),renderHTML:attrs=>attrs.id?{id:attrs.id}:{}}}}];},
 addProseMirrorPlugins(){
  const automaticIds=this.options.automaticIds;
  // The mounted view, so programmatic edits dispatched while its composition
  // is open (not only the DOM-read ones carrying "composition") wait as well.
  let mounted:EditorView|undefined;
  const composing=(tr:Transaction)=>Boolean(tr.getMeta('composition')||mounted?.composing);
  return [new Plugin<PendingIdentity>({
  key:pendingIdentity,
  // Changing a block's attributes makes ProseMirror redraw that block's DOM.
  // Doing so while an IME composition is open destroys the browser's
  // composition text node: the composition is silently lost (no
  // compositionend), its commit is inserted a second time and the editor stays
  // "composing" forever, so autosave never resumes. Blocks edited by a
  // composition therefore receive their identity only after it has ended.
  state:{
   init:()=>null,
   apply(tr,value){
    if(tr.getMeta(pendingIdentity)==='assigned'||isHistoryTransaction(tr))return null;
    let next=value;
    if(next&&tr.docChanged)next={...next,ranges:next.ranges.map(([from,to])=>[tr.mapping.map(from,-1),tr.mapping.map(to,1)] as Range)};
    if(automaticIds&&composing(tr)&&userEdit(tr))next={ranges:[...(next?.ranges??[]),...touchedRanges(tr)],composition:tr.getMeta('composition')??next?.composition};
    return next;
   },
  },
  view(view){
   mounted=view;
   let timer:ReturnType<typeof setTimeout>|undefined;
   const assign=()=>{
    timer=undefined;
    if(view.isDestroyed||view.composing)return;
    const pending=pendingIdentity.getState(view.state);
    if(!pending)return;
    const tr=view.state.tr.setMeta(pendingIdentity,'assigned');
    assignIds(view.state.doc,tr,pending.ranges);keepNodeSelection(view.state,tr);
    // Same composition ID: undo history keeps the IDs in the composition's event.
    if(tr.docChanged&&pending.composition!==undefined)tr.setMeta('composition',pending.composition);
    else tr.setMeta('addToHistory',false);
    const before=view.state;
    view.dispatch(tr);
    // An editor guard may refuse it (the windowed editor commits a provisional
    // composition over a document selection from its own captured slice).
    // Then drop the request instead of retrying it as a later, separate edit.
    if(!view.isDestroyed&&view.state===before&&tr.docChanged)
     view.dispatch(view.state.tr.setMeta(pendingIdentity,'assigned').setMeta('addToHistory',false));
   };
   const schedule=()=>{timer??=setTimeout(assign,0);};
   view.dom.addEventListener('compositionend',schedule);
   return {
    update(next){if(!next.composing&&pendingIdentity.getState(next.state))schedule();},
    destroy(){clearTimeout(timer);view.dom.removeEventListener('compositionend',schedule);if(mounted===view)mounted=undefined;},
   };
  },
  props:{transformPasted:slice=>cloneSliceIdentity(slice)},
  appendTransaction(transactions,_old,state){
   // Undo/redo must reproduce the exact historical document, including the
   // absence of an ID before the first edit. Never turn replay into a new edit.
   if(transactions.some(isHistoryTransaction)||!transactions.some(tr=>tr.docChanged))return null;
   const seen=new Set<string>();const tr=state.tr;
   // Give only blocks touched by this edit an identity. Existing documents are
   // left byte-for-byte alone until the user edits them; this keeps opening a
   // note and windowed reads source-preserving while making newly typed,
   // split, or pasted blocks linkable immediately.
   if (automaticIds) {
    // Composition edits wait in the plugin state (see above); the deferred
    // assignment itself is not a new edit.
    assignIds(state.doc,tr,editedRanges(transactions,tx=>userEdit(tx)&&!composing(tx)&&!tx.getMeta(pendingIdentity)));
   }
   state.doc.descendants((node,pos)=>{const id=node.attrs.id;if(!id)return;
    if(seen.has(id))tr.setNodeMarkup(pos,undefined,{...node.attrs,id:newBlockId()});else seen.add(id);
   });
   keepNodeSelection(state,tr);
   return tr.docChanged?tr.setMeta(pendingIdentity,'appended'):null;
  }
 })];}
});
