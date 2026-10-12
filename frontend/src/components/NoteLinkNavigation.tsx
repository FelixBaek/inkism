import {AnchorRepairDialog} from "./AnchorRepairDialog";
import {useEffect,useRef} from 'react';
import {useStore} from '../store';
import {api,rpc} from '../api';
import type {Note} from '../types';
import {referencePreview} from '../lib/reference-preview';
import {referenceRead} from '../lib/reference-read';
import type {NoteAnchor} from '../lib/note-anchor';
import {knowledge,parseReference} from '../lib/knowledge';
import {navigateNoteAnchor} from '../lib/note-anchor';
import {t} from '../i18n';
/** Resolve note links in all previews; Ctrl/Command-click follows editable links. */
export function NoteLinkNavigation(){
 const s=useStore(),latest=useRef(s);latest.current=s;
 useEffect(()=>{
  let generation=0,navigation:AbortController|null=null;
  let timer:number|undefined, active:Element|null=null, popup:HTMLDivElement|null=null;
  const removePreview=()=>{generation++;if(timer)window.clearTimeout(timer);timer=undefined;popup?.remove();popup=null;active=null;};
  const over=(event:Event)=>{const target=event.target instanceof Element?event.target.closest('a[href^="note://"]'):null;if(!target||target===active)return;removePreview();active=target;const request=generation;timer=window.setTimeout(()=>{void(async()=>{try{
    const ref=parseReference(target.getAttribute('href')!),resolved=await knowledge.resolve(ref.target);if(resolved.items.length!==1||active!==target||request!==generation)return;
    const note=await api.notePreview(resolved.items[0].id);if(active!==target||request!==generation)return;
    popup=document.createElement('div');popup.className='inkism-link-preview';popup.setAttribute('role','tooltip');
    const title=document.createElement('strong');title.textContent=note.title||t('제목 없음');const body=document.createElement('p');body.textContent=note.preview;popup.append(title,body);document.body.appendChild(popup);
    const rect=target.getBoundingClientRect();popup.style.left=`${Math.max(8,Math.min(window.innerWidth-popup.offsetWidth-8,rect.left))}px`;popup.style.top=`${Math.min(window.innerHeight-popup.offsetHeight-8,rect.bottom+8)}px`;
  }catch{/* Preview failures never interrupt editing. */}})();},280);};
  const out=(event:MouseEvent|FocusEvent)=>{if(active&&(!event.relatedTarget||!(event.relatedTarget instanceof Node)||!active.contains(event.relatedTarget)))removePreview();};
  const openHref=(href:string)=>{
   navigation?.abort();const controller=new AbortController();navigation=controller;const ref=parseReference(href),store=latest.current,origin=store.readDraft()?.id;
   void(async()=>{
    if(!await store.flushNow())return;
    const resolved=await knowledge.resolve(ref.target);
    if(resolved.items.length!==1)throw new Error(t('대상 노트가 없거나 같은 이름이 여러 개입니다. 속성과 노트 연결에서 확인해 주세요.'));
    const id=resolved.items[0].id;let note:Note|undefined,anchor:NoteAnchor|string=decodeURIComponent(ref.anchor);
    if(ref.anchor){try{note=await rpc<Note>('get',{id,max_body_bytes:2*1024*1024},{signal:controller.signal});}catch(error){if(controller.signal.aborted||!(error instanceof Error)||!error.message.includes('note body exceeds read budget'))throw error;const preview=await referenceRead(()=>referencePreview(id,ref.anchor,resolved.redirect_sources??[],controller.signal),controller.signal);note=preview.note;anchor=preview.anchor??anchor;}if(('locked'in note&&note.locked)||note.trashed)throw new Error(t('이 노트는 미리 볼 수 없습니다.'));await api.documentInfo(id,note.revision);}
    if(controller.signal.aborted||latest.current.readDraft()?.id!==origin)return;
    window.dispatchEvent(new Event('inkism-close-knowledge'));
    await store.selectNote(id);
    if(latest.current.readDraft()?.id!==id||controller.signal.aborted)return;
    if(note){await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const deadline=Date.now()+10000;while(document.querySelector('.windowed-editor')&&!document.querySelector('.windowed-editor .ProseMirror')){if(Date.now()>deadline)throw new Error(t('문서를 준비 중입니다. 잠시 후 다시 열어 주세요.'));await new Promise(r=>setTimeout(r,25));}await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const draft=latest.current.readDraft();if(note.content_format==='markdown'&&draft?.id===id)note={...note,content:draft.content,text:draft.text};await navigateNoteAnchor(note,anchor,resolved.redirect_sources);}
   })().catch(error=>{if(!controller.signal.aborted)void store.showError(t('노트 연결'),error instanceof Error?error.message:String(error));});
  };
  const follow=(event:MouseEvent)=>{
   const target=event.target instanceof Element?event.target.closest('a[href^="note://"]'):null;
   if(!target||event.button!==0)return;
   event.preventDefault();
   if(target.closest('[contenteditable]')?.getAttribute('contenteditable')==='true'&&!event.ctrlKey&&!event.metaKey)return;
   event.stopPropagation();
   openHref(target.getAttribute('href')!);
  };
  const openFromOs=(event:Event)=>{const href=(event as CustomEvent<string>).detail;if(typeof href==='string'&&href.startsWith('note://'))openHref(href);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')removePreview();};
  document.addEventListener('focusin',over,true);document.addEventListener('focusout',out,true);document.addEventListener('keydown',escape,true);
  document.addEventListener('mouseover',over,true);document.addEventListener('mouseout',out,true);document.addEventListener('click',follow,true);window.addEventListener('inkism-open-link',openFromOs);
  const pending=(window as Window & {__inkismPendingNoteLink?:unknown}).__inkismPendingNoteLink;
  if(typeof pending==='string'&&pending.startsWith('note://')){
   delete (window as Window & {__inkismPendingNoteLink?:unknown}).__inkismPendingNoteLink;
   queueMicrotask(()=>openHref(pending));
  }
  return()=>{navigation?.abort();removePreview();document.removeEventListener('focusin',over,true);document.removeEventListener('focusout',out,true);document.removeEventListener('keydown',escape,true);document.removeEventListener('mouseover',over,true);document.removeEventListener('mouseout',out,true);document.removeEventListener('click',follow,true);window.removeEventListener('inkism-open-link',openFromOs);};
 },[]);return <AnchorRepairDialog/>;
}
