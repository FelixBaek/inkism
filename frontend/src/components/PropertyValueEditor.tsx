import React, {useEffect,useState} from 'react';
import {t} from '../i18n';
import {type KnowledgeItem,type NoteProperty} from '../lib/knowledge';
export function PropertyValueEditor({property,items,onChange}:Readonly<{property:NoteProperty;items:KnowledgeItem[];onChange:(patch:Partial<NoteProperty>)=>void}>) {
 const [raw,setRaw]=useState('');
 useEffect(()=>setRaw((property.options??[]).join(', ')),[property.options]);
 const choices=property.type==='relation'?items.map(n=>({id:n.id,label:n.title||t('제목 없음')})):(property.options??[]).map(x=>({id:x,label:x}));
 const selection=Array.isArray(property.value)?property.value:[];
 return <div className="property-choice">
  {!property.definition_id&&(property.type==='select'||property.type==='multiselect')&&<input aria-label={t('선택 항목 (쉼표로 구분)')} placeholder={t('선택 항목 (쉼표로 구분)')} value={raw} onChange={e=>setRaw(e.target.value)} onBlur={()=>{
   const options=Array.from(new Set(raw.split(',').map(x=>x.trim()).filter(Boolean)));
   onChange({options,value:property.type==='select'?(options.includes(String(property.value))?property.value:''):selection.filter(x=>options.includes(x))});
  }}/>}
  {property.type==='select'?<select aria-label={t('속성 값')} value={String(property.value)} onChange={e=>onChange({value:e.target.value})}><option value="">{t('선택 없음')}</option>{choices.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>:<>
   <select aria-label={t('속성 값')} multiple value={selection} onChange={e=>onChange({value:Array.from(e.target.selectedOptions,x=>x.value)})}>
    {selection.filter(id=>!choices.some(c=>c.id===id)).map(id=><option key={id} value={id}>{t('사용할 수 없는 노트')}</option>)}
    {choices.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
   </select>
   {property.type==='relation'&&<div>{selection.map(id=>{const item=items.find(n=>n.id===id);return item?<a key={id} href={`note://${id}`}>{item.title||t('제목 없음')}</a>:null;})}</div>}
  </>}
 </div>;
}
