import type {SearchDocument} from "../lib/search-document-core";
import { t } from "../i18n";
import React, { useState, useRef, useEffect } from "react";
import type { Summary, Notebook, TagCount } from "../types";
import { searchInWorker, type SearchHit } from "../lib/global-search";
import "./GlobalSearchPanel.css";
import { searchPages } from "../lib/global-search-load";
import { NoteAnswer } from "./NoteAnswer";
import { CalendarBlank } from "../icons";

import {periodRange,searchQuery,readSearchPresets,SEARCH_PRESETS_KEY,type Period,type SearchPreset} from '../lib/search-presets';
import {prepareSearch} from '../lib/global-search-core';
export {periodRange} from '../lib/search-presets';
const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "today", label: "오늘" },
  { id: "week", label: "이번 주" },
  { id: "month", label: "이번 달" },
  { id: "last-month", label: "지난달" },
];
const monthDay = (value: string) => {
  const [, m, d] = value.split("-").map(Number);
  return t("{month}월 {day}일", { month: m, day: d });
};
export function GlobalSearchPanel({ notes = [], notebooks = [], tags = [], loadPage, loadText, loadCandidates, onOpen }: Readonly<{ notes?: Summary[]; notebooks?: Notebook[]; tags?: TagCount[]; loadCandidates?: (query: string, signal: AbortSignal) => Promise<Summary[]>; loadPage?: (cursor: string | undefined, signal: AbortSignal) => Promise<{items: Summary[]; next_cursor: string | null}>; loadText: (note: Summary, signal?: AbortSignal) => Promise<string|SearchDocument>; onOpen?: (id: string, anchor?: string, hit?: SearchHit) => void }>) {
  const [query, setQuery] = useState(""); const [regex, setRegex] = useState(false); const [hits, setHits] = useState<SearchHit[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const active=useRef<AbortController|null>(null);
  const [progress,setProgress]=useState(0);
  const [searched,setSearched]=useState(false);
  // 기간 칩은 수정 날짜(updated:)로 거른다. 검색어 없이 기간만 골라도 그 기간 노트를 보여 준다.
  const [period,setPeriod]=useState<Period>("all");const [custom,setCustom]=useState<[string,string]>(["",""]);
  const [tag,setTag]=useState(''),[notebook,setNotebook]=useState('');
  const [saved,setSaved]=useState<SearchPreset[]>(()=>{try{return readSearchPresets(localStorage.getItem(SEARCH_PRESETS_KEY));}catch{
    // Search remains usable when browser storage is blocked; saving reports its error.
    return [];}});
  const [presetName,setPresetName]=useState(''),[selected,setSelected]=useState(''),[savedMessage,setSavedMessage]=useState('');
  const range=periodRange(period,custom);
  const conditions={query,regex,period,custom,tag,notebook};
  const fullQuery=searchQuery(conditions);
  const cancel=()=>{active.current?.abort();active.current=null;setBusy(false);};
  useEffect(()=>()=>{active.current?.abort();},[]);
  const change=()=>{cancel();setHits([]);setError("");setSearched(false);setSavedMessage('');};
  const persist=(next:SearchPreset[])=>{
    try{localStorage.setItem(SEARCH_PRESETS_KEY,JSON.stringify(next));setSaved(next);setError('');return true;}
    catch{setError(t('검색 조건을 저장하지 못했습니다. 이 기기의 저장 공간을 확인해 주세요.'));return false;}
  };
  const savePreset=()=>{
    const name=presetName.trim();if(!name||!fullQuery)return;
    try{prepareSearch(fullQuery);}catch(e){setError(t(e instanceof Error?e.message:'검색 오류'));return;}
    const existing=saved.find(p=>p.name===name);
    if(!existing&&saved.length>=20){setError(t('검색 조건은 20개까지 저장할 수 있습니다.'));return;}
    const preset={...conditions,name,id:existing?.id??crypto.randomUUID()};
    if(persist([...saved.filter(p=>p.id!==preset.id),preset])){setSelected(preset.id);setSavedMessage(t('이 기기에 검색 조건을 저장했습니다.'));}
  };
  const loadPreset=(id:string)=>{const value=saved.find(p=>p.id===id);setSelected(id);if(!value)return;change();setQuery(value.query);setRegex(value.regex);setPeriod(value.period);setCustom(value.custom);setTag(value.tag);setNotebook(value.notebook);setPresetName(value.name);setSavedMessage('');};
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
  return <section className="global-search-panel" aria-label={t("전역 검색")}><div className="global-search-form"><input value={query} onChange={e => {change();setQuery(e.target.value);}} onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && void run()} placeholder={t("모든 노트 검색 (title:, tag:, type:)")} aria-label={t("전역 검색어")}/><label><input type="checkbox" checked={regex} onChange={e => {change();setRegex(e.target.checked);}} /> {t("정규식")}</label><button className="btn" type="button" onClick={() => void run()} disabled={busy || !fullQuery}>{busy ? t("검색 중…") : t("검색")}</button>{busy&&<button className="btn" type="button" onClick={cancel}>{t("취소")}</button>}</div><fieldset className="global-search-period plain-fieldset" aria-label={t("기간")}><span>{t("기간")}</span>{PERIODS.map(p=><button key={p.id} type="button" className="search-chip" aria-pressed={period===p.id} onClick={()=>{change();setPeriod(p.id);}}>{t(p.label)}</button>)}<button type="button" className="search-chip" aria-pressed={period==="custom"} onClick={()=>{change();setPeriod("custom");}}><CalendarBlank size={13} aria-hidden/>{t("날짜 고르기…")}</button>{period==="custom"&&<><input type="date" aria-label={t("시작 날짜")} value={custom[0]} max={custom[1]||undefined} onChange={e=>{change();setCustom([e.target.value,custom[1]]);}}/><span aria-hidden>–</span><input type="date" aria-label={t("끝 날짜")} value={custom[1]} min={custom[0]||undefined} onChange={e=>{change();setCustom([custom[0],e.target.value]);}}/></>}{range&&<output className="global-search-range">{(range[0]?monthDay(range[0]):"…")+" – "+(range[1]?monthDay(range[1]):"…")}{searched&&" · "+t("{count}개",{count:new Set(hits.map(h=>h.note.id)).size})}</output>}</fieldset><div className="global-search-filters">
<label>{t('태그 조건')}<select value={tag} onChange={e=>{change();setTag(e.target.value);}}><option value="">{t('모든 태그')}</option>{tag&&!tags.some(v=>v.name===tag)&&<option value={tag}>{tag}</option>}{tags.map(v=><option key={v.name} value={v.name}>{v.name}</option>)}</select></label>
<label>{t('노트북 조건')}<select value={notebook} onChange={e=>{change();setNotebook(e.target.value);}}><option value="">{t('모든 노트북')}</option>{notebook&&!notebooks.some(v=>v.id===notebook)&&<option value={notebook}>{t('찾을 수 없는 노트북')}</option>}{notebooks.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
</div><fieldset className="global-search-presets"><legend>{t('검색 조건 저장')}</legend>
<label>{t('저장한 검색 조건')}<select value={selected} onChange={e=>loadPreset(e.target.value)}><option value="">{t('검색 조건 선택')}</option>{saved.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
<label>{t('검색 조건 이름')}<input value={presetName} maxLength={80} onChange={e=>setPresetName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)savePreset();}}/></label>
<button className="btn" type="button" disabled={!presetName.trim()||!fullQuery} onClick={savePreset}>{saved.some(p=>p.name===presetName.trim())?t('검색 조건 갱신'):t('검색 조건 저장')}</button>
<button className="btn" type="button" disabled={!selected} onClick={()=>{if(persist(saved.filter(p=>p.id!==selected))){setSelected('');setPresetName('');setSavedMessage(t('저장한 검색 조건을 삭제했습니다.'));}}}>{t('검색 조건 삭제')}</button>
<output className="search-preset-status">{savedMessage||t('이 기기에만 저장됩니다.')}</output></fieldset>{loadCandidates&&<NoteAnswer question={query} loadCandidates={loadCandidates} loadText={loadText} onOpen={onOpen}/>}{error && <p role="alert" className="search-error">{error}</p>}<p>{t("조건: created:날짜, updated:날짜, title:, tag:, notebook:, type:, path:, line:시작-끝, block:ID, section:제목")}</p><p>{t("노트당 최대 200개, 전체 최대 5,000개 결과를 표시합니다.")}</p><p><output>{period==="all"?t("검색한 노트: {count}",{count:progress}):t("검색한 노트: {count} ({period})",{count:progress,period:period==="custom"?t("날짜 고르기"):t(PERIODS.find(p=>p.id===period)!.label)})}</output></p><ol className="global-search-results">{hits.map((h, i) => <li key={`${h.note.id}:${h.index}:${i}`}><button type="button" onClick={() => onOpen?.(h.note.id,undefined,h)}><strong>{h.note.title}</strong><small>{t("줄 {line}", {line:h.line})}</small><span>{h.snippet.slice(0,h.matchStart??0)}<mark>{h.snippet.slice(h.matchStart??0,(h.matchStart??0)+(h.matchLength??0))}</mark>{h.snippet.slice((h.matchStart??0)+(h.matchLength??0))}</span></button></li>)}</ol>{!busy && searched && !error && hits.length === 0 && <p className="search-empty">{t("검색 결과가 없습니다.")}</p>}</section>;
}
