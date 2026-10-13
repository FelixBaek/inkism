import React,{useEffect,useState} from 'react';
import {t} from '../i18n';
import {knowledge,initialPropertyValue,type KnowledgeItem,type KnowledgeSettings,type PropertyDefinition,type NoteProperty} from '../lib/knowledge';
import {AttachmentPropertyEditor} from './AttachmentPropertyEditor';
import {PropertyValueEditor} from './PropertyValueEditor';
export function CollectionManager({settings,items,selected,onSaved,flush}:{settings:KnowledgeSettings;items:KnowledgeItem[];selected:Set<string>;onSaved:(settings:KnowledgeSettings)=>Promise<void>;flush:()=>Promise<boolean>}) {
 const empty=():PropertyDefinition=>({id:crypto.randomUUID(),name:'',type:'text'});
 const [definition,setDefinition]=useState<PropertyDefinition>(empty),[value,setValue]=useState<NoteProperty['value']>(''),[raw,setRaw]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const saved=(settings.property_definitions??[]).find(d=>d.id===definition.id);
 useEffect(()=>{setValue(initialPropertyValue(definition.type));setRaw((definition.options??[]).join(', '));},[definition.id,definition.type]);
 const run=async(operation:'save'|'apply'|'remove')=>{
  if(busy)return;setBusy(true);setError('');setStatus('');
  try {
   if(!await flush())throw new Error(t('먼저 노트를 저장해 주세요.'));
   // Preserve displayed snapshot versions; refreshing here must never authorize overwriting intervening metadata changes.
   const targets=operation==='apply'?items.filter(n=>selected.has(n.id)):items.filter(n=>n.properties.some(p=>p.definition_id===definition.id));
   if(operation==='apply'&&!targets.length)throw new Error(t('적용할 노트를 선택해 주세요.'));
   const updated=await knowledge.saveSettings({...settings,collection_update:{operation,definition,notes:targets.map(n=>({id:n.id,version:n.version,revision:n.revision})),...(operation==='apply'?{value}:{})}});
   await onSaved(updated);setStatus(t('저장됨'));if(operation==='remove')setDefinition(empty());
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 return <section className="collection-manager" aria-label={t('공통 속성')}>
  <p>{t('공통 속성 변경은 연결된 모든 노트에 적용됩니다. 기존 값이 새 종류나 선택 항목에 맞지 않으면 전체 변경을 취소합니다.')}</p>
  {error&&<p role="alert">{error}</p>}{status&&<output>{status}</output>}
  <fieldset className="plain-fieldset" disabled={busy}><div className="knowledge-row">
   <select aria-label={t('공통 속성 선택')} value={saved?definition.id:''} onChange={e=>{setDefinition(settings.property_definitions?.find(d=>d.id===e.target.value)??empty());setError('');setStatus('');}}><option value="">{t('새 공통 속성')}</option>{settings.property_definitions?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
   <input aria-label={t('공통 속성 이름')} value={definition.name} maxLength={80} onChange={e=>setDefinition({...definition,name:e.target.value})}/>
   <select aria-label={t('공통 속성 종류')} value={definition.type} onChange={e=>setDefinition({...definition,type:e.target.value as PropertyDefinition['type'],options:['select','multiselect'].includes(e.target.value)?[]:undefined})}>{(['text','number','date','checkbox','list','select','multiselect','person','relation','attachment'] as const).map((type,i)=><option key={type} value={type}>{t(['텍스트','숫자','날짜','체크박스','목록','단일 선택','다중 선택','사람','노트 관계','첨부 이미지'][i])}</option>)}</select>
   {['select','multiselect'].includes(definition.type)&&<input aria-label={t('공통 선택 항목')} value={raw} onChange={e=>{setRaw(e.target.value);setDefinition({...definition,options:Array.from(new Set(e.target.value.split(',').map(x=>x.trim()).filter(Boolean)))});}}/>}
   <button className="btn" disabled={!definition.name.trim()} onClick={()=>void run('save')}>{t('공통 속성 저장')}</button><button className="btn" disabled={!saved} onClick={()=>void run('remove')}>{t('공통 연결 해제')}</button>
  </div><p>{t('연결 해제 시 각 노트의 속성과 값은 그대로 남습니다.')}</p>
  <div className="knowledge-row">
   <span>{t('선택한 노트 {count}개',{count:selected.size})}</span>
   {definition.type==='attachment'?<AttachmentPropertyEditor key={definition.id} value={String(value)} onChange={setValue}/>:['select','multiselect','relation'].includes(definition.type)?<PropertyValueEditor property={{...definition,definition_id:definition.id,value}} items={items} onChange={patch=>{if(patch.value!==undefined)setValue(patch.value);}}/>:definition.type==='checkbox'?<input aria-label={t('일괄 적용 값')} type="checkbox" checked={value===true} onChange={e=>setValue(e.target.checked)}/>:<input aria-label={t('일괄 적용 값')} type={definition.type==='number'?'number':definition.type==='date'?'date':'text'} value={Array.isArray(value)?value.join(', '):String(value)} onChange={e=>setValue(definition.type==='number'?Number(e.target.value):['list','person'].includes(definition.type)?e.target.value.split(',').map(x=>x.trim()).filter(Boolean):e.target.value)}/>}
   <button className="btn" disabled={!saved||!selected.size||saved.name!==definition.name||saved.type!==definition.type||JSON.stringify(saved.options??[])!==JSON.stringify(definition.options??[])} onClick={()=>void run('apply')}>{t('선택한 노트의 값 덮어쓰기')}</button>
  </div></fieldset>
 </section>;
}
