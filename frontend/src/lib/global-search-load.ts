import type {SearchDocument} from './search-document-core';
import type { Summary } from '../types';
import { prepareSearch } from './global-search-core';
/** Filter metadata before I/O; retain input ordering regardless of completion order. */
export async function loadSearchTexts(notes: Summary[], query: string, load: (note: Summary, signal?: AbortSignal) => Promise<string|SearchDocument>, options: {signal?: AbortSignal; concurrency?: number; maxBytes?: number} = {}) {
 const {signal, maxBytes=64*1024*1024}=options;
 const concurrency=Math.max(1,Math.min(8,options.concurrency??4));
 const {term,matches,bodyFilters}=prepareSearch(query);
 const selected=notes.filter(matches);
 const texts:Record<string,string|SearchDocument>=Object.create(null);
 let cursor=0,bytes=0,failed=false;
 const check=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
 check();
 if(!term&&!bodyFilters.length)return {notes:selected,texts}; // Metadata-only searches need no body reads.
 await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},async()=>{
  while(!failed){check();const index=cursor++;if(index>=selected.length)return;const note=selected[index];
   try{const body=await load(note,signal);check();if(failed)return;
    const text=typeof body==='string'?note.title+'\n'+body:body;bytes+=new TextEncoder().encode(typeof text==='string'?text:text.source).length;
    if(bytes>maxBytes)throw new Error('검색 본문이 64 MiB를 넘었습니다. 기본 노트 검색을 이용해 주세요.');
    texts[note.id]=text;
   }catch(error){failed=true;throw error;}
  }
 }));
 check();return {notes:selected,texts};
}

/** Release bodies after each page; candidate count has no hard cap. */
export async function searchPages(
 page:(cursor:string|undefined,signal:AbortSignal)=>Promise<{items:Summary[];next_cursor:string|null}>,
 query:string,load:(note:Summary,signal?:AbortSignal)=>Promise<string|SearchDocument>,
 search:(notes:Summary[],texts:Record<string,string|SearchDocument>)=>Promise<import('./global-search-core').SearchHit[]>,
 options:{signal:AbortSignal;onProgress:(count:number,hits:import('./global-search-core').SearchHit[])=>void}
){
 const {signal,onProgress}=options;let cursor:string|undefined,count=0;
 const hits:import('./global-search-core').SearchHit[]=[];
 const check=()=>{if(signal.aborted)throw new DOMException('Aborted','AbortError');};
 do{check();const batch=await page(cursor,signal);check();
  const loaded=await loadSearchTexts(batch.items,query,load,{signal,concurrency:4});check();
  const found=await search(loaded.notes,loaded.texts);check();hits.push(...found.slice(0,5000-hits.length));
  count+=batch.items.length;onProgress(count,hits);
  if(hits.length>=5000)break;
  if(batch.next_cursor===cursor)throw new Error('검색 페이지를 불러오지 못했습니다.');
  cursor=batch.next_cursor??undefined;
 }while(cursor);
 return hits;
}
