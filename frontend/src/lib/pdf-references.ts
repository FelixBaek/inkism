import { t } from "../i18n";
export type PdfPageLink={label:string;page:number;url:string};
export type Footnote={id:string;marker:string;text:string;line:number;from?:number;to?:number};
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function pageUrl(url:string,page:number){const u=new URL(url,location.href);if(!['https:','http:'].includes(u.protocol)&&!(u.protocol==='tauri:'&&u.protocol===location.protocol&&u.host===location.host))throw new Error(t("안전한 웹 주소나 앱 첨부파일을 입력해 주세요."));if(u.username||u.password||!Number.isSafeInteger(page)||page<1||page>1000000)throw new Error(t("PDF 주소와 페이지 번호를 확인해 주세요."));u.hash=`page=${page}`;return u.toString();}
export function extractPdfPageLinks(source:string):PdfPageLink[]{const out:PdfPageLink[]=[];for(const m of source.matchAll(/\[([^\]]+)\]\(([^)\s]+#page=(\d+)[^)]*)\)/gi)){try{out.push({label:m[1],page:Number(m[3]),url:pageUrl(m[2],Number(m[3]))});}catch{}}for(const m of source.matchAll(/<a\b[^>]*href=["']([^"']+#page=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{out.push({label:m[3].replace(/<[^>]+>/g,''),page:Number(m[2]),url:pageUrl(m[1].replaceAll('&amp;','&'),Number(m[2]))});}catch{}}return out;}
/** Exact closing token, including nested same-tag elements. Quoted attributes,
 * comments and raw text cannot supply a closing tag for the definition. */
const TAG_PART=/"[^"]*"|'[^']*'|[^'">]/.source;
const HTML_TOKEN=[
 /<!--[\s\S]*?(?:-->|$)/.source, // comment, possibly unterminated
 String.raw`<(script|style|textarea|title|pre|code)\b(?:${TAG_PART})*?>[\s\S]*?(?:<\/\1\s*>|$)`, // raw text element
 String.raw`<\/?([a-z][a-z0-9]*)\b(?:${TAG_PART})*?>`, // complete tag
 String.raw`<\/?([a-z][a-z0-9]*)\b(?:${TAG_PART})*(?:"[^"]*|'[^']*|$)`, // unterminated tag
].join('|');
function htmlTokens(){
 return new RegExp(HTML_TOKEN,'gi');
}
/** Consume complete attributes, so an id/href/value inside another quoted
 * attribute can never become a source edit target. Keep their exact spans. */
const HTML_ATTRIBUTE_VALUE=/"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)/.source;
const HTML_ATTRIBUTE=new RegExp(String.raw`^(\s+)([^\s"'<>/=]+)(?:\s*=\s*(?:${HTML_ATTRIBUTE_VALUE}))?`);
function htmlAttributes(opening:string){
 const tag=/^<[a-z][a-z0-9]*\b/i.exec(opening);if(!tag)return undefined;
 const attributes:{name:string;value:string;from:number;to:number}[]=[];let offset=tag[0].length;
 while(offset<opening.length){
  const rest=opening.slice(offset);if(/^\s*\/?>$/.test(rest))return attributes;
  const attr=HTML_ATTRIBUTE.exec(rest);
  if(!attr)return undefined;
  attributes.push({name:attr[2].toLowerCase(),value:attr[3]??attr[4]??attr[5]??'',from:offset,to:offset+attr[0].length});offset+=attr[0].length;
 }
 return undefined;
}
function htmlAttribute(opening:string,name:string){
 const matches=htmlAttributes(opening)?.filter(attribute=>attribute.name===name);
 return matches?.length===1?matches[0]:undefined;
}
function elementEnd(source:string,contentStart:number,tag:string){
 const tokens=htmlTokens();
 tokens.lastIndex=contentStart;let depth=1,token:RegExpExecArray|null;
 while((token=tokens.exec(source))){
  if(token[2]?.toLowerCase()!==tag.toLowerCase())continue;
  if(token[0].startsWith('</')){if(--depth===0)return {from:token.index,to:tokens.lastIndex};}
  else if(tag.toLowerCase()==='a'||tag.toLowerCase()==='p'||(!token[0].endsWith('/>')&&++depth>128))return undefined;
 }
 return undefined;
}
function htmlReferenceLabels(source:string){
 const labels=new Map<string,Set<string>>();
 for(const ref of footnoteReferences(source,'html')){
  const values=labels.get(ref.id)??new Set<string>();values.add(ref.text);labels.set(ref.id,values);
 }
 return labels;
}
/** App paragraph definitions put their own identifier in a leading sup.
 * After renumbering it matches a real reference label instead. A list's value
 * supplies its number; superscripts inside its body are ordinary content. */
function paragraphMarker(body:string,id:string,labels:Map<string,Set<string>>){
 const marker=/^\s*<sup\b(?:"[^"]*"|'[^']*'|[^'">])*?>([^<]*)<\/sup\s*>/i.exec(body);
 if(!marker)return '';
 const template=document.createElement('template');template.innerHTML=marker[0];
 const sup=template.content.querySelector('sup')!,text=(sup.textContent??'').trim();
 return 'inkFootnote' in sup.dataset||text===id||labels.get(id)?.has(text)?marker[0]:'';
}
export function extractFootnotes(source:string,format='markdown'):Footnote[]{
 const result:Footnote[]=[];
 if(format==='html'){
  const labels=htmlReferenceLabels(source);
  for(const m of source.matchAll(htmlTokens())){
   if(!/^(p|li)$/i.test(m[2]??'')||m[0].startsWith('</'))continue;
   const attr=/^fn[-:]?([\w-]+)$/i.exec(htmlAttribute(m[0],'id')?.value??'');if(!attr)continue;
   const start=m.index!,contentStart=start+m[0].length;
   const end=elementEnd(source,contentStart,m[2]);if(!end)continue;
   const body=source.slice(contentStart,end.from),label=m[2].toLowerCase()==='p'?paragraphMarker(body,attr[1],labels):'';
   const template=document.createElement('template');template.innerHTML=body.slice(label.length);
   template.content.querySelectorAll('a[href^="#fnref"], .footnote-backref').forEach(el=>el.remove());
   template.content.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));
   result.push({id:attr[1],marker:attr[1],text:(template.content.textContent??'').trim(),line:source.slice(0,start).split('\n').length,from:start,to:end.to});
  }
  return result;
 }
 const prose=markdownProse(source);
 const lines=source.split(/(?<=\n)/),offsets:number[]=[];let offset=0,fence='';
 for(const line of lines){offsets.push(offset);offset+=line.length;}
 for(let i=0,consumed=-1;i<lines.length;i++){
  if(i<=consumed)continue;
  const trimmed=lines[i].replace(/[\r\n]+$/,'');
  const boundary=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if(boundary){if(!fence)fence=boundary[1];else if(boundary[1].startsWith(fence[0])&&boundary[1].length>=fence.length&&!boundary[2].trim())fence='';continue;}
  if(fence)continue;
  const match=/^ {0,3}\[\^([\w-]+)\]:[ \t]*(.*)$/.exec(trimmed);if(!match||!prose.slice(offsets[i],offsets[i]+trimmed.length).includes('[^'+match[1]+']:'))continue;
  const first=i,body=[match[2]];let last=i;
  while(last+1<lines.length){
   let next=last+1;const blanks:string[]=[];
   while(next<lines.length&&!lines[next].trim()){blanks.push('');next++;}
   const continuation=next<lines.length?/^(?: {4}|\t)(.*)$/.exec(lines[next].replace(/[\r\n]+$/,'')):null;
   if(!continuation)break;
   body.push(...blanks,continuation[1]);last=next;
  }
  result.push({id:match[1],marker:`[^${match[1]}]`,text:body.join('\n'),line:first+1,from:offsets[first],to:offsets[last]+lines[last].replace(/[\r\n]+$/,'').length});
  consumed=last;
 }
 return result;
}
export function setFootnote(source:string,format:string,id:string,text:string,replace=false):string{
 if(!/^[\w-]{1,80}$/.test(id)||text.length>10000)throw new Error(t("각주 이름과 내용 길이를 확인해 주세요."));
 if(!['html','markdown'].includes(format))throw new Error(t("HTML 또는 Markdown 노트에서 각주를 편집해 주세요."));
 const definitions=extractFootnotes(source,format),found=definitions.find(f=>f.id===id);
 if(found&&!replace)throw new Error(t("이미 있는 각주 이름입니다."));
 if(replace&&!found)throw new Error(t("각주가 변경되었습니다. 다시 불러와 주세요."));
 if(definitions.filter(note=>note.id===id).length>1)throw new Error(t('이미 있는 각주 이름입니다.'));
 const newline=source.includes('\r\n')?'\r\n':'\n';
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 if(!found){
  if(format==='markdown')return source+newline+newline+`[^${id}]`+newline+newline+markdownDefinition(id,lines,newline)+newline;
  assertHtmlInsertable(source,id);
  return source+`<p><sup><a href="#fn-${id}">${escape(id)}</a></sup></p>`+htmlDefinition(id,lines);
 }
 if(found.text===text)return source;
 if(format==='markdown')return source.slice(0,found.from!)+markdownDefinition(id,lines,newline)+source.slice(found.to!);
 if(definitions.some(other=>other!==found&&other.from!<found.to!&&other.to!>found.from!))
  throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));
 return source.slice(0,found.from!)+htmlReplacement(source,found,id,lines)+source.slice(found.to!);
}
const markdownDefinition=(id:string,lines:string[],newline:string)=>`[^${id}]: ${lines[0]}`+lines.slice(1).map(line=>newline+'    '+line).join('');
const htmlDefinition=(id:string,lines:string[])=>`<p id="fn-${id}"><sup>${escape(id)}</sup> ${lines.map(escape).join('<br>')}</p>`;
/** A new HTML definition must not meet an unterminated token or an existing/ambiguous fn id. */
function assertHtmlInsertable(source:string,id:string){
 for(const token of source.matchAll(htmlTokens()))if(ambiguousHtmlToken(token,id))
  throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));
}
function ambiguousHtmlToken(token:RegExpMatchArray,id:string){
 if(token[3]||(token[0].startsWith('<!--')&&!token[0].endsWith('-->')))return true;
 if(token[1]&&!new RegExp(String.raw`</${token[1]}\s*>$`,'i').test(token[0]))return true;
 const ids=htmlAttributes(token[0])?.filter(attr=>attr.name==='id');
 if(ids?.some(attr=>/^fn[-:]?([\w-]+)$/i.exec(attr.value)?.[1]===id))return true;
 return !!ids&&ids.length>1&&ids.some(attr=>/^fn[-:]?[\w-]+$/i.test(attr.value));
}
/** Replace an HTML definition's body, keeping its opening tag, marker and backlinks. */
function htmlReplacement(source:string,found:Footnote,id:string,lines:string[]){
 const original=source.slice(found.from,found.to),opening=/^<(p|li)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/i.exec(original);
 if(!opening)return htmlDefinition(id,lines);
 const backlinks=footnoteBacklinks(original);
 const label=opening[1].toLowerCase()==='p'?paragraphMarker(original.slice(opening[0].length),id,htmlReferenceLabels(source)):'';
 return opening[0]+label+lines.map(escape).join('<br>')+backlinks+`</${opening[1]}>`;
}
function footnoteBacklinks(original:string){
 const chunks:string[]=[],tokens=htmlTokens();let token:RegExpExecArray|null;
 while((token=tokens.exec(original))){
  if(!/^<a\b/i.test(token[0]))continue;
  const href=htmlAttribute(token[0],'href')?.value,classes=htmlAttribute(token[0],'class')?.value.split(/\s+/);
  if(!href?.startsWith('#fnref')&&!classes?.includes('footnote-backref'))continue;
  const end=elementEnd(original,tokens.lastIndex,'a');
  if(!end)throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));
  chunks.push(original.slice(token.index,end.to));tokens.lastIndex=end.to;
 }
 return chunks.join('');
}

/** Remove one definition and its real references without reparsing the
 * surrounding source. Whole-body undo is owned by the calling editor. */
export function removeFootnote(source:string,format:string,id:string):string{
 if(!['html','markdown'].includes(format))throw new Error(t('HTML 또는 Markdown 노트에서 각주를 편집해 주세요.'));
 const definitions=extractFootnotes(source,format),found=definitions.filter(note=>note.id===id);
 if(found.length!==1)throw new Error(t('각주가 변경되었습니다. 다시 불러와 주세요.'));
 const note=found[0];
 if(definitions.some(other=>other!==note&&other.from!<note.to!&&other.to!>note.from!))
  throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));
 const edits:SourceEdit[]=[{from:note.from!,to:note.to!,text:''}];
 for(const ref of footnoteReferences(source,format))
  if(ref.id===id&&!(ref.from>=note.from!&&ref.from<note.to!))edits.push(referenceRemoval(source,format,ref));
 return applySourceEdits(source,edits);
}
function referenceRemoval(source:string,format:string,ref:FootnoteReference):SourceEdit{
 if(format==='markdown')return {from:ref.from,to:ref.to,text:''};
 const end=elementEnd(source,ref.to,'a');
 if(!end)throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));
 return {from:ref.from,to:end.to,text:''};
}

/** Append a citation without reparsing or normalizing the surrounding source. */
export function appendPdfCitation(source:string,format:string,url:string,page:number):string {
 const safe=pageUrl(url,page),label=`PDF · ${page}`;
 if(format==='html')return source+`<p><a href="${escape(safe)}">${escape(label)}</a></p>`;
 if(format==='markdown')return source+(source.includes('\r\n')?'\r\n\r\n':'\n\n')+`[${label}](${safe.replace(/[()]/g,c=>c==='('? '%28':'%29')})`;
 throw new Error(t('HTML 또는 Markdown 노트에서 각주를 편집해 주세요.'));
}

/** Mask syntax without changing offsets into the canonical source. */
function markdownProse(source:string):string {
 let fence='',masked='',raw='';
 for(const line of source.split(/(?<=\n)/)) {
  const boundary=/^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
  if(boundary){if(!fence)fence=boundary[1];else if(boundary[1].startsWith(fence[0])&&boundary[1].length>=fence.length&&!boundary[2].trim())fence='';masked+=' '.repeat(line.length);continue;}
  if(fence||/^(?: {4}|\t)/.test(line)){masked+=' '.repeat(line.length);continue;}
  masked+=line;
 }
 // CommonMark raw HTML blocks and inline code are not reference syntax.
 masked=masked.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|pre|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,m=>' '.repeat(m.length));
 for(let i=0;i<masked.length;){
  if(masked[i]!=='`'){raw+=masked[i++];continue;}
  let end=i;while(masked[end]==='`')end++;const ticks=masked.slice(i,end);let close=masked.indexOf(ticks,end);
  while(close>=0&&(masked[close-1]==='`'||masked[close+ticks.length]==='`'))close=masked.indexOf(ticks,close+ticks.length);
  if(close<0){raw+=ticks;i=end;}else{raw+=' '.repeat(close+ticks.length-i);i=close+ticks.length;}
 }
 return raw;
}
export type FootnoteReference={id:string;from:number;to:number;text:string};
export function footnoteReferences(source:string,format:string):FootnoteReference[]{
 const result:FootnoteReference[]=[];
 if(format==='markdown')for(const m of markdownProse(source).matchAll(/\[\^([\w-]+)\](?!:)/g)){
  let slash=0;for(let i=m.index!-1;i>=0&&source[i]==='\\';i--)slash++;
  if(slash%2===0)result.push({id:m[1],from:m.index!,to:m.index!+m[0].length,text:m[0]});
 }
 if(format==='html')for(const m of source.matchAll(htmlTokens())){
  if(!/^<a\b/i.test(m[0]))continue;
  const href=htmlAttribute(m[0],'href')?.value??'',classes=htmlAttribute(m[0],'class')?.value.split(/\s+/);
  if(/^#fnref/i.test(href)||classes?.includes('footnote-backref'))continue;
  const attr=/^#fn[-:]?([\w-]+)$/i.exec(href);if(!attr)continue;
  const end=source.slice(m.index!+m[0].length).search(/<\/a\s*>/i);const node=document.createElement('template');node.innerHTML=end<0?'':source.slice(m.index!+m[0].length,m.index!+m[0].length+end);
  result.push({id:attr[1],from:m.index!,to:m.index!+m[0].length,text:(node.content.textContent??'').trim()});
 }
 return result;
}
/** Renumber Markdown definitions and real references in first-use order. Other bytes stay exact. */
export function renumberFootnotes(source:string):string {
 const definitions=extractFootnotes(source,'markdown'),refs=footnoteReferences(source,'markdown'),ids=new Set(definitions.map(f=>f.id));
 if(ids.size!==definitions.length)throw new Error(t('이미 있는 각주 이름입니다.'));
 const order=[...new Set([...refs.map(f=>f.id).filter(id=>ids.has(id)),...definitions.map(f=>f.id)])];
 const numbers=new Map(order.map((id,i)=>[id,String(i+1)])),edits:{from:number;to:number;text:string}[]=[];
 for(const ref of refs)if(numbers.has(ref.id))edits.push({from:ref.from,to:ref.to,text:`[^${numbers.get(ref.id)}]`});
 for(const definition of definitions){const from=definition.from!+source.slice(definition.from).indexOf('[^');edits.push({from,to:from+definition.id.length+3,text:`[^${numbers.get(definition.id)}]`});}
 // Undefined numeric references must not silently become linked to a renamed definition.
 for(const ref of refs)if(!ids.has(ref.id)&&[...numbers.values()].includes(ref.id))throw new Error(t('각주가 변경되었습니다. 다시 불러와 주세요.'));
 edits.sort((a,b)=>b.from-a.from);
 for(const edit of edits)source=source.slice(0,edit.from)+edit.text+source.slice(edit.to);
 return source;
}

/** Move complete Markdown definitions among their existing slots, preserving separators. */
export function reorderFootnotes(source:string):string {
 const definitions=extractFootnotes(source),refs=footnoteReferences(source,'markdown');
 if(new Set(definitions.map(f=>f.id)).size!==definitions.length)throw new Error(t('이미 있는 각주 이름입니다.'));
 const ordered=[...new Set([...refs.map(r=>r.id),...definitions.map(d=>d.id)])].map(id=>definitions.find(d=>d.id===id)).filter((d):d is Footnote=>!!d);
 const chunks=ordered.map(d=>source.slice(d.from,d.to));
 for(let i=definitions.length-1;i>=0;i--)source=source.slice(0,definitions[i].from!)+chunks[i]+source.slice(definitions[i].to!);
 return source;
}

type SourceEdit={from:number;to:number;text:string};
function htmlFootnotePlan(source:string){
 const definitions=extractFootnotes(source,'html');
 const fail=()=>{throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));};
 if(new Set(definitions.map(d=>d.id)).size!==definitions.length)fail();
 for(const d of definitions){
  const chunk=source.slice(d.from,d.to),tag=/^<(p|li)\b/i.exec(chunk)?.[1];
  if(!tag||new RegExp(String.raw`<${tag}\b`,'gi').exec(chunk.slice(1)))fail();
 }
 const refs=footnoteReferences(source,'html').filter(r=>!definitions.some(d=>r.from>=d.from!&&r.from<d.to!));
 const byId=new Map(definitions.map(d=>[d.id,d]));
 const order=[...new Set([...refs.map(r=>r.id).filter(id=>byId.has(id)),...definitions.map(d=>d.id)])];
 return {definitions,refs,order,fail};
}
function applySourceEdits(source:string,edits:SourceEdit[]){
 const ordered=[...edits].sort((a,b)=>a.from-b.from);
 for(let i=0;i<ordered.length;i++){
  const e=ordered[i];if(e.from<0||e.to<e.from||e.to>source.length||(i&&e.from<ordered[i-1].to))
   throw new Error(t('각주 구조가 모호하여 정리할 수 없습니다. 각주와 참조를 확인해 주세요.'));
 }
 edits.sort((a,b)=>b.from-a.from);
 for(const e of edits)source=source.slice(0,e.from)+e.text+source.slice(e.to);
 return source;
}
/** HTML keeps stable fragment IDs/backlinks; only displayed numbers change. */
export function renumberHtmlFootnotes(source:string):string {
 const {definitions,refs,order,fail}=htmlFootnotePlan(source),edits:SourceEdit[]=[];
 const labels=htmlReferenceLabels(source);
 const numbers=new Map(order.map((id,i)=>[id,String(i+1)]));
 for(const r of refs){
  const number=numbers.get(r.id);if(!number)continue;
  const close=/^([^<]*)(<\/a\s*>)/i.exec(source.slice(r.to));if(!close)fail();
  const label=close![1],trimmed=label.trim();if(!trimmed)fail();
  const leading=label.length-label.trimStart().length;
  edits.push({from:r.to+leading,to:r.to+leading+trimmed.length,text:number});
 }
 for(const d of definitions){
  const opening=/^<(p|li)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/i.exec(source.slice(d.from,d.to));if(!opening)fail();
  const number=numbers.get(d.id)!;
  if(opening![1].toLowerCase()==='li'){
   const values=htmlAttributes(opening![0])?.filter(attr=>attr.name==='value');if(!values||values.length>1)fail();
   if(values!.length){const v=values![0];edits.push({from:d.from!+v.from,to:d.from!+v.to,text:` value="${number}"`});}
   else edits.push({from:d.from!+opening![0].length-1,to:d.from!+opening![0].length-1,text:` value="${number}"`});
  }else{
   const bodyStart=d.from!+opening![0].length;
   if(!paragraphMarker(source.slice(bodyStart,d.to),d.id,labels))fail();
   const label=/^(\s*<sup\b(?:"[^"]*"|'[^']*'|[^'">])*?>)([^<]*)(<\/sup\s*>)/i.exec(source.slice(bodyStart,d.to));if(!label)fail();
   edits.push({from:bodyStart+label![1].length,to:bodyStart+label![1].length+label![2].length,text:number});
  }
 }
 return applySourceEdits(source,edits);
}
/** Reorder only unambiguous contiguous same-tag sibling definitions. */
export function reorderHtmlFootnotes(source:string):string {
 const {definitions,order,fail}=htmlFootnotePlan(source);if(definitions.length<2)return source;
 const tag=/^<(p|li)\b/i.exec(source.slice(definitions[0].from))![1].toLowerCase();
 for(let i=0;i<definitions.length;i++){
  if(!new RegExp(String.raw`^<${tag}\b`,'i').test(source.slice(definitions[i].from)))fail();
  if(i&&source.slice(definitions[i-1].to,definitions[i].from).trim())fail();
 }
 const chunks=order.map(id=>{const d=definitions.find(d=>d.id===id)!;return source.slice(d.from,d.to);});
 return applySourceEdits(source,definitions.map((d,i)=>({from:d.from!,to:d.to!,text:chunks[i]})));
}
