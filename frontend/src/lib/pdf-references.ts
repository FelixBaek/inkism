import { t } from "../i18n";
export type PdfPageLink={label:string;page:number;url:string};
export type Footnote={id:string;marker:string;text:string;line:number;from?:number;to?:number};
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function pageUrl(url:string,page:number){const u=new URL(url,location.href);if(!['https:','http:'].includes(u.protocol)&&!(u.protocol==='tauri:'&&u.protocol===location.protocol&&u.host===location.host))throw new Error(t("안전한 웹 주소나 앱 첨부파일을 입력해 주세요."));if(u.username||u.password||!Number.isSafeInteger(page)||page<1||page>1000000)throw new Error(t("PDF 주소와 페이지 번호를 확인해 주세요."));u.hash=`page=${page}`;return u.toString();}
export function extractPdfPageLinks(source:string):PdfPageLink[]{const out:PdfPageLink[]=[];for(const m of source.matchAll(/\[([^\]]+)\]\(([^)\s]+#page=(\d+)[^)]*)\)/gi)){try{out.push({label:m[1],page:Number(m[3]),url:pageUrl(m[2],Number(m[3]))});}catch{}}for(const m of source.matchAll(/<a\b[^>]*href=["']([^"']+#page=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{out.push({label:m[3].replace(/<[^>]+>/g,''),page:Number(m[2]),url:pageUrl(m[1].replace(/&amp;/g,'&'),Number(m[2]))});}catch{}}return out;}
export function extractFootnotes(source:string,format='markdown'):Footnote[]{
 const result:Footnote[]=[];
 if(format==='html'){
  for(const m of source.matchAll(/<!--[\s\S]*?-->|<(script|style|textarea|title|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>|<(p|li)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi)){
   if(!m[2])continue;
   const attr=/\sid\s*=\s*(["'])(fn[-:]?([\w-]+))\1/i.exec(m[0]);if(!attr)continue;
   const start=m.index!,contentStart=start+m[0].length;
   const closing=new RegExp(`</${m[2]}\\s*>`,'gi');closing.lastIndex=contentStart;const end=closing.exec(source);if(!end)continue;
   const template=document.createElement('template');template.innerHTML=source.slice(contentStart,end.index);
   template.content.querySelector('sup')?.remove();template.content.querySelectorAll('a[href^="#fnref"], .footnote-backref').forEach(el=>el.remove());
   template.content.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));
   result.push({id:attr[3],marker:attr[3],text:(template.content.textContent??'').trim(),line:source.slice(0,start).split('\n').length,from:start,to:end.index+end[0].length});
  }
  return result;
 }
 const prose=markdownProse(source);
 const lines=source.split(/(?<=\n)/),offsets:number[]=[];let offset=0,fence='';
 for(const line of lines){offsets.push(offset);offset+=line.length;}
 for(let i=0;i<lines.length;i++){
  const trimmed=lines[i].replace(/[\r\n]+$/,'');
  const boundary=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if(boundary){if(!fence)fence=boundary[1];else if(boundary[1][0]===fence[0]&&boundary[1].length>=fence.length&&!boundary[2].trim())fence='';continue;}
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
  i=last;
 }
 return result;
}
export function setFootnote(source:string,format:string,id:string,text:string,replace=false):string{
 if(!/^[\w-]{1,80}$/.test(id)||text.length>10000)throw new Error(t("각주 이름과 내용 길이를 확인해 주세요."));
 if(!['html','markdown'].includes(format))throw new Error(t("HTML 또는 Markdown 노트에서 각주를 편집해 주세요."));
 const found=extractFootnotes(source,format).find(f=>f.id===id);
 if(found&&!replace)throw new Error(t("이미 있는 각주 이름입니다."));
 if(replace&&!found)throw new Error(t("각주가 변경되었습니다. 다시 불러와 주세요."));
 const newline=source.includes('\r\n')?'\r\n':'\n';
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 let definition=format==='html'?`<p id="fn-${id}"><sup>${escape(id)}</sup> ${lines.map(escape).join('<br>')}</p>`:`[^${id}]: ${lines[0]}`+lines.slice(1).map(line=>newline+'    '+line).join('');
 if(found&&format==='html'){
  const original=source.slice(found.from,found.to),opening=/^<(p|li)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/i.exec(original);
  if(opening){const backlinks=[...original.matchAll(/<a\b[^>]*href=["']#fnref[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)].map(m=>m[0]).join('');const label=/^\s*<sup\b[^>]*>[\s\S]*?<\/sup>/i.exec(original.slice(opening[0].length))?.[0]??'';definition=opening[0]+label+lines.map(escape).join('<br>')+backlinks+`</${opening[1]}>`;}
 }
 if(found)return source.slice(0,found.from!)+definition+source.slice(found.to!);
 return format==='html'?source+`<p><sup><a href="#fn-${id}">${escape(id)}</a></sup></p>`+definition:source+newline+newline+`[^${id}]`+newline+newline+definition+newline;
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
  if(boundary){if(!fence)fence=boundary[1];else if(boundary[1][0]===fence[0]&&boundary[1].length>=fence.length&&!boundary[2].trim())fence='';masked+=' '.repeat(line.length);continue;}
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
 if(format==='html')for(const m of source.matchAll(/<!--[\s\S]*?-->|<(script|style|textarea|title|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>|<a\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi)){
  if(!/^<a\b/i.test(m[0]))continue;const attr=/\shref\s*=\s*(["'])#fn[-:]?([\w-]+)\1/i.exec(m[0]);if(!attr)continue;
  const end=source.slice(m.index!+m[0].length).search(/<\/a\s*>/i);const node=document.createElement('template');node.innerHTML=end<0?'':source.slice(m.index!+m[0].length,m.index!+m[0].length+end);
  result.push({id:attr[2],from:m.index!,to:m.index!+m[0].length,text:(node.content.textContent??'').trim()});
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
 for(const edit of edits.sort((a,b)=>b.from-a.from))source=source.slice(0,edit.from)+edit.text+source.slice(edit.to);
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
  if(!tag||new RegExp(`<${tag}\\b`,'gi').exec(chunk.slice(1)))fail();
 }
 const refs=footnoteReferences(source,'html').filter(r=>!definitions.some(d=>r.from>=d.from!&&r.from<d.to!));
 const byId=new Map(definitions.map(d=>[d.id,d]));
 const order=[...new Set([...refs.map(r=>r.id).filter(id=>byId.has(id)),...definitions.map(d=>d.id)])];
 return {definitions,refs,order,fail};
}
function applySourceEdits(source:string,edits:SourceEdit[]){
 for(const e of edits.sort((a,b)=>b.from-a.from))source=source.slice(0,e.from)+e.text+source.slice(e.to);
 return source;
}
/** HTML keeps stable fragment IDs/backlinks; only displayed numbers change. */
export function renumberHtmlFootnotes(source:string):string {
 const {definitions,refs,order,fail}=htmlFootnotePlan(source),edits:SourceEdit[]=[];
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
   const values=[...opening![0].matchAll(/\svalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi)];if(values.length>1)fail();
   if(values.length){const v=values[0];edits.push({from:d.from!+v.index!,to:d.from!+v.index!+v[0].length,text:` value="${number}"`});}
   else edits.push({from:d.from!+opening![0].length-1,to:d.from!+opening![0].length-1,text:` value="${number}"`});
  }else{
   const bodyStart=d.from!+opening![0].length;
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
  if(!new RegExp(`^<${tag}\\b`,'i').test(source.slice(definitions[i].from)))fail();
  if(i&&source.slice(definitions[i-1].to,definitions[i].from).trim())fail();
 }
 const chunks=order.map(id=>{const d=definitions.find(d=>d.id===id)!;return source.slice(d.from,d.to);});
 return applySourceEdits(source,definitions.map((d,i)=>({from:d.from!,to:d.to!,text:chunks[i]})));
}
