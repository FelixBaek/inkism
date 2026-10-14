import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useStore} from '../store';
import {t} from '../i18n';
import {useDialogVisibility} from '../lib/dialog-visibility';
import {TAG_CHANGE_EVENT,tagChanges,type TagChangeRequest,type TagChangePreview,type TagChangeReceipt,type TagChangeResult} from '../lib/tag-change';
import './SharingDialogs.css';
import './TagChangeDialog.css';
export function TagChangeDialog(){
 const s=useStore(),latest=useRef(s);latest.current=s;
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),generation=useRef(0);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [preview,setPreview]=useState<TagChangePreview|null>(null),[request,setRequest]=useState<TagChangeRequest|null>(null),[history,setHistory]=useState<TagChangeReceipt[]>([]);
 useDialogVisibility(dialog,open);
 const run=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(String(e));}finally{lock.current=false;setBusy(false);}};
 const load=async(value?:TagChangeRequest)=>{const ticket=++generation.current;setSuccess('');setPreview(null);setRequest(value??null);
  if(!await latest.current.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));
  const [receipt,next]=await Promise.all([tagChanges.list(),value?tagChanges.preview(value):Promise.resolve(null)]);
  if(ticket!==generation.current)return;setHistory(receipt.items);setPreview(next);
 };
 useEffect(()=>{const show=(event:Event)=>{if(lock.current)return;setOpen(true);void run(()=>load((event as CustomEvent<TagChangeRequest|undefined>).detail));};window.addEventListener(TAG_CHANGE_EVENT,show);return()=>{generation.current++;window.removeEventListener(TAG_CHANGE_EVENT,show);};},[]);
 const close=()=>{if(lock.current)return;generation.current++;setOpen(false);};
 const refresh=async(result:TagChangeResult)=>{
  const current=latest.current;current.refreshList();await current.refreshMeta();
  setHistory((await tagChanges.list()).items);
 };
 const apply=()=>void run(async()=>{if(preview?.status!=='preview')return;if(!await latest.current.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));
  const result=await latest.current.performTagChange((id,revision)=>tagChanges.apply(preview.id,id,revision));setPreview(null);setSuccess(t('{count}개 노트의 태그를 변경했습니다.',{count:result.updated}));
  const view=latest.current.view;if(view.type==='tag'&&view.name===preview.name)latest.current.setView(preview.replacement?{type:'tag',name:preview.replacement}:{type:'all'});
  await refresh(result);
 });
 const undo=(receipt:TagChangeReceipt)=>void run(async()=>{if(!await latest.current.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));const result=await latest.current.performTagChange((id,revision)=>tagChanges.undo(receipt.id,id,revision));setPreview(null);setSuccess(t('{count}개 노트의 이전 태그를 복원했습니다.',{count:result.updated}));await refresh(result);});
 const more=()=>void run(async()=>{if(!preview||preview.next_offset===null)return;const next=await tagChanges.preview({preview_id:preview.id,offset:preview.next_offset});setPreview({...next,items:[...preview.items,...next.items]});});
 return createPortal(<dialog ref={dialog} className="sharing-dialog tag-change-dialog" aria-label={t('태그 변경 미리보기와 기록')} onCancel={e=>{e.preventDefault();close();}}>
  <h2>{t('태그 변경 미리보기와 기록')}</h2>
  <p>{t('보관함과 지운 노트를 포함합니다. 잠긴 노트와 읽기 전용 노트는 제외합니다. 미리보기 이후 문서가 바뀌면 다시 확인해야 합니다.')}</p>
  {busy&&<p><output>{t('불러오는 중…')}</output></p>}{error&&<p role="alert">{error}</p>}{success&&<p><output>{success}</output></p>}
  {preview&&<section><h3>{preview.name} → {preview.replacement??t('태그 제거')}</h3><p>{t('변경 {changed}개 · 제외 {excluded}개 · 전체 {total}개',{changed:preview.eligible_count,excluded:preview.excluded_count,total:preview.total})}</p>
   {preview.default_tag.changes&&<p>{t('새 노트의 기본 태그도 함께 변경합니다.')}: {preview.default_tag.before??'—'} → {preview.default_tag.after??'—'}</p>}
   <ul className="tag-change-items">{preview.items.map(item=><li key={item.id}><strong>{item.locked?t('잠긴 노트'):item.title||t('제목 없음')}</strong><span>{item.reason==='locked'?t('잠긴 노트'):item.reason==='readonly'?t('읽기 전용'):t('변경 대상')}{item.trashed?' · '+t('지운 노트'):item.archived?' · '+t('보관함'):''}</span>{!item.locked&&<div>{item.tags.join(', ')} → {item.next_tags.join(', ')||'—'}</div>}</li>)}</ul>
   {preview.next_offset!==null&&<button className="btn" disabled={busy} onClick={more}>{t('변경 대상 더 보기')}</button>}
   <button className="btn btn-primary" disabled={busy||(!preview.eligible_count&&!preview.default_tag.changes)} onClick={apply}>{t('확인한 태그 변경 적용')}</button>
  </section>}
  {request&&<button className="btn" disabled={busy} onClick={()=>void run(()=>load(request))}>{t('태그 변경 미리보기 새로고침')}</button>}
  <section><h3>{t('태그 변경 기록')}</h3><p>{t('되돌리기는 변경 전 태그를 복원합니다. 이후 수정된 노트가 있으면 덮어쓰지 않고 중단합니다.')}</p>
   {history.filter(item=>item.status!=='preview').map(item=><div className="tag-change-receipt" key={item.id}><span>{item.name} → {item.replacement??t('태그 제거')} · {item.updated}</span><time>{new Date(item.applied_at??item.created_at).toLocaleString()}</time><button className="btn" disabled={busy||item.status!=='applied'} onClick={()=>undo(item)}>{item.status==='undone'?t('복원됨'):t('이 태그 변경 되돌리기')}</button></div>)}
  </section><div className="dialog-actions"><button className="btn" disabled={busy} onClick={close}>{t('닫기')}</button></div>
 </dialog>,document.body);
}
