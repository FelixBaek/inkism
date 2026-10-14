import type {Note} from "../types";
import {t} from "../i18n";
import {noteAnchors,resolveNoteAnchor} from "./note-anchor";
import {sanitizeRichHtml} from "./sanitize";
import {markdownToHTML} from "./markdown";
const escape=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
export function referenceHTML(note:Note,anchor:string):string {
  let source=note.content;const format=note.content_format??'html';
  if(new TextEncoder().encode(source).length>2*1024*1024)throw new Error(t('참조 미리보기는 2MB 이하 노트에서 사용할 수 있습니다.'));
  if(anchor) {
    const anchors=noteAnchors(source,format),name=decodeURIComponent(anchor).replace(/^\^/,'');
    const found=anchors.find(a=>a.id===name)||anchors.find(a=>a.kind==='heading'&&(a.text===name||a.text.toLowerCase().replace(/\s+/g,'-')===name.toLowerCase()));
    if(!found)throw new Error(t('연결된 제목이나 문단을 찾지 못했습니다.'));
    if(found.kind==='heading'){
      const next=anchors.find(a=>a.kind==='heading'&&a.sourceOffset>found.sourceOffset&&a.level<=found.level);
      source=source.slice(found.sourceOffset,next?.sourceOffset);
    }else if(format==='html'){
      const el=document.createElement('template');el.innerHTML=sanitizeRichHtml(source);
      source=Array.from(el.content.querySelectorAll('[id]')).find(n=>n.id===name)?.outerHTML??'';
    }else{
      let start=0,end=source.length;const blanks=/\r?\n[\t ]*\r?\n/g;let match:RegExpExecArray|null;
      while((match=blanks.exec(source))){if(match.index+match[0].length<=found.sourceOffset)start=match.index+match[0].length;else if(match.index>=found.sourceOffset){end=match.index;break;}}
      source=source.slice(start,end);
    }
  }
  return format==='html'?sanitizeRichHtml(source):format==='markdown'?markdownToHTML(source).content:`<pre>${escape(source)}</pre>`;
}


export async function referenceHTMLResolved(note:Note,anchor:string,redirectSources:string[]=[]):Promise<string>{
 if(!anchor)return referenceHTML(note,anchor);
 const found=await resolveNoteAnchor(note,decodeURIComponent(anchor),redirectSources);
 if(!found)throw new Error(t('연결된 제목이나 문단을 찾지 못했습니다.'));
 return referenceHTML(note,encodeURIComponent(found.id?`^${found.id}`:found.text));
}
