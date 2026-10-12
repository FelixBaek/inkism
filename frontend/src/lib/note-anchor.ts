import type { Note } from "../types";
import { knowledge } from "./knowledge";
import { api } from "../api";
import { t } from "../i18n";
export interface NoteAnchor { kind:"heading"|"block"; text:string; level:number; index:number; sourceOffset:number; sourceEnd?:number; byteOffset?:number; byteEnd?:number; searchText?:string; searchOccurrence?:number; id?:string }
export const ANCHOR_EVENT="inkism-navigate-anchor";
export interface AnchorRequest { note:Note; anchor:NoteAnchor; ordinal?:number; accept:(work:Promise<void>|void)=>void }
const textOf=(html:string)=> {const el=document.createElement("template");el.innerHTML=html;return (el.content.textContent??"").trim();};
/** Original source offsets are retained; no canonical source is normalized. */
export function noteAnchors(content:string, format:string="html"):NoteAnchor[] {
  const result:NoteAnchor[]=[];
  if (format==="html") {
    // Consume comments and raw-text elements before looking for real tags.
    const tags=/<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi;
    let match:RegExpExecArray|null, heading=0;
    while ((match=tags.exec(content))) {
      if (!match[2]) continue;
      const tag=match[2].toLowerCase(), node=document.createElement("template"); node.innerHTML=match[0];
      const el=node.content.firstElementChild;
      if (!el) continue;
      const end=content.slice(tags.lastIndex).search(new RegExp(`</${tag}\\s*>`,"i"));
      const raw=end<0?"":content.slice(tags.lastIndex,tags.lastIndex+end);
      if (/^h[1-6]$/.test(tag)) result.push({kind:"heading",text:textOf(raw),level:Number(tag[1]),index:heading++,sourceOffset:match.index,id:el.id||undefined});
      if (el.id) result.push({kind:"block",text:textOf(raw).slice(0,160)||el.id,level:0,index:result.length,sourceOffset:match.index,id:el.id});
    }
  } else if (format==="markdown") {
    let offset=0, fence="", fenceLength=0, index=0;
    const lines=content.split(/(?<=\n)/);
    for(let n=0;n<lines.length;n++) {
      const line=lines[n].replace(/[\r\n]+$/, ""), candidate=line.replace(/^\uFEFF/, ""), f=/^ {0,3}(`{3,}|~{3,})/.exec(candidate);
      if(f) {if(!fence){fence=f[1][0];fenceLength=f[1].length;}else if(f[1][0]===fence&&f[1].length>=fenceLength&&/^\s*$/.test(candidate.slice(f[0].length)))fence="";offset+=lines[n].length;continue;}
      if(!fence&&!/^(?: {4}|\t)/.test(candidate)) {
        const atx=/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(candidate);
        const setext=n+1<lines.length&&candidate.trim()&&/^ {0,3}(=+|-+)\s*$/.exec(lines[n+1].trimEnd());
        if(atx||setext) result.push({kind:"heading",text:(atx?atx[2]:candidate.trim()).replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g,"$1").replace(/[*_`]/g,""),level:atx?atx[1].length:(setext as RegExpExecArray)[1][0]==="="?1:2,index:index++,sourceOffset:offset});
        const block=/(?:^|\s)\^([\w-]+)\s*$/.exec(candidate);
        if(block)result.push({kind:"block",text:candidate.slice(0,block.index).trim(),level:0,index:result.length,sourceOffset:offset,id:block[1]});
      }
      offset+=lines[n].length;
    }
  }
  return result;
}
/** Resolve only explicit repairs, always preferring an original anchor restored later. */
export async function resolveNoteAnchorTarget(note:Note,target:string,redirectSources:string[]=[]):Promise<{anchor?:NoteAnchor;fragment:string}>{
  const anchors=noteAnchors(note.content,note.content_format??"html");
  const find=(fragment:string)=>anchors.find(a=>a.id===fragment.replace(/^\^/,""))??anchors.find(a=>a.kind==='heading'&&(a.text===fragment||a.text.toLowerCase().replace(/\s+/g,'-')===fragment.toLowerCase()));
  let fragment=target.replace(/^#/,"");const original=find(fragment);if(original&&!redirectSources.length)return {anchor:original,fragment};
  // Preserve each merged source's namespace; never combine maps with the target.
  for(const sourceId of redirectSources.slice(0,32)){
    const source=await api.get(sourceId);if(('locked'in source&&source.locked)||new TextEncoder().encode(source.content).length>8*1024*1024)continue;
    const sourceAnchors=noteAnchors(source.content,source.content_format??'html');
    const sourceFind=(value:string)=>sourceAnchors.find(a=>a.id===value.replace(/^\^/,''))??sourceAnchors.find(a=>a.kind==='heading'&&(a.text===value||a.text.toLowerCase().replace(/\s+/g,'-')===value.toLowerCase()));
    if(sourceFind(fragment))continue;
    const map=(await knowledge.get(sourceId)).anchor_redirects??{};const visited=new Set<string>();
    for(let depth=0;depth<16;depth++){if(visited.has(fragment))break;visited.add(fragment);const next=Object.prototype.hasOwnProperty.call(map,fragment)?map[fragment]:undefined;if(typeof next!=='string'||!next)break;fragment=next;if(sourceFind(fragment))break;}
  }
  const afterMerge=find(fragment);if(afterMerge)return {anchor:afterMerge,fragment};
  const metadata=await knowledge.get(note.id),redirects=metadata.anchor_redirects??{};const seen=new Set<string>();
  for(let depth=0;depth<16;depth++){if(seen.has(fragment))return {fragment};seen.add(fragment);const next=Object.prototype.hasOwnProperty.call(redirects,fragment)?redirects[fragment]:undefined;if(typeof next!=='string'||!next)return {fragment};fragment=next;const found=find(fragment);if(found)return {anchor:found,fragment};}
  return {fragment};
}
export async function resolveNoteAnchor(note:Note,target:string,redirectSources:string[]=[]):Promise<NoteAnchor|undefined>{return (await resolveNoteAnchorTarget(note,target,redirectSources)).anchor;}
/** Repair the final namespace reached by source and target redirect chains. */
export async function requestResolvedAnchorRepair(note:Note,target:string,redirectSources:string[]=[]):Promise<void>{const resolved=await resolveNoteAnchorTarget(note,target,redirectSources);requestAnchorRepair(note.id,resolved.fragment);}
export const ANCHOR_REPAIR_EVENT='inkism-repair-anchor';
export function requestAnchorRepair(noteId:string,anchor:string){window.dispatchEvent(new CustomEvent(ANCHOR_REPAIR_EVENT,{detail:{noteId,anchor}}));}
export async function navigateNoteAnchor(note:Note, target:NoteAnchor|string,redirectSources:string[]=[]):Promise<void> {
  const resolved=typeof target==='string'?await resolveNoteAnchorTarget(note,target,redirectSources):{anchor:target,fragment:''};
  let anchor=resolved.anchor;
  if(anchor?.byteOffset!==undefined&&note.content){
    const offset=sourceOffsetForByte(note.content,anchor.byteOffset),end=anchor.byteEnd===undefined?undefined:sourceOffsetForByte(note.content,anchor.byteEnd);
    // Markdown visual occurrence needs the Markdown renderer, which belongs to
    // the editor that displays it (RichEditor); SourceEditor uses byte offsets.
    const occurrence=(note.content_format??'html')==='html'&&anchor.searchText?textOccurrence(textOf(note.content.slice(0,offset)),anchor.searchText):undefined;
    anchor={...anchor,sourceOffset:offset,sourceEnd:end,searchOccurrence:occurrence};
  }
  if(!anchor){if(typeof target==='string'){requestAnchorRepair(note.id,resolved.fragment);return;}throw new Error(t("연결된 제목이나 문단을 찾지 못했습니다."));}
  let accepted:Promise<void>|undefined;
  const request:AnchorRequest={note,anchor,accept(work){accepted=Promise.resolve(work);}};
  window.dispatchEvent(new CustomEvent(ANCHOR_EVENT,{detail:request}));
  if(accepted)return accepted;
  // A windowed editor may need its containing canonical block loaded first.
  if((note.content_format??"html")==="html"&&document.querySelector(".windowed-editor")) {
    const located=await api.documentLocate(note.id,note.revision,anchor.byteOffset??new TextEncoder().encode(note.content.slice(0,anchor.sourceOffset)).length);
    if(located.ready){request.ordinal=located.ordinal;window.dispatchEvent(new CustomEvent(ANCHOR_EVENT,{detail:request}));if(accepted)return accepted;}
  }
  throw new Error(t("현재 편집 화면에서 해당 위치로 이동하지 못했습니다."));
}

/** Count non-overlapping occurrences of `search` in visual `text`. */
export function textOccurrence(text:string,search:string):number {let occurrence=0,at=0;if(search)while((at=text.indexOf(search,at))>=0){occurrence++;at+=search.length;}return occurrence;}
export function sourceOffsetForByte(source:string,byte:number):number {let offset=0,size=0;while(offset<source.length&&size<byte){const cp=source.codePointAt(offset)!;size+=cp<128?1:cp<2048?2:cp<65536?3:4;offset+=cp>65535?2:1;}return offset;}
