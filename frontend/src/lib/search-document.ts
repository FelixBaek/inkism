import {noteAnchors} from './note-anchor';
import type {SearchDocument} from './search-document-core';
export type {SearchDocument} from './search-document-core';
/** Search projection only: canonical bytes are never parsed back or saved. */
export function searchDocument(source:string,format:string,revision:number):SearchDocument {
 const segments:SearchDocument['segments']=[];const ends=new Map<number,number>();let text='';
 const append=(value:string,start:number,end:number)=>{if(!value)return;segments.push({start:text.length,end:text.length+value.length,sourceStart:start,sourceEnd:end});text+=value;};
 if(format!=='html')append(source,0,source.length);
 else {
  const tokens=/<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi;
  const decoder=document.createElement('textarea');const stack:{tag:string;start:number}[]=[];let at=0,m:RegExpExecArray|null;
  while((m=tokens.exec(source))){append(source.slice(at,m.index),at,m.index);const token=m[0];const tag=/^<(\/?)([a-z][\w:-]*)\b/i.exec(token);
   if(tag){const name=tag[2].toLowerCase();if(tag[1]){let index=stack.length-1;while(index>=0&&stack[index].tag!==name)index--;if(index>=0){for(const entry of stack.splice(index))ends.set(entry.start,tokens.lastIndex);}}else if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)&&!token.endsWith('/>')&&!/^<(script|style|textarea|title)\b/i.test(token))stack.push({tag:name,start:m.index});else ends.set(m.index,tokens.lastIndex);}
   if(token.startsWith('&')){decoder.innerHTML=token;append(decoder.value,m.index,tokens.lastIndex);}else if(/^<\/?(?:p|div|h[1-6]|li|br|tr|pre|blockquote|section|article)\b/i.test(token))append('\n',m.index,tokens.lastIndex);at=tokens.lastIndex;}
  append(source.slice(at),at,source.length);
 }
 return {text,source,revision,segments,anchors:noteAnchors(source,format).map(anchor=>{
   if(anchor.kind!=='block')return anchor;
   if(format==='html')return {...anchor,sourceEnd:ends.get(anchor.sourceOffset)??source.length};
   if(format==='markdown'){const end=source.indexOf('\n',anchor.sourceOffset);return {...anchor,sourceEnd:end<0?source.length:end};}return anchor;
 })};
}
