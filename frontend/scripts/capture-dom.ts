import {writeFile} from 'node:fs/promises';
export function extractInkismDOM({id,commit}) {
 const keys=('display visibility position zIndex color backgroundColor backgroundImage opacity fontFamily fontSize fontWeight fontStyle lineHeight letterSpacing textAlign textDecorationLine whiteSpace wordBreak boxSizing boxShadow borderTopWidth borderRightWidth borderBottomWidth borderLeftWidth borderTopColor borderRightColor borderBottomColor borderLeftColor borderTopStyle borderRightStyle borderBottomStyle borderLeftStyle borderTopLeftRadius borderTopRightRadius borderBottomLeftRadius borderBottomRightRadius outlineColor outlineStyle outlineWidth outlineOffset flexDirection flexWrap alignItems alignSelf justifyContent gap rowGap columnGap flexGrow flexShrink flexBasis gridTemplateColumns gridTemplateRows gridColumn gridRow paddingTop paddingRight paddingBottom paddingLeft marginTop marginRight marginBottom marginLeft overflow overflowX overflowY objectFit transform clipPath clip filter textOverflow appearance accentColor maxHeight minHeight').split(' ');
 const nodes=[],topLayers=[];let n=0;const box=r=>({x:r.x,y:r.y,width:r.width,height:r.height});const css=s=>Object.fromEntries(keys.map(k=>[k,s[k]||'']));const visible=r=>r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.x<innerWidth&&r.y<innerHeight;
 function walk(e,parentId){
  if(e.nodeType===3){if(!e.textContent.trim())return;const rg=document.createRange();rg.selectNodeContents(e);const r=rg.getBoundingClientRect();if(!visible(r))return;const s=getComputedStyle(e.parentElement);nodes.push({id:'n'+(++n),parentId,type:'text',tag:'#text',className:'',role:'',name:'',rect:box(r),text:['normal','nowrap'].includes(s.whiteSpace)?e.textContent.replace(/\s+/g,' '):e.textContent,textRects:[...rg.getClientRects()].map(box),style:css(s)});return;}
  if(e.nodeType!==1||['SCRIPT','STYLE','LINK','META','NOSCRIPT','HEAD'].includes(e.tagName))return;const s=getComputedStyle(e),r=e.getBoundingClientRect();if(s.display==='none'||s.visibility!=='visible'||+s.opacity===0||s.clip==='rect(0px, 0px, 0px, 0px)')return;const seen=visible(r);if(!seen&&s.overflow==='hidden')return;let pid=parentId;
  if(seen){
   let backdrop;
   if(e.matches('dialog[open]')){backdrop={id:'n'+(++n),parentId,type:'backdrop',tag:'::backdrop',rect:{x:0,y:0,width:innerWidth,height:innerHeight},style:css(getComputedStyle(e,'::backdrop'))};nodes.push(backdrop);}
   pid='n'+(++n);const o: any={id:pid,parentId,type:'element',tag:e.tagName.toLowerCase(),className:e.getAttribute('class')||'',role:e.getAttribute('role')||'',name:e.getAttribute('aria-label')||e.getAttribute('title')||e.id||'',rect:box(r),style:css(s)};
   if(backdrop)topLayers.push({nodeId:pid,rect:box(r),backdropNodeId:backdrop.id,backdropStyle:backdrop.style,paintOrder:'backdrop immediately before dialog subtree; promote dialog subtree above ordinary DOM'});
   if(e.tagName.toLowerCase()==='svg'){const c=e.cloneNode(true),a=[e,...e.querySelectorAll('*')],b=[c,...c.querySelectorAll('*')];a.forEach((x,i)=>{const st=getComputedStyle(x);for(const k of ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','clip-rule','opacity'])b[i].setAttribute(k,st.getPropertyValue(k));b[i].removeAttribute('class');b[i].removeAttribute('style')});c.setAttribute('xmlns','http://www.w3.org/2000/svg');o.type='svg';o.svg=new XMLSerializer().serializeToString(c);nodes.push(o);return;}
   if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.tagName))o.control={type:e.type||e.tagName.toLowerCase(),value:e.value||'',checked:!!e.checked,disabled:!!e.disabled,placeholder:e.placeholder||''};nodes.push(o);
   if(['INPUT','TEXTAREA','SELECT'].includes(e.tagName)&&!['hidden','checkbox','radio','range','color','file'].includes(e.type)){const t=e.tagName==='SELECT'?e.selectedOptions[0]?.textContent:e.value||e.placeholder;if(t){const num=k=>parseFloat(s[k])||0,h=r.height-num('borderTopWidth')-num('borderBottomWidth')-num('paddingTop')-num('paddingBottom'),lh=parseFloat(s.lineHeight)||num('fontSize')*1.2;nodes.push({id:'n'+(++n),parentId:pid,type:'text',tag:'#control-value',className:'',role:'',name:'',rect:{x:r.x+num('borderLeftWidth')+num('paddingLeft'),y:r.y+num('borderTopWidth')+num('paddingTop')+(e.tagName==='TEXTAREA'?0:Math.max(0,(h-lh)/2)),width:r.width-num('paddingLeft')-num('paddingRight')-num('borderLeftWidth')-num('borderRightWidth'),height:e.tagName==='TEXTAREA'?h:Math.min(h,lh)},text:t,style:{...css(s),color:e.value?s.color:getComputedStyle(e,'::placeholder').color},controlValue:true});}}
  }
  if(!['INPUT','TEXTAREA','SELECT'].includes(e.tagName))for(const c of e.childNodes)walk(c,pid);
 }
 walk(document.body,null);return{schemaVersion:1,id,sourceCommit:commit,theme:document.documentElement.dataset.theme||'light',viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,capturedAt:new Date().toISOString(),provenance:{mode:'source-replay',baselinePNG:id+'.png',matchStatus:'needs-reference-QA'},topLayers,nodes};
}
export async function captureDOM(page,dir,id,commit){
 await page.evaluate(()=>document.fonts.ready);
 const dom=await page.evaluate(extractInkismDOM,{id,commit});dom.frames=[];
 for(const [index,frame] of page.frames().filter(f=>f!==page.mainFrame()).entries()){
  const record: any={index,url:frame.url(),status:'missing'};
  try{
   const element=await frame.frameElement();record.origin=await element.boundingBox();record.element=await element.evaluate((e: any)=>({tag:e.tagName.toLowerCase(),sandbox:e.getAttribute('sandbox'),title:e.title||'',borderLeft:parseFloat(getComputedStyle(e).borderLeftWidth)||0,borderTop:parseFloat(getComputedStyle(e).borderTopWidth)||0}));
   await frame.evaluate(()=>document.fonts.ready);
   const content=await frame.evaluate(extractInkismDOM,{id:id+'-frame-'+index,commit});
   record.file=id+'.frame-'+index+'.dom.json';record.status='captured';record.access='Playwright isolated frame evaluation; no sandbox attribute changes';
   await writeFile(dir+'/'+record.file,JSON.stringify({...content,frameOrigin:record.origin,frameElement:record.element,clipToFrame:true},null,2));
  }catch(e){record.reason=String(e).slice(0,500)}
  dom.frames.push(record);
 }
 await writeFile(dir+'/'+id+'.dom.json',JSON.stringify(dom,null,2));return dom;
}
