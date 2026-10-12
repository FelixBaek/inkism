import {Extension} from '@tiptap/core';
import {Plugin,PluginKey} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import type {Node as PMNode} from '@tiptap/pm/model';
import {referenceRead} from '../lib/reference-read';
import {referencePreview} from '../lib/reference-preview';
import {knowledge,parseReference} from '../lib/knowledge';
import {t} from '../i18n';
const key=new PluginKey<DecorationSet>('noteEmbeds');
/** Read-only projections are view decorations, never serialized note content.
 * A nested reference stays text: cycles cannot recurse or duplicate note data.
 */
export const NoteEmbeds=Extension.create({
 name:'noteEmbeds',
 addOptions(){return {noteId:''};},
 addProseMirrorPlugins(){
  const owner=this.options.noteId;
  const decorate=(doc:PMNode)=>{
   const items:Decoration[]=[],occurrences=new Map<string,number>();
   doc.descendants((node,pos,parent)=>{
    if(items.length>=20)return false;
    if(!node.isText||parent?.type.name==='codeBlock'||node.marks.some(m=>m.type.name==='code'))return;
    for(const match of node.text!.matchAll(/!\[\[([^\]\n]+)\]\]/g)){
     if(items.length>=20)break;
     const raw=match[1],ref=parseReference(raw,true),at=pos+match.index!+match[0].length;const occurrence=occurrences.get(raw)??0;occurrences.set(raw,occurrence+1);
     items.push(Decoration.widget(at,()=>{
      const root=document.createElement('span');root.className='inline-note-embed';root.contentEditable='false';root.setAttribute('role','region');root.setAttribute('aria-label',t('참조한 노트 내용'));
      const header=document.createElement('span'),link=document.createElement('a'),refresh=document.createElement('button'),body=document.createElement('span');
      header.className='inline-note-embed-header';body.className='inline-note-embed-body';refresh.type='button';refresh.textContent=t('참조 새로고침');link.textContent=ref.label;header.append(link,refresh);root.append(header,body);
      let alive=true,controller:AbortController|null=null;
      const load=async()=>{
       controller?.abort();const request=new AbortController();controller=request;refresh.disabled=true;body.textContent=t('불러오는 중…');
       try{
        const resolved=ref.target?await knowledge.resolve(ref.target):{items:owner?[{id:owner,title:''}]:[]};
        if(!alive)return;
        if(resolved.items.length!==1)throw new Error(t('대상 노트가 없거나 같은 이름이 여러 개입니다. 속성과 노트 연결에서 확인해 주세요.'));
        const preview=await referenceRead(()=>referencePreview(resolved.items[0].id,ref.anchor,'redirect_sources'in resolved?resolved.redirect_sources??[]:[],request.signal),request.signal);
        if(!alive||request.signal.aborted)return;
        link.href=`note://${preview.note.id}${ref.anchor?'#'+ref.anchor:''}`;link.textContent=ref.label||preview.note.title;body.innerHTML=preview.html;
        if(preview.truncated){const hint=document.createElement('span');hint.textContent=t('큰 참조는 일부만 미리 표시합니다. 전체 내용은 노트를 열어 확인하세요.');body.append(hint);}
       }catch(e){if(alive&&!request.signal.aborted)body.textContent=e instanceof Error?e.message:String(e);}finally{if(alive&&!request.signal.aborted)refresh.disabled=false;}
      };
      refresh.onclick=()=>void load();
      (root as HTMLElement & {dispose?:()=>void}).dispose=()=>{alive=false;controller?.abort();refresh.onclick=null;};
      void load();return root;
     },{key:`${owner}:${raw}:${occurrence}`,side:1,ignoreSelection:true,stopEvent:()=>true,destroy:node=>(node as HTMLElement & {dispose?:()=>void}).dispose?.()}));
    }
   });
   return DecorationSet.create(doc,items);
  };
  return [new Plugin<DecorationSet>({key,state:{init:(_,state)=>decorate(state.doc),apply:(tr,old)=>tr.docChanged?decorate(tr.doc):old},props:{decorations:state=>key.getState(state)}})];
 }
});
