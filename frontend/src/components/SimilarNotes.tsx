import {useEffect,useRef,useState} from 'react';
import {rpc,type SemanticHit} from '../api';
import type {DocumentInfo} from '../types';
import {semanticRelated} from '../lib/semantic-index';
import {embeddingsReady,onAIConfigChange} from '../lib/ai-provider';
import {t} from '../i18n';
import './SimilarNotes.css';

export function SimilarNotes({noteId,revision,onOpen}:Readonly<{noteId:string;revision:number;onOpen:(id:string)=>Promise<void>}>) {
 const [hits,setHits]=useState<SemanticHit[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [configured,setConfigured]=useState(embeddingsReady);
 const active=useRef<AbortController|null>(null);
 const clear=()=>{active.current?.abort();active.current=null;setHits([]);setBusy(false);};
 useEffect(()=>{const unsubscribe=onAIConfigChange(()=>{clear();setConfigured(embeddingsReady());setError('');setMessage(t('설정이 바뀌었습니다. 다시 찾아 주세요.'));});return()=>{unsubscribe();active.current?.abort();active.current=null;};},[]);
 const current=async(id:string,expected:number,signal:AbortSignal)=>{
  const info=await rpc<DocumentInfo>('document_info',{id,revision:expected},{signal});
  if(info.revision!==expected||info.summary.trashed||('locked' in info.summary&&info.summary.locked))throw new Error(t('문서가 변경되었습니다. 다시 시도해 주세요.'));
 };
 const find=async()=>{
  clear();const controller=new AbortController();active.current=controller;setBusy(true);setError('');setMessage('');
  try{
   await current(noteId,revision,controller.signal);
   const result=await semanticRelated(noteId,revision,controller.signal);
   await current(noteId,revision,controller.signal);
   if(active.current!==controller||controller.signal.aborted)return;
   setHits(result.items);
   setMessage(result.ready?(result.items.length?'':t('비슷한 노트를 찾지 못했습니다.')):t('이 노트의 의미 색인이 아직 준비되지 않았습니다. 잠시 후 다시 찾아 주세요.'));
  }catch(e){if(active.current===controller&&!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 };
 const open=async(hit:SemanticHit)=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setError('');
  try{
   await current(noteId,revision,controller.signal);
   await current(hit.note.id,hit.note.revision,controller.signal);
   if(active.current!==controller||controller.signal.aborted)return;
   await onOpen(hit.note.id);
  }catch(e){if(active.current===controller&&!controller.signal.aborted){setHits([]);setError(e instanceof Error?e.message:String(e));}}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 };
 return <section className="similar-notes" aria-label={t('비슷한 노트')}>
  <h2>{t('비슷한 노트')}</h2><p>{t('저장된 의미 색인에서 관련 구절을 찾습니다. 추천은 자동으로 노트를 연결하거나 수정하지 않습니다.')}</p>
  {!configured&&<p>{t('AI 연결이 아직 설정되지 않았습니다. 연결이 준비되면 이 메뉴에서 바로 쓸 수 있습니다.')}</p>}
  <div className="similar-notes-controls"><button type="button" className="btn" disabled={busy||!configured} onClick={()=>void find()}>{t('비슷한 노트 찾기')}</button>{busy&&<button type="button" className="btn" onClick={()=>{clear();setMessage(t('중단됨'));}}>{t('취소')}</button>}</div>
  <output>{busy?t('불러오는 중…'):message}</output>{error&&<p role="alert">{error}</p>}
  <ul>{hits.map(hit=><li key={hit.note.id}><button type="button" disabled={busy} onClick={()=>void open(hit)}>{hit.note.title||t('제목 없음')}</button><blockquote>{hit.snippet}</blockquote></li>)}</ul>
 </section>;
}
