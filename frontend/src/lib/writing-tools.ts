import {t} from "../i18n";
import type { Summary } from "../types";
import { noteAnchors } from "./note-anchor";

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function localTime(date = new Date()): string {
  return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}
/** Ordered subsequence matching handles Korean titles without language-specific tokenization. */
export function fuzzyScore(title: string, query: string): number {
  const text=title.normalize("NFKC").toLocaleLowerCase(), needle=query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!needle) return 0;
  const exact=text.indexOf(needle);
  if (exact>=0) return 10000-exact-text.length/1000;
  let pos=0, score=0, previous=-2;
  for (const char of needle) {
    const at=text.indexOf(char,pos);
    if (at<0) return -1;
    score+=at===previous+1?8:1;
    previous=at; pos=at+char.length;
  }
  return score-pos/1000;
}
export function rankNotes(notes: readonly Summary[], query: string, recent: readonly string[]): Summary[] {
  const order=new Map(recent.map((id,i)=>[id,i]));
  return notes.map(note=>({note,score:Math.max(fuzzyScore(note.title,query),...((note as Summary & {aliases?:string[]}).aliases??[]).map(alias=>fuzzyScore(alias,query)))})).filter(item=>item.score>=0)
    .sort((a,b)=>b.score-a.score || (order.get(a.note.id)??1000)-(order.get(b.note.id)??1000) || b.note.updated_at-a.note.updated_at)
    .map(item=>item.note);
}

/** Nearest same-level section without crossing an ancestor. */
export function headingSiblingIndex(headings:readonly {level:number}[],index:number,direction:"up"|"down"):number {
 const current=headings[index];if(!current)return -1;
 const step=direction==="up"?-1:1;
 for(let i=index+step;i>=0&&i<headings.length;i+=step){if(headings[i].level<=current.level)return headings[i].level===current.level?i:-1;}
 return -1;
}

/** Move adjacent sibling sections without crossing their parent boundary. */
export function reorderMarkdownHeading(content: string, headingIndex: number, direction: "up" | "down"): string | null {
  const bom=content.startsWith("\ufeff")?"\ufeff":"", source=content.slice(bom.length);
  const anchors=noteAnchors(source,"markdown").filter(a=>a.kind==="heading"), current=anchors[headingIndex];
  if(!current)return null;
  const boundary=(index:number)=>{for(let i=index+1;i<anchors.length;i++)if(anchors[i].level<=anchors[index].level)return i;return anchors.length;};
  const peer=headingSiblingIndex(anchors,headingIndex,direction);
  if(peer<0)return null;
  const left=Math.min(peer,headingIndex),right=Math.max(peer,headingIndex),end=boundary(right);
  const startOffset=anchors[left].sourceOffset,middle=anchors[right].sourceOffset,endOffset=anchors[end]?.sourceOffset??source.length;
  const first=source.slice(startOffset,middle),second=source.slice(middle,endOffset),eol=source.includes("\r\n")?"\r\n":"\n";
  // A final section without a newline must not swallow the following heading.
  // Setext headings also require separation from an adjacent paragraph.
  const required=/^ {0,3}#{1,6}(?:\s|$)/.test(first)?1:2;
  const trailing=(/(?:\r?\n)+$/.exec(second)?.[0].match(/\n/g)??[]).length;
  const separator=eol.repeat(Math.max(0,required-trailing));
  const next=source.slice(0,startOffset)+second+separator+first+source.slice(endOffset);
  const expected=[...anchors.slice(0,left),...anchors.slice(right,end),...anchors.slice(left,right),...anchors.slice(end)].map(a=>[a.text,a.level]);
  const actual=noteAnchors(next,"markdown").filter(a=>a.kind==="heading").map(a=>[a.text,a.level]);
  // Unclosed fences and other boundary-sensitive syntax must not hide headings.
  if(JSON.stringify(actual)!==JSON.stringify(expected))return null;
  return bom+next;
}

/** Strict lexical HTML outline. No DOM serialization: slices retain all source
 * spelling, whitespace, attributes, comments and embedded raw-text content. */
export function reorderHTMLHeading(content:string,headingIndex:number,direction:'up'|'down',expectedOffset?:number):string|null {
 const tokens=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<(\/?)([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi;
 const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 const stack:string[]=[],headings:{start:number;level:number}[]=[];let end=0,match:RegExpExecArray|null;
 while((match=tokens.exec(content))){
  if(content.slice(end,match.index).includes('<'))throw new Error(t('HTML 구조를 확인할 수 없어 목차 순서를 바꾸지 않았습니다.'));
  end=tokens.lastIndex;if(!match[3])continue;
  const tag=match[3].toLowerCase(),closing=match[2]==='/';
  if(closing){if(stack.pop()!==tag)throw new Error(t('HTML 구조를 확인할 수 없어 목차 순서를 바꾸지 않았습니다.'));continue;}
  if(/^h[1-6]$/.test(tag)){if(stack.length)throw new Error(t('중첩된 HTML 제목은 순서를 바꿀 수 없습니다. 제목을 문서 최상위로 옮겨 주세요.'));headings.push({start:match.index,level:Number(tag[1])});}
  if(!voids.has(tag)){if(/\/\s*>$/.test(match[0]))throw new Error(t('HTML 구조를 확인할 수 없어 목차 순서를 바꾸지 않았습니다.'));stack.push(tag);}
 }
 if(stack.length||content.slice(end).includes('<'))throw new Error(t('HTML 구조를 확인할 수 없어 목차 순서를 바꾸지 않았습니다.'));
 const current=headings[headingIndex];if(!current)return null;
 if(expectedOffset!==undefined&&current.start!==expectedOffset)throw new Error(t('HTML 구조를 확인할 수 없어 목차 순서를 바꾸지 않았습니다.'));
 const boundary=(index:number)=>{for(let i=index+1;i<headings.length;i++)if(headings[i].level<=headings[index].level)return i;return headings.length;};
 const currentEnd=boundary(headingIndex);let peer=-1;
 if(direction==='down'){if(currentEnd<headings.length&&headings[currentEnd].level===current.level)peer=currentEnd;}
 else{for(let i=headingIndex-1;i>=0;i--){if(headings[i].level<=current.level){if(headings[i].level===current.level)peer=i;break;}}}
 if(peer<0)return null;
 const left=direction==='up'?peer:headingIndex,right=direction==='up'?headingIndex:peer;
 const start=headings[left].start,middle=headings[right].start,finish=headings[boundary(right)]?.start??content.length;
 return content.slice(0,start)+content.slice(middle,finish)+content.slice(start,middle)+content.slice(finish);
}
