import type {SearchDocument} from "../lib/search-document-core";
import { t } from "../i18n";
import React, { useState, useRef, useEffect } from "react";
import type { Summary } from "../types";
import { searchInWorker, type SearchHit } from "../lib/global-search";
import "./GlobalSearchPanel.css";
import { searchPages } from "../lib/global-search-load";
import { NoteAnswer } from "./NoteAnswer";
import { CalendarBlank } from "../icons";

type Period = "all" | "today" | "week" | "month" | "last-month" | "custom";
const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "today", label: "오늘" },
  { id: "week", label: "이번 주" },
  { id: "month", label: "이번 달" },
  { id: "last-month", label: "지난달" },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** 기간 칩 → [시작, 끝] 날짜(로컬, 끝 포함). 주는 월요일부터. */
export function periodRange(period: Period, custom: [string, string], now = new Date()): [string, string] | null {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  switch (period) {
    case "today": return [ymd(now), ymd(now)];
    case "week": return [ymd(day(-((now.getDay() + 6) % 7))), ymd(now)];
    case "month": return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
    case "last-month": return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
    case "custom": return custom[0] || custom[1] ? custom : null;
    default: return null;
  }
}
const monthDay = (value: string) => {
  const [, m, d] = value.split("-").map(Number);
  return t("{month}월 {day}일", { month: m, day: d });
};
export function GlobalSearchPanel({ notes = [], loadPage, loadText, loadCandidates, onOpen }: Readonly<{ notes?: Summary[]; loadCandidates?: (query: string, signal: AbortSignal) => Promise<Summary[]>; loadPage?: (cursor: string | undefined, signal: AbortSignal) => Promise<{items: Summary[]; next_cursor: string | null}>; loadText: (note: Summary, signal?: AbortSignal) => Promise<string|SearchDocument>; onOpen?: (id: string, anchor?: string, hit?: SearchHit) => void }>) {
  const [query, setQuery] = useState(""); const [regex, setRegex] = useState(false); const [hits, setHits] = useState<SearchHit[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const active=useRef<AbortController|null>(null);
  const [progress,setProgress]=useState(0);
  const [searched,setSearched]=useState(false);
  // 기간 칩은 수정 날짜(updated:)로 거른다. 검색어 없이 기간만 골라도 그 기간 노트를 보여 준다.
  const [period,setPeriod]=useState<Period>("all");const [custom,setCustom]=useState<[string,string]>(["",""]);
  const range=periodRange(period,custom);
  const fullQuery=(query+(range?` updated:${range[0]}..${range[1]}`:"")).trim();
  const cancel=()=>{active.current?.abort();active.current=null;setBusy(false);};
  useEffect(()=>()=>{active.current?.abort();},[]);
  const change=()=>{cancel();setHits([]);setError("");setSearched(false);};
  const run = async () => {
    if(!fullQuery)return;
    active.current?.abort();const controller=new AbortController();active.current=controller;
    setProgress(0);setBusy(true);setError("");setHits([]);setSearched(false);
    try {
      await searchPages(loadPage ?? (()=>Promise.resolve({items:notes,next_cursor:null})),fullQuery,loadText,
        (loaded,texts)=>searchInWorker(loaded,texts,fullQuery,{regex},1500,controller.signal),
        {signal:controller.signal,onProgress:(count,result)=>{if(active.current===controller){setProgress(count);setHits([...result]);}}});
      if(active.current===controller)setSearched(true);
    } catch(e) {if(active.current===controller&&!controller.signal.aborted)setError(e instanceof Error?t(e.message):t("검색 오류"));}
    finally {if(active.current===controller){active.current=null;setBusy(false);}}
  };
  return <section className="global-search-panel" aria-label={t("전역 검색")}><div className="global-search-form"><input value={query} onChange={e => {change();setQuery(e.target.value);}} onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && void run()} placeholder={t("모든 노트 검색 (title:, tag:, type:)")} aria-label={t("전역 검색어")}/><label><input type="checkbox" checked={regex} onChange={e => {change();setRegex(e.target.checked);}} /> {t("정규식")}</label><button type="button" onClick={() => void run()} disabled={busy || !fullQuery}>{busy ? t("검색 중…") : t("검색")}</button>{busy&&<button type="button" onClick={cancel}>{t("취소")}</button>}</div><div className="global-search-period" role="group" aria-label={t("기간")}><span>{t("기간")}</span>{PERIODS.map(p=><button key={p.id} type="button" className="search-chip" aria-pressed={period===p.id} onClick={()=>{change();setPeriod(p.id);}}>{t(p.label)}</button>)}<button type="button" className="search-chip" aria-pressed={period==="custom"} onClick={()=>{change();setPeriod("custom");}}><CalendarBlank size={13} aria-hidden/>{t("날짜 고르기…")}</button>{period==="custom"&&<><input type="date" aria-label={t("시작 날짜")} value={custom[0]} max={custom[1]||undefined} onChange={e=>{change();setCustom([e.target.value,custom[1]]);}}/><span aria-hidden>–</span><input type="date" aria-label={t("끝 날짜")} value={custom[1]} min={custom[0]||undefined} onChange={e=>{change();setCustom([custom[0],e.target.value]);}}/></>}{range&&<output className="global-search-range">{(range[0]?monthDay(range[0]):"…")+" – "+(range[1]?monthDay(range[1]):"…")}{searched&&" · "+t("{count}개",{count:new Set(hits.map(h=>h.note.id)).size})}</output>}</div>{loadCandidates&&<NoteAnswer question={query} loadCandidates={loadCandidates} loadText={loadText} onOpen={onOpen}/>}{error && <p role="alert" className="search-error">{error}</p>}<p>{t("조건: created:날짜, updated:날짜, title:, tag:, notebook:, type:, path:, line:시작-끝, block:ID, section:제목")}</p><p>{t("노트당 최대 200개, 전체 최대 5,000개 결과를 표시합니다.")}</p><p><output>{period==="all"?t("검색한 노트: {count}",{count:progress}):t("검색한 노트: {count} ({period})",{count:progress,period:period==="custom"?t("날짜 고르기"):t(PERIODS.find(p=>p.id===period)!.label)})}</output></p><ol className="global-search-results">{hits.map((h, i) => <li key={`${h.note.id}:${h.index}:${i}`}><button type="button" onClick={() => onOpen?.(h.note.id,undefined,h)}><strong>{h.note.title}</strong><small>{t("줄 {line}", {line:h.line})}</small><span>{h.snippet.slice(0,h.matchStart??0)}<mark>{h.snippet.slice(h.matchStart??0,(h.matchStart??0)+(h.matchLength??0))}</mark>{h.snippet.slice((h.matchStart??0)+(h.matchLength??0))}</span></button></li>)}</ol>{!busy && searched && !error && hits.length === 0 && <p className="search-empty">{t("검색 결과가 없습니다.")}</p>}</section>;
}
