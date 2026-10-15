import {useEffect,useState} from 'react';
import {kickSemanticIndex,onSemanticIndex,rebuildSemanticIndex,type SemanticIndexState} from '../lib/semantic-index';
import {aiConfig,aiKeyState,configureAI,clearAI,completeAI,listModels,detectCLIs,cliName,type AiCli} from '../lib/ai-provider';
import {t} from '../i18n';
import {AlertTriangle,CheckCircle2} from '../icons';
const PRESETS=[['OpenAI','https://api.openai.com/v1/chat/completions'],['OpenRouter','https://openrouter.ai/api/v1/chat/completions'],['Ollama','http://localhost:11434/v1/chat/completions'],['LM Studio','http://localhost:1234/v1/chat/completions']];
function SemanticIndexStatus({enabled}:Readonly<{enabled:boolean}>){
 const [state,setState]=useState<SemanticIndexState|null>(null),[error,setError]=useState('');
 useEffect(()=>onSemanticIndex(setState),[]);
 if(!enabled||!state)return null;
 const progress=state.running?t('의미 색인 만드는 중: {indexed}개 완료, {pending}개 남음',{indexed:state.indexed,pending:state.pending}):t('의미 색인: {indexed}개 완료, {pending}개 남음',{indexed:state.indexed,pending:state.pending});
 return <fieldset className="semantic-index"><legend>{t('의미 색인')}</legend>
  <output>{progress}</output>{state.running&&<progress max={Math.max(1,state.indexed+state.pending)} value={state.indexed} aria-label={t('의미 색인 진행')}/>}
  {(error||state.error)&&<p role="alert">{error||state.error}</p>}
  <button className="btn" type="button" disabled={state.running} onClick={()=>{setError('');void rebuildSemanticIndex().catch(e=>setError(e instanceof Error?e.message:String(e)));}}>{t('의미 색인 다시 만들기')}</button>
 </fieldset>;}
const hostOf=(endpoint:string)=>{try{const u=new URL(endpoint);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)?t('이 기기({host})',{host:u.host}):u.host;}catch{return '';}};
export function AiSettings(){const [config,setConfig]=useState(aiConfig),[key,setKey]=useState(''),[message,setMessage]=useState(''),[tone,setTone]=useState<'ok'|'warn'|'error'>('ok'),[busy,setBusy]=useState(false),[models,setModels]=useState<string[]>([]),[keyState,setKeyState]=useState({kept:false,saved:false}),[clis,setClis]=useState<AiCli[]>([]);const host=config.cli?cliName(config.cli):hostOf(config.endpoint||'');
 const cliModels=clis.find(c=>c.cli===config.cli)?.models??[];
 useEffect(()=>{void aiKeyState().then(setKeyState);void detectCLIs().then(setClis);},[]);
 const run=(job:()=>Promise<unknown>)=>{setBusy(true);setTone('ok');void job().catch(e=>{setTone('error');setMessage(e instanceof Error?e.message:String(e));}).finally(()=>setBusy(false));};
 return <section className="ai-settings">{!config.cli&&<><p>{t('Chat Completions 호환 서버의 전체 요청 주소와 모델을 등록합니다.')}</p>
 <p className="ai-key-storage">{keyState.kept?t('API 키는 이 Windows 사용자 계정으로 암호화(DPAPI)해 앱 데이터 폴더에 저장하고, 앱을 다시 열면 불러옵니다. 요청 주소의 서버가 바뀌면 키를 다시 입력해야 하며, AI 연결 삭제를 누르면 지워집니다.'):t('이 환경에서는 API 키를 저장하지 않습니다. 키는 메모리에만 두며 앱을 닫으면 지워집니다.')}</p></>}
 <label>{t('서비스 예시')}<select aria-label={t('서비스 예시')} value={config.cli?'cli:'+config.cli:''} onChange={e=>{const v=e.target.value;setModels([]);if(v.startsWith('cli:'))setConfig({...config,cli:v.slice(4),endpoint:'',model:'',embedModel:''});else setConfig({...config,cli:undefined,endpoint:v||(config.cli?'':config.endpoint),model:config.cli?'':config.model});}}><option value="">{t('직접 입력')}</option>{clis.length>0&&<optgroup label={t('이 컴퓨터의 CLI')}>{clis.map(c=><option key={c.cli} value={'cli:'+c.cli}>{cliName(c.cli)}</option>)}</optgroup>}<optgroup label={t('서버')}>{PRESETS.map(([name,url])=><option key={url} value={url}>{name}</option>)}</optgroup></select></label>
 {config.cli?<>
 <p className="ai-key-storage">{t('{cli}에 로그인된 계정으로 실행합니다. 주소와 API 키는 필요 없습니다.',{cli:cliName(config.cli)})}</p>
 <label>{t('AI 모델')}<select aria-label={t('AI 모델')} value={config.model||''} onChange={e=>setConfig({...config,model:e.target.value})}><option value="">{t('CLI 기본 모델')}</option>{cliModels.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
 </>:<>
 <label>{t('AI 요청 주소')}<input type="url" value={config.endpoint||''} onChange={e=>{setConfig({...config,endpoint:e.target.value});setModels([]);}}/></label>
 <label>{t('AI 모델')}<input value={config.model||''} onChange={e=>setConfig({...config,model:e.target.value})}/></label>
 <label>{t('임베딩 모델 (선택)')}<input value={config.embedModel||''} placeholder={t('비우면 의미 검색을 쓰지 않습니다')} onChange={e=>setConfig({...config,embedModel:e.target.value})}/></label>
 <label>{t('AI API 키')}<input type="password" autoComplete="off" value={key} placeholder={keyState.saved?t('저장된 키 사용 중 · 바꿀 때만 입력'):undefined} onChange={e=>setKey(e.target.value)}/></label>
 <button className="btn" disabled={busy||!config.endpoint} onClick={()=>run(async()=>{setMessage('');const list=await listModels(config.endpoint,key);setModels(list);if(!list.length)setTone('warn');setMessage(list.length?t('모델 {count}개를 불러왔습니다.',{count:list.length}):t('서버가 알려 준 모델이 없습니다. 모델 이름을 직접 입력해 주세요.'));})}>{t('모델 불러오기')}</button>
 {models.length>0&&<label>{t('불러온 모델')}<select aria-label={t('불러온 모델')} value={models.includes(config.model)?config.model:''} onChange={e=>setConfig({...config,model:e.target.value})}><option value="" disabled>{t('모델 고르기')}</option>{models.map(m=><option key={m} value={m}>{m}</option>)}</select></label>}
 </>}
 <div className="settings-actions"><button className="btn btn-primary" disabled={busy} onClick={()=>run(async()=>{await configureAI({...config,enabled:true},key);setKey('');setMessage(t('저장됨'));kickSemanticIndex();setKeyState(await aiKeyState());})}>{t('AI 연결 저장')}</button>
 <button className="btn" disabled={busy} onClick={()=>run(async()=>setMessage(t('연결됨: {reply}',{reply:(await completeAI('Reply with OK.','')).slice(0,80)})))}>{t('AI 연결 테스트')}</button>
 <button className="btn btn-ghost danger-text" onClick={()=>run(async()=>{const cleared=clearAI();setConfig(aiConfig());setKey('');setModels([]);setMessage('');await cleared;setKeyState(await aiKeyState());})}>{t('AI 연결 삭제')}</button></div>
 {message&&<p className={'settings-msg settings-msg--'+tone}>{tone==='ok'&&<CheckCircle2 size={14} aria-hidden/>}{tone==='warn'&&<AlertTriangle size={14} aria-hidden/>}<output>{message}</output></p>}
 <SemanticIndexStatus enabled={Boolean(aiConfig().enabled&&aiConfig().embedModel?.trim())}/>
 <section className="ai-disclosure" aria-label={t('AI로 보내는 내용')}><p>{host?t('AI를 실행할 때만 아래 내용이 {host}로 전송됩니다.',{host}):t('AI를 실행할 때만 아래 내용이 등록한 서버로 전송됩니다.')}</p><ul>
  <li>{t('글 다듬기·요약 등 AI 메뉴: 고른 글(없으면 노트 전체 글)과 요청')}</li>
  <li>{t('AI 블록: 블록에 적은 요청만')}</li>
  <li>{t('용어 풀이: 고른 용어와 앞뒤 약 1,200자')}</li>
  <li>{t('내 노트에 묻기: 질문과 검색으로 찾은 노트 구절(최대 8개, 12,000자). 잠긴 노트와 지운 노트는 보내지 않습니다.')}</li>
  <li>{t('의미 색인(임베딩 모델을 등록했을 때): 앱이 켜져 있는 동안 노트 글을 약 800자 조각으로 나눠 임베딩 주소로 보내고, 묻기 질문도 보냅니다. 잠긴 노트와 지운 노트는 보내지 않습니다.')}</li>
 </ul></section></section>;}
