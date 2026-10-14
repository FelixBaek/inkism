import type {SearchDocument} from "../lib/search-document-core";
import { t } from "../i18n";
import React, { useState, useRef, useEffect } from "react";
import type { Summary } from "../types";
import { searchInWorker, type SearchHit } from "../lib/global-search";
import "./GlobalSearchPanel.css";
import { searchPages } from "../lib/global-search-load";
import { NoteAnswer } from "./NoteAnswer";
export function GlobalSearchPanel({ notes = [], loadPage, loadText, loadCandidates, onOpen }: Readonly<{ notes?: Summary[]; loadCandidates?: (query: string, signal: AbortSignal) => Promise<Summary[]>; loadPage?: (cursor: string | undefined, signal: AbortSignal) => Promise<{items: Summary[]; next_cursor: string | null}>; loadText: (note: Summary, signal?: AbortSignal) => Promise<string|SearchDocument>; onOpen?: (id: string, anchor?: string, hit?: SearchHit) => void }>) {
  const [query, setQuery] = useState(""); const [regex, setRegex] = useState(false); const [hits, setHits] = useState<SearchHit[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const active=useRef<AbortController|null>(null);
  const [progress,setProgress]=useState(0);
  const [searched,setSearched]=useState(false);
  const cancel=()=>{active.current?.abort();active.current=null;setBusy(false);};
  useEffect(()=>()=>{active.current?.abort();},[]);
  const change=()=>{cancel();setHits([]);setError("");setSearched(false);};
  const run = async () => {
    if(!query.trim())return;
    active.current?.abort();const controller=new AbortController();active.current=controller;
    setProgress(0);setBusy(true);setError("");setHits([]);setSearched(false);
    try {
      await searchPages(loadPage ?? (()=>Promise.resolve({items:notes,next_cursor:null})),query,loadText,
        (loaded,texts)=>searchInWorker(loaded,texts,query,{regex},1500,controller.signal),
        {signal:controller.signal,onProgress:(count,result)=>{if(active.current===controller){setProgress(count);setHits([...result]);}}});
      if(active.current===controller)setSearched(true);
    } catch(e) {if(active.current===controller&&!controller.signal.aborted)setError(e instanceof Error?t(e.message):t("검색 오류"));}
    finally {if(active.current===controller){active.current=null;setBusy(false);}}
  };
  return <section className="global-search-panel" aria-label={t("전역 검색")}><div className="global-search-form"><input value={query} onChange={e => {change();setQuery(e.target.value);}} onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && void run()} placeholder={t("모든 노트 검색 (title:, tag:, type:)")} aria-label={t("전역 검색어")}/><label><input type="checkbox" checked={regex} onChange={e => {change();setRegex(e.target.checked);}} /> {t("정규식")}</label><button type="button" onClick={() => void run()} disabled={busy || !query.trim()}>{busy ? t("검색 중…") : t("검색")}</button>{busy&&<button type="button" onClick={cancel}>{t("취소")}</button>}</div>{loadCandidates&&<NoteAnswer question={query} loadCandidates={loadCandidates} loadText={loadText} onOpen={onOpen}/>}{error && <p role="alert" className="search-error">{error}</p>}<p>{t("조건: title:, tag:, notebook:, type:, path:, line:시작-끝, block:ID, section:제목")}</p><p>{t("노트당 최대 200개, 전체 최대 5,000개 결과를 표시합니다.")}</p><p><output>{t("검색한 노트: {count}",{count:progress})}</output></p><ol className="global-search-results">{hits.map((h, i) => <li key={`${h.note.id}:${h.index}:${i}`}><button type="button" onClick={() => onOpen?.(h.note.id,undefined,h)}><strong>{h.note.title}</strong><small>{t("줄 {line}", {line:h.line})}</small><span>{h.snippet.slice(0,h.matchStart??0)}<mark>{h.snippet.slice(h.matchStart??0,(h.matchStart??0)+(h.matchLength??0))}</mark>{h.snippet.slice((h.matchStart??0)+(h.matchLength??0))}</span></button></li>)}</ol>{!busy && searched && !error && hits.length === 0 && <p className="search-empty">{t("검색 결과가 없습니다.")}</p>}</section>;
}
