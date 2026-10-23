import {prepareSearch} from './global-search-core';
export type Period = "all" | "today" | "week" | "month" | "last-month" | "custom";
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

export type SearchConditions={query:string;regex:boolean;period:Period;custom:[string,string];tag:string;notebook:string};
export type SearchPreset=SearchConditions&{id:string;name:string};
export const SEARCH_PRESETS_KEY='inkism.search.presets.v1';
export function searchQuery(value:SearchConditions,now=new Date()){
 const range=periodRange(value.period,value.custom,now);
 return [value.query,range?`updated:${range[0]}..${range[1]}`:'',value.tag?'tag:'+JSON.stringify(value.tag):'',value.notebook?'notebook:'+JSON.stringify(value.notebook):''].filter(Boolean).join(' ').trim();
}
export function readSearchPresets(raw:string|null):SearchPreset[]{
 try{
  const data:unknown=JSON.parse(raw??'[]');if(!Array.isArray(data))return [];
  const seen=new Set<string>();
  return data.filter((v):v is SearchPreset=>{
   if(!v||typeof v!=='object'||typeof v.id!=='string'||!v.id||seen.has(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>80||typeof v.query!=='string'||v.query.length>1000||typeof v.regex!=='boolean'||!['all','today','week','month','last-month','custom'].includes(v.period)||!Array.isArray(v.custom)||v.custom.length!==2||!v.custom.every((d:unknown)=>typeof d==='string'&&(!d||/^\d{4}-\d{2}-\d{2}$/.test(d)))||typeof v.tag!=='string'||typeof v.notebook!=='string')return false;
   try{prepareSearch(searchQuery(v));}catch{return false;}
   seen.add(v.id);return true;
  }).slice(0,20);
 }catch{return [];}
}
