import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {isHistoryTransaction} from '@tiptap/pm/history';
import {cloneSliceIdentity,newBlockId} from '../lib/block-identity';
/** IDs are added to edited/new blocks, never merely by opening a document. */
export const BlockIdentity=Extension.create({
 name:'blockIdentity',
 addOptions(){return {automaticIds:true};},
 addGlobalAttributes(){return [{types:['paragraph','heading','blockquote','bulletList','orderedList','listItem','taskList','taskItem','codeBlock','horizontalRule','table','tableRow','tableCell','tableHeader','details','detailsSummary','detailsContent','callout','image','attachment'],attributes:{id:{default:null,keepOnSplit:false,parseHTML:el=>el.getAttribute('id'),renderHTML:attrs=>attrs.id?{id:attrs.id}:{}}}}];},
 addProseMirrorPlugins(){const automaticIds=this.options.automaticIds;return [new Plugin({
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
   const touched: Array<[number,number]> = [];
   if (automaticIds) {
    for (const tx of transactions) {
      if (!tx.docChanged) continue;
      // Windowed editor projection/reconciliation transactions deliberately do
      // not enter history. They must never acquire IDs or rewrite the source;
      // only real user edits (or a user paste) can create new identities.
      if (tx.getMeta("addToHistory") === false && tx.getMeta("uiEvent") !== "paste") continue;
      tx.mapping.maps.forEach(map => map.forEach((_oldFrom,_oldTo,newFrom,newTo) => {
        touched.push([Math.max(0,newFrom-1), Math.min(state.doc.content.size,newTo+1)]);
      }));
    }
    for (const [from,to] of touched) {
      state.doc.nodesBetween(from,to,(node,pos)=>{
        if (node.isText || !Object.prototype.hasOwnProperty.call(node.attrs,'id') || node.attrs.id) return;
        tr.setNodeMarkup(pos,undefined,{...node.attrs,id:newBlockId()});
      });
    }
   }
   state.doc.descendants((node,pos)=>{const id=node.attrs.id;if(!id)return;
    if(seen.has(id))tr.setNodeMarkup(pos,undefined,{...node.attrs,id:newBlockId()});else seen.add(id);
   });
   return tr.docChanged?tr:null;
  }
 })];}
});
