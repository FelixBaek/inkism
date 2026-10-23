import {sourcePosition,type SearchDocument} from './search-document-core';
import type {Summary} from '../types';
export type SearchHit={note:Summary;index:number;line:number;snippet:string;matchStart?:number;matchLength?:number;sourceOffset?:number;sourceEnd?:number;revision?:number;matchedText?:string;occurrence?:number};
export type SearchOptions={regex?:boolean;caseSensitive?:boolean};
export function escape(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,String.raw`\$&`);}
const DATE_ERROR='created:·updated: 조건은 2026-10-15, 2026-10 또는 2026-10-01..2026-10-15처럼 입력해 주세요.';
/** "2026-10-15" · "2026-10" · "2026" · "A..B"(한쪽 생략 가능) → 로컬 시각 [start,end) ms. */
export function dateRange(value:string):[number,number]{
 const bound=(text:string,end:boolean)=>{
  const m=/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text);if(!m)throw new Error(DATE_ERROR);
  const y=Number(m[1]),mo=m[2]?Number(m[2])-1:0,d=m[3]?Number(m[3]):1;
  const at=new Date(0);at.setFullYear(y,mo,d);at.setHours(0,0,0,0);if(at.getFullYear()!==y||at.getMonth()!==mo||at.getDate()!==d)throw new Error(DATE_ERROR);
  if(!end)return at.getTime();
  if(m[3])at.setDate(d+1);else if(m[2])at.setMonth(mo+1,1);else at.setFullYear(y+1,0,1);return at.getTime();
 };
 const parts=value.split('..');if(parts.length>2||(parts.length===2&&!parts[0]&&!parts[1]))throw new Error(DATE_ERROR);
 if(parts.length===1)return [bound(value,false),bound(value,true)];
 const range:[number,number]=[parts[0]?bound(parts[0],false):-Infinity,parts[1]?bound(parts[1],true):Infinity];
 if(range[0]>=range[1])throw new Error(DATE_ERROR);
 return range;
}
function quotedValue(value:string){try{return JSON.parse('"'+value+'"') as string;}catch{return value;}}
export function prepareSearch(query:string) {
 if(query.length>1000)throw new Error('검색어는 1,000자 이하로 입력해 주세요.');
 const filters:{name:string;value:string}[]=[];
 const term=query.replace(/(?:^|\s)(title|tag|notebook|type|path|line|block|section|created|updated):(?:"((?:\\.|[^"\\])*)"|(\S+))/gi,(_all,name,quoted,bare)=>{filters.push({name:name.toLowerCase(),value:(quoted===undefined?bare:quotedValue(quoted)).toLocaleLowerCase()});return ' ';}).trim();
 const bodyFilters=filters.filter(f=>['line','block','section'].includes(f.name));
 for(const f of bodyFilters)if(f.name==='line'&&!/^([1-9]\d*)(?:-([1-9]\d*))?$/.test(f.value))throw new Error('line: 조건은 줄 번호 또는 시작-끝 번호로 입력해 주세요.');
 const dates=filters.filter(f=>f.name==='created'||f.name==='updated').map(f=>({key:f.name==='created'?'created_at' as const:'updated_at' as const,range:dateRange(f.value)}));
 const inDates=(note:Summary)=>dates.every(({key,range})=>note[key]>=range[0]&&note[key]<range[1]);
 const matches=(note:Summary)=>!note.trashed && !('locked' in note && note.locked) && inDates(note) && filters.filter(f=>!bodyFilters.includes(f)&&f.name!=='created'&&f.name!=='updated').every(f=>f.name==='title'?note.title.toLocaleLowerCase().includes(f.value):f.name==='tag'?note.tags.some(t=>t.toLocaleLowerCase()===f.value):f.name==='path'?((note as Summary & {searchPaths?:string[]}).searchPaths??[]).some(path=>path.toLocaleLowerCase().includes(f.value)):f.name==='notebook'?(note.notebook_ids??[note.notebook_id]).some(id=>id?.toLowerCase()===f.value):(note.content_format??'html')===f.value);
 return {term,matches,bodyFilters};
}
export function searchText(notes:Summary[],textOf:(note:Summary)=>string|SearchDocument,query:string,options:SearchOptions={}):SearchHit[]{
 if(!query.trim())return [];
 const {term,matches:match,bodyFilters}=prepareSearch(query);
 const hits:SearchHit[]=[];const expression=term?new RegExp(options.regex?term:escape(term),options.caseSensitive?'g':'gi'):null;
 for(const note of notes){
  if(!match(note))continue;const body=textOf(note),doc=typeof body==='string'?undefined:body,text=typeof body==='string'?body:body.text;
  const lineOffsets=[0];const source=doc?.source??text;for(let i=0;i<source.length;i++)if(source[i]==='\n')lineOffsets.push(i+1);
  const lineAt=(offset:number)=>{let lo=0,hi=lineOffsets.length;while(lo<hi){const mid=(lo+hi)>>>1;if(lineOffsets[mid]<=offset)lo=mid+1;else hi=mid;}return lo;};
  const accepted=(offset:number,line:number)=>bodyFilters.every(f=>{
   if(f.name==='line'){const range=/^(\d+)(?:-(\d+))?$/.exec(f.value);if(!range)throw new Error('line: 조건은 줄 번호 또는 시작-끝 번호로 입력해 주세요.');return line>=Number(range[1])&&line<=Number(range[2]??range[1]);}
   if(!doc)return false;
   const anchors=doc.anchors.filter(a=>a.sourceOffset<=offset);
   if(f.name==='block'){const blocks=anchors.filter(a=>a.kind==='block');return blocks.some((a,index)=>(a.id?.toLowerCase()===f.value.replace(/^\^/,'')||String(index+1)===f.value)&&(a.sourceEnd===undefined||offset<a.sourceEnd));}
   // A heading's scope ends at the next same-or-higher-level heading.
   const stack:typeof doc.anchors=[];for(const a of anchors.filter(a=>a.kind==='heading')){while(stack.length&&stack.at(-1)!.level>=a.level)stack.pop();stack.push(a);}return stack.some(a=>a.text.toLocaleLowerCase().includes(f.value));
  });
  const add=(index:number,length:number)=>{const offset=doc?sourcePosition(doc,index):index,line=lineAt(offset);if(!accepted(offset,line))return false;
   const start=Math.max(0,index-70),end=Math.min(text.length,index+length+110),matchedText=text.slice(index,index+length);
   // Count non-overlapping preceding occurrences to navigate repeated matches exactly.
   let occurrence=0,at=0;if(matchedText)while(at<index){const next=text.indexOf(matchedText,at);if(next<0||next>=index)break;occurrence++;at=next+Math.max(1,matchedText.length);}
   hits.push({note,index,line,snippet:text.slice(start,end),matchStart:index-start,matchLength:length,sourceOffset:doc?offset:undefined,sourceEnd:doc?sourcePosition(doc,index+length,true):undefined,revision:doc?.revision,matchedText,occurrence});return true;
  };
  if(!expression){if(bodyFilters.length){for(let index=0;index<text.length;index++){if(index===0||text[index-1]==='\n')add(index,0);if(hits.length>=5000)return hits;}}else add(0,0);if(hits.length>=5000)return hits;continue;}
  if(doc&&!bodyFilters.length){expression.lastIndex=0;const titleMatch=expression.exec(note.title);if(titleMatch)hits.push({note,index:titleMatch.index,line:1,snippet:note.title,matchStart:titleMatch.index,matchLength:titleMatch[0].length});if(hits.length>=5000)return hits;}
  expression.lastIndex=0;let found:RegExpExecArray|null,count=0;
  while(count<200&&(found=expression.exec(text))){if(add(found.index,found[0].length))count++;if(hits.length>=5000)return hits;if(!found[0])expression.lastIndex++;}
 }return hits;
}
