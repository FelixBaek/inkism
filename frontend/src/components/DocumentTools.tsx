import React,{useEffect,useId,useRef,useState} from 'react';
import {DotsThreeIcon as DotsThree} from '@phosphor-icons/react';
import {ChevronDown,Plus} from '../icons';
import {useStore} from '../store';
import {api,rpc} from '../api';
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
/** 기본 화살표 대신 Phosphor 캐럿을 얹은 select 틀 */
const SelectBox=({children}:Readonly<{children:React.ReactNode}>)=><span className="document-select">{children}<ChevronDown size={14} aria-hidden/></span>;
type Choice<T extends string>=readonly (readonly [T,string])[];
/** 너비·간격처럼 몇 가지 중 하나를 고르는 칸: 라디오라서 화살표 키로 옮겨 다닌다. */
function Segmented<T extends string>({label,caption,value,options,onChange}:Readonly<{label:string;caption:string;value:T;options:Choice<T>;onChange:(value:T)=>void}>) {
 const name=useId();
 return <div className="document-field"><span className="document-field-label" aria-hidden="true">{caption}</span>
  <div className="document-segmented" role="radiogroup" aria-label={label}>{options.map(([v,text])=><label key={v}><input type="radio" name={name} checked={value===v} onChange={()=>onChange(v)}/><span>{t(text)}</span></label>)}</div></div>;
}
/** 문서 설정 판 (Figma 09b): 편집기 도구줄의 [문서 설정]이 open을 바꾼다. 바꾸면 바로 저장한다. */
export function DocumentTools({data,open:panelOpen,onOpenChange}:Readonly<{data:ReturnType<typeof useDocumentMetadata>;open:boolean;onOpenChange:(open:boolean)=>void}>) {
 const s=useStore(),id=s.draft!.id;
 const [style,setStyle]=useState<DocumentSettings>({}),[busy,setBusy]=useState(false),[title,setTitle]=useState(''),[childId,setChildId]=useState(()=>crypto.randomUUID());
 const latest=useRef<DocumentSettings>({}),timer=useRef<number|undefined>(undefined),queue=useRef<Promise<void>>(Promise.resolve());
 // 저장 대기 중에는 다시 불러온 값으로 덮지 않는다(방금 고른 값이 잠깐 되돌아가 보이지 않게).
 useEffect(()=>{if(timer.current===undefined){const next=data.metadata?.document??{};latest.current=next;setStyle(next);}},[data.metadata]);
 const [config,setConfig]=useState<KnowledgeSettings|null>(null),[presetId,setPresetId]=useState(''),[presetName,setPresetName]=useState(''),[menu,setMenu]=useState(false),[naming,setNaming]=useState(false);
 const menuRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{let live=true;knowledge.settings().then(c=>{if(live)setConfig(c);}).catch(e=>data.setError(errorText(e)));return()=>{live=false;};},[]);
 useEffect(()=>{if(!menu)return;const away=(e:PointerEvent)=>{if(!menuRef.current?.contains(e.target as Node))setMenu(false);};document.addEventListener('pointerdown',away);return()=>document.removeEventListener('pointerdown',away);},[menu]);
 const presetAction=async(action:'save'|'remove')=>{
  if(!config||busy)return;setBusy(true);data.setError('');setMenu(false);
  try {
   const {parent_id,...presentation}=latest.current;
   const presets=(config.style_presets??[]).filter(p=>p.id!==presetId);
   const target=presetId||crypto.randomUUID();
   if(action==='save')presets.push({id:target,name:presetName.trim(),style:presentation});
   setConfig(await knowledge.saveSettings({...config,style_presets:presets}));
   if(action==='remove'){setPresetId('');setPresetName('');}else{setPresetId(target);setNaming(false);}
  }catch(e){data.setError(errorText(e));}finally{setBusy(false);}
 };
 const blocked=Boolean(s.draft?.readonly)||Boolean(s.note?.trashed)||s.editorConverting;
 // 노트 본문을 먼저 저장해 최신 revision으로 쓴다. 판이 닫히는 중이면 진행 중인 저장을 기다린 뒤 서버의 revision을 쓴다.
 const persist=(next:DocumentSettings,leaving=false)=>{queue.current=queue.current.then(async()=>{
  try{
   let revision:number;
   if(leaving){await s.flushNow();revision=(await api.get(id,{max_body_bytes:0})).revision;}
   else{
    if(!await s.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));
    const draft=s.readDraft();if(draft?.id!==id)throw new Error(t('선택한 노트가 바뀌었습니다.'));
    revision=draft.revision;
   }
   const meta=await knowledge.get(id);
   await knowledge.set({...meta,document:next},revision);
   if(!leaving)data.setError('');
   window.dispatchEvent(new Event('inkism-knowledge-changed'));
  }catch(e){if(!leaving)data.setError(errorText(e));}
 });};
 const flush=(leaving=false)=>{if(timer.current===undefined)return;window.clearTimeout(timer.current);timer.current=undefined;persist(latest.current,leaving);};
 useEffect(()=>()=>flush(true),[]);
 const change=(patch:Partial<DocumentSettings>)=>{
  if(blocked)return;
  const next={...latest.current,...patch};latest.current=next;setStyle(next);
  window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>flush(),300);
 };
 const open=async(target:string)=>{try{if(await s.flushNow())await s.selectNote(target);}catch(e){data.setError(errorText(e));}};
 const parents=new Map(data.items.map(n=>[n.id,n.document?.parent_id]));
 const eligible=(candidate:string)=>{const seen=new Set([id]);let cursor:string|null|undefined=candidate;while(cursor){if(seen.has(cursor))return false;seen.add(cursor);cursor=parents.get(cursor);}return true;};
 const ancestors:KnowledgeItem[]=[];let cursor=data.metadata?.document?.parent_id;const seen=new Set([id]);
 while(cursor&&!seen.has(cursor)&&ancestors.length<128){seen.add(cursor);const note=data.items.find(n=>n.id===cursor);if(!note)break;ancestors.unshift(note);cursor=note.document?.parent_id;}
 const create=async()=>{
  if(blocked||busy||!title.trim())return;setBusy(true);data.setError('');
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
  <details id="document-settings-panel" open={panelOpen} onToggle={e=>{if(e.currentTarget.open!==panelOpen)onOpenChange(e.currentTarget.open);if(!e.currentTarget.open)flush();}}><summary tabIndex={-1} aria-hidden="true">{t('문서 설정')}</summary>
   {data.error&&<p role="alert" className="document-error">{data.error}</p>}
   <fieldset className="plain-fieldset" disabled={blocked}>
    <section className="document-group" aria-label={t('문서 스타일')}>
     <h3>{t('모양')}</h3>
     <Segmented label={t('문서 너비')} caption={t('너비')} value={style.width??'standard'} options={[['standard','기본'],['wide','넓게'],['full','전체 너비']] as const} onChange={width=>change({width})}/>
     <Segmented label={t('문단 간격')} caption={t('문단 간격')} value={style.spacing??'normal'} options={[['compact','좁게'],['normal','기본'],['relaxed','여유롭게']] as const} onChange={spacing=>change({spacing})}/>
     <Segmented label={t('문서 배경')} caption={t('배경')} value={style.tone??'default'} options={[['default','기본'],['paper','종이'],['soft','부드럽게']] as const} onChange={tone=>change({tone})}/>
     <div className="document-subgroup" role="group" aria-label={t('하위 페이지 카드')}>
      <h4 aria-hidden="true">{t('하위 페이지 카드')}</h4>
      <Segmented label={t('카드 크기')} caption={t('크기')} value={style.card_size??'medium'} options={[['small','작게'],['medium','기본'],['large','크게']] as const} onChange={card_size=>change({card_size})}/>
      <label className="document-switch"><span>{t('그림자')}</span><input type="checkbox" aria-label={t('카드 그림자')} checked={style.card_shadow??false} onChange={e=>change({card_shadow:e.target.checked})}/></label>
     </div>
    </section>
    <section className="document-group" aria-label={t('페이지 관계')}>
     <h3>{t('페이지 관계')}</h3>
     <label className="document-field"><span className="document-field-label">{t('상위 페이지')}</span><SelectBox><select aria-label={t('상위 페이지')} value={style.parent_id??''} onChange={e=>change({parent_id:e.target.value||null})}><option value="">{t('상위 페이지 없음')}</option>{style.parent_id&&!data.items.some(n=>n.id===style.parent_id)&&<option value={style.parent_id}>{t('사용할 수 없는 노트')}</option>}{data.items.filter(n=>eligible(n.id)).map(n=><option key={n.id} value={n.id}>{n.title||t('제목 없음')}</option>)}</select></SelectBox></label>
     <div className="document-field"><span className="document-field-label" aria-hidden="true">{t('하위 페이지 추가')}</span>
      <form className="document-inline" onSubmit={e=>{e.preventDefault();void create();}}>
       <input aria-label={t('하위 페이지 제목')} placeholder={t('하위 페이지 제목')} value={title} maxLength={256} onChange={e=>setTitle(e.target.value)}/>
       <button type="submit" className="document-square" aria-label={t('하위 페이지 만들기')} title={t('하위 페이지 만들기')} disabled={busy||!title.trim()}><Plus size={16} aria-hidden/></button>
      </form></div>
    </section>
    <section className="document-group" aria-label={t('문서 스타일 보관함')}>
     <h3>{t('저장한 스타일')}</h3>
     <div className="document-inline" ref={menuRef}>
      <SelectBox><select aria-label={t('저장한 문서 스타일')} value={presetId} onChange={e=>{const preset=config?.style_presets?.find(p=>p.id===e.target.value);setPresetId(e.target.value);setPresetName(preset?.name??'');setNaming(false);if(preset)change({...preset.style,parent_id:latest.current.parent_id});}}><option value="">{t('새 문서 스타일')}</option>{config?.style_presets?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></SelectBox>
      <button type="button" className="document-square" aria-label={t('스타일 메뉴')} title={t('스타일 메뉴')} aria-haspopup="menu" aria-expanded={menu} disabled={!config||busy} onClick={()=>setMenu(!menu)}><DotsThree size={16} aria-hidden/></button>
      {menu&&<div className="document-style-menu" role="menu" aria-label={t('스타일 메뉴')} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(false);}}}>
       <button type="button" role="menuitem" autoFocus onClick={()=>{setMenu(false);setNaming(true);}}>{t('현재 스타일 저장')}</button>
       <button type="button" role="menuitem" className="document-danger" disabled={!presetId} onClick={()=>void presetAction('remove')}>{t('문서 스타일 삭제')}</button>
      </div>}
     </div>
     {naming&&<form className="document-inline" onSubmit={e=>{e.preventDefault();if(presetName.trim())void presetAction('save');}}>
      <input autoFocus aria-label={t('문서 스타일 이름')} placeholder={t('문서 스타일 이름')} value={presetName} maxLength={128} onChange={e=>setPresetName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setNaming(false);}}}/>
      <button type="submit" className="btn" disabled={busy||!presetName.trim()}>{t('저장')}</button>
     </form>}
    </section>
   </fieldset>
   {data.truncated&&<p className="document-note">{t('큰 보관함의 일부만 불러왔습니다.')}</p>}
  </details>
  {children.length>0&&<nav className="document-children" aria-label={t('하위 페이지')}>{children.map(n=><button type="button" key={n.id} data-tone={n.document?.tone??'default'} data-size={n.document?.card_size??'medium'} data-shadow={n.document?.card_shadow||undefined} onClick={()=>void open(n.id)}>{n.title||t('제목 없음')}</button>)}</nav>}
 </div>;
}
