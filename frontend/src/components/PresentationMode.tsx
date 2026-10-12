import React,{useEffect,useRef,useState} from 'react';
import {useStore} from '../store';
import {api} from '../api';
import {t} from '../i18n';
import {registerCommands} from '../lib/app-commands';
import {presentationSlides,slideDocument,offlinePresentation,type PresentationSlide} from '../lib/presentation';
import './PresentationMode.css';
export function PresentationMode(){
 const s=useStore(),latest=useRef(s);latest.current=s;
 const [slides,setSlides]=useState<PresentationSlide[]|null>(null),[index,setIndex]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[exporting,setExporting]=useState(false),[warnings,setWarnings]=useState<string[]>([]);
 const dialog=useRef<HTMLDialogElement>(null),frame=useRef<HTMLIFrameElement>(null),shell=useRef<HTMLDivElement>(null),opening=useRef(false),previous=useRef<HTMLElement|null>(null);
 const close=()=>{if(document.fullscreenElement===shell.current)void document.exitFullscreen().catch(()=>{});setSlides(null);setError('');};
 const fullscreen=async()=>{try{if(document.fullscreenElement===shell.current)await document.exitFullscreen();else if(shell.current?.requestFullscreen)await shell.current.requestFullscreen();else throw new Error(t('이 환경에서는 전체화면을 지원하지 않습니다.'));}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const open=async()=>{const store=latest.current,id=store.note?.id;if(!id||opening.current)return;opening.current=true;setBusy(true);try{
  if(!await store.flushNow())return;const note=await api.get(id,{max_body_bytes:8*1024*1024});
  if(('locked'in note&&note.locked)||note.trashed)throw new Error(t('발표할 수 없는 노트입니다.'));
  const result=presentationSlides(note);previous.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setSlides(result);setIndex(0);setError('');setWarnings([]);
 }catch(e){await store.showError(t('발표 모드'),String(e));}finally{opening.current=false;setBusy(false);}};
 const exportSlides=async(print=false)=>{if(!slides||exporting)return;let popup:Window|null=null;if(print){popup=window.open('about:blank','_blank');if(!popup){setError(t('인쇄 창을 열지 못했습니다. 팝업 허용 후 다시 시도해 주세요.'));return;}popup.opener=null;}
  setExporting(true);setError('');setWarnings([]);try{const result=await offlinePresentation(slides,{print});setWarnings(result.warnings);if(popup){popup.document.open();popup.document.write(result.html);popup.document.close();}else{const url=URL.createObjectURL(new Blob([result.html],{type:'text/html;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='presentation.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(error){popup?.close();setError(error instanceof Error?error.message:String(error));}finally{setExporting(false);}
 };
 const actions=useRef({close,fullscreen,open});actions.current={close,fullscreen,open};
 useEffect(()=>registerCommands([{id:'note.presentation',label:t('발표 모드'),enabled:()=>Boolean(latest.current.note),run:()=>actions.current.open()}]),[]);
 useEffect(()=>{if(slides){dialog.current?.showModal();dialog.current?.focus();}else{dialog.current?.close();previous.current?.focus();previous.current=null;}},[Boolean(slides)]);
 useEffect(()=>{if(slides)dialog.current?.focus();},[index]);
 const keys=(e:KeyboardEvent)=>{if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;const key=e.key;
  if(['ArrowRight','ArrowDown','PageDown',' ','ArrowLeft','ArrowUp','PageUp','Home','End','Escape','f','F'].includes(key)){if(key===' '&&(e.target instanceof HTMLButtonElement||e.target instanceof HTMLInputElement))return;e.preventDefault();e.stopPropagation();
   if(key==='Escape')actions.current.close();else if(key.toLowerCase()==='f')void actions.current.fullscreen();else setIndex(i=>key==='Home'?0:key==='End'?(slides?.length??1)-1:Math.max(0,Math.min((slides?.length??1)-1,i+(['ArrowLeft','ArrowUp','PageUp'].includes(key)?-1:1))));
  }
 };
 const keyHandler=useRef(keys);keyHandler.current=keys;
 useEffect(()=>{if(!slides)return;const handle=(e:KeyboardEvent)=>keyHandler.current(e);window.addEventListener('keydown',handle,true);return()=>window.removeEventListener('keydown',handle,true);},[Boolean(slides)]);
 return <><button type="button" disabled={!s.note||busy} onClick={()=>void open()}>{t('발표 모드')}</button><dialog ref={dialog} className="presentation-dialog" aria-label={t('발표 모드')} tabIndex={-1} onCancel={e=>{e.preventDefault();close();}}>{slides&&<div ref={shell} className="presentation-shell"><header><strong>{slides[index].title}</strong><span aria-live="polite">{index+1} / {slides.length}</span><button type="button" disabled={exporting} onClick={()=>void exportSlides()}>{t('발표 HTML 내보내기')}</button><button type="button" disabled={exporting} onClick={()=>void exportSlides(true)}>{t('인쇄 · PDF')}</button><button type="button" onClick={()=>void fullscreen()}>{t('전체화면')}</button><button type="button" onClick={close}>{t('닫기')}</button></header>{error&&<p role="alert">{error}</p>}{warnings.length>0&&<details className="presentation-export-warnings" open><summary>{t('누락된 첨부와 수식')}</summary><ul>{warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}<iframe ref={frame} title={t('발표 페이지')} sandbox="allow-same-origin" srcDoc={slideDocument(slides[index])} onLoad={()=>{const doc=frame.current?.contentDocument;if(doc)doc.addEventListener('keydown',e=>keyHandler.current(e));}}/><footer><button type="button" disabled={index===0} onClick={()=>setIndex(i=>i-1)}>{t('이전 페이지')}</button><span>{t('방향키로 이동 · F 전체화면 · Esc 닫기')}</span><button type="button" disabled={index===slides.length-1} onClick={()=>setIndex(i=>i+1)}>{t('다음 페이지')}</button></footer></div>}</dialog></>;
}
