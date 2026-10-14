import DOMPurify from 'dompurify';
import {markdownToHTML} from './markdown';
import type {Note} from '../types';
import {t} from '../i18n';
export type PresentationSlide={title:string;html:string};
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
/** A derived, inert view. Never send this representation back to storage. */
export function presentationSlides(note:Pick<Note,'title'|'content'|'content_format'>):PresentationSlide[]{
 if(new TextEncoder().encode(note.content).length>8*1024*1024)throw new Error(t('발표 모드는 8 MiB 이하 문서에서 사용할 수 있습니다.'));
 const format=note.content_format??'html';
 let html=format==='markdown'?markdownToHTML(note.content).content:format==='text'?`<pre>${escape(note.content)}</pre>`:note.content;
 const input=document.createElement('template');input.innerHTML=html;
 for(const media of input.content.querySelectorAll('audio,video,iframe,object,embed')){const name=media.getAttribute('title')||media.getAttribute('aria-label')||media.getAttribute('src')?.split('/').at(-1)||media.tagName.toLowerCase();const placeholder=document.createElement('p');placeholder.dataset.presentationOmitted=name;placeholder.textContent=t('발표에서 제외된 첨부: {name}',{name});media.replaceWith(placeholder);}html=input.innerHTML;
 const safe=DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['style','link','iframe','object','embed','form','input','button','textarea','select','video','audio','source','base','meta'],FORBID_ATTR:['srcset','autofocus','contenteditable','name','id','background','poster','target','download']});
 const root=document.createElement('template');root.innerHTML=safe;
 for(const element of root.content.querySelectorAll<HTMLElement>('*')){
  const link=element.getAttribute('href');if(link?.startsWith('/api/attachments/'))element.dataset.presentationOmitted=element.textContent?.trim()||link.split('/').at(-1)||t('첨부 누락');
  element.removeAttribute('href'); // Presentation links cannot navigate or launch other applications.
  const style=element.style;const retained:Record<string,string>={};
  for(const key of ['color','background-color','font-size','font-weight','font-style','text-align','text-decoration','vertical-align']){const value=style.getPropertyValue(key);if(value&&!/url\s*\(|expression\s*\(|var\s*\(/i.test(value))retained[key]=value;}
  element.removeAttribute('style');for(const[key,value]of Object.entries(retained))style.setProperty(key,value);
  if(element instanceof HTMLImageElement){const src=element.getAttribute('src')??'';let allowed=false;try{const url=new URL(src,location.href);allowed=url.origin===location.origin&&/^\/api\/attachments\/[\w-]+$/.test(url.pathname)&&(!url.search||url.search==='?preview=1')&&!url.hash;if(allowed){url.search='?preview=1';element.src=url.href;}}catch{/* Invalid resource remains inert. */}if(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src))allowed=true;if(!allowed){element.removeAttribute('src');element.alt=element.alt||t('외부 이미지');}}
  if(element instanceof HTMLDetailsElement)element.open=true;
 }
 const slides:PresentationSlide[]=[];let parts:string[]=[],title=note.title||t('제목 없음');
 const flush=()=>{if(parts.some(p=>p.trim())){slides.push({title,html:parts.join('')});parts=[];if(slides.length>500)throw new Error(t('발표 페이지는 최대 500개까지 지원합니다.'));}};
 // Only document-level headings/rules split slides; nested lists/tables/details remain intact.
 for(const node of root.content.childNodes){if(node instanceof HTMLElement){if(node.tagName==='HR'){flush();continue;}if(/^H[1-6]$/.test(node.tagName)){flush();title=node.textContent||note.title;}parts.push(node.outerHTML);}else if(node.nodeType===Node.TEXT_NODE&&node.textContent?.trim())parts.push(`<p>${escape(node.textContent)}</p>`);}
 flush();return slides.length?slides:[{title,html:`<h1>${escape(title)}</h1>`}];
}
export function slideDocument(slide:PresentationSlide):string{
 const origin=escape(location.origin);
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${origin} data:; connect-src 'none'; form-action 'none'; base-uri 'none';"><title>${escape(slide.title)}</title><style>html{color-scheme:light dark}body{margin:0;padding:clamp(24px,5vw,72px);font:clamp(18px,2.4vw,32px)/1.55 system-ui,sans-serif;background:#fff;color:#222;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{line-height:1.2;margin:0 0 .7em}h1{font-size:2em}img{max-width:100%;max-height:65vh;object-fit:contain}pre{white-space:pre-wrap;font-size:.8em}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #aaa;padding:.35em}blockquote{margin:1em 0;padding:0 1em;border-inline-start:3px solid #999}a{color:inherit}*{box-sizing:border-box}@media(prefers-color-scheme:dark){body{background:#202020;color:#eee}}@media print{body{font-size:20px}}</style></head><body>${slide.html}</body></html>`;
}

/** Export a derived snapshot. Attachment failures are visible, never silently omitted. */
export async function offlinePresentation(slides:PresentationSlide[],options:{print?:boolean}={}):Promise<{html:string;warnings:string[]}>{
 const warnings:string[]=[],prepared:PresentationSlide[]=[];let budget=32*1024*1024;
 const cached=new Map<string,string>();
 for(const slide of slides){
  const template=document.createElement('template');template.innerHTML=DOMPurify.sanitize(slide.html,{USE_PROFILES:{html:true,mathMl:true},FORBID_TAGS:['script','style','link','iframe','object','embed','form','input','button','textarea','select','video','audio','source','base','meta'],FORBID_ATTR:['srcset','id','name','autofocus','contenteditable']});
  for(const omitted of template.content.querySelectorAll<HTMLElement>('[data-presentation-omitted]'))warnings.push(t('발표에서 제외된 첨부: {name}',{name:omitted.dataset.presentationOmitted??t('첨부 누락')}));
  template.content.querySelectorAll('[href]').forEach(element=>element.removeAttribute('href'));
  for(const image of template.content.querySelectorAll('img')){
   const src=image.getAttribute('src')??'',name=image.alt||src.split('/').at(-1)||t('이름 없는 이미지');
   try{
    if(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)){budget-=src.length;if(budget<0)throw new Error(t('발표 첨부 용량 제한을 초과했습니다.'));continue;}
    const url=new URL(src,location.href);if(!src||url.origin!==location.origin||!/^\/api\/attachments\/[\w-]+$/.test(url.pathname)||(url.search&&url.search!=='?preview=1')||url.hash)throw new Error(t('오프라인 이미지로 포함할 수 없습니다.'));
    url.search='?preview=1';
    if(cached.has(url.href)){image.src=cached.get(url.href)!;continue;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
     const response=await fetch(url.href,{signal:controller.signal,credentials:'same-origin',redirect:'error'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
     const type=(response.headers.get('content-type')??'').split(';')[0];if(!/^image\/(png|jpeg|gif|webp)$/.test(type))throw new Error(t('지원하지 않는 이미지 형식입니다.'));
     const reader=response.body?.getReader();if(!reader)throw new Error(t('이미지를 읽지 못했습니다.'));
     const chunks:Uint8Array[]=[];let size=0;
     try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>8*1024*1024||size>budget)throw new Error(t('발표 첨부 용량 제한을 초과했습니다.'));chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
     budget-=size;const blob=new Blob(chunks as BlobPart[],{type});const data=await new Promise<string>((resolve,reject)=>{const file=new FileReader();file.onload=()=>resolve(String(file.result));file.onerror=()=>reject(new Error(t('이미지를 읽지 못했습니다.')));file.readAsDataURL(blob);});image.src=data;cached.set(url.href,data);
    }finally{clearTimeout(timer);}
   }catch(error){image.removeAttribute('src');image.alt=`${name} — ${t('첨부 누락')}`;warnings.push(`${name}: ${error instanceof Error?error.message:String(error)}`);}
  }
  const math=template.content.querySelectorAll<HTMLElement>('[data-type="block-math"],[data-type="inline-math"]');
  if(math.length){const {default:katex}=await import('katex');for(const element of math){const latex=element.dataset.latex??element.textContent??'';try{if(latex.length>50000)throw new Error('formula size');element.innerHTML=katex.renderToString(latex,{output:'mathml',displayMode:element.dataset.type==='block-math',throwOnError:true,trust:false,strict:'error'});}catch{warnings.push(`${t('수식 원문 유지')}: ${latex.slice(0,100)}`);element.textContent=latex;}}}
  budget-=template.innerHTML.length;if(budget<0)throw new Error(t('발표 첨부 용량 제한을 초과했습니다.'));
  prepared.push({title:slide.title,html:template.innerHTML});
 }
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
 const navigation=`(()=>{const slides=[...document.querySelectorAll('main>section')],counter=document.querySelector('output');let index=0;function show(next){index=Math.max(0,Math.min(slides.length-1,next));slides.forEach((slide,i)=>slide.hidden=i!==index);counter.textContent=(index+1)+' / '+slides.length;document.querySelector('[data-action="previous"]').disabled=index===0;document.querySelector('[data-action="next"]').disabled=index===slides.length-1;}document.querySelector('[data-action="previous"]').onclick=()=>show(index-1);document.querySelector('[data-action="next"]').onclick=()=>show(index+1);document.querySelector('[data-action="print"]').onclick=()=>window.print();document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;if(['ArrowRight','ArrowDown','PageDown','ArrowLeft','ArrowUp','PageUp','Home','End'].includes(e.key)){e.preventDefault();show(e.key==='Home'?0:e.key==='End'?slides.length-1:index+(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)?-1:1));}});show(0);${options.print?"window.addEventListener('load',()=>window.print());":''}})();`;
 const styles=`*{box-sizing:border-box}body{margin:0;background:#fff;color:#222;font:clamp(18px,2.5vw,30px)/1.5 system-ui,sans-serif;overflow-wrap:anywhere}nav{display:flex;gap:12px;align-items:center;padding:12px;flex-wrap:wrap;font-size:16px;border-bottom:1px solid #aaa}button{padding:8px 14px}section{padding:clamp(20px,5vw,64px);min-height:80vh}section[hidden]{display:none}img{max-width:100%;max-height:65vh;object-fit:contain}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #aaa;padding:.3em}pre{white-space:pre-wrap}aside{padding:12px;background:#fff4d4;font-size:16px}math{max-width:100%;overflow:auto}h1,h2,h3{line-height:1.2}a{color:inherit}@page{size:landscape;margin:15mm}@media print{nav{display:none}section,section[hidden]{display:block!important;min-height:0;break-after:page;padding:0}section:last-child{break-after:auto}body{font-size:18px}img{max-height:65vh}aside{break-after:page}}`;
 const html=`<!doctype html><html lang="${escape(document.documentElement.lang||'ko')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';"><title>${escape(slides[0]?.title||t('발표 모드'))}</title><style>${styles}</style></head><body><nav aria-label="${escape(t('발표 모드'))}"><button data-action="previous">${escape(t('이전 페이지'))}</button><output aria-live="polite"></output><button data-action="next">${escape(t('다음 페이지'))}</button><button data-action="print">${escape(t('인쇄 · PDF'))}</button></nav>${warnings.length?`<aside role="status"><strong>${escape(t('누락된 첨부와 수식'))}</strong><ul>${warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></aside>`:''}<main>${prepared.map(slide=>`<section aria-label="${escape(slide.title)}">${slide.html}</section>`).join('')}</main><script nonce="${nonce}">${navigation}</script></body></html>`;
 return {html,warnings};
}
