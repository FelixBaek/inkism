import { t } from "../i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { planFolderChanges, applyFolderChanges, readFolderHandle, writeDatabaseSnapshot, type FolderPlan, type WritableFolderHandle } from "../lib/portable-sync";
import './PortableLibrarySettings.css';
import {getPortableSession,subscribePortableSession,configurePortableSession,disconnectPortableSession,runPortableSession,setPortableCallbacks} from '../lib/portable-session';
/** Draft flush precedes every preview/apply; watcher belongs to the app session. */
export function PortableLibrarySettings({beforeAction,onApplied}: {beforeAction: () => Promise<boolean>; onApplied?: () => Promise<void> | void}) {
 const session=useSyncExternalStore(subscribePortableSession,getPortableSession);
 const [localBusy,setBusy]=useState(false),[message,setMessage]=useState(()=>sessionStorage.getItem('inkism.portable.result')||''),[plan,setPlan]=useState<FolderPlan|null>(session.plan),[selected,setSelected]=useState<Set<string>>(new Set());
 const {folder,watch,autoWrite,autoImport}=session;const busy=localBusy||session.busy;
 const setFolder=(folder:WritableFolderHandle|null)=>configurePortableSession({folder});
 const setWatch=(watch:boolean)=>configurePortableSession({watch});
 const setAutoWrite=(autoWrite:boolean)=>configurePortableSession({autoWrite});
 const setAutoImport=(autoImport:boolean)=>configurePortableSession({autoImport});
 useEffect(()=>{setPlan(session.plan);setSelected(new Set());},[session.plan]);
 useEffect(()=>{if(session.error)setMessage(session.error);},[session.error]);
 setPortableCallbacks({beforeAction,onApplied});
 const input=useRef<HTMLInputElement>(null),running=useRef(false),mounted=useRef(true);
 const callbacks=useRef({beforeAction,onApplied});callbacks.current={beforeAction,onApplied};
 useEffect(()=>{sessionStorage.removeItem('inkism.portable.result');mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function run(action:()=>Promise<void>){if(running.current||getPortableSession().busy)return;running.current=true;setBusy(true);setMessage('');try{await runPortableSession(async()=>{if(!(await callbacks.current.beforeAction()))throw new Error(t('작성 중인 노트를 먼저 저장해 주세요.'));await action();});}catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:t('처리하지 못했습니다.'));}finally{running.current=false;if(mounted.current)setBusy(false);}}
 async function inspect(files:File[]){await run(async()=>{setPlan(null);setSelected(new Set());const next=await planFolderChanges(files);if(mounted.current){setPlan(next);setSelected(new Set());}});}
 async function exportFolder(){await run(async()=>{const response=await fetch('/api/portable/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok){const error=await response.json();throw new Error(error.error||t('내보내지 못했습니다.'));}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='inkism-folder.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage(t('외부 편집 폴더 ZIP을 내보냈습니다. 압축을 풀고 notes 폴더에서 편집하세요.'));});}
 async function connect(){const picker=(window as unknown as {showDirectoryPicker?:(o:{mode:'readwrite'})=>Promise<WritableFolderHandle>}).showDirectoryPicker;if(!picker){input.current?.click();return;}try{const handle=await picker({mode:'readwrite'});setFolder(handle);await inspect(await readFolderHandle(handle));}catch(e){if((e as Error).name!=='AbortError')setMessage((e as Error).message);}}

 async function apply(){if(!plan||!selected.size)return;configurePortableSession({watch:false,autoWrite:false,autoImport:false});await run(async()=>{const result=await applyFolderChanges(plan,selected);setPlan(null);setSelected(new Set());const message=t('{saved}개 반영 · {failed}개 저장 실패',{saved:result.saved,failed:result.errors.length})+(result.errors.length?'\n'+result.errors.join('\n'):'')+'\n'+t('반영 후에는 새 ZIP을 내보내 새 외부 편집 폴더로 시작하세요. 이전 외부 편집 폴더는 이전 비교 기준을 유지합니다.');setMessage(message);if(result.saved){sessionStorage.setItem('inkism.portable.result',message);await callbacks.current.onApplied?.();}});disconnectPortableSession();}
 const kindLabel={create:t('새 노트'),update:t('내용 변경'),rename:t('이름 변경'),delete:t('지운 노트로 이동')};
 const conflicts=plan?.conflicts??[];
 return <div className="portable-library-settings">
 <section className="portable-column" aria-labelledby="portable-folder-title">
  <h3 id="portable-folder-title">{t('외부 편집 폴더')}</h3>
  <div className="portable-actions"><button className="btn" disabled={busy} onClick={()=>void exportFolder()}>{t('외부 편집 폴더 ZIP 내보내기')}</button></div>
  <p className="portable-note">{t('노트를 Markdown·HTML·텍스트 파일과 첨부파일로 내보냅니다. 잠긴 노트와 지운 노트는 제외됩니다.')}</p>
  <div className="portable-actions"><button className="btn" disabled={busy} onClick={()=>void connect()}>{t('외부 편집 폴더 선택')}</button>{folder&&<button className="btn" disabled={busy} onClick={()=>void readFolderHandle(folder).then(inspect).catch(e=>setMessage(e.message))}>{t('지금 확인')}</button>}{folder&&<button className="btn" disabled={busy} onClick={()=>disconnectPortableSession()}>{t('외부 편집 폴더 연결 해제')}</button>}<input ref={input} hidden type="file" multiple {...{webkitdirectory:'',directory:''}} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void inspect(files);}} /></div>
  {folder&&<p className="portable-status" role="status">{folder.name} · {busy?t('외부 편집 폴더 작업 중'):watch||autoWrite||autoImport?t('자동 감지 켜기'):t('연결됨')}</p>}
  <label className="portable-switch"><span>{t('자동 감지')}</span><input type="checkbox" aria-label={t('자동 감지 켜기')} checked={watch} disabled={!folder||busy} onChange={e=>setWatch(e.target.checked)}/><span>{t('5초마다 변경 확인')}</span></label>
  <label className="portable-switch"><span>{t('자동 반영')}</span><input type="checkbox" aria-label={t('외부 변경 자동 반영 (삭제는 지운 노트로 이동)')} checked={autoImport} disabled={!folder||busy} onChange={e=>setAutoImport(e.target.checked)}/><span>{t('외부 변경 자동 반영 (삭제는 지운 노트로 이동)')}</span></label>
  <label className="portable-switch"><span>{t('자동 쓰기')}</span><input type="checkbox" aria-label={t('DB 변경 자동 쓰기')} checked={autoWrite} disabled={!folder||busy} onChange={e=>setAutoWrite(e.target.checked)}/><span>{t('DB 변경 자동 쓰기')}</span></label>
  {folder&&<div className="portable-actions"><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const result=await writeDatabaseSnapshot(folder);setMessage(t('{n}개 파일을 외부 편집 폴더에 저장했습니다.',{n:result.written}));})}>{t('현재 DB를 외부 편집 폴더에 쓰기')}</button></div>}
  <div className="portable-note"><p>{t('외부 편집 폴더를 5초마다 확인합니다. 설정을 닫아도 계속 작동합니다. 충돌이나 권한 오류 시 자동 반영을 멈춥니다. 앱을 다시 열면 외부 편집 폴더를 다시 선택하세요.')}</p><p>{t('메타데이터는 .inkism-portable.json의 metadata에서 제목·태그·폴더만 편집할 수 있습니다.')}</p></div>
 </section>
 <section className="portable-column" aria-labelledby="portable-plan-title">
  <h3 id="portable-plan-title">{t('변경 비교 · 선택 {count}개',{count:selected.size})}</h3>
  {plan?<div className="portable-plan"><p role="status">{t('{changes}개 반영 가능 · {unchanged}개 변경 없음 · {conflicts}개 충돌 · {ignored}개 추가 파일 제외',{changes:plan.changes.length,unchanged:plan.unchanged,conflicts:plan.conflicts.length,ignored:plan.ignored})}</p>
   <ul className="portable-change-list">{plan.changes.map(c=><li key={c.key}><label><span className="portable-kind"><input type="checkbox" aria-label={`${kindLabel[c.kind]} · ${c.title}`} checked={selected.has(c.key)} disabled={busy} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(c.key);else next.delete(c.key);return next;})}/>{kindLabel[c.kind]}</span><span><strong>{c.title}</strong><small>{c.previousPath?c.previousPath+' → ':''}{c.path}</small>{c.details.length>0&&<small>{c.details.map(detail=>t(detail)).join(' · ')}</small>}</span></label></li>)}
    {conflicts.map((c,i)=><li key={`conflict-${i}`} className="portable-conflict"><span className="portable-kind">{t('충돌 · 제외')}</span><span>{c}</span></li>)}</ul>
   <div className="portable-actions"><button className="btn" disabled={busy} onClick={()=>setSelected(new Set(plan.changes.filter(c=>c.kind!=='delete').map(c=>c.key)))}>{t('삭제 외 항목 선택')}</button></div>
   <div className="portable-actions"><button className="btn" disabled={busy||!selected.size} onClick={()=>void apply()}>{t('선택한 {count}개 반영',{count:selected.size})}</button><button className="btn" disabled={busy} onClick={()=>{setPlan(null);configurePortableSession({watch:false,autoWrite:false,autoImport:false});}}>{t('취소')}</button></div>
   <div className="portable-warning"><p>{t('반영할 항목을 직접 선택하세요. 첨부 변경은 새 사본으로 저장하며 기존 첨부는 유지합니다. 본문 변경은 노트 이력에서, 삭제는 지운 노트에서 복원할 수 있습니다.')}</p><p>{t('반영 후에는 새 ZIP을 내보내 새 외부 편집 폴더로 시작하세요. 이전 외부 편집 폴더는 이전 비교 기준을 유지합니다.')}</p>{conflicts.length>0&&<p>{t('충돌한 노트는 건너뜁니다. 앱과 파일 내용을 비교한 뒤 새로 내보내 주세요.')}</p>}</div>
  </div>:<div className="portable-note"><p>{t('본문·새 파일·이름 변경·삭제·첨부파일·제목·태그·폴더 변경을 확인하고 선택합니다. 삭제한 노트는 앱의 지운 노트로 옮기며 외부 파일은 지우지 않습니다.')}</p><p>{t('이름과 본문을 동시에 바꾸면 새 파일과 삭제로 표시됩니다. 문서 ID를 유지하려면 이름만 먼저 변경하세요.')}</p></div>}
  {!folder&&<p className="portable-note">{t('외부 편집 폴더 연결을 지원하지 않는 환경에서는 ‘외부 편집 폴더 선택’으로 직접 다시 확인하세요.')}</p>}
  {message&&<p className="portable-status" role="status" style={{whiteSpace:'pre-wrap'}}>{message}</p>}
 </section>
 </div>;
}
