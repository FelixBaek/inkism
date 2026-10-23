import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {t} from '../i18n';
import {useStore} from '../store';
import {registerCommands} from '../lib/app-commands';
import './QuickCapture.css';
export const QUICK_CAPTURE='inkism-quick-capture';
export function QuickCapture(){
 const s=useStore(),latest=useRef(s);latest.current=s;
 const dialog=useRef<HTMLDialogElement>(null),running=useRef(false),id=useRef<string|null>(null);
 const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[body,setBody]=useState(''),[tags,setTags]=useState(''),[folder,setFolder]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [connect,setConnect]=useState(false),[connectionId,setConnectionId]=useState<string|null>(null);
 useEffect(()=>{if(connectionId&&s.draft?.id===connectionId&&!s.draftLoading){setConnectionId(null);window.dispatchEvent(new CustomEvent('inkism-open-knowledge',{detail:'note'}));}},[connectionId,s.draft?.id,s.draftLoading]);
 const pending=useRef(false);pending.current=Boolean(title||body||tags);
 useEffect(()=>{const show=()=>{if(document.querySelector('dialog[open]'))return;setOpen(true);};window.addEventListener(QUICK_CAPTURE,show);const unregister=registerCommands([{id:'note.capture',label:t('빠른 기록'),shortcut:'mod+shift+n',run:show}]);return()=>{window.removeEventListener(QUICK_CAPTURE,show);unregister();};},[]);
 useEffect(()=>{if(open){dialog.current?.showModal();dialog.current?.querySelector('textarea')?.focus();}else dialog.current?.close();},[open]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(pending.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 const close=()=>{if(!running.current)setOpen(false);};
 const save=async()=>{
  if(running.current||!body.trim())return;running.current=true;setBusy(true);setError('');
  try{
   if(!await latest.current.flushNow())throw new Error(t('저장을 완료한 뒤 다시 시도해 주세요.'));
   id.current??=crypto.randomUUID();
   const note={id:id.current,title:title.trim()||[...body.trim().split(/\r?\n/)[0]].slice(0,80).join(''),content:body,content_format:'text' as const,notebook_id:folder||null,tags:[...new Set(tags.split(',').map(x=>x.trim()).filter(Boolean))],require_absent:true};
   try{await api.save(note);}catch(error_){
    // An interrupted response can hide a successful commit. Reconcile this ID
    // only; never retry with a new ID or overwrite a different existing record.
    let saved;try{saved=await api.get(note.id);}catch{throw error_;}
    const savedTags=new Set(saved.tags);
    if(saved.title!==note.title||saved.content!==note.content||saved.content_format!=='text'||saved.notebook_id!==note.notebook_id||saved.tags.length!==note.tags.length||savedTags.size!==note.tags.length||!note.tags.every(tag=>savedTags.has(tag)))throw error_;
   }
   latest.current.refreshList();await latest.current.refreshMeta();
   setOpen(false);setTitle('');setBody('');setTags('');id.current=null;
   await latest.current.selectNote(note.id);
   if(connect)setConnectionId(note.id);
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{running.current=false;setBusy(false);}
 };
 return <dialog ref={dialog} className="dialog capture-layer" aria-labelledby="capture-title" onCancel={e=>{e.preventDefault();close();}}>
  <form className="capture-form" onSubmit={e=>{e.preventDefault();void save();}}>
   <h2 id="capture-title" className="dialog-title">{t('빠른 기록')}</h2>
   <p className="dialog-message">{t('텍스트로 저장합니다. 폴더와 태그로 다시 찾을 수 있습니다.')}</p>
   <button type="button" className="btn" disabled={busy} onClick={()=>{dialog.current?.close();setOpen(false);window.dispatchEvent(new CustomEvent('inkism-open-writing-tool',{detail:'templates'}));}}>{t('템플릿으로 새 노트')}</button>
   <label className="field-label" htmlFor="capture-body">{t('기록할 내용')}</label>
   <textarea id="capture-body" className="text-field" rows={6} value={body} onChange={e=>setBody(e.target.value)} disabled={busy} required />
   <label className="field-label" htmlFor="capture-name">{t('제목 (선택)')}</label>
   <input id="capture-name" className="text-field" value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/>
   <label className="field-label" htmlFor="capture-folder">{t('폴더')}</label>
   <select id="capture-folder" className="text-field" value={folder} onChange={e=>setFolder(e.target.value)} disabled={busy}><option value="">{t('폴더 없음')}</option>{s.notebooks.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select>
   <label className="field-label" htmlFor="capture-tags">{t('태그 (쉼표로 구분)')}</label>
   <input id="capture-tags" className="text-field" value={tags} onChange={e=>setTags(e.target.value)} disabled={busy}/>
   <p className="dialog-message">{t('닫아도 입력은 앱을 종료할 때까지 남아 있습니다.')}</p>
   <label className="capture-option"><input type="checkbox" checked={connect} disabled={busy} onChange={e=>setConnect(e.target.checked)}/>{t('저장 후 속성과 노트 연결 열기')}</label>
   {error&&<p role="alert">{error}</p>}
   <div className="dialog-actions"><button type="button" className="btn" disabled={busy} onClick={close}>{t('닫기')}</button><button type="submit" className="btn btn-primary" disabled={busy||!body.trim()}>{busy?t('저장 중…'):t('저장하고 열기')}</button></div>
  </form>
 </dialog>;
}
