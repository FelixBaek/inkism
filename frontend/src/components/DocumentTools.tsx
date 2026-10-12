import React,{useEffect,useState} from 'react';
import {useStore} from '../store';
import {rpc} from '../api';
import {t} from '../i18n';
import {knowledge,type DocumentSettings,type KnowledgeItem,type NoteKnowledge,type KnowledgeSettings} from '../lib/knowledge';
import './DocumentTools.css';
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
export function useDocumentMetadata(id:string|undefined,isNew:boolean) {
 const [metadata,setMetadata]=useState<NoteKnowledge|null>(null),[items,setItems]=useState<KnowledgeItem[]>([]),[error,setError]=useState(''),[truncated,setTruncated]=useState(false);
 useEffect(()=>{
  let live=true,request=0;setMetadata(null);setItems([]);setError('');
  const load=()=>{
   const token=++request;
   if(!id||isNew)return;
   Promise.all([knowledge.get(id),knowledge.list()]).then(([meta,list])=>{if(live&&token===request){setMetadata(meta);setItems(list.items);setTruncated(list.truncated);setError('');}}).catch(e=>{if(live&&token===request)setError(errorText(e));});
  };
  load();window.addEventListener('inkism-knowledge-changed',load);
  return()=>{live=false;window.removeEventListener('inkism-knowledge-changed',load);};
 },[id,isNew]);
 return {metadata,items,error,truncated,setError};
}
export function DocumentTools({data}:{data:ReturnType<typeof useDocumentMetadata>}) {
 const s=useStore(),id=s.draft!.id;
 const [style,setStyle]=useState<DocumentSettings>({}),[busy,setBusy]=useState(false),[title,setTitle]=useState(''),[childId,setChildId]=useState(()=>crypto.randomUUID()),[saved,setSaved]=useState(false);
 useEffect(()=>{setStyle(data.metadata?.document??{});},[data.metadata]);
 const [config,setConfig]=useState<KnowledgeSettings|null>(null),[presetId,setPresetId]=useState(''),[presetName,setPresetName]=useState('');
 useEffect(()=>{let live=true;knowledge.settings().then(c=>{if(live)setConfig(c);}).catch(e=>data.setError(errorText(e)));return()=>{live=false;};},[]);
 const presetAction=async(action:'save'|'remove')=>{
  if(!config||busy)return;setBusy(true);data.setError('');
  try {
   const {parent_id,...presentation}=style;
   const presets=(config.style_presets??[]).filter(p=>p.id!==presetId);
   const target=presetId||crypto.randomUUID();
   if(action==='save')presets.push({id:target,name:presetName.trim(),style:presentation});
   setConfig(await knowledge.saveSettings({...config,style_presets:presets}));
   if(action==='remove'){setPresetId('');setPresetName('');}else setPresetId(target);
  }catch(e){data.setError(errorText(e));}finally{setBusy(false);}
 };
 const change=(patch:Partial<DocumentSettings>)=>{setStyle(current=>({...current,...patch}));setSaved(false);};
 const blocked=busy||Boolean(s.draft?.readonly)||Boolean(s.note?.trashed)||s.editorConverting;
 const open=async(target:string)=>{try{if(await s.flushNow())await s.selectNote(target);}catch(e){data.setError(errorText(e));}};
 const parents=new Map(data.items.map(n=>[n.id,n.document?.parent_id]));
 const eligible=(candidate:string)=>{const seen=new Set([id]);let cursor:string|null|undefined=candidate;while(cursor){if(seen.has(cursor))return false;seen.add(cursor);cursor=parents.get(cursor);}return true;};
 const ancestors:KnowledgeItem[]=[];let cursor=data.metadata?.document?.parent_id;const seen=new Set([id]);
 while(cursor&&!seen.has(cursor)&&ancestors.length<128){seen.add(cursor);const note=data.items.find(n=>n.id===cursor);if(!note)break;ancestors.unshift(note);cursor=note.document?.parent_id;}
 const save=async()=>{
  if(blocked)return;setBusy(true);data.setError('');
  try{
   if(!await s.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));
   const draft=s.readDraft();if(draft?.id!==id)throw new Error(t('선택한 노트가 바뀌었습니다.'));
   const meta=data.metadata??await knowledge.get(id);
   await knowledge.set({...meta,document:style},draft.revision);
   window.dispatchEvent(new Event('inkism-knowledge-changed'));setSaved(true);
  }catch(e){data.setError(errorText(e));}finally{setBusy(false);}
 };
 const create=async()=>{
  if(blocked||!title.trim())return;setBusy(true);data.setError('');
  try{
   if(!await s.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));
   const draft=s.readDraft();if(draft?.id!==id)throw new Error(t('선택한 노트가 바뀌었습니다.'));
   await rpc('page_create',{id:childId,parent_id:id,title:title.trim(),revision:draft.revision});
   setChildId(crypto.randomUUID());setTitle('');s.refreshList();window.dispatchEvent(new Event('inkism-knowledge-changed'));
  }catch(e){data.setError(errorText(e));}finally{setBusy(false);}
 };
 const children=data.items.filter(n=>n.document?.parent_id===id).sort((a,b)=>a.title.localeCompare(b.title));
 return <div className="document-tools">
  {ancestors.length>0&&<nav className="document-breadcrumbs" aria-label={t('상위 페이지 경로')}>{ancestors.map(n=><button type="button" key={n.id} onClick={()=>void open(n.id)}>{n.title||t('제목 없음')} /</button>)}</nav>}
  <details><summary>{t('문서 구성과 꾸미기')}</summary>
   {data.error&&<p role="alert">{data.error}</p>}
   <fieldset className="plain-fieldset" disabled={blocked}>
    <div className="document-controls" aria-label={t('문서 스타일 보관함')}>
     <select aria-label={t('저장한 문서 스타일')} value={presetId} onChange={e=>{setPresetId(e.target.value);setPresetName(config?.style_presets?.find(p=>p.id===e.target.value)?.name??'');}}><option value="">{t('새 문서 스타일')}</option>{config?.style_presets?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
     <input aria-label={t('문서 스타일 이름')} placeholder={t('문서 스타일 이름')} value={presetName} maxLength={128} onChange={e=>setPresetName(e.target.value)}/>
     <button type="button" className="btn" disabled={!presetId} onClick={()=>{const preset=config?.style_presets?.find(p=>p.id===presetId);if(preset){setStyle({...preset.style,parent_id:style.parent_id});setSaved(false);}}}>{t('스타일 불러오기')}</button>
     <button type="button" className="btn" disabled={!config||!presetName.trim()} onClick={()=>void presetAction('save')}>{t('현재 스타일 저장')}</button>
     <button type="button" className="btn" disabled={!presetId} onClick={()=>void presetAction('remove')}>{t('문서 스타일 삭제')}</button>
     <button type="button" className="btn" onClick={()=>void knowledge.settings().then(setConfig).catch(e=>data.setError(errorText(e)))}>{t('새로고침')}</button>
     <span>{t('불러온 스타일은 문서 설정 저장으로 적용합니다.')}</span>
    </div>
    <div className="document-controls">
     <label>{t('상위 페이지')}<select aria-label={t('상위 페이지')} value={style.parent_id??''} onChange={e=>change({parent_id:e.target.value||null})}><option value="">{t('상위 페이지 없음')}</option>{style.parent_id&&!data.items.some(n=>n.id===style.parent_id)&&<option value={style.parent_id}>{t('사용할 수 없는 노트')}</option>}{data.items.filter(n=>eligible(n.id)).map(n=><option key={n.id} value={n.id}>{n.title||t('제목 없음')}</option>)}</select></label>
     <label>{t('문서 너비')}<select aria-label={t('문서 너비')} value={style.width??'standard'} onChange={e=>change({width:e.target.value as DocumentSettings['width']})}><option value="standard">{t('기본')}</option><option value="wide">{t('넓게')}</option><option value="full">{t('전체 너비')}</option></select></label>
     <label>{t('문단 간격')}<select aria-label={t('문단 간격')} value={style.spacing??'normal'} onChange={e=>change({spacing:e.target.value as DocumentSettings['spacing']})}><option value="compact">{t('좁게')}</option><option value="normal">{t('기본')}</option><option value="relaxed">{t('여유롭게')}</option></select></label>
     <label>{t('문서 배경')}<select aria-label={t('문서 배경')} value={style.tone??'default'} onChange={e=>change({tone:e.target.value as DocumentSettings['tone']})}><option value="default">{t('기본')}</option><option value="paper">{t('종이')}</option><option value="soft">{t('부드럽게')}</option></select></label>
     <label>{t('카드 크기')}<select aria-label={t('카드 크기')} value={style.card_size??'medium'} onChange={e=>change({card_size:e.target.value as DocumentSettings['card_size']})}><option value="small">{t('작게')}</option><option value="medium">{t('기본')}</option><option value="large">{t('크게')}</option></select></label>
     <label><input type="checkbox" checked={style.card_shadow??false} onChange={e=>change({card_shadow:e.target.checked})}/>{t('카드 그림자')}</label>
     <button type="button" className="btn" onClick={()=>void save()}>{t('문서 설정 저장')}</button>{saved&&<output>{t('저장됨')}</output>}
    </div>
    <div className="document-controls"><input aria-label={t('하위 페이지 제목')} placeholder={t('하위 페이지 제목')} value={title} maxLength={256} onChange={e=>setTitle(e.target.value)}/><button type="button" className="btn" disabled={!title.trim()} onClick={()=>void create()}>{t('하위 페이지 만들기')}</button></div>
   </fieldset>
   <p>{t('문서 스타일은 노트 설정으로 저장됩니다. Markdown 파일에는 포함되지 않습니다.')}</p>
   {data.truncated&&<p>{t('큰 보관함의 일부만 불러왔습니다.')}</p>}
  </details>
  {children.length>0&&<nav className="document-children" aria-label={t('하위 페이지')}>{children.map(n=><button type="button" key={n.id} data-tone={n.document?.tone??'default'} data-size={n.document?.card_size??'medium'} data-shadow={n.document?.card_shadow||undefined} onClick={()=>void open(n.id)}>{n.title||t('제목 없음')}</button>)}</nav>}
 </div>;
}
