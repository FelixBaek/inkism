import { useEffect, useMemo, useRef, useState } from "react";
import { api, rpc } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import { htmlToPureMarkdown } from "../lib/markdown";
type Snapshot = { title:string; html:string; version:number; pages?:{id:string;title:string;html:string}[] };
type Binding = { id:string; revision:number; version:number; format:string };
type Props = {publicationId:string; request:(action:string,extra?:Record<string,unknown>)=>Promise<any>; pages?:{id:string;title:string}[]};
/** Checkpoints live in the source library; credentials never persist. */
export function PublicationReconciliation(props:Props) {
  const [page,setPage]=useState("");
  return <><label>{t("변경을 받을 공유 페이지")}<select value={page} onChange={e=>setPage(e.target.value)}><option value="">{t("첫 페이지")}</option>{props.pages?.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select></label><ReconciliationPage key={`${props.publicationId}:${page}`} {...props} pageId={page}/></>;
}
function ReconciliationPage({publicationId,request,pageId}:Props&{pageId:string}) {
  const s=useStore(), latest=useRef({s,request}); latest.current={s,request};
  const [binding,setBinding]=useState<Binding|null>(null),[pending,setPending]=useState<Snapshot|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[ack,setAck]=useState(false);
  const receipt=useRef<{kind:"apply"|"copy";version:number;source:string;note:{id:string;revision:number}}|null>(null);
  const checkpoint=useRef(0),[ready,setReady]=useState(false);
  const conversion=useMemo(()=>{if(!pending||binding?.format!=="markdown")return {markdown:undefined,error:""};try{const markdown=htmlToPureMarkdown(pending.html);return {markdown,error:""};}catch(e){return {markdown:undefined,error:e instanceof Error?e.message:String(e)};}},[pending,binding?.format]);
  const persist=async(value:Binding|null)=>{const row=await rpc<{binding:Binding|null;updated_at:number}>("collaboration_binding_set",{publication_id:publicationId,page_id:pageId,binding:value,expected_updated_at:checkpoint.current});checkpoint.current=row.updated_at;setBinding(row.binding);};
  const snapshot=async():Promise<Snapshot>=>{const result:Snapshot=await latest.current.request("snapshot",{id:publicationId});if(!pageId)return result;const page=result.pages?.find(p=>p.id===pageId);if(!page)throw Error(t("공유 페이지가 삭제되었습니다. 원본은 보존됩니다."));return {...page,version:result.version};};
  useEffect(()=>setAck(false),[pending?.version]);
  const inFlight=useRef(false), generation=useRef(0);
  useEffect(()=>{let disposed=false;void rpc<{binding:Binding|null;updated_at:number}>("collaboration_binding_get",{publication_id:publicationId,page_id:pageId}).then(row=>{if(!disposed){checkpoint.current=row.updated_at;setBinding(row.binding);setReady(true);}}).catch(e=>{if(!disposed)setError(String(e));});return()=>{disposed=true;generation.current++;};},[publicationId,pageId]);
  const run=async(fn:()=>Promise<void>)=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{inFlight.current=false;setBusy(false);}};
  useEffect(()=>{
    if(!binding)return;
    let disposed=false;
    const check=async()=>{if(inFlight.current||document.hidden||receipt.current)return;inFlight.current=true;try{const remote=await snapshot();if(!disposed&&remote.version>binding.version){setPending(remote);}}catch(e){if(!disposed)setError(e instanceof Error?e.message:String(e));}finally{inFlight.current=false;}};
    const interval=setInterval(()=>void check(),15000);void check();return()=>{disposed=true;clearInterval(interval);};
  },[binding,publicationId]);
  const connect=()=>void run(async()=>{const generationAtStart=generation.current;const store=latest.current.s;if(!store.note||!await store.flushNow())throw Error(t("먼저 원본 노트를 저장하세요."));const source=await api.get(store.note.id);if(source.readonly||source.trashed||("locked" in source && source.locked))throw Error(t("보호된 노트는 연결할 수 없습니다."));const snap=await snapshot();if(generation.current!==generationAtStart)return;await persist({id:source.id,revision:source.revision,version:snap.version,format:source.content_format||"html"});setPending(null);});
  const apply=()=>void run(async()=>{
    if(!binding||!pending||!ack)return;
    const store=latest.current.s;
    if(!await store.flushNow())throw Error(t("먼저 원본 노트를 저장하세요."));
    const previous=receipt.current;
    let saved=previous?.kind==="apply"&&previous.version===pending.version&&previous.source===binding.id?previous.note:null;
    if(!saved){const result=await latest.current.request("reconcile",{id:publicationId,note_id:binding.id,revision:binding.revision,version:pending.version,page_id:pageId,markdown:conversion.markdown});saved=result.note;receipt.current={kind:"apply",source:binding.id,version:pending.version,note:result.note};}
    await persist({...binding,revision:saved!.revision,version:pending.version});
    receipt.current=null;setPending(null);setAck(false);await store.refreshList();if(!await store.reloadCurrentNote(binding.id))throw Error(t("공유 변경은 저장되었습니다. 새로 입력한 내용은 보존했으니 저장 충돌을 먼저 해결하세요."));
  });
  const copy=()=>void run(async()=>{
    if(!pending||!binding)return;
    const previous=receipt.current;
    let note=previous?.kind==="copy"&&previous.version===pending.version&&previous.source===binding.id?previous.note:null;
    if(!note){note=await api.save({id:crypto.randomUUID(),title:`${pending.title} (${t("공동편집 사본")})`,content:pending.html,content_format:"html",require_absent:true});receipt.current={kind:"copy",source:binding.id,version:pending.version,note};}
    await persist({...binding,version:pending.version});
    receipt.current=null;setPending(null);setAck(false);await latest.current.s.refreshList();await latest.current.s.selectNote(note.id);
  });
  return <fieldset data-collaboration-page={pageId} disabled={busy}><legend>{t("공동편집 변경 받기")}</legend><p>{t("페이지마다 원본을 연결하고 변경을 검토한 뒤 반영합니다. 연결은 이 라이브러리에 저장되며 공유 관리 화면에서 15초마다 확인합니다. 원본도 바뀌면 별도 사본으로 보관하세요.")}</p>{!binding?<button disabled={!s.note||!ready} onClick={connect}>{t("현재 노트를 원본으로 연결")}</button>:<><p>{t("연결된 원본")}: {binding.id}</p><button onClick={()=>void run(async()=>{generation.current++;await persist(null);receipt.current=null;setPending(null);setAck(false);})}>{t("원본 연결 해제")}</button><button disabled={!!receipt.current} onClick={()=>void run(async()=>{const remote=await snapshot();if(remote.version>binding.version){setPending(remote);}})}>{t("변경 확인")}</button></>}
    {pending&&<><p role="status">{t("공동편집 변경이 도착했습니다.")} · v{pending.version}</p><iframe title={t("공동편집 변경 미리보기")} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><body>${pending.html}`} style={{width:"100%",minHeight:180,border:"1px solid var(--border)"}}/><label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{t("검토한 본문을 원본에 반영합니다.")}</label><button disabled={!ack||binding?.format==="text"||Boolean(conversion.error)||receipt.current?.kind==="copy"} onClick={apply}>{t("원본에 반영")}</button><button disabled={receipt.current?.kind==="apply"} onClick={copy}>{t("별도 사본으로 보관")}</button>{conversion.error&&<p role="alert">{conversion.error}</p>}{binding?.format==="text"&&<p>{t("텍스트 원본은 공유 변경을 별도 HTML 사본으로 보관하세요.")}</p>}</>}
    {error&&<><p role="alert">{error}</p>{receipt.current&&<p>{t("본문은 저장되었지만 연결 기록 저장에 실패했습니다. 같은 버튼을 다시 누르면 본문을 중복 저장하지 않고 기록만 재시도합니다.")}</p>}<button onClick={()=>void run(async()=>{const row=await rpc<{binding:Binding|null;updated_at:number}>("collaboration_binding_get",{publication_id:publicationId,page_id:pageId});checkpoint.current=row.updated_at;receipt.current=null;setBinding(row.binding);setReady(true);setPending(null);setAck(false);})}>{t("연결 정보 다시 불러오기")}</button></>}
  </fieldset>;
}
