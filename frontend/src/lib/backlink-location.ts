import type {Note} from '../types';
import {hasRpcDiagnostic} from '../api';
import {parseReference} from './knowledge';
import {markdownToHTML} from './markdown';
import {sourcePosition} from './search-document-core';
import {searchDocument} from './search-document';
import type {NoteAnchor} from './note-anchor';
export type BacklinkLocation={revision:number;context:string;anchor:NoteAnchor};
const text=(html:string)=>{const el=document.createElement('template');el.innerHTML=html;return el.content.textContent??'';};
/** Find a real link while retaining canonical UTF-16 offsets. Never save a projection. */
export function backlinkLocation(note:Note,target:string,names:string[]):BacklinkLocation|undefined{
 const source=note.content,html=(note.content_format??'html')==='html';
 const masked=html?source.replace(/<!--[\s\S]*?-->|<(pre|code|script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,m=>' '.repeat(m.length)):
 source.replace(/(?:^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$))|(?:`+[^`\n]*`+)/gm,m=>' '.repeat(m.length));
 const matches=(value:string)=>{const ref=parseReference(value);return ref.target===target||names.some(n=>n.toLocaleLowerCase()===ref.target.toLocaleLowerCase());};
 const pattern=html?/<a\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/a\s*>|!?\[\[[^\]\n]+\]\]/gi:/!?\[\[[^\]\n]+\]\]|\[([^\]\n]+)\]\((note:\/\/[^\s)]+)\)/g;
 let found:RegExpExecArray|null;
 while((found=pattern.exec(masked))){let label='',at=found.index;
  if(html&&found[0].startsWith('<')){const el=document.createElement('template');el.innerHTML=found[0];const a=el.content.querySelector('a');if(!a||!matches(a.getAttribute('href')??''))continue;label=a.textContent??'';at+=found[0].indexOf('>')+1;}
  else if(found[0].includes('[[')){const value=found[0].replace(/^!?\[\[|\]\]$/g,'');if(!matches(value))continue;const bar=value.indexOf('|');label=bar>=0?value.slice(bar+1):value;at+=found[0].indexOf('[[')+2+(bar>=0?bar+1:0);}
  else {if(!matches(found[2]))continue;label=found[1];at++;}
  if(!label)continue;
  const projection=html?searchDocument(source,'html',note.revision):undefined;
  const plain=projection?projection.text:text(markdownToHTML(source).content);
  const prefix=html?searchDocument(source.slice(0,at),'html',note.revision).text:text(markdownToHTML(source.slice(0,at)).content);
  let occurrence=0,offset=0;while((offset=prefix.indexOf(label,offset))>=0){occurrence++;offset+=label.length;}
  const matchAt=plain.indexOf(label,Math.max(0,prefix.length-2));
  return {revision:note.revision,context:plain.slice(Math.max(0,matchAt-90),Math.max(0,matchAt)+label.length+190).replace(/\s+/g,' ').trim(),anchor:{kind:'block',text:label,level:0,index:0,sourceOffset:projection&&matchAt>=0?sourcePosition(projection,matchAt):at,sourceEnd:projection&&matchAt>=0?sourcePosition(projection,matchAt+label.length,true):at+label.length,searchText:label,searchOccurrence:occurrence}};
 }
}

/** Large HTML uses at most sixteen 64 KiB indexed blocks per RPC. */
export async function readBacklinkLocation(id:string,target:string,names:string[],signal:AbortSignal):Promise<BacklinkLocation|undefined>{
 const {rpc}=await import('../api');
 try{const note=await rpc<Note>('get',{id,max_body_bytes:2*1024*1024},{signal});if(('locked'in note&&note.locked)||note.trashed)return;return backlinkLocation(note,target,names);}
 catch(error){if(signal.aborted||!hasRpcDiagnostic(error,'body_read_budget'))throw error;}
 const info=await rpc<import('../types').DocumentInfo>('document_info',{id},{signal});
 if(('locked'in info.summary&&info.summary.locked)||info.summary.trashed)return;
 if(info.summary.content_format==='markdown'){const result=await rpc<{ready:boolean;item:{byte_offset:number;byte_end:number;label:string}|null}>('backlink_location',{id,target,revision:info.revision},{signal});if(!result.ready||!result.item)return;const item=result.item;return {revision:info.revision,context:item.label,anchor:{kind:'block',text:item.label,index:0,level:0,sourceOffset:0,byteOffset:item.byte_offset,byteEnd:item.byte_end,searchText:item.label}};}
 if((info.summary.content_format??'html')!=='html')return;
 let after:number|undefined;
 do{const result=await rpc<{ready:boolean;items:{ordinal:number;byte_offset:number;html:string|null}[];next:number|null}>('backlink_blocks',{id,target,revision:info.revision,...(after===undefined?{}:{after})},{signal});if(!result.ready)return;
  for(const block of result.items){
   const locate=(source:string,byte:number,prefix='',suffix='')=>{const location=backlinkLocation({...info.summary,content:prefix+source+suffix,text:''},target,names);if(!location)return;const from=location.anchor.sourceOffset-prefix.length,to=(location.anchor.sourceEnd??location.anchor.sourceOffset)-prefix.length;if(from<0||from>=source.length||to>source.length)return;
    location.anchor.byteOffset=byte+new TextEncoder().encode(source.slice(0,from)).length;location.anchor.byteEnd=byte+new TextEncoder().encode(source.slice(0,to)).length;return location;};
   if(block.html!==null){const location=locate(block.html,block.byte_offset);if(location)return location;continue;}
   let offset:number|undefined=0;
   while(offset!==undefined&&!signal.aborted){const page:import('../types').DocumentSegmentPage=await rpc<import('../types').DocumentSegmentPage>('document_segments',{id,revision:info.revision,ordinal:block.ordinal,offset,limit:1},{signal});if(!page.ready||page.supported===false)break;
    for(const segment of page.segments){if([...segment.start_context,...segment.end_context].some(a=>a.tag==='a'))continue;const prefix=segment.start_context.map(a=>a.open).join(''),suffix=[...segment.end_context].reverse().map(a=>`</${a.tag}>`).join('');const location=locate(segment.source,segment.byte_offset,prefix,suffix);if(location)return location;}
    offset=page.next_offset??undefined;
   }
  }after=result.next??undefined;
 }while(after!==undefined&&!signal.aborted);
}

type LocationOpener={selectNote:(id:string)=>Promise<void>;readDraft:()=>{id:string;revision:number;content:string;text:string}|null};
/** Opens `id` at a located link; `active` stops when the caller moved on meanwhile. */
export async function openBacklinkLocation(s:LocationOpener,id:string,location:BacklinkLocation,active:()=>boolean=()=>true){
 const [{api},{t},{waitForAnchorEditor,navigateNoteAnchor}]=await Promise.all([import('../api'),import('../i18n'),import('./note-anchor')]);
 const note=location.anchor.byteOffset===undefined?await api.get(id,{max_body_bytes:2*1024*1024}):await api.documentInfo(id,location.revision).then(info=>({...info.summary,content:'',text:''}));
 if(!active())return;
 if(('locked'in note&&note.locked)||note.trashed||note.revision!==location.revision)throw new Error(t('문서가 변경되었습니다. 다시 시도해 주세요.'));
 await s.selectNote(id);
 await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 if(location.anchor.byteOffset!==undefined)await waitForAnchorEditor();
 const draft=s.readDraft();
 const located=note.content_format==='markdown'&&draft?.id===id&&draft.revision===note.revision?{...note,content:draft.content,text:draft.text}:note;
 await navigateNoteAnchor(located,location.anchor);
}
