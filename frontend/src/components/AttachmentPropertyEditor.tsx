import {useEffect,useRef,useState} from 'react';
import {api} from '../api';import {t} from '../i18n';
export function AttachmentPropertyEditor({value,onChange}:{value:string;onChange:(value:string)=>void}) {
 const abort=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>abort.current?.abort(),[]);
 const upload=async(file:File)=>{if(busy)return;if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)){setError(t('지원하는 이미지 파일을 선택하세요.'));return;}const controller=new AbortController();abort.current=controller;setBusy(true);setError('');try{const asset=await api.uploadAttachment(file,controller.signal);if(!controller.signal.aborted)onChange(asset.id);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}finally{if(!controller.signal.aborted)setBusy(false);}};
 return <span><input aria-label={t('이미지 첨부 ID')} value={value} disabled={busy} onChange={e=>onChange(e.target.value.trim().toLowerCase())}/><label>{t('표지 이미지 등록')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label={t('표지 이미지 등록')} disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/></label>{busy&&<span role="status">{t('불러오는 중…')}</span>}{error&&<span role="alert">{error}</span>}</span>;
}
