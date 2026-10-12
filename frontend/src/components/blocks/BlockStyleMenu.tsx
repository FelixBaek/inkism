import {useEffect,useState} from 'react';
import {knowledge,type BlockStyle,type KnowledgeSettings} from '../../lib/knowledge';
import type {Node as PMNode} from '@tiptap/pm/model';
import {t} from '../../i18n';
/** Presets intentionally contain presentation only: never text, links or IDs. */
export function BlockStyleMenu({node,onApply}:{node:PMNode;onApply:(style:BlockStyle)=>void}) {
 const [settings,setSettings]=useState<KnowledgeSettings|null>(null),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;knowledge.settings().then(s=>{if(alive)setSettings(s);}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[]);
 const supported=['paragraph','heading','blockquote','callout','codeBlock'].includes(node.type.name);
 if(!supported)return null;
 const save=async(styles:BlockStyle[])=>{if(!settings||busy)return;setBusy(true);setError('');try{setSettings(await knowledge.saveSettings({...settings,block_styles:styles}));setName('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const capture=()=>{const attrs:BlockStyle['attrs']={};if(['left','center','right','justify'].includes(node.attrs.textAlign))attrs.textAlign=node.attrs.textAlign;if(['ltr','rtl'].includes(node.attrs.dir))attrs.dir=node.attrs.dir;const previous=settings?.block_styles??[];const existing=previous.find(s=>s.name.toLowerCase()===name.trim().toLowerCase()&&s.type===node.type.name);const style:BlockStyle={id:existing?.id??crypto.randomUUID(),name:name.trim(),type:node.type.name as BlockStyle['type'],attrs};void save(existing?previous.map(s=>s.id===existing.id?style:s):[...previous,style]);};
 return <div className="block-style-presets" role="group" aria-label={t('문단 스타일')}>
  <div className="block-menu__section">{t('문단 스타일')}</div>
  <p className="block-selection-info">{t('같은 종류의 문단에 정렬과 글 방향을 적용합니다.')}</p>
  <input aria-label={t('문단 스타일 이름')} maxLength={128} value={name} onChange={e=>setName(e.target.value)} />
  <button type="button" className="block-menu__item" disabled={!settings||busy||!name.trim()||((settings.block_styles?.length??0)>=100&&!settings.block_styles?.some(s=>s.name.toLowerCase()===name.trim().toLowerCase()&&s.type===node.type.name))} onClick={capture}>{t('문단 스타일 저장')}</button>
  {(settings?.block_styles??[]).filter(s=>s.type===node.type.name).map(style=><div key={style.id} className="block-style-presets__row"><button type="button" className="block-menu__item" disabled={busy} onClick={()=>onApply(style)}>{style.name}</button><button type="button" disabled={busy} aria-label={t('{name} 스타일 삭제',{name:style.name})} onClick={()=>void save((settings?.block_styles??[]).filter(s=>s.id!==style.id))}>×</button></div>)}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
