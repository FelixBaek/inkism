import {Extension} from '@tiptap/core';
import {NodeSelection,Plugin,PluginKey,type EditorState,type Transaction} from '@tiptap/pm/state';
import type {Node as PMNode} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {Transform,type Mapping} from '@tiptap/pm/transform';
import {isHistoryTransaction} from '@tiptap/pm/history';
import {cloneSliceIdentity,newBlockId} from '../lib/block-identity';
type Range=[number,number];
/** Blocks touched by IME composition, waiting for the composition to end. */
type PendingIdentity={ranges:Range[];composition?:number}|null;
const pendingIdentity=new PluginKey<PendingIdentity>('blockIdentityPending');
/** How a transaction carries block identities (attributes only): `appended`
 * to the edit that touched the blocks, or `deferred` until an IME composition
 * that touched them had ended. */
export const blockIdentityTransaction=(tr:Transaction):'appended'|'deferred'|undefined=>{
 const meta=tr.getMeta(pendingIdentity);
 return meta==='appended'?'appended':meta==='assigned'?'deferred':undefined;
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
  if(node.isText||!Object.prototype.hasOwnProperty.call(node.attrs,'id')||node.attrs.id||!allow(pos))return;
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
   const schedule=()=>{if(timer===undefined)timer=setTimeout(assign,0);};
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
