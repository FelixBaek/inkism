import {useState} from 'react';
import {aiConfig,configureAI,clearAI,completeAI,listModels} from '../lib/ai-provider';
import {t} from '../i18n';
const PRESETS=[['OpenAI','https://api.openai.com/v1/chat/completions'],['OpenRouter','https://openrouter.ai/api/v1/chat/completions'],['Ollama','http://localhost:11434/v1/chat/completions'],['LM Studio','http://localhost:1234/v1/chat/completions']];
const hostOf=(endpoint:string)=>{try{const u=new URL(endpoint);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)?t('이 기기({host})',{host:u.host}):u.host;}catch{return '';}};
export function AiSettings(){const [config,setConfig]=useState(aiConfig),[key,setKey]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[models,setModels]=useState<string[]>([]);const host=hostOf(config.endpoint||'');
 const run=(job:()=>Promise<unknown>)=>{setBusy(true);void job().catch(e=>setMessage(e instanceof Error?e.message:String(e))).finally(()=>setBusy(false));};
 return <section><h3>{t('AI 연결')}</h3><p>{t('Chat Completions 호환 서버의 전체 요청 주소와 모델을 등록합니다. 키는 앱을 닫으면 지워집니다.')}</p>
 <label>{t('서비스 예시')}<select aria-label={t('서비스 예시')} value="" onChange={e=>{if(e.target.value){setConfig({...config,endpoint:e.target.value});setModels([]);}}}><option value="">{t('직접 입력')}</option>{PRESETS.map(([name,url])=><option key={url} value={url}>{name}</option>)}</select></label>
 <label>{t('AI 요청 주소')}<input type="url" value={config.endpoint||''} onChange={e=>{setConfig({...config,endpoint:e.target.value});setModels([]);}}/></label>
 <label>{t('AI 모델')}<input value={config.model||''} onChange={e=>setConfig({...config,model:e.target.value})}/></label>
 <label>{t('AI API 키')}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label>
 <button className="btn" disabled={busy||!config.endpoint} onClick={()=>run(async()=>{setMessage('');const list=await listModels(config.endpoint,key);setModels(list);setMessage(list.length?t('모델 {count}개를 불러왔습니다.',{count:list.length}):t('서버가 알려 준 모델이 없습니다. 모델 이름을 직접 입력해 주세요.'));})}>{t('모델 불러오기')}</button>
 {models.length>0&&<label>{t('불러온 모델')}<select aria-label={t('불러온 모델')} value={models.includes(config.model)?config.model:''} onChange={e=>setConfig({...config,model:e.target.value})}><option value="" disabled>{t('모델 고르기')}</option>{models.map(m=><option key={m} value={m}>{m}</option>)}</select></label>}
 <button className="btn" disabled={busy} onClick={()=>{try{configureAI({...config,enabled:true},key);setKey('');setMessage(t('저장됨'));}catch(e){setMessage(e instanceof Error?e.message:String(e));}}}>{t('AI 연결 저장')}</button>
 <button className="btn" disabled={busy} onClick={()=>run(async()=>setMessage(t('연결됨: {reply}',{reply:(await completeAI('Reply with OK.','')).slice(0,80)})))}>{t('AI 연결 테스트')}</button>
 <button className="btn" onClick={()=>{clearAI();setConfig(aiConfig());setKey('');setModels([]);setMessage('');}}>{t('AI 연결 삭제')}</button>
 {message&&<p><output>{message}</output></p>}
 <section className="ai-disclosure" aria-label={t('AI로 보내는 내용')}><p>{host?t('AI를 실행할 때만 아래 내용이 {host}로 전송됩니다.',{host}):t('AI를 실행할 때만 아래 내용이 등록한 서버로 전송됩니다.')}</p><ul>
  <li>{t('글 다듬기·요약 등 AI 메뉴: 고른 글(없으면 노트 전체 글)과 요청')}</li>
  <li>{t('AI 블록: 블록에 적은 요청만')}</li>
  <li>{t('용어 풀이: 고른 용어와 앞뒤 약 1,200자')}</li>
  <li>{t('내 노트에 묻기: 질문과 검색으로 찾은 노트 구절(최대 8개, 12,000자). 잠긴 노트와 휴지통은 보내지 않습니다.')}</li>
 </ul></section></section>;}
