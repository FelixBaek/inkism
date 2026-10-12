import type {SearchDocument} from './search-document-core';
import { t } from "../i18n";
import type {Summary} from '../types';
import {searchText,type SearchOptions,type SearchHit} from './global-search-core';
export {searchText,escape} from './global-search-core';export type {SearchHit,SearchOptions} from './global-search-core';
export function searchInWorker(notes:Summary[],texts:Record<string,string|SearchDocument>,query:string,options:SearchOptions={},timeoutMs=1500,signal?:AbortSignal):Promise<SearchHit[]>{
 if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
 if(typeof Worker==='undefined'){if(options.regex)return Promise.reject(new Error(t("이 환경에서는 정규식 검색을 사용할 수 없습니다.")));return Promise.resolve(searchText(notes,n=>texts[n.id]??n.preview,query,options));}
 const worker=new Worker(new URL('../workers/global-search.worker.ts',import.meta.url),{type:'module'});
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();};
  const abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};
  const timer=setTimeout(()=>{cleanup();reject(new Error(t("검색 시간이 초과되었습니다.")));},timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=e=>{cleanup();e.data.ok?resolve(e.data.result):reject(new Error(e.data.error));};
  worker.onerror=()=>{cleanup();reject(new Error(t("검색을 실행하지 못했습니다.")));};
  try{worker.postMessage({notes,texts,query,options});}catch(error){cleanup();reject(error);}
 });
}
