import {useEffect, useRef, useState} from 'react';
import {rpc} from '../api';
import type {ListResult, Note, Summary} from '../types';
import {noteTasks, TASK_SCAN_BYTES, type NoteTask} from '../lib/note-tasks';
import {t} from '../i18n';
import './TaskOverview.css';

const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
type Row = NoteTask & {note: Summary};
const MAX_TASKS = 5000;
export function TaskOverview({onOpen}:Readonly<{onOpen:(id:string)=>void}>) {
 const [rows,setRows]=useState<Row[]>([]),[filter,setFilter]=useState('open'),[query,setQuery]=useState('');
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[skipped,setSkipped]=useState(0);
 const [cancelled,setCancelled]=useState(false),[limited,setLimited]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 const scan=async()=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;
  setRows([]);setProgress(0);setSkipped(0);setError('');setCancelled(false);setLimited(false);setBusy(true);
  const found:Row[]=[];let cursor:string|undefined,read=0,unread=0;const seen=new Set<string>();
  try {
   do {
    const page=await rpc<ListResult>('list',{view:'all',limit:100,...(cursor?{cursor}:{})},{signal:controller.signal});
    for(const summary of page.items){
     if(active.current!==controller||controller.signal.aborted)return;
     if(summary.trashed||('locked' in summary&&summary.locked)||seen.has(summary.id))continue;
     seen.add(summary.id);const previousCount=found.length;
     try {
      const note=await rpc<Note>('get',{id:summary.id,max_body_bytes:TASK_SCAN_BYTES},{signal:controller.signal});
      if(active.current!==controller||controller.signal.aborted)return;
      if(note.trashed||('locked' in note&&note.locked))continue;
      const {content:_content,text:_text,...metadata}=note;
      const tasks=noteTasks(note.content,note.content_format??'html',MAX_TASKS-found.length+1);
      for(const task of tasks){if(found.length===MAX_TASKS){setLimited(true);return;}found.push({...task,note:{...metadata,preview:''}});}
     }catch(e){
      if(active.current!==controller||controller.signal.aborted)return;
      unread++;setSkipped(unread);setError(errorText(e));
     }
     read++;setProgress(read);if(found.length!==previousCount)setRows([...found]);
    }
    cursor=page.next_cursor??undefined;
   }while(cursor);
  }catch(e){if(active.current===controller&&!controller.signal.aborted)setError(errorText(e));}
  finally{if(active.current===controller){setRows([...found]);setBusy(false);active.current=null;}}
 };
 useEffect(()=>{void scan();return()=>{active.current?.abort();active.current=null;};},[]);
 const cancel=()=>{active.current?.abort();active.current=null;setBusy(false);setCancelled(true);};
 const term=query.trim().toLocaleLowerCase();
 const visible=rows.filter(row=>(filter==='all'||row.checked===(filter==='done'))&&(!term||`${row.text}\n${row.note.title}\n${row.note.tags.join(' ')}`.toLocaleLowerCase().includes(term)));
 return <section className="task-overview" aria-label={t('할 일 모아보기')}>
  <h2>{t('할 일 모아보기')}</h2><p>{t('노트의 체크리스트를 모아 봅니다. 노트를 열어 수정하세요.')}</p>
  <div className="task-overview-controls">
   <label>{t('완료 상태')}<select aria-label={t('완료 상태')} value={filter} onChange={e=>setFilter(e.target.value)}><option value="open">{t('미완료')}</option><option value="done">{t('완료')}</option><option value="all">{t('모든 상태')}</option></select></label>
   <label>{t('할 일 검색')}<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   {busy?<button type="button" className="btn" onClick={cancel}>{t('취소')}</button>:<button type="button" className="btn" onClick={()=>void scan()}>{t('다시 불러오기')}</button>}
  </div>
  <output>{t('확인한 노트: {count}',{count:progress})} · {t('할 일: {count}',{count:visible.length})}{busy?' · '+t('불러오는 중…'):''}{cancelled?' · '+t('중단됨'):''}</output>
  {skipped>0&&<p role="alert">{t('읽지 못한 노트: {count}. 큰 문서는 원문에서 확인해 주세요.',{count:skipped})}</p>}
  {error&&<p role="alert">{error==='TASK_SCAN_TOO_LARGE'?t('할 일 모아보기는 노트당 8MB까지 읽습니다.'):error}</p>}
  {limited&&<p role="alert">{t('할 일 5,000개까지 표시합니다. 나머지는 원문에서 확인해 주세요.')}</p>}
  {!busy&&!visible.length&&<p>{t('표시할 할 일이 없습니다.')}</p>}
  <ul className="task-overview-list">{visible.map(row=><li key={`${row.note.id}:${row.ordinal}`}>
   <span className="task-overview-state">{row.checked?t('완료'):t('미완료')}</span>
   <button type="button" onClick={()=>onOpen(row.note.id)}><span>{row.text||t('내용 없는 할 일')}</span><small>{row.note.title||t('제목 없음')}</small></button>
  </li>)}</ul>
 </section>;
}
