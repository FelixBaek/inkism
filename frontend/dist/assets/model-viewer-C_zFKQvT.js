import{t as e}from"./preload-helper-CRzLMJPS.js";import{$ as t,$n as n,A as r,An as i,B as a,C as o,Cn as s,Ct as c,D as l,Dn as u,E as d,En as f,Et as p,F as m,Fn as h,G as g,Gn as _,H as v,I as y,In as b,J as x,Jn as S,K as C,Kn as w,L as T,Ln as E,M as D,Mn as O,Mt as k,N as ee,Nn as A,Nt as te,O as j,On as ne,Ot as re,P as ie,Pn as M,Q as ae,Qn as N,R as oe,Rn as P,S as se,Sn as F,St as ce,T as le,Tn as ue,Tt as de,U as fe,Un as pe,V as me,Vn as he,Wn as ge,X as _e,Xn as ve,Y as ye,Yn as be,Z as xe,Zn as Se,_ as I,_t as Ce,a as we,ar as Te,at as Ee,b as De,bt as Oe,c as ke,cr as Ae,ct as L,d as R,dn as je,dt as z,er as Me,et as B,f as Ne,fn as V,ft as H,g as Pe,gn as Fe,gt as Ie,h as Le,hn as Re,ht as ze,ir as Be,it as Ve,j as He,jn as Ue,k as We,kn as Ge,l as Ke,ln as qe,lr as Je,lt as Ye,m as Xe,mn as Ze,mt as Qe,n as $e,nr as et,nt as tt,o as nt,or as rt,ot as it,p as at,pt as ot,q as st,qn as ct,r as lt,rr as ut,rt as dt,sr as ft,st as pt,t as mt,tr as ht,tt as gt,u as _t,un as vt,ur as yt,ut as U,v as bt,vt as xt,w as St,wn as Ct,wt,x as Tt,xn as Et,xt as Dt,y as Ot,yt as kt,zn as At}from"./CachingGLTFLoader-JOXgQ-JE.js";var jt=globalThis,Mt=jt.ShadowRoot&&(jt.ShadyCSS===void 0||jt.ShadyCSS.nativeShadow)&&`adoptedStyleSheets`in Document.prototype&&`replace`in CSSStyleSheet.prototype,Nt=Symbol(),Pt=new WeakMap,Ft=class{constructor(e,t,n){if(this._$cssResult$=!0,n!==Nt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(Mt&&e===void 0){let n=t!==void 0&&t.length===1;n&&(e=Pt.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),n&&Pt.set(t,e))}return e}toString(){return this.cssText}},It=e=>new Ft(typeof e==`string`?e:e+``,void 0,Nt),Lt=(e,t)=>{if(Mt)e.adoptedStyleSheets=t.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let n of t){let t=document.createElement(`style`),r=jt.litNonce;r!==void 0&&t.setAttribute(`nonce`,r),t.textContent=n.cssText,e.appendChild(t)}},Rt=Mt?e=>e:e=>e instanceof CSSStyleSheet?(e=>{let t=``;for(let n of e.cssRules)t+=n.cssText;return It(t)})(e):e,{is:zt,defineProperty:Bt,getOwnPropertyDescriptor:Vt,getOwnPropertyNames:Ht,getOwnPropertySymbols:Ut,getPrototypeOf:Wt}=Object,Gt=globalThis,Kt=Gt.trustedTypes,qt=Kt?Kt.emptyScript:``,Jt=Gt.reactiveElementPolyfillSupport,Yt=(e,t)=>e,Xt={toAttribute(e,t){switch(t){case Boolean:e=e?qt:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let n=e;switch(t){case Boolean:n=e!==null;break;case Number:n=e===null?null:Number(e);break;case Object:case Array:try{n=JSON.parse(e)}catch{n=null}}return n}},Zt=(e,t)=>!zt(e,t),Qt={attribute:!0,type:String,converter:Xt,reflect:!1,useDefault:!1,hasChanged:Zt};Symbol.metadata??=Symbol(`metadata`),Gt.litPropertyMetadata??=new WeakMap;var $t=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=Qt){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let n=Symbol(),r=this.getPropertyDescriptor(e,n,t);r!==void 0&&Bt(this.prototype,e,r)}}static getPropertyDescriptor(e,t,n){let{get:r,set:i}=Vt(this.prototype,e)??{get(){return this[t]},set(e){this[t]=e}};return{get:r,set(t){let a=r?.call(this);i?.call(this,t),this.requestUpdate(e,a,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??Qt}static _$Ei(){if(this.hasOwnProperty(Yt(`elementProperties`)))return;let e=Wt(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(Yt(`finalized`)))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(Yt(`properties`))){let e=this.properties,t=[...Ht(e),...Ut(e)];for(let n of t)this.createProperty(n,e[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[e,n]of t)this.elementProperties.set(e,n)}this._$Eh=new Map;for(let[e,t]of this.elementProperties){let n=this._$Eu(e,t);n!==void 0&&this._$Eh.set(n,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let n=new Set(e.flat(1/0).reverse());for(let e of n)t.unshift(Rt(e))}else e!==void 0&&t.push(Rt(e));return t}static _$Eu(e,t){let n=t.attribute;return!1===n?void 0:typeof n==`string`?n:typeof e==`string`?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let n of t.keys())this.hasOwnProperty(n)&&(e.set(n,this[n]),delete this[n]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Lt(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,n){this._$AK(e,n)}_$ET(e,t){let n=this.constructor.elementProperties.get(e),r=this.constructor._$Eu(e,n);if(r!==void 0&&!0===n.reflect){let i=(n.converter?.toAttribute===void 0?Xt:n.converter).toAttribute(t,n.type);this._$Em=e,i==null?this.removeAttribute(r):this.setAttribute(r,i),this._$Em=null}}_$AK(e,t){let n=this.constructor,r=n._$Eh.get(e);if(r!==void 0&&this._$Em!==r){let e=n.getPropertyOptions(r),i=typeof e.converter==`function`?{fromAttribute:e.converter}:e.converter?.fromAttribute===void 0?Xt:e.converter;this._$Em=r;let a=i.fromAttribute(t,e.type);this[r]=a??this._$Ej?.get(r)??a,this._$Em=null}}requestUpdate(e,t,n,r=!1,i){if(e!==void 0){let a=this.constructor;if(!1===r&&(i=this[e]),n??=a.getPropertyOptions(e),!((n.hasChanged??Zt)(i,t)||n.useDefault&&n.reflect&&i===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,n))))return;this.C(e,t,n)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(e,t,{useDefault:n,reflect:r,wrapped:i},a){n&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),!0!==i||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||n||(t=void 0),this._$AL.set(e,t)),!0===r&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,t]of this._$Ep)this[e]=t;this._$Ep=void 0}let e=this.constructor.elementProperties;if(e.size>0)for(let[t,n]of e){let{wrapped:e}=n,r=this[t];!0!==e||this._$AL.has(t)||r===void 0||this.C(t,void 0,n,r)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(e=>e.hostUpdate?.()),this.update(t)):this._$EM()}catch(t){throw e=!1,this._$EM(),t}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(e){}firstUpdated(e){}};$t.elementStyles=[],$t.shadowRootOptions={mode:`open`},$t[Yt(`elementProperties`)]=new Map,$t[Yt(`finalized`)]=new Map,Jt?.({ReactiveElement:$t}),(Gt.reactiveElementVersions??=[]).push(`2.1.2`);var en=globalThis,tn=e=>e,nn=en.trustedTypes,rn=nn?nn.createPolicy(`lit-html`,{createHTML:e=>e}):void 0,an=`$lit$`,on=`lit$${Math.random().toFixed(9).slice(2)}$`,sn=`?`+on,cn=`<${sn}>`,ln=document,un=()=>ln.createComment(``),dn=e=>e===null||typeof e!=`object`&&typeof e!=`function`,fn=Array.isArray,pn=e=>fn(e)||typeof e?.[Symbol.iterator]==`function`,mn=`[ 	
\f\r]`,hn=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,gn=/-->/g,_n=/>/g,vn=RegExp(`>|${mn}(?:([^\\s"'>=/]+)(${mn}*=${mn}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,`g`),yn=/'/g,bn=/"/g,xn=/^(?:script|style|textarea|title)$/i,Sn=(e=>(t,...n)=>({_$litType$:e,strings:t,values:n}))(1),Cn=Symbol.for(`lit-noChange`),wn=Symbol.for(`lit-nothing`),Tn=new WeakMap,En=ln.createTreeWalker(ln,129);function Dn(e,t){if(!fn(e)||!e.hasOwnProperty(`raw`))throw Error(`invalid template strings array`);return rn===void 0?t:rn.createHTML(t)}var On=(e,t)=>{let n=e.length-1,r=[],i,a=t===2?`<svg>`:t===3?`<math>`:``,o=hn;for(let t=0;t<n;t++){let n=e[t],s,c,l=-1,u=0;for(;u<n.length&&(o.lastIndex=u,c=o.exec(n),c!==null);)u=o.lastIndex,o===hn?c[1]===`!--`?o=gn:c[1]===void 0?c[2]===void 0?c[3]!==void 0&&(o=vn):(xn.test(c[2])&&(i=RegExp(`</`+c[2],`g`)),o=vn):o=_n:o===vn?c[0]===`>`?(o=i??hn,l=-1):c[1]===void 0?l=-2:(l=o.lastIndex-c[2].length,s=c[1],o=c[3]===void 0?vn:c[3]===`"`?bn:yn):o===bn||o===yn?o=vn:o===gn||o===_n?o=hn:(o=vn,i=void 0);let d=o===vn&&e[t+1].startsWith(`/>`)?` `:``;a+=o===hn?n+cn:l>=0?(r.push(s),n.slice(0,l)+an+n.slice(l)+on+d):n+on+(l===-2?t:d)}return[Dn(e,a+(e[n]||`<?>`)+(t===2?`</svg>`:t===3?`</math>`:``)),r]},kn=class e{constructor({strings:t,_$litType$:n},r){let i;this.parts=[];let a=0,o=0,s=t.length-1,c=this.parts,[l,u]=On(t,n);if(this.el=e.createElement(l,r),En.currentNode=this.el.content,n===2||n===3){let e=this.el.content.firstChild;e.replaceWith(...e.childNodes)}for(;(i=En.nextNode())!==null&&c.length<s;){if(i.nodeType===1){if(i.hasAttributes())for(let e of i.getAttributeNames())if(e.endsWith(an)){let t=u[o++],n=i.getAttribute(e).split(on),r=/([.?@])?(.*)/.exec(t);c.push({type:1,index:a,name:r[2],strings:n,ctor:r[1]===`.`?Pn:r[1]===`?`?Fn:r[1]===`@`?In:Nn}),i.removeAttribute(e)}else e.startsWith(on)&&(c.push({type:6,index:a}),i.removeAttribute(e));if(xn.test(i.tagName)){let e=i.textContent.split(on),t=e.length-1;if(t>0){i.textContent=nn?nn.emptyScript:``;for(let n=0;n<t;n++)i.append(e[n],un()),En.nextNode(),c.push({type:2,index:++a});i.append(e[t],un())}}}else if(i.nodeType===8){if(i.data===sn)c.push({type:2,index:a});else{let e=-1;for(;(e=i.data.indexOf(on,e+1))!==-1;)c.push({type:7,index:a}),e+=on.length-1}}a++}}static createElement(e,t){let n=ln.createElement(`template`);return n.innerHTML=e,n}};function An(e,t,n=e,r){if(t===Cn)return t;let i=r===void 0?n._$Cl:n._$Co?.[r],a=dn(t)?void 0:t._$litDirective$;return i?.constructor!==a&&(i?._$AO?.(!1),a===void 0?i=void 0:(i=new a(e),i._$AT(e,n,r)),r===void 0?n._$Cl=i:(n._$Co??=[])[r]=i),i!==void 0&&(t=An(e,i._$AS(e,t.values),i,r)),t}var jn=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:n}=this._$AD,r=(e?.creationScope??ln).importNode(t,!0);En.currentNode=r;let i=En.nextNode(),a=0,o=0,s=n[0];for(;s!==void 0;){if(a===s.index){let t;s.type===2?t=new Mn(i,i.nextSibling,this,e):s.type===1?t=new s.ctor(i,s.name,s.strings,this,e):s.type===6&&(t=new Ln(i,this,e)),this._$AV.push(t),s=n[++o]}a!==s?.index&&(i=En.nextNode(),a++)}return En.currentNode=ln,r}p(e){let t=0;for(let n of this._$AV)n!==void 0&&(n.strings===void 0?n._$AI(e[t]):(n._$AI(e,n,t),t+=n.strings.length-2)),t++}},Mn=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,n,r){this.type=2,this._$AH=wn,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=n,this.options=r,this._$Cv=r?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=An(this,e,t),dn(e)?e===wn||e==null||e===``?(this._$AH!==wn&&this._$AR(),this._$AH=wn):e!==this._$AH&&e!==Cn&&this._(e):e._$litType$===void 0?e.nodeType===void 0?pn(e)?this.k(e):this._(e):this.T(e):this.$(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==wn&&dn(this._$AH)?this._$AA.nextSibling.data=e:this.T(ln.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:n}=e,r=typeof n==`number`?this._$AC(e):(n.el===void 0&&(n.el=kn.createElement(Dn(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===r)this._$AH.p(t);else{let e=new jn(r,this),n=e.u(this.options);e.p(t),this.T(n),this._$AH=e}}_$AC(e){let t=Tn.get(e.strings);return t===void 0&&Tn.set(e.strings,t=new kn(e)),t}k(t){fn(this._$AH)||(this._$AH=[],this._$AR());let n=this._$AH,r,i=0;for(let a of t)i===n.length?n.push(r=new e(this.O(un()),this.O(un()),this,this.options)):r=n[i],r._$AI(a),i++;i<n.length&&(this._$AR(r&&r._$AB.nextSibling,i),n.length=i)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let t=tn(e).nextSibling;tn(e).remove(),e=t}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},Nn=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,n,r,i){this.type=1,this._$AH=wn,this._$AN=void 0,this.element=e,this.name=t,this._$AM=r,this.options=i,n.length>2||n[0]!==``||n[1]!==``?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=wn}_$AI(e,t=this,n,r){let i=this.strings,a=!1;if(i===void 0)e=An(this,e,t,0),a=!dn(e)||e!==this._$AH&&e!==Cn,a&&(this._$AH=e);else{let r=e,o,s;for(e=i[0],o=0;o<i.length-1;o++)s=An(this,r[n+o],t,o),s===Cn&&(s=this._$AH[o]),a||=!dn(s)||s!==this._$AH[o],s===wn?e=wn:e!==wn&&(e+=(s??``)+i[o+1]),this._$AH[o]=s}a&&!r&&this.j(e)}j(e){e===wn?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??``)}},Pn=class extends Nn{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===wn?void 0:e}},Fn=class extends Nn{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==wn)}},In=class extends Nn{constructor(e,t,n,r,i){super(e,t,n,r,i),this.type=5}_$AI(e,t=this){if((e=An(this,e,t,0)??wn)===Cn)return;let n=this._$AH,r=e===wn&&n!==wn||e.capture!==n.capture||e.once!==n.once||e.passive!==n.passive,i=e!==wn&&(n===wn||r);r&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH==`function`?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},Ln=class{constructor(e,t,n){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(e){An(this,e)}},Rn=en.litHtmlPolyfillSupport;Rn?.(kn,Mn),(en.litHtmlVersions??=[]).push(`3.3.3`);var zn=(e,t,n)=>{let r=n?.renderBefore??t,i=r._$litPart$;if(i===void 0){let e=n?.renderBefore??null;r._$litPart$=i=new Mn(t.insertBefore(un(),e),e,void 0,n??{})}return i._$AI(e),i},Bn=globalThis,Vn=class extends $t{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=zn(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return Cn}};Vn._$litElement$=!0,Vn.finalized=!0,Bn.litElementHydrateSupport?.({LitElement:Vn});var Hn=Bn.litElementPolyfillSupport;Hn?.({LitElement:Vn}),(Bn.litElementVersions??=[]).push(`4.2.2`);var Un={attribute:!0,type:String,converter:Xt,reflect:!1,hasChanged:Zt},Wn=(e=Un,t,n)=>{let{kind:r,metadata:i}=n,a=globalThis.litPropertyMetadata.get(i);if(a===void 0&&globalThis.litPropertyMetadata.set(i,a=new Map),r===`setter`&&((e=Object.create(e)).wrapped=!0),a.set(n.name,e),r===`accessor`){let{name:r}=n;return{set(n){let i=t.get.call(this);t.set.call(this,n),this.requestUpdate(r,i,e,!0,n)},init(t){return t!==void 0&&this.C(r,void 0,e,t),t}}}if(r===`setter`){let{name:r}=n;return function(n){let i=this[r];t.call(this,n),this.requestUpdate(r,i,e,!0,n)}}throw Error(`Unsupported decorator location: `+r)};function W(e){return(t,n)=>typeof n==`object`?Wn(e,t,n):((e,t,n)=>{let r=t.hasOwnProperty(n);return t.constructor.createProperty(n,e),r?Object.getOwnPropertyDescriptor(t,n):void 0})(e,t,n)}var Gn=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Kn=class extends $t{constructor(){super(...arguments),this.src=null,this.offset=null,this.orientation=null,this.scale=null,this.background=!1}static get is(){return`extra-model`}updated(e){if(super.updated(e),e.has(`src`)||e.has(`offset`)||e.has(`orientation`)||e.has(`scale`)||e.has(`background`)){let t=e.has(`src`);this.dispatchEvent(new CustomEvent(`extra-model-changed`,{bubbles:!0,composed:!0,detail:{srcChanged:t,src:this.src,offset:this.offset,orientation:this.orientation,scale:this.scale,background:this.background}}))}}};Gn([W({type:String})],Kn.prototype,`src`,void 0),Gn([W({type:String})],Kn.prototype,`offset`,void 0),Gn([W({type:String})],Kn.prototype,`orientation`,void 0),Gn([W({type:String})],Kn.prototype,`scale`,void 0),Gn([W({type:Boolean})],Kn.prototype,`background`,void 0),customElements.define(`extra-model`,Kn);function qn(){let e=null,t=!1,n=null,r=null;function i(t,a){n(t,a),r=e.requestAnimationFrame(i)}return{start:function(){t!==!0&&n!==null&&(r=e.requestAnimationFrame(i),t=!0)},stop:function(){e.cancelAnimationFrame(r),t=!1},setAnimationLoop:function(e){n=e},setContext:function(t){e=t}}}function Jn(e){let t=new WeakMap;function n(t,n){let r=t.array,i=t.usage,a=r.byteLength,o=e.createBuffer();e.bindBuffer(n,o),e.bufferData(n,r,i),t.onUploadCallback();let s;if(r instanceof Float32Array)s=e.FLOAT;else if(typeof Float16Array<`u`&&r instanceof Float16Array)s=e.HALF_FLOAT;else if(r instanceof Uint16Array)s=t.isFloat16BufferAttribute?e.HALF_FLOAT:e.UNSIGNED_SHORT;else if(r instanceof Int16Array)s=e.SHORT;else if(r instanceof Uint32Array)s=e.UNSIGNED_INT;else if(r instanceof Int32Array)s=e.INT;else if(r instanceof Int8Array)s=e.BYTE;else if(r instanceof Uint8Array)s=e.UNSIGNED_BYTE;else if(r instanceof Uint8ClampedArray)s=e.UNSIGNED_BYTE;else throw Error(`THREE.WebGLAttributes: Unsupported buffer data format: `+r);return{buffer:o,type:s,bytesPerElement:r.BYTES_PER_ELEMENT,version:t.version,size:a}}function r(t,n,r){let i=n.array,a=n.updateRanges;if(e.bindBuffer(r,t),a.length===0)e.bufferSubData(r,0,i);else{a.sort((e,t)=>e.start-t.start);let t=0;for(let e=1;e<a.length;e++){let n=a[t],r=a[e];r.start<=n.start+n.count+1?n.count=Math.max(n.count,r.start+r.count-n.start):(++t,a[t]=r)}a.length=t+1;for(let t=0,n=a.length;t<n;t++){let n=a[t];e.bufferSubData(r,n.start*i.BYTES_PER_ELEMENT,i,n.start,n.count)}n.clearUpdateRanges()}n.onUploadCallback()}function i(e){return e.isInterleavedBufferAttribute&&(e=e.data),t.get(e)}function a(n){n.isInterleavedBufferAttribute&&(n=n.data);let r=t.get(n);r&&(e.deleteBuffer(r.buffer),t.delete(n))}function o(e,i){if(e.isInterleavedBufferAttribute&&(e=e.data),e.isGLBufferAttribute){let n=t.get(e);(!n||n.version<e.version)&&t.set(e,{buffer:e.buffer,type:e.type,bytesPerElement:e.elementSize,version:e.version});return}let a=t.get(e);if(a===void 0)t.set(e,n(e,i));else if(a.version<e.version){if(a.size!==e.array.byteLength)throw Error(`THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.`);r(a.buffer,e,i),a.version=e.version}}return{get:i,remove:a,update:o}}var G={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,common:`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:`gl_FragColor = linearToOutputTexel( gl_FragColor );`,colorspace_pars_fragment:`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment:`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return v;
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,depth_frag:`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distance_vert:`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,distance_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,linedashed_frag:`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,meshbasic_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,meshbasic_frag:`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshlambert_vert:`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshmatcap_vert:`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,meshmatcap_frag:`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshnormal_vert:`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshphysical_vert:`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,meshphysical_frag:`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshtoon_vert:`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,points_vert:`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,points_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,shadow_vert:`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,sprite_vert:`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sprite_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`},K={common:{diffuse:{value:new I(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new L},alphaMap:{value:null},alphaMapTransform:{value:new L},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new L}},envmap:{envMap:{value:null},envMapRotation:{value:new L},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new L}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new L}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new L},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new L},normalScale:{value:new ct(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new L},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new L}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new L}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new L}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new I(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new I(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new L},alphaTest:{value:0},uvTransform:{value:new L}},sprite:{diffuse:{value:new I(16777215)},opacity:{value:1},center:{value:new ct(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new L},alphaMap:{value:null},alphaMapTransform:{value:new L},alphaTest:{value:0}}},Yn={basic:{uniforms:ft([K.common,K.specularmap,K.envmap,K.aomap,K.lightmap,K.fog]),vertexShader:G.meshbasic_vert,fragmentShader:G.meshbasic_frag},lambert:{uniforms:ft([K.common,K.specularmap,K.envmap,K.aomap,K.lightmap,K.emissivemap,K.bumpmap,K.normalmap,K.displacementmap,K.fog,K.lights,{emissive:{value:new I(0)},envMapIntensity:{value:1}}]),vertexShader:G.meshlambert_vert,fragmentShader:G.meshlambert_frag},phong:{uniforms:ft([K.common,K.specularmap,K.envmap,K.aomap,K.lightmap,K.emissivemap,K.bumpmap,K.normalmap,K.displacementmap,K.fog,K.lights,{emissive:{value:new I(0)},specular:{value:new I(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:G.meshphong_vert,fragmentShader:G.meshphong_frag},standard:{uniforms:ft([K.common,K.envmap,K.aomap,K.lightmap,K.emissivemap,K.bumpmap,K.normalmap,K.displacementmap,K.roughnessmap,K.metalnessmap,K.fog,K.lights,{emissive:{value:new I(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:G.meshphysical_vert,fragmentShader:G.meshphysical_frag},toon:{uniforms:ft([K.common,K.aomap,K.lightmap,K.emissivemap,K.bumpmap,K.normalmap,K.displacementmap,K.gradientmap,K.fog,K.lights,{emissive:{value:new I(0)}}]),vertexShader:G.meshtoon_vert,fragmentShader:G.meshtoon_frag},matcap:{uniforms:ft([K.common,K.bumpmap,K.normalmap,K.displacementmap,K.fog,{matcap:{value:null}}]),vertexShader:G.meshmatcap_vert,fragmentShader:G.meshmatcap_frag},points:{uniforms:ft([K.points,K.fog]),vertexShader:G.points_vert,fragmentShader:G.points_frag},dashed:{uniforms:ft([K.common,K.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:G.linedashed_vert,fragmentShader:G.linedashed_frag},depth:{uniforms:ft([K.common,K.displacementmap]),vertexShader:G.depth_vert,fragmentShader:G.depth_frag},normal:{uniforms:ft([K.common,K.bumpmap,K.normalmap,K.displacementmap,{opacity:{value:1}}]),vertexShader:G.meshnormal_vert,fragmentShader:G.meshnormal_frag},sprite:{uniforms:ft([K.sprite,K.fog]),vertexShader:G.sprite_vert,fragmentShader:G.sprite_frag},background:{uniforms:{uvTransform:{value:new L},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:G.background_vert,fragmentShader:G.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new L}},vertexShader:G.backgroundCube_vert,fragmentShader:G.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:G.cube_vert,fragmentShader:G.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:G.equirect_vert,fragmentShader:G.equirect_frag},distance:{uniforms:ft([K.common,K.displacementmap,{referencePosition:{value:new S},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:G.distance_vert,fragmentShader:G.distance_frag},shadow:{uniforms:ft([K.lights,K.fog,{color:{value:new I(0)},opacity:{value:1}}]),vertexShader:G.shadow_vert,fragmentShader:G.shadow_frag}};Yn.physical={uniforms:ft([Yn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new L},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new L},clearcoatNormalScale:{value:new ct(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new L},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new L},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new L},sheen:{value:0},sheenColor:{value:new I(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new L},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new L},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new L},transmissionSamplerSize:{value:new ct},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new L},attenuationDistance:{value:0},attenuationColor:{value:new I(0)},specularColor:{value:new I(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new L},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new L},anisotropyVector:{value:new ct},anisotropyMap:{value:null},anisotropyMapTransform:{value:new L}}]),vertexShader:G.meshphysical_vert,fragmentShader:G.meshphysical_frag};var Xn={r:0,b:0,g:0},Zn=new D,Qn=new Ye;function $n(e,t,n,r,i,a){let o=new I(0),s=i===!0?0:1,l,u,d=null,f=0,p=null;function m(e){let n=e.isScene===!0?e.background:null;if(n&&n.isTexture){let r=e.backgroundBlurriness>0;n=t.get(n,r)}return n}function h(t){let r=!1,i=m(t);i===null?_(o,s):i&&i.isColor&&(_(i,1),r=!0);let c=e.xr.getEnvironmentBlendMode();c===`additive`?n.buffers.color.setClear(0,0,0,1,a):c===`alpha-blend`&&n.buffers.color.setClear(0,0,0,0,a),(e.autoClear||r)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function g(t,n){let i=m(n);i&&(i.isCubeTexture||i.mapping===306)?(u===void 0&&(u=new U(new R(1,1,1),new Ct({name:`BackgroundCubeMaterial`,uniforms:Me(Yn.backgroundCube.uniforms),vertexShader:Yn.backgroundCube.vertexShader,fragmentShader:Yn.backgroundCube.fragmentShader,side:1,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute(`normal`),u.geometry.deleteAttribute(`uv`),u.onBeforeRender=function(e,t,n){this.matrixWorld.copyPosition(n.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(u)),Zn.copy(n.backgroundRotation),Zn.x*=-1,Zn.y*=-1,Zn.z*=-1,i.isCubeTexture&&i.isRenderTargetTexture===!1&&(Zn.y*=-1,Zn.z*=-1),u.material.uniforms.envMap.value=i,u.material.uniforms.flipEnvMap.value=i.isCubeTexture&&i.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=n.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(Qn.makeRotationFromEuler(Zn)),u.material.toneMapped=bt.getTransfer(i.colorSpace)!==F,(d!==i||f!==i.version||p!==e.toneMapping)&&(u.material.needsUpdate=!0,d=i,f=i.version,p=e.toneMapping),u.layers.enableAll(),t.unshift(u,u.geometry,u.material,0,0,null)):i&&i.isTexture&&(l===void 0&&(l=new U(new c(2,2),new Ct({name:`BackgroundMaterial`,uniforms:Me(Yn.background.uniforms),vertexShader:Yn.background.vertexShader,fragmentShader:Yn.background.fragmentShader,side:0,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute(`normal`),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(l)),l.material.uniforms.t2D.value=i,l.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,l.material.toneMapped=bt.getTransfer(i.colorSpace)!==F,i.matrixAutoUpdate===!0&&i.updateMatrix(),l.material.uniforms.uvTransform.value.copy(i.matrix),(d!==i||f!==i.version||p!==e.toneMapping)&&(l.material.needsUpdate=!0,d=i,f=i.version,p=e.toneMapping),l.layers.enableAll(),t.unshift(l,l.geometry,l.material,0,0,null))}function _(t,r){t.getRGB(Xn,Te(e)),n.buffers.color.setClear(Xn.r,Xn.g,Xn.b,r,a)}function v(){u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(e,t=1){o.set(e),s=t,_(o,s)},getClearAlpha:function(){return s},setClearAlpha:function(e){s=e,_(o,s)},render:h,addToRenderList:g,dispose:v}}function er(e,t){let n=e.getParameter(e.MAX_VERTEX_ATTRIBS),r={},i=f(null),a=i,o=!1;function s(n,r,i,s,c){let u=!1,f=d(n,s,i,r);a!==f&&(a=f,l(a.object)),u=p(n,s,i,c),u&&m(n,s,i,c),c!==null&&t.update(c,e.ELEMENT_ARRAY_BUFFER),(u||o)&&(o=!1,b(n,r,i,s),c!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(c).buffer))}function c(){return e.createVertexArray()}function l(t){return e.bindVertexArray(t)}function u(t){return e.deleteVertexArray(t)}function d(e,t,n,i){let a=i.wireframe===!0,o=r[t.id];o===void 0&&(o={},r[t.id]=o);let s=e.isInstancedMesh===!0?e.id:0,l=o[s];l===void 0&&(l={},o[s]=l);let u=l[n.id];u===void 0&&(u={},l[n.id]=u);let d=u[a];return d===void 0&&(d=f(c()),u[a]=d),d}function f(e){let t=[],r=[],i=[];for(let e=0;e<n;e++)t[e]=0,r[e]=0,i[e]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:t,enabledAttributes:r,attributeDivisors:i,object:e,attributes:{},index:null}}function p(e,t,n,r){let i=a.attributes,o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=i[t],r=o[t];if(r===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(r=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(r=e.instanceColor)),n===void 0||n.attribute!==r||r&&n.data!==r.data)return!0;s++}return a.attributesNum!==s||a.index!==r}function m(e,t,n,r){let i={},o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=o[t];n===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(n=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(n=e.instanceColor));let r={};r.attribute=n,n&&n.data&&(r.data=n.data),i[t]=r,s++}a.attributes=i,a.attributesNum=s,a.index=r}function h(){let e=a.newAttributes;for(let t=0,n=e.length;t<n;t++)e[t]=0}function g(e){_(e,0)}function _(t,n){let r=a.newAttributes,i=a.enabledAttributes,o=a.attributeDivisors;r[t]=1,i[t]===0&&(e.enableVertexAttribArray(t),i[t]=1),o[t]!==n&&(e.vertexAttribDivisor(t,n),o[t]=n)}function v(){let t=a.newAttributes,n=a.enabledAttributes;for(let r=0,i=n.length;r<i;r++)n[r]!==t[r]&&(e.disableVertexAttribArray(r),n[r]=0)}function y(t,n,r,i,a,o,s){s===!0?e.vertexAttribIPointer(t,n,r,a,o):e.vertexAttribPointer(t,n,r,i,a,o)}function b(n,r,i,a){h();let o=a.attributes,s=i.getAttributes(),c=r.defaultAttributeValues;for(let r in s){let i=s[r];if(i.location>=0){let s=o[r];if(s===void 0&&(r===`instanceMatrix`&&n.instanceMatrix&&(s=n.instanceMatrix),r===`instanceColor`&&n.instanceColor&&(s=n.instanceColor)),s!==void 0){let r=s.normalized,o=s.itemSize,c=t.get(s);if(c===void 0)continue;let l=c.buffer,u=c.type,d=c.bytesPerElement,f=u===e.INT||u===e.UNSIGNED_INT||s.gpuType===1013;if(s.isInterleavedBufferAttribute){let t=s.data,c=t.stride,p=s.offset;if(t.isInstancedInterleavedBuffer){for(let e=0;e<i.locationSize;e++)_(i.location+e,t.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=t.meshPerAttribute*t.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,c*d,(p+o/i.locationSize*e)*d,f)}else{if(s.isInstancedBufferAttribute){for(let e=0;e<i.locationSize;e++)_(i.location+e,s.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=s.meshPerAttribute*s.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,o*d,o/i.locationSize*e*d,f)}}else if(c!==void 0){let t=c[r];if(t!==void 0)switch(t.length){case 2:e.vertexAttrib2fv(i.location,t);break;case 3:e.vertexAttrib3fv(i.location,t);break;case 4:e.vertexAttrib4fv(i.location,t);break;default:e.vertexAttrib1fv(i.location,t)}}}}v()}function x(){T();for(let e in r){let t=r[e];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e]}}function S(e){if(r[e.id]===void 0)return;let t=r[e.id];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e.id]}function C(e){for(let t in r){let n=r[t];for(let t in n){let r=n[t];if(r[e.id]===void 0)continue;let i=r[e.id];for(let e in i)u(i[e].object),delete i[e];delete r[e.id]}}}function w(e){for(let t in r){let n=r[t],i=e.isInstancedMesh===!0?e.id:0,a=n[i];if(a!==void 0){for(let e in a){let t=a[e];for(let e in t)u(t[e].object),delete t[e];delete a[e]}delete n[i],Object.keys(n).length===0&&delete r[t]}}}function T(){E(),o=!0,a!==i&&(a=i,l(a.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:s,reset:T,resetDefaultState:E,dispose:x,releaseStatesOfGeometry:S,releaseStatesOfObject:w,releaseStatesOfProgram:C,initAttributes:h,enableAttribute:g,disableUnusedAttributes:v}}function tr(e,t,n){let r;function i(e){r=e}function a(t,i){e.drawArrays(r,t,i),n.update(i,r,1)}function o(t,i,a){a!==0&&(e.drawArraysInstanced(r,t,i,a),n.update(i,r,a))}function s(e,i,a){if(a===0)return;t.get(`WEBGL_multi_draw`).multiDrawArraysWEBGL(r,e,0,i,0,a);let o=0;for(let e=0;e<a;e++)o+=i[e];n.update(o,r,1)}function c(e,i,a,s){if(a===0)return;let c=t.get(`WEBGL_multi_draw`);if(c===null)for(let t=0;t<e.length;t++)o(e[t],i[t],s[t]);else{c.multiDrawArraysInstancedWEBGL(r,e,0,i,0,s,0,a);let t=0;for(let e=0;e<a;e++)t+=i[e]*s[e];n.update(t,r,1)}}this.setMode=i,this.render=a,this.renderInstances=o,this.renderMultiDraw=s,this.renderMultiDrawInstances=c}function nr(e,t,n,r){let i;function a(){if(i!==void 0)return i;if(t.has(`EXT_texture_filter_anisotropic`)===!0){let n=t.get(`EXT_texture_filter_anisotropic`);i=e.getParameter(n.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(t){return t===1023||r.convert(t)===e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT)}function s(n){let i=n===1016&&(t.has(`EXT_color_buffer_half_float`)||t.has(`EXT_color_buffer_float`));return!(n!==1009&&r.convert(n)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE)&&n!==1015&&!i)}function c(t){if(t===`highp`){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return`highp`;t=`mediump`}return t===`mediump`&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?`mediump`:`lowp`}let l=n.precision===void 0?`highp`:n.precision,u=c(l);u!==l&&(Je(`WebGLRenderer:`,l,`not supported, using`,u,`instead.`),l=u);let d=n.logarithmicDepthBuffer===!0,f=n.reversedDepthBuffer===!0&&t.has(`EXT_clip_control`),p=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),m=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),h=e.getParameter(e.MAX_TEXTURE_SIZE),g=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),_=e.getParameter(e.MAX_VERTEX_ATTRIBS),v=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),y=e.getParameter(e.MAX_VARYING_VECTORS),b=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),x=e.getParameter(e.MAX_SAMPLES),S=e.getParameter(e.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:a,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:s,precision:l,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:m,maxTextureSize:h,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:v,maxVaryings:y,maxFragmentUniforms:b,maxSamples:x,samples:S}}function rr(e){let t=this,n=null,r=0,i=!1,a=!1,o=new ce,s=new L,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(e,t){let n=e.length!==0||t||r!==0||i;return i=t,r=e.length,n},this.beginShadows=function(){a=!0,u(null)},this.endShadows=function(){a=!1},this.setGlobalState=function(e,t){n=u(e,t,0)},this.setState=function(t,o,s){let d=t.clippingPlanes,f=t.clipIntersection,p=t.clipShadows,m=e.get(t);if(!i||d===null||d.length===0||a&&!p)a?u(null):l();else{let e=a?0:r,t=e*4,i=m.clippingState||null;c.value=i,i=u(d,o,t,s);for(let e=0;e!==t;++e)i[e]=n[e];m.clippingState=i,this.numIntersection=f?this.numPlanes:0,this.numPlanes+=e}};function l(){c.value!==n&&(c.value=n,c.needsUpdate=r>0),t.numPlanes=r,t.numIntersection=0}function u(e,n,r,i){let a=e===null?0:e.length,l=null;if(a!==0){if(l=c.value,i!==!0||l===null){let t=r+a*4,i=n.matrixWorldInverse;s.getNormalMatrix(i),(l===null||l.length<t)&&(l=new Float32Array(t));for(let t=0,n=r;t!==a;++t,n+=4)o.copy(e[t]).applyMatrix4(i,s),o.normal.toArray(l,n),l[n+3]=o.constant}c.value=l,c.needsUpdate=!0}return t.numPlanes=a,t.numIntersection=0,l}}var ir=4,ar=[.125,.215,.35,.446,.526,.582],or=20,sr=256,cr=new Oe,lr=new I,ur=null,dr=0,fr=0,pr=!1,mr=new S,hr=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,r=100,i={}){let{size:a=256,position:o=mr}=i;ur=this._renderer.getRenderTarget(),dr=this._renderer.getActiveCubeFace(),fr=this._renderer.getActiveMipmapLevel(),pr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,r,s,o),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Sr(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=xr(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=2**this._lodMax}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(ur,dr,fr),this._renderer.xr.enabled=pr,e.scissorTest=!1,vr(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===301||e.mapping===302?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),ur=this._renderer.getRenderTarget(),dr=this._renderer.getActiveCubeFace(),fr=this._renderer.getActiveMipmapLevel(),pr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,r={magFilter:ye,minFilter:ye,generateMipmaps:!1,type:me,format:k,colorSpace:t,depthBuffer:!1},i=_r(e,n,r);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=_r(e,n,r);let{_lodMax:t}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=gr(t)),this._blurMaterial=br(t,e,n),this._ggxMaterial=yr(t,e,n)}return i}_compileMaterial(e){let t=new U(new at,e);this._renderer.compile(t,cr)}_sceneToCubeUV(e,t,n,r,i){let a=new Dt(90,1,t,n),o=[1,-1,1,1,1,1],s=[1,1,1,-1,-1,-1],c=this._renderer,l=c.autoClear,u=c.toneMapping;c.getClearColor(lr),c.toneMapping=0,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new U(new R,new z({name:`PMREM.Background`,side:1,depthWrite:!1,depthTest:!1})));let d=this._backgroundBox,f=d.material,p=!1,m=e.background;m?m.isColor&&(f.color.copy(m),e.background=null,p=!0):(f.color.copy(lr),p=!0);for(let t=0;t<6;t++){let n=t%3;n===0?(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x+s[t],i.y,i.z)):n===1?(a.up.set(0,0,o[t]),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y+s[t],i.z)):(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y,i.z+s[t]));let l=this._cubeSize;vr(r,n*l,t>2?l:0,l,l),c.setRenderTarget(r),p&&c.render(d,a),c.render(e,a)}c.toneMapping=u,c.autoClear=l,e.background=m}_textureToCubeUV(e,t){let n=this._renderer,r=e.mapping===301||e.mapping===302;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=Sr()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=xr());let i=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=i;let o=i.uniforms;o.envMap.value=e;let s=this._cubeSize;vr(t,0,0,3*s,2*s),n.setRenderTarget(t),n.render(a,cr)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let t=1;t<r;t++)this._applyGGXFilter(e,t-1,t);t.autoClear=n}_applyGGXFilter(e,t,n){let r=this._renderer,i=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let s=a.uniforms,c=n/(this._lodMeshes.length-1),l=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-l*l)*(0+c*1.25),{_lodMax:d}=this,f=this._sizeLods[n],p=3*f*(n>d-ir?n-d+ir:0),m=4*(this._cubeSize-f);s.envMap.value=e.texture,s.roughness.value=u,s.mipInt.value=d-t,vr(i,p,m,3*f,2*f),r.setRenderTarget(i),r.render(o,cr),s.envMap.value=i.texture,s.roughness.value=0,s.mipInt.value=d-n,vr(e,p,m,3*f,2*f),r.setRenderTarget(e),r.render(o,cr)}_blur(e,t,n,r,i){let a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,r,`latitudinal`,i),this._halfBlur(a,e,n,n,r,`longitudinal`,i)}_halfBlur(e,t,n,r,i,a,o){let s=this._renderer,c=this._blurMaterial;a!==`latitudinal`&&a!==`longitudinal`&&ut(`blur direction must be either latitudinal or longitudinal!`);let l=this._lodMeshes[r];l.material=c;let u=c.uniforms,d=this._sizeLods[n]-1,f=isFinite(i)?Math.PI/(2*d):2*Math.PI/39,p=i/f,m=isFinite(i)?1+Math.floor(3*p):or;m>or&&Je(`sigmaRadians, ${i}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${or}`);let h=[],g=0;for(let e=0;e<or;++e){let t=e/p,n=Math.exp(-t*t/2);h.push(n),e===0?g+=n:e<m&&(g+=2*n)}for(let e=0;e<h.length;e++)h[e]=h[e]/g;u.envMap.value=e.texture,u.samples.value=m,u.weights.value=h,u.latitudinal.value=a===`latitudinal`,o&&(u.poleAxis.value=o);let{_lodMax:_}=this;u.dTheta.value=f,u.mipInt.value=_-n;let v=this._sizeLods[r];vr(t,3*v*(r>_-ir?r-_+ir:0),4*(this._cubeSize-v),3*v,2*v),s.setRenderTarget(t),s.render(l,cr)}};function gr(e){let t=[],n=[],r=[],i=e,a=e-ir+1+ar.length;for(let o=0;o<a;o++){let a=2**i;t.push(a);let s=1/a;o>e-ir?s=ar[o-e+ir-1]:o===0&&(s=0),n.push(s);let c=1/(a-2),l=-c,u=1+c,d=[l,l,u,l,u,u,l,l,u,u,l,u],f=new Float32Array(108),p=new Float32Array(72),m=new Float32Array(36);for(let e=0;e<6;e++){let t=e%3*2/3-1,n=e>2?0:-1,r=[t,n,0,t+2/3,n,0,t+2/3,n+1,0,t,n,0,t+2/3,n+1,0,t,n+1,0];f.set(r,18*e),p.set(d,12*e);let i=[e,e,e,e,e,e];m.set(i,6*e)}let h=new at;h.setAttribute(`position`,new Ne(f,3)),h.setAttribute(`uv`,new Ne(p,2)),h.setAttribute(`faceIndex`,new Ne(m,1)),r.push(new U(h,null)),i>ir&&i--}return{lodMeshes:r,sizeLods:t,sigmas:n}}function _r(e,t,n){let r=new N(e,t,n);return r.texture.mapping=306,r.texture.name=`PMREM.cubeUv`,r.scissorTest=!0,r}function vr(e,t,n,r,i){e.viewport.set(t,n,r,i),e.scissor.set(t,n,r,i)}function yr(e,t,n){return new Ct({name:`PMREMGGXConvolution`,defines:{GGX_SAMPLES:sr,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Cr(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function br(e,t,n){let r=new Float32Array(or),i=new S(0,1,0);return new Ct({name:`SphericalGaussianBlur`,defines:{n:or,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:r},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:Cr(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function xr(){return new Ct({name:`EquirectangularToCubeUV`,uniforms:{envMap:{value:null}},vertexShader:Cr(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function Sr(){return new Ct({name:`CubemapToCubeUV`,uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Cr(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function Cr(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}var wr=class extends N{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},r=[n,n,n,n,n,n];this.texture=new se(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new R(5,5,5),i=new Ct({name:`CubemapFromEquirect`,uniforms:Me(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:1,blending:0});i.uniforms.tEquirect.value=t;let a=new U(r,i),o=t.minFilter;return t.minFilter===1008&&(t.minFilter=ye),new De(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,r=!0){let i=e.getRenderTarget();for(let i=0;i<6;i++)e.setRenderTarget(this,i),e.clear(t,n,r);e.setRenderTarget(i)}};function Tr(e){let t=new WeakMap,n=new WeakMap,r=null;function i(e,t=!1){return e==null?null:t?o(e):a(e)}function a(n){if(n&&n.isTexture){let r=n.mapping;if(r===303||r===304){if(t.has(n)){let e=t.get(n).texture;return s(e,n.mapping)}{let r=n.image;if(r&&r.height>0){let i=new wr(r.height);return i.fromEquirectangularTexture(e,n),t.set(n,i),n.addEventListener(`dispose`,l),s(i.texture,n.mapping)}return null}}}return n}function o(t){if(t&&t.isTexture){let i=t.mapping,a=i===303||i===304,o=i===301||i===302;if(a||o){let i=n.get(t),s=i===void 0?0:i.texture.pmremVersion;if(t.isRenderTargetTexture&&t.pmremVersion!==s)return r===null&&(r=new hr(e)),i=a?r.fromEquirectangular(t,i):r.fromCubemap(t,i),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),i.texture;if(i!==void 0)return i.texture;{let s=t.image;return a&&s&&s.height>0||o&&s&&c(s)?(r===null&&(r=new hr(e)),i=a?r.fromEquirectangular(t):r.fromCubemap(t),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),t.addEventListener(`dispose`,u),i.texture):null}}}return t}function s(e,t){return t===303?e.mapping=301:t===304&&(e.mapping=302),e}function c(e){let t=0;for(let n=0;n<6;n++)e[n]!==void 0&&t++;return t===6}function l(e){let n=e.target;n.removeEventListener(`dispose`,l);let r=t.get(n);r!==void 0&&(t.delete(n),r.dispose())}function u(e){let t=e.target;t.removeEventListener(`dispose`,u);let r=n.get(t);r!==void 0&&(n.delete(t),r.dispose())}function d(){t=new WeakMap,n=new WeakMap,r!==null&&(r.dispose(),r=null)}return{get:i,dispose:d}}function Er(e){let t={};function n(n){if(t[n]!==void 0)return t[n];let r=e.getExtension(n);return t[n]=r,r}return{has:function(e){return n(e)!==null},init:function(){n(`EXT_color_buffer_float`),n(`WEBGL_clip_cull_distance`),n(`OES_texture_float_linear`),n(`EXT_color_buffer_half_float`),n(`WEBGL_multisampled_render_to_texture`),n(`WEBGL_render_shared_exponent`)},get:function(e){let t=n(e);return t===null&&yt(`WebGLRenderer: `+e+` extension not supported.`),t}}}function Dr(e,t,n,r){let i={},a=new WeakMap;function o(e){let s=e.target;s.index!==null&&t.remove(s.index);for(let e in s.attributes)t.remove(s.attributes[e]);s.removeEventListener(`dispose`,o),delete i[s.id];let c=a.get(s);c&&(t.remove(c),a.delete(s)),r.releaseStatesOfGeometry(s),s.isInstancedBufferGeometry===!0&&delete s._maxInstanceCount,n.memory.geometries--}function s(e,t){return i[t.id]===!0||(t.addEventListener(`dispose`,o),i[t.id]=!0,n.memory.geometries++),t}function c(n){let r=n.attributes;for(let n in r)t.update(r[n],e.ARRAY_BUFFER)}function l(e){let n=[],r=e.index,i=e.attributes.position,o=0;if(i===void 0)return;if(r!==null){let e=r.array;o=r.version;for(let t=0,r=e.length;t<r;t+=3){let r=e[t+0],i=e[t+1],a=e[t+2];n.push(r,i,i,a,a,r)}}else{let e=i.array;o=i.version;for(let t=0,r=e.length/3-1;t<r;t+=3){let e=t+0,r=t+1,i=t+2;n.push(e,r,r,i,i,e)}}let s=new(i.count>=65535?b:h)(n,1);s.version=o;let c=a.get(e);c&&t.remove(c),a.set(e,s)}function u(e){let t=a.get(e);if(t){let n=e.index;n!==null&&t.version<n.version&&l(e)}else l(e);return a.get(e)}return{get:s,update:c,getWireframeAttribute:u}}function Or(e,t,n){let r;function i(e){r=e}let a,o;function s(e){a=e.type,o=e.bytesPerElement}function c(t,i){e.drawElements(r,i,a,t*o),n.update(i,r,1)}function l(t,i,s){s!==0&&(e.drawElementsInstanced(r,i,a,t*o,s),n.update(i,r,s))}function u(e,i,o){if(o===0)return;t.get(`WEBGL_multi_draw`).multiDrawElementsWEBGL(r,i,0,a,e,0,o);let s=0;for(let e=0;e<o;e++)s+=i[e];n.update(s,r,1)}function d(e,i,s,c){if(s===0)return;let u=t.get(`WEBGL_multi_draw`);if(u===null)for(let t=0;t<e.length;t++)l(e[t]/o,i[t],c[t]);else{u.multiDrawElementsInstancedWEBGL(r,i,0,a,e,0,c,0,s);let t=0;for(let e=0;e<s;e++)t+=i[e]*c[e];n.update(t,r,1)}}this.setMode=i,this.setIndex=s,this.render=c,this.renderInstances=l,this.renderMultiDraw=u,this.renderMultiDrawInstances=d}function kr(e){let t={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function r(t,r,i){switch(n.calls++,r){case e.TRIANGLES:n.triangles+=t/3*i;break;case e.LINES:n.lines+=t/2*i;break;case e.LINE_STRIP:n.lines+=i*(t-1);break;case e.LINE_LOOP:n.lines+=i*t;break;case e.POINTS:n.points+=i*t;break;default:ut(`WebGLInfo: Unknown draw mode:`,r)}}function i(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:t,render:n,programs:null,autoReset:!0,reset:i,update:r}}function Ar(e,t,n){let r=new WeakMap,i=new be;function a(a,o,s){let c=a.morphTargetInfluences,l=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=l===void 0?0:l.length,d=r.get(o);if(d===void 0||d.count!==u){d!==void 0&&d.texture.dispose();let e=o.morphAttributes.position!==void 0,n=o.morphAttributes.normal!==void 0,a=o.morphAttributes.color!==void 0,s=o.morphAttributes.position||[],c=o.morphAttributes.normal||[],l=o.morphAttributes.color||[],f=0;e===!0&&(f=1),n===!0&&(f=2),a===!0&&(f=3);let p=o.attributes.position.count*f,m=1;p>t.maxTextureSize&&(m=Math.ceil(p/t.maxTextureSize),p=t.maxTextureSize);let h=new Float32Array(p*m*4*u),g=new St(h,p,m,u);g.type=T,g.needsUpdate=!0;let _=f*4;for(let t=0;t<u;t++){let r=s[t],o=c[t],u=l[t],d=p*m*4*t;for(let t=0;t<r.count;t++){let s=t*_;e===!0&&(i.fromBufferAttribute(r,t),h[d+s+0]=i.x,h[d+s+1]=i.y,h[d+s+2]=i.z,h[d+s+3]=0),n===!0&&(i.fromBufferAttribute(o,t),h[d+s+4]=i.x,h[d+s+5]=i.y,h[d+s+6]=i.z,h[d+s+7]=0),a===!0&&(i.fromBufferAttribute(u,t),h[d+s+8]=i.x,h[d+s+9]=i.y,h[d+s+10]=i.z,h[d+s+11]=u.itemSize===4?i.w:1)}}d={count:u,texture:g,size:new ct(p,m)},r.set(o,d);function v(){g.dispose(),r.delete(o),o.removeEventListener(`dispose`,v)}o.addEventListener(`dispose`,v)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)s.getUniforms().setValue(e,`morphTexture`,a.morphTexture,n);else{let t=0;for(let e=0;e<c.length;e++)t+=c[e];let n=o.morphTargetsRelative?1:1-t;s.getUniforms().setValue(e,`morphTargetBaseInfluence`,n),s.getUniforms().setValue(e,`morphTargetInfluences`,c)}s.getUniforms().setValue(e,`morphTargetsTexture`,d.texture,n),s.getUniforms().setValue(e,`morphTargetsTextureSize`,d.size)}return{update:a}}function jr(e,t,n,r,i){let a=new WeakMap;function o(r){let o=i.render.frame,s=r.geometry,l=t.get(r,s);if(a.get(l)!==o&&(t.update(l),a.set(l,o)),r.isInstancedMesh&&(r.hasEventListener(`dispose`,c)===!1&&r.addEventListener(`dispose`,c),a.get(r)!==o&&(n.update(r.instanceMatrix,e.ARRAY_BUFFER),r.instanceColor!==null&&n.update(r.instanceColor,e.ARRAY_BUFFER),a.set(r,o))),r.isSkinnedMesh){let e=r.skeleton;a.get(e)!==o&&(e.update(),a.set(e,o))}return l}function s(){a=new WeakMap}function c(e){let t=e.target;t.removeEventListener(`dispose`,c),r.releaseStatesOfObject(t),n.remove(t.instanceMatrix),t.instanceColor!==null&&n.remove(t.instanceColor)}return{update:o,dispose:s}}var Mr={1:`LINEAR_TONE_MAPPING`,2:`REINHARD_TONE_MAPPING`,3:`CINEON_TONE_MAPPING`,4:`ACES_FILMIC_TONE_MAPPING`,6:`AGX_TONE_MAPPING`,7:`NEUTRAL_TONE_MAPPING`,5:`CUSTOM_TONE_MAPPING`};function Nr(e,t,n,r,i){let a=new N(t,n,{type:e,depthBuffer:r,stencilBuffer:i}),o=new N(t,n,{type:me,depthBuffer:!1,stencilBuffer:!1}),s=new at;s.setAttribute(`position`,new y([-1,3,0,-1,-1,0,3,-1,0],3)),s.setAttribute(`uv`,new y([0,2,0,0,2,0],2));let c=new je({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),l=new U(s,c),u=new Oe(-1,1,1,-1,0,1),d=null,f=null,p=!1,m,h=null,g=[],_=!1;this.setSize=function(e,t){a.setSize(e,t),o.setSize(e,t);for(let n=0;n<g.length;n++){let r=g[n];r.setSize&&r.setSize(e,t)}},this.setEffects=function(e){g=e,_=g.length>0&&g[0].isRenderPass===!0;let t=a.width,n=a.height;for(let e=0;e<g.length;e++){let r=g[e];r.setSize&&r.setSize(t,n)}},this.begin=function(e,t){if(p||e.toneMapping===0&&g.length===0)return!1;if(h=t,t!==null){let e=t.width,n=t.height;(a.width!==e||a.height!==n)&&this.setSize(e,n)}return _===!1&&e.setRenderTarget(a),m=e.toneMapping,e.toneMapping=0,!0},this.hasRenderPass=function(){return _},this.end=function(e,t){e.toneMapping=m,p=!0;let n=a,r=o;for(let i=0;i<g.length;i++){let a=g[i];if(a.enabled!==!1&&(a.render(e,r,n,t),a.needsSwap!==!1)){let e=n;n=r,r=e}}if(d!==e.outputColorSpace||f!==e.toneMapping){d=e.outputColorSpace,f=e.toneMapping,c.defines={},bt.getTransfer(d)===`srgb`&&(c.defines.SRGB_TRANSFER=``);let t=Mr[f];t&&(c.defines[t]=``),c.needsUpdate=!0}c.uniforms.tDiffuse.value=n.texture,e.setRenderTarget(h),e.render(l,u),h=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){a.dispose(),o.dispose(),s.dispose(),c.dispose()}}var Pr=new O,Fr=new r(1,1),Ir=new St,Lr=new o,Rr=new se,zr=[],Br=[],Vr=new Float32Array(16),Hr=new Float32Array(9),Ur=new Float32Array(4);function Wr(e,t,n){let r=e[0];if(r<=0||r>0)return e;let i=t*n,a=zr[i];if(a===void 0&&(a=new Float32Array(i),zr[i]=a),t!==0){r.toArray(a,0);for(let r=1,i=0;r!==t;++r)i+=n,e[r].toArray(a,i)}return a}function Gr(e,t){if(e.length!==t.length)return!1;for(let n=0,r=e.length;n<r;n++)if(e[n]!==t[n])return!1;return!0}function Kr(e,t){for(let n=0,r=t.length;n<r;n++)e[n]=t[n]}function qr(e,t){let n=Br[t];n===void 0&&(n=new Int32Array(t),Br[t]=n);for(let r=0;r!==t;++r)n[r]=e.allocateTextureUnit();return n}function Jr(e,t){let n=this.cache;n[0]!==t&&(e.uniform1f(this.addr,t),n[0]=t)}function Yr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Gr(n,t))return;e.uniform2fv(this.addr,t),Kr(n,t)}}function Xr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else if(t.r!==void 0)(n[0]!==t.r||n[1]!==t.g||n[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),n[0]=t.r,n[1]=t.g,n[2]=t.b);else{if(Gr(n,t))return;e.uniform3fv(this.addr,t),Kr(n,t)}}function Zr(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Gr(n,t))return;e.uniform4fv(this.addr,t),Kr(n,t)}}function Qr(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Gr(n,t))return;e.uniformMatrix2fv(this.addr,!1,t),Kr(n,t)}else{if(Gr(n,r))return;Ur.set(r),e.uniformMatrix2fv(this.addr,!1,Ur),Kr(n,r)}}function $r(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Gr(n,t))return;e.uniformMatrix3fv(this.addr,!1,t),Kr(n,t)}else{if(Gr(n,r))return;Hr.set(r),e.uniformMatrix3fv(this.addr,!1,Hr),Kr(n,r)}}function ei(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Gr(n,t))return;e.uniformMatrix4fv(this.addr,!1,t),Kr(n,t)}else{if(Gr(n,r))return;Vr.set(r),e.uniformMatrix4fv(this.addr,!1,Vr),Kr(n,r)}}function ti(e,t){let n=this.cache;n[0]!==t&&(e.uniform1i(this.addr,t),n[0]=t)}function ni(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Gr(n,t))return;e.uniform2iv(this.addr,t),Kr(n,t)}}function ri(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(Gr(n,t))return;e.uniform3iv(this.addr,t),Kr(n,t)}}function ii(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Gr(n,t))return;e.uniform4iv(this.addr,t),Kr(n,t)}}function ai(e,t){let n=this.cache;n[0]!==t&&(e.uniform1ui(this.addr,t),n[0]=t)}function oi(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Gr(n,t))return;e.uniform2uiv(this.addr,t),Kr(n,t)}}function si(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(Gr(n,t))return;e.uniform3uiv(this.addr,t),Kr(n,t)}}function ci(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Gr(n,t))return;e.uniform4uiv(this.addr,t),Kr(n,t)}}function li(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i);let a;this.type===e.SAMPLER_2D_SHADOW?(Fr.compareFunction=n.isReversedDepthBuffer()?518:515,a=Fr):a=Pr,n.setTexture2D(t||a,i)}function ui(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture3D(t||Lr,i)}function di(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTextureCube(t||Rr,i)}function fi(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture2DArray(t||Ir,i)}function pi(e){switch(e){case 5126:return Jr;case 35664:return Yr;case 35665:return Xr;case 35666:return Zr;case 35674:return Qr;case 35675:return $r;case 35676:return ei;case 5124:case 35670:return ti;case 35667:case 35671:return ni;case 35668:case 35672:return ri;case 35669:case 35673:return ii;case 5125:return ai;case 36294:return oi;case 36295:return si;case 36296:return ci;case 35678:case 36198:case 36298:case 36306:case 35682:return li;case 35679:case 36299:case 36307:return ui;case 35680:case 36300:case 36308:case 36293:return di;case 36289:case 36303:case 36311:case 36292:return fi}}function mi(e,t){e.uniform1fv(this.addr,t)}function hi(e,t){let n=Wr(t,this.size,2);e.uniform2fv(this.addr,n)}function gi(e,t){let n=Wr(t,this.size,3);e.uniform3fv(this.addr,n)}function _i(e,t){let n=Wr(t,this.size,4);e.uniform4fv(this.addr,n)}function vi(e,t){let n=Wr(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,n)}function yi(e,t){let n=Wr(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,n)}function bi(e,t){let n=Wr(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,n)}function xi(e,t){e.uniform1iv(this.addr,t)}function Si(e,t){e.uniform2iv(this.addr,t)}function Ci(e,t){e.uniform3iv(this.addr,t)}function wi(e,t){e.uniform4iv(this.addr,t)}function Ti(e,t){e.uniform1uiv(this.addr,t)}function Ei(e,t){e.uniform2uiv(this.addr,t)}function Di(e,t){e.uniform3uiv(this.addr,t)}function Oi(e,t){e.uniform4uiv(this.addr,t)}function ki(e,t,n){let r=this.cache,i=t.length,a=qr(n,i);Gr(r,a)||(e.uniform1iv(this.addr,a),Kr(r,a));let o;o=this.type===e.SAMPLER_2D_SHADOW?Fr:Pr;for(let e=0;e!==i;++e)n.setTexture2D(t[e]||o,a[e])}function Ai(e,t,n){let r=this.cache,i=t.length,a=qr(n,i);Gr(r,a)||(e.uniform1iv(this.addr,a),Kr(r,a));for(let e=0;e!==i;++e)n.setTexture3D(t[e]||Lr,a[e])}function ji(e,t,n){let r=this.cache,i=t.length,a=qr(n,i);Gr(r,a)||(e.uniform1iv(this.addr,a),Kr(r,a));for(let e=0;e!==i;++e)n.setTextureCube(t[e]||Rr,a[e])}function Mi(e,t,n){let r=this.cache,i=t.length,a=qr(n,i);Gr(r,a)||(e.uniform1iv(this.addr,a),Kr(r,a));for(let e=0;e!==i;++e)n.setTexture2DArray(t[e]||Ir,a[e])}function Ni(e){switch(e){case 5126:return mi;case 35664:return hi;case 35665:return gi;case 35666:return _i;case 35674:return vi;case 35675:return yi;case 35676:return bi;case 5124:case 35670:return xi;case 35667:case 35671:return Si;case 35668:case 35672:return Ci;case 35669:case 35673:return wi;case 5125:return Ti;case 36294:return Ei;case 36295:return Di;case 36296:return Oi;case 35678:case 36198:case 36298:case 36306:case 35682:return ki;case 35679:case 36299:case 36307:return Ai;case 35680:case 36300:case 36308:case 36293:return ji;case 36289:case 36303:case 36311:case 36292:return Mi}}var Pi=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=pi(t.type)}},Fi=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Ni(t.type)}},Ii=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let r=this.seq;for(let i=0,a=r.length;i!==a;++i){let a=r[i];a.setValue(e,t[a.id],n)}}},Li=/(\w+)(\])?(\[|\.)?/g;function Ri(e,t){e.seq.push(t),e.map[t.id]=t}function zi(e,t,n){let r=e.name,i=r.length;for(Li.lastIndex=0;;){let a=Li.exec(r),o=Li.lastIndex,s=a[1],c=a[2]===`]`,l=a[3];if(c&&(s|=0),l===void 0||l===`[`&&o+2===i){Ri(n,l===void 0?new Pi(s,e,t):new Fi(s,e,t));break}{let e=n.map[s];e===void 0&&(e=new Ii(s),Ri(n,e)),n=e}}}var Bi=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<n;++r){let n=e.getActiveUniform(t,r);zi(n,e.getUniformLocation(t,n.name),this)}let r=[],i=[];for(let t of this.seq)t.type===e.SAMPLER_2D_SHADOW||t.type===e.SAMPLER_CUBE_SHADOW||t.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(t):i.push(t);r.length>0&&(this.seq=r.concat(i))}setValue(e,t,n,r){let i=this.map[t];i!==void 0&&i.setValue(e,n,r)}setOptional(e,t,n){let r=t[n];r!==void 0&&this.setValue(e,n,r)}static upload(e,t,n,r){for(let i=0,a=t.length;i!==a;++i){let a=t[i],o=n[a.id];o.needsUpdate!==!1&&a.setValue(e,o.value,r)}}static seqWithValue(e,t){let n=[];for(let r=0,i=e.length;r!==i;++r){let i=e[r];i.id in t&&n.push(i)}return n}};function Vi(e,t,n){let r=e.createShader(t);return e.shaderSource(r,n),e.compileShader(r),r}var Hi=37297,Ui=0;function Wi(e,t){let n=e.split(`
`),r=[],i=Math.max(t-6,0),a=Math.min(t+6,n.length);for(let e=i;e<a;e++){let i=e+1;r.push(`${i===t?`>`:` `} ${i}: ${n[e]}`)}return r.join(`
`)}var Gi=new L;function Ki(e){bt._getMatrix(Gi,bt.workingColorSpace,e);let t=`mat3( ${Gi.elements.map(e=>e.toFixed(4))} )`;switch(bt.getTransfer(e)){case B:return[t,`LinearTransferOETF`];case F:return[t,`sRGBTransferOETF`];default:return Je(`WebGLProgram: Unsupported color space: `,e),[t,`LinearTransferOETF`]}}function qi(e,t,n){let r=e.getShaderParameter(t,e.COMPILE_STATUS),i=(e.getShaderInfoLog(t)||``).trim();if(r&&i===``)return``;let a=/ERROR: 0:(\d+)/.exec(i);if(a){let r=parseInt(a[1]);return n.toUpperCase()+`

`+i+`

`+Wi(e.getShaderSource(t),r)}return i}function Ji(e,t){let n=Ki(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,`}`].join(`
`)}var Yi={1:`Linear`,2:`Reinhard`,3:`Cineon`,4:`ACESFilmic`,6:`AgX`,7:`Neutral`,5:`Custom`};function Xi(e,t){let n=Yi[t];return n===void 0?(Je(`WebGLProgram: Unsupported toneMapping:`,t),`vec3 `+e+`( vec3 color ) { return LinearToneMapping( color ); }`):`vec3 `+e+`( vec3 color ) { return `+n+`ToneMapping( color ); }`}var Zi=new S;function Qi(){return bt.getLuminanceCoefficients(Zi),[`float luminance( const in vec3 rgb ) {`,`	const vec3 weights = vec3( ${Zi.x.toFixed(4)}, ${Zi.y.toFixed(4)}, ${Zi.z.toFixed(4)} );`,`	return dot( weights, rgb );`,`}`].join(`
`)}function $i(e){return[e.extensionClipCullDistance?`#extension GL_ANGLE_clip_cull_distance : require`:``,e.extensionMultiDraw?`#extension GL_ANGLE_multi_draw : require`:``].filter(na).join(`
`)}function ea(e){let t=[];for(let n in e){let r=e[n];r!==!1&&t.push(`#define `+n+` `+r)}return t.join(`
`)}function ta(e,t){let n={},r=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let i=0;i<r;i++){let r=e.getActiveAttrib(t,i),a=r.name,o=1;r.type===e.FLOAT_MAT2&&(o=2),r.type===e.FLOAT_MAT3&&(o=3),r.type===e.FLOAT_MAT4&&(o=4),n[a]={type:r.type,location:e.getAttribLocation(t,a),locationSize:o}}return n}function na(e){return e!==``}function ra(e,t){let n=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function ia(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var aa=/^[ \t]*#include +<([\w\d./]+)>/gm;function oa(e){return e.replace(aa,ca)}var sa=new Map;function ca(e,t){let n=G[t];if(n===void 0){let e=sa.get(t);if(e!==void 0)n=G[e],Je(`WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.`,t,e);else throw Error(`Can not resolve #include <`+t+`>`)}return oa(n)}var la=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function ua(e){return e.replace(la,da)}function da(e,t,n,r){let i=``;for(let e=parseInt(t);e<parseInt(n);e++)i+=r.replace(/\[\s*i\s*\]/g,`[ `+e+` ]`).replace(/UNROLLED_LOOP_INDEX/g,e);return i}function fa(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision===`highp`?t+=`
#define HIGH_PRECISION`:e.precision===`mediump`?t+=`
#define MEDIUM_PRECISION`:e.precision===`lowp`&&(t+=`
#define LOW_PRECISION`),t}var pa={1:`SHADOWMAP_TYPE_PCF`,3:`SHADOWMAP_TYPE_VSM`};function ma(e){return pa[e.shadowMapType]||`SHADOWMAP_TYPE_BASIC`}var ha={301:`ENVMAP_TYPE_CUBE`,302:`ENVMAP_TYPE_CUBE`,306:`ENVMAP_TYPE_CUBE_UV`};function ga(e){return e.envMap===!1?`ENVMAP_TYPE_CUBE`:ha[e.envMapMode]||`ENVMAP_TYPE_CUBE`}var _a={302:`ENVMAP_MODE_REFRACTION`};function va(e){return e.envMap===!1?`ENVMAP_MODE_REFLECTION`:_a[e.envMapMode]||`ENVMAP_MODE_REFLECTION`}var ya={0:`ENVMAP_BLENDING_MULTIPLY`,1:`ENVMAP_BLENDING_MIX`,2:`ENVMAP_BLENDING_ADD`};function ba(e){return e.envMap===!1?`ENVMAP_BLENDING_NONE`:ya[e.combine]||`ENVMAP_BLENDING_NONE`}function xa(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let n=Math.log2(t)-2,r=1/t;return{texelWidth:1/(3*Math.max(2**n,112)),texelHeight:r,maxMip:n}}function Sa(e,t,n,r){let i=e.getContext(),a=n.defines,o=n.vertexShader,s=n.fragmentShader,c=ma(n),l=ga(n),u=va(n),d=ba(n),f=xa(n),p=$i(n),m=ea(a),h=i.createProgram(),g,_,v=n.glslVersion?`#version `+n.glslVersion+`
`:``;n.isRawShaderMaterial?(g=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(na).join(`
`),g.length>0&&(g+=`
`),_=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(na).join(`
`),_.length>0&&(_+=`
`)):(g=[fa(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.extensionClipCullDistance?`#define USE_CLIP_DISTANCE`:``,n.batching?`#define USE_BATCHING`:``,n.batchingColor?`#define USE_BATCHING_COLOR`:``,n.instancing?`#define USE_INSTANCING`:``,n.instancingColor?`#define USE_INSTANCING_COLOR`:``,n.instancingMorph?`#define USE_INSTANCING_MORPH`:``,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.map?`#define USE_MAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+u:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.displacementMap?`#define USE_DISPLACEMENTMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.mapUv?`#define MAP_UV `+n.mapUv:``,n.alphaMapUv?`#define ALPHAMAP_UV `+n.alphaMapUv:``,n.lightMapUv?`#define LIGHTMAP_UV `+n.lightMapUv:``,n.aoMapUv?`#define AOMAP_UV `+n.aoMapUv:``,n.emissiveMapUv?`#define EMISSIVEMAP_UV `+n.emissiveMapUv:``,n.bumpMapUv?`#define BUMPMAP_UV `+n.bumpMapUv:``,n.normalMapUv?`#define NORMALMAP_UV `+n.normalMapUv:``,n.displacementMapUv?`#define DISPLACEMENTMAP_UV `+n.displacementMapUv:``,n.metalnessMapUv?`#define METALNESSMAP_UV `+n.metalnessMapUv:``,n.roughnessMapUv?`#define ROUGHNESSMAP_UV `+n.roughnessMapUv:``,n.anisotropyMapUv?`#define ANISOTROPYMAP_UV `+n.anisotropyMapUv:``,n.clearcoatMapUv?`#define CLEARCOATMAP_UV `+n.clearcoatMapUv:``,n.clearcoatNormalMapUv?`#define CLEARCOAT_NORMALMAP_UV `+n.clearcoatNormalMapUv:``,n.clearcoatRoughnessMapUv?`#define CLEARCOAT_ROUGHNESSMAP_UV `+n.clearcoatRoughnessMapUv:``,n.iridescenceMapUv?`#define IRIDESCENCEMAP_UV `+n.iridescenceMapUv:``,n.iridescenceThicknessMapUv?`#define IRIDESCENCE_THICKNESSMAP_UV `+n.iridescenceThicknessMapUv:``,n.sheenColorMapUv?`#define SHEEN_COLORMAP_UV `+n.sheenColorMapUv:``,n.sheenRoughnessMapUv?`#define SHEEN_ROUGHNESSMAP_UV `+n.sheenRoughnessMapUv:``,n.specularMapUv?`#define SPECULARMAP_UV `+n.specularMapUv:``,n.specularColorMapUv?`#define SPECULAR_COLORMAP_UV `+n.specularColorMapUv:``,n.specularIntensityMapUv?`#define SPECULAR_INTENSITYMAP_UV `+n.specularIntensityMapUv:``,n.transmissionMapUv?`#define TRANSMISSIONMAP_UV `+n.transmissionMapUv:``,n.thicknessMapUv?`#define THICKNESSMAP_UV `+n.thicknessMapUv:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexColors?`#define USE_COLOR`:``,n.vertexAlphas?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.flatShading?`#define FLAT_SHADED`:``,n.skinning?`#define USE_SKINNING`:``,n.morphTargets?`#define USE_MORPHTARGETS`:``,n.morphNormals&&n.flatShading===!1?`#define USE_MORPHNORMALS`:``,n.morphColors?`#define USE_MORPHCOLORS`:``,n.morphTargetsCount>0?`#define MORPHTARGETS_TEXTURE_STRIDE `+n.morphTextureStride:``,n.morphTargetsCount>0?`#define MORPHTARGETS_COUNT `+n.morphTargetsCount:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.sizeAttenuation?`#define USE_SIZEATTENUATION`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 modelMatrix;`,`uniform mat4 modelViewMatrix;`,`uniform mat4 projectionMatrix;`,`uniform mat4 viewMatrix;`,`uniform mat3 normalMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,`#ifdef USE_INSTANCING`,`	attribute mat4 instanceMatrix;`,`#endif`,`#ifdef USE_INSTANCING_COLOR`,`	attribute vec3 instanceColor;`,`#endif`,`#ifdef USE_INSTANCING_MORPH`,`	uniform sampler2D morphTexture;`,`#endif`,`attribute vec3 position;`,`attribute vec3 normal;`,`attribute vec2 uv;`,`#ifdef USE_UV1`,`	attribute vec2 uv1;`,`#endif`,`#ifdef USE_UV2`,`	attribute vec2 uv2;`,`#endif`,`#ifdef USE_UV3`,`	attribute vec2 uv3;`,`#endif`,`#ifdef USE_TANGENT`,`	attribute vec4 tangent;`,`#endif`,`#if defined( USE_COLOR_ALPHA )`,`	attribute vec4 color;`,`#elif defined( USE_COLOR )`,`	attribute vec3 color;`,`#endif`,`#ifdef USE_SKINNING`,`	attribute vec4 skinIndex;`,`	attribute vec4 skinWeight;`,`#endif`,`
`].filter(na).join(`
`),_=[fa(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.alphaToCoverage?`#define ALPHA_TO_COVERAGE`:``,n.map?`#define USE_MAP`:``,n.matcap?`#define USE_MATCAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+l:``,n.envMap?`#define `+u:``,n.envMap?`#define `+d:``,f?`#define CUBEUV_TEXEL_WIDTH `+f.texelWidth:``,f?`#define CUBEUV_TEXEL_HEIGHT `+f.texelHeight:``,f?`#define CUBEUV_MAX_MIP `+f.maxMip+`.0`:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoat?`#define USE_CLEARCOAT`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.dispersion?`#define USE_DISPERSION`:``,n.iridescence?`#define USE_IRIDESCENCE`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaTest?`#define USE_ALPHATEST`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.sheen?`#define USE_SHEEN`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexColors||n.instancingColor?`#define USE_COLOR`:``,n.vertexAlphas||n.batchingColor?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.gradientMap?`#define USE_GRADIENTMAP`:``,n.flatShading?`#define FLAT_SHADED`:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.premultipliedAlpha?`#define PREMULTIPLIED_ALPHA`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.decodeVideoTexture?`#define DECODE_VIDEO_TEXTURE`:``,n.decodeVideoTextureEmissive?`#define DECODE_VIDEO_TEXTURE_EMISSIVE`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 viewMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,n.toneMapping===0?``:`#define TONE_MAPPING`,n.toneMapping===0?``:G.tonemapping_pars_fragment,n.toneMapping===0?``:Xi(`toneMapping`,n.toneMapping),n.dithering?`#define DITHERING`:``,n.opaque?`#define OPAQUE`:``,G.colorspace_pars_fragment,Ji(`linearToOutputTexel`,n.outputColorSpace),Qi(),n.useDepthPacking?`#define DEPTH_PACKING `+n.depthPacking:``,`
`].filter(na).join(`
`)),o=oa(o),o=ra(o,n),o=ia(o,n),s=oa(s),s=ra(s,n),s=ia(s,n),o=ua(o),s=ua(s),n.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,g=[p,`#define attribute in`,`#define varying out`,`#define texture2D texture`].join(`
`)+`
`+g,_=[`#define varying in`,n.glslVersion===`300 es`?``:`layout(location = 0) out highp vec4 pc_fragColor;`,n.glslVersion===`300 es`?``:`#define gl_FragColor pc_fragColor`,`#define gl_FragDepthEXT gl_FragDepth`,`#define texture2D texture`,`#define textureCube texture`,`#define texture2DProj textureProj`,`#define texture2DLodEXT textureLod`,`#define texture2DProjLodEXT textureProjLod`,`#define textureCubeLodEXT textureLod`,`#define texture2DGradEXT textureGrad`,`#define texture2DProjGradEXT textureProjGrad`,`#define textureCubeGradEXT textureGrad`].join(`
`)+`
`+_);let y=v+g+o,b=v+_+s,x=Vi(i,i.VERTEX_SHADER,y),S=Vi(i,i.FRAGMENT_SHADER,b);i.attachShader(h,x),i.attachShader(h,S),n.index0AttributeName===void 0?n.morphTargets===!0&&i.bindAttribLocation(h,0,`position`):i.bindAttribLocation(h,0,n.index0AttributeName),i.linkProgram(h);function C(t){if(e.debug.checkShaderErrors){let n=i.getProgramInfoLog(h)||``,r=i.getShaderInfoLog(x)||``,a=i.getShaderInfoLog(S)||``,o=n.trim(),s=r.trim(),c=a.trim(),l=!0,u=!0;if(i.getProgramParameter(h,i.LINK_STATUS)===!1){if(l=!1,typeof e.debug.onShaderError==`function`)e.debug.onShaderError(i,h,x,S);else{let e=qi(i,x,`vertex`),n=qi(i,S,`fragment`);ut(`THREE.WebGLProgram: Shader Error `+i.getError()+` - VALIDATE_STATUS `+i.getProgramParameter(h,i.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+o+`
`+e+`
`+n)}}else o===``?(s===``||c===``)&&(u=!1):Je(`WebGLProgram: Program Info Log:`,o);u&&(t.diagnostics={runnable:l,programLog:o,vertexShader:{log:s,prefix:g},fragmentShader:{log:c,prefix:_}})}i.deleteShader(x),i.deleteShader(S),w=new Bi(i,h),T=ta(i,h)}let w;this.getUniforms=function(){return w===void 0&&C(this),w};let T;this.getAttributes=function(){return T===void 0&&C(this),T};let E=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return E===!1&&(E=i.getProgramParameter(h,Hi)),E},this.destroy=function(){r.releaseStatesOfProgram(this),i.deleteProgram(h),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=Ui++,this.cacheKey=t,this.usedTimes=1,this.program=h,this.vertexShader=x,this.fragmentShader=S,this}var Ca=0,wa=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,r=this._getShaderStage(t),i=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(r)===!1&&(a.add(r),r.usedTimes++),a.has(i)===!1&&(a.add(i),i.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let e of t)e.usedTimes--,e.usedTimes===0&&this.shaderCache.delete(e.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Ta(e),t.set(e,n)),n}},Ta=class{constructor(e){this.id=Ca++,this.code=e,this.usedTimes=0}};function Ea(e,n,r,i,a,o){let s=new C,c=new wa,l=new Set,u=[],d=new Map,f=i.logarithmicDepthBuffer,p=i.precision,m={MeshDepthMaterial:`depth`,MeshDistanceMaterial:`distance`,MeshNormalMaterial:`normal`,MeshBasicMaterial:`basic`,MeshLambertMaterial:`lambert`,MeshPhongMaterial:`phong`,MeshToonMaterial:`toon`,MeshStandardMaterial:`physical`,MeshPhysicalMaterial:`physical`,MeshMatcapMaterial:`matcap`,LineBasicMaterial:`basic`,LineDashedMaterial:`dashed`,PointsMaterial:`points`,ShadowMaterial:`shadow`,SpriteMaterial:`sprite`};function h(e){return l.add(e),e===0?`uv`:`uv${e}`}function g(a,s,u,d,g){let _=d.fog,v=g.geometry,y=a.isMeshStandardMaterial||a.isMeshLambertMaterial||a.isMeshPhongMaterial?d.environment:null,b=a.isMeshStandardMaterial||a.isMeshLambertMaterial&&!a.envMap||a.isMeshPhongMaterial&&!a.envMap,x=n.get(a.envMap||y,b),S=x&&x.mapping===306?x.image.height:null,C=m[a.type];a.precision!==null&&(p=i.getMaxPrecision(a.precision),p!==a.precision&&Je(`WebGLProgram.getParameters:`,a.precision,`not supported, using`,p,`instead.`));let w=v.morphAttributes.position||v.morphAttributes.normal||v.morphAttributes.color,T=w===void 0?0:w.length,E=0;v.morphAttributes.position!==void 0&&(E=1),v.morphAttributes.normal!==void 0&&(E=2),v.morphAttributes.color!==void 0&&(E=3);let D,O,k,ee;if(C){let e=Yn[C];D=e.vertexShader,O=e.fragmentShader}else D=a.vertexShader,O=a.fragmentShader,c.update(a),k=c.getVertexShaderID(a),ee=c.getFragmentShaderID(a);let A=e.getRenderTarget(),te=e.state.buffers.depth.getReversed(),j=g.isInstancedMesh===!0,ne=g.isBatchedMesh===!0,re=!!a.map,ie=!!a.matcap,M=!!x,ae=!!a.aoMap,N=!!a.lightMap,oe=!!a.bumpMap,P=!!a.normalMap,se=!!a.displacementMap,F=!!a.emissiveMap,ce=!!a.metalnessMap,le=!!a.roughnessMap,ue=a.anisotropy>0,de=a.clearcoat>0,fe=a.dispersion>0,pe=a.iridescence>0,me=a.sheen>0,he=a.transmission>0,ge=ue&&!!a.anisotropyMap,_e=de&&!!a.clearcoatMap,ve=de&&!!a.clearcoatNormalMap,ye=de&&!!a.clearcoatRoughnessMap,be=pe&&!!a.iridescenceMap,xe=pe&&!!a.iridescenceThicknessMap,Se=me&&!!a.sheenColorMap,I=me&&!!a.sheenRoughnessMap,Ce=!!a.specularMap,we=!!a.specularColorMap,Te=!!a.specularIntensityMap,Ee=he&&!!a.transmissionMap,De=he&&!!a.thicknessMap,Oe=!!a.gradientMap,ke=!!a.alphaMap,Ae=a.alphaTest>0,L=!!a.alphaHash,R=!!a.extensions,je=0;a.toneMapped&&(A===null||A.isXRRenderTarget===!0)&&(je=e.toneMapping);let z={shaderID:C,shaderType:a.type,shaderName:a.name,vertexShader:D,fragmentShader:O,defines:a.defines,customVertexShaderID:k,customFragmentShaderID:ee,isRawShaderMaterial:a.isRawShaderMaterial===!0,glslVersion:a.glslVersion,precision:p,batching:ne,batchingColor:ne&&g._colorsTexture!==null,instancing:j,instancingColor:j&&g.instanceColor!==null,instancingMorph:j&&g.morphTexture!==null,outputColorSpace:A===null?e.outputColorSpace:A.isXRRenderTarget===!0?A.texture.colorSpace:t,alphaToCoverage:!!a.alphaToCoverage,map:re,matcap:ie,envMap:M,envMapMode:M&&x.mapping,envMapCubeUVHeight:S,aoMap:ae,lightMap:N,bumpMap:oe,normalMap:P,displacementMap:se,emissiveMap:F,normalMapObjectSpace:P&&a.normalMapType===1,normalMapTangentSpace:P&&a.normalMapType===0,metalnessMap:ce,roughnessMap:le,anisotropy:ue,anisotropyMap:ge,clearcoat:de,clearcoatMap:_e,clearcoatNormalMap:ve,clearcoatRoughnessMap:ye,dispersion:fe,iridescence:pe,iridescenceMap:be,iridescenceThicknessMap:xe,sheen:me,sheenColorMap:Se,sheenRoughnessMap:I,specularMap:Ce,specularColorMap:we,specularIntensityMap:Te,transmission:he,transmissionMap:Ee,thicknessMap:De,gradientMap:Oe,opaque:a.transparent===!1&&a.blending===1&&a.alphaToCoverage===!1,alphaMap:ke,alphaTest:Ae,alphaHash:L,combine:a.combine,mapUv:re&&h(a.map.channel),aoMapUv:ae&&h(a.aoMap.channel),lightMapUv:N&&h(a.lightMap.channel),bumpMapUv:oe&&h(a.bumpMap.channel),normalMapUv:P&&h(a.normalMap.channel),displacementMapUv:se&&h(a.displacementMap.channel),emissiveMapUv:F&&h(a.emissiveMap.channel),metalnessMapUv:ce&&h(a.metalnessMap.channel),roughnessMapUv:le&&h(a.roughnessMap.channel),anisotropyMapUv:ge&&h(a.anisotropyMap.channel),clearcoatMapUv:_e&&h(a.clearcoatMap.channel),clearcoatNormalMapUv:ve&&h(a.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ye&&h(a.clearcoatRoughnessMap.channel),iridescenceMapUv:be&&h(a.iridescenceMap.channel),iridescenceThicknessMapUv:xe&&h(a.iridescenceThicknessMap.channel),sheenColorMapUv:Se&&h(a.sheenColorMap.channel),sheenRoughnessMapUv:I&&h(a.sheenRoughnessMap.channel),specularMapUv:Ce&&h(a.specularMap.channel),specularColorMapUv:we&&h(a.specularColorMap.channel),specularIntensityMapUv:Te&&h(a.specularIntensityMap.channel),transmissionMapUv:Ee&&h(a.transmissionMap.channel),thicknessMapUv:De&&h(a.thicknessMap.channel),alphaMapUv:ke&&h(a.alphaMap.channel),vertexTangents:!!v.attributes.tangent&&(P||ue),vertexColors:a.vertexColors,vertexAlphas:a.vertexColors===!0&&!!v.attributes.color&&v.attributes.color.itemSize===4,pointsUvs:g.isPoints===!0&&!!v.attributes.uv&&(re||ke),fog:!!_,useFog:a.fog===!0,fogExp2:!!_&&_.isFogExp2,flatShading:a.wireframe===!1&&(a.flatShading===!0||v.attributes.normal===void 0&&P===!1&&(a.isMeshLambertMaterial||a.isMeshPhongMaterial||a.isMeshStandardMaterial||a.isMeshPhysicalMaterial)),sizeAttenuation:a.sizeAttenuation===!0,logarithmicDepthBuffer:f,reversedDepthBuffer:te,skinning:g.isSkinnedMesh===!0,morphTargets:v.morphAttributes.position!==void 0,morphNormals:v.morphAttributes.normal!==void 0,morphColors:v.morphAttributes.color!==void 0,morphTargetsCount:T,morphTextureStride:E,numDirLights:s.directional.length,numPointLights:s.point.length,numSpotLights:s.spot.length,numSpotLightMaps:s.spotLightMap.length,numRectAreaLights:s.rectArea.length,numHemiLights:s.hemi.length,numDirLightShadows:s.directionalShadowMap.length,numPointLightShadows:s.pointShadowMap.length,numSpotLightShadows:s.spotShadowMap.length,numSpotLightShadowsWithMaps:s.numSpotLightShadowsWithMaps,numLightProbes:s.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:a.dithering,shadowMapEnabled:e.shadowMap.enabled&&u.length>0,shadowMapType:e.shadowMap.type,toneMapping:je,decodeVideoTexture:re&&a.map.isVideoTexture===!0&&bt.getTransfer(a.map.colorSpace)===`srgb`,decodeVideoTextureEmissive:F&&a.emissiveMap.isVideoTexture===!0&&bt.getTransfer(a.emissiveMap.colorSpace)===`srgb`,premultipliedAlpha:a.premultipliedAlpha,doubleSided:a.side===2,flipSided:a.side===1,useDepthPacking:a.depthPacking>=0,depthPacking:a.depthPacking||0,index0AttributeName:a.index0AttributeName,extensionClipCullDistance:R&&a.extensions.clipCullDistance===!0&&r.has(`WEBGL_clip_cull_distance`),extensionMultiDraw:(R&&a.extensions.multiDraw===!0||ne)&&r.has(`WEBGL_multi_draw`),rendererExtensionParallelShaderCompile:r.has(`KHR_parallel_shader_compile`),customProgramCacheKey:a.customProgramCacheKey()};return z.vertexUv1s=l.has(1),z.vertexUv2s=l.has(2),z.vertexUv3s=l.has(3),l.clear(),z}function _(t){let n=[];if(t.shaderID?n.push(t.shaderID):(n.push(t.customVertexShaderID),n.push(t.customFragmentShaderID)),t.defines!==void 0)for(let e in t.defines)n.push(e),n.push(t.defines[e]);return t.isRawShaderMaterial===!1&&(v(n,t),y(n,t),n.push(e.outputColorSpace)),n.push(t.customProgramCacheKey),n.join()}function v(e,t){e.push(t.precision),e.push(t.outputColorSpace),e.push(t.envMapMode),e.push(t.envMapCubeUVHeight),e.push(t.mapUv),e.push(t.alphaMapUv),e.push(t.lightMapUv),e.push(t.aoMapUv),e.push(t.bumpMapUv),e.push(t.normalMapUv),e.push(t.displacementMapUv),e.push(t.emissiveMapUv),e.push(t.metalnessMapUv),e.push(t.roughnessMapUv),e.push(t.anisotropyMapUv),e.push(t.clearcoatMapUv),e.push(t.clearcoatNormalMapUv),e.push(t.clearcoatRoughnessMapUv),e.push(t.iridescenceMapUv),e.push(t.iridescenceThicknessMapUv),e.push(t.sheenColorMapUv),e.push(t.sheenRoughnessMapUv),e.push(t.specularMapUv),e.push(t.specularColorMapUv),e.push(t.specularIntensityMapUv),e.push(t.transmissionMapUv),e.push(t.thicknessMapUv),e.push(t.combine),e.push(t.fogExp2),e.push(t.sizeAttenuation),e.push(t.morphTargetsCount),e.push(t.morphAttributeCount),e.push(t.numDirLights),e.push(t.numPointLights),e.push(t.numSpotLights),e.push(t.numSpotLightMaps),e.push(t.numHemiLights),e.push(t.numRectAreaLights),e.push(t.numDirLightShadows),e.push(t.numPointLightShadows),e.push(t.numSpotLightShadows),e.push(t.numSpotLightShadowsWithMaps),e.push(t.numLightProbes),e.push(t.shadowMapType),e.push(t.toneMapping),e.push(t.numClippingPlanes),e.push(t.numClipIntersection),e.push(t.depthPacking)}function y(e,t){s.disableAll(),t.instancing&&s.enable(0),t.instancingColor&&s.enable(1),t.instancingMorph&&s.enable(2),t.matcap&&s.enable(3),t.envMap&&s.enable(4),t.normalMapObjectSpace&&s.enable(5),t.normalMapTangentSpace&&s.enable(6),t.clearcoat&&s.enable(7),t.iridescence&&s.enable(8),t.alphaTest&&s.enable(9),t.vertexColors&&s.enable(10),t.vertexAlphas&&s.enable(11),t.vertexUv1s&&s.enable(12),t.vertexUv2s&&s.enable(13),t.vertexUv3s&&s.enable(14),t.vertexTangents&&s.enable(15),t.anisotropy&&s.enable(16),t.alphaHash&&s.enable(17),t.batching&&s.enable(18),t.dispersion&&s.enable(19),t.batchingColor&&s.enable(20),t.gradientMap&&s.enable(21),e.push(s.mask),s.disableAll(),t.fog&&s.enable(0),t.useFog&&s.enable(1),t.flatShading&&s.enable(2),t.logarithmicDepthBuffer&&s.enable(3),t.reversedDepthBuffer&&s.enable(4),t.skinning&&s.enable(5),t.morphTargets&&s.enable(6),t.morphNormals&&s.enable(7),t.morphColors&&s.enable(8),t.premultipliedAlpha&&s.enable(9),t.shadowMapEnabled&&s.enable(10),t.doubleSided&&s.enable(11),t.flipSided&&s.enable(12),t.useDepthPacking&&s.enable(13),t.dithering&&s.enable(14),t.transmission&&s.enable(15),t.sheen&&s.enable(16),t.opaque&&s.enable(17),t.pointsUvs&&s.enable(18),t.decodeVideoTexture&&s.enable(19),t.decodeVideoTextureEmissive&&s.enable(20),t.alphaToCoverage&&s.enable(21),e.push(s.mask)}function b(e){let t=m[e.type],n;if(t){let e=Yn[t];n=P.clone(e.uniforms)}else n=e.uniforms;return n}function x(t,n){let r=d.get(n);return r===void 0?(r=new Sa(e,n,t,a),u.push(r),d.set(n,r)):++r.usedTimes,r}function S(e){if(--e.usedTimes===0){let t=u.indexOf(e);u[t]=u[u.length-1],u.pop(),d.delete(e.cacheKey),e.destroy()}}function w(e){c.remove(e)}function T(){c.dispose()}return{getParameters:g,getProgramCacheKey:_,getUniforms:b,acquireProgram:x,releaseProgram:S,releaseShaderCache:w,programs:u,dispose:T}}function Da(){let e=new WeakMap;function t(t){return e.has(t)}function n(t){let n=e.get(t);return n===void 0&&(n={},e.set(t,n)),n}function r(t){e.delete(t)}function i(t,n,r){e.get(t)[n]=r}function a(){e=new WeakMap}return{has:t,get:n,remove:r,update:i,dispose:a}}function Oa(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.material.id===t.material.id?e.materialVariant===t.materialVariant?e.z===t.z?e.id-t.id:e.z-t.z:e.materialVariant-t.materialVariant:e.material.id-t.material.id:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function ka(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.z===t.z?e.id-t.id:t.z-e.z:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function Aa(){let e=[],t=0,n=[],r=[],i=[];function a(){t=0,n.length=0,r.length=0,i.length=0}function o(e){let t=0;return e.isInstancedMesh&&(t+=2),e.isSkinnedMesh&&(t+=1),t}function s(n,r,i,a,s,c){let l=e[t];return l===void 0?(l={id:n.id,object:n,geometry:r,material:i,materialVariant:o(n),groupOrder:a,renderOrder:n.renderOrder,z:s,group:c},e[t]=l):(l.id=n.id,l.object=n,l.geometry=r,l.material=i,l.materialVariant=o(n),l.groupOrder=a,l.renderOrder=n.renderOrder,l.z=s,l.group=c),t++,l}function c(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.push(u):a.transparent===!0?i.push(u):n.push(u)}function l(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.unshift(u):a.transparent===!0?i.unshift(u):n.unshift(u)}function u(e,t){n.length>1&&n.sort(e||Oa),r.length>1&&r.sort(t||ka),i.length>1&&i.sort(t||ka)}function d(){for(let n=t,r=e.length;n<r;n++){let t=e[n];if(t.id===null)break;t.id=null,t.object=null,t.geometry=null,t.material=null,t.group=null}}return{opaque:n,transmissive:r,transparent:i,init:a,push:c,unshift:l,finish:d,sort:u}}function ja(){let e=new WeakMap;function t(t,n){let r=e.get(t),i;return r===void 0?(i=new Aa,e.set(t,[i])):n>=r.length?(i=new Aa,r.push(i)):i=r[n],i}function n(){e=new WeakMap}return{get:t,dispose:n}}function Ma(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`DirectionalLight`:n={direction:new S,color:new I};break;case`SpotLight`:n={position:new S,direction:new S,color:new I,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case`PointLight`:n={position:new S,color:new I,distance:0,decay:0};break;case`HemisphereLight`:n={direction:new S,skyColor:new I,groundColor:new I};break;case`RectAreaLight`:n={color:new I,position:new S,halfWidth:new S,halfHeight:new S}}return e[t.id]=n,n}}}function Na(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`DirectionalLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ct};break;case`SpotLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ct};break;case`PointLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ct,shadowCameraNear:1,shadowCameraFar:1e3}}return e[t.id]=n,n}}}var Pa=0;function Fa(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+ +!!t.map-!!e.map}function Ia(e){let t=new Ma,n=Na(),r={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let e=0;e<9;e++)r.probe.push(new S);let i=new S,a=new Ye,o=new Ye;function s(i){let a=0,o=0,s=0;for(let e=0;e<9;e++)r.probe[e].set(0,0,0);let c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0;i.sort(Fa);for(let e=0,y=i.length;e<y;e++){let y=i[e],b=y.color,x=y.intensity,S=y.distance,C=null;if(y.shadow&&y.shadow.map&&(C=y.shadow.map.texture.format===1030?y.shadow.map.texture:y.shadow.map.depthTexture||y.shadow.map.texture),y.isAmbientLight)a+=b.r*x,o+=b.g*x,s+=b.b*x;else if(y.isLightProbe){for(let e=0;e<9;e++)r.probe[e].addScaledVector(y.sh.coefficients[e],x);v++}else if(y.isDirectionalLight){let e=t.get(y);if(e.color.copy(y.color).multiplyScalar(y.intensity),y.castShadow){let e=y.shadow,t=n.get(y);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,r.directionalShadow[c]=t,r.directionalShadowMap[c]=C,r.directionalShadowMatrix[c]=y.shadow.matrix,p++}r.directional[c]=e,c++}else if(y.isSpotLight){let e=t.get(y);e.position.setFromMatrixPosition(y.matrixWorld),e.color.copy(b).multiplyScalar(x),e.distance=S,e.coneCos=Math.cos(y.angle),e.penumbraCos=Math.cos(y.angle*(1-y.penumbra)),e.decay=y.decay,r.spot[u]=e;let i=y.shadow;if(y.map&&(r.spotLightMap[g]=y.map,g++,i.updateMatrices(y),y.castShadow&&_++),r.spotLightMatrix[u]=i.matrix,y.castShadow){let e=n.get(y);e.shadowIntensity=i.intensity,e.shadowBias=i.bias,e.shadowNormalBias=i.normalBias,e.shadowRadius=i.radius,e.shadowMapSize=i.mapSize,r.spotShadow[u]=e,r.spotShadowMap[u]=C,h++}u++}else if(y.isRectAreaLight){let e=t.get(y);e.color.copy(b).multiplyScalar(x),e.halfWidth.set(y.width*.5,0,0),e.halfHeight.set(0,y.height*.5,0),r.rectArea[d]=e,d++}else if(y.isPointLight){let e=t.get(y);if(e.color.copy(y.color).multiplyScalar(y.intensity),e.distance=y.distance,e.decay=y.decay,y.castShadow){let e=y.shadow,t=n.get(y);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,t.shadowCameraNear=e.camera.near,t.shadowCameraFar=e.camera.far,r.pointShadow[l]=t,r.pointShadowMap[l]=C,r.pointShadowMatrix[l]=y.shadow.matrix,m++}r.point[l]=e,l++}else if(y.isHemisphereLight){let e=t.get(y);e.skyColor.copy(y.color).multiplyScalar(x),e.groundColor.copy(y.groundColor).multiplyScalar(x),r.hemi[f]=e,f++}}d>0&&(e.has(`OES_texture_float_linear`)===!0?(r.rectAreaLTC1=K.LTC_FLOAT_1,r.rectAreaLTC2=K.LTC_FLOAT_2):(r.rectAreaLTC1=K.LTC_HALF_1,r.rectAreaLTC2=K.LTC_HALF_2)),r.ambient[0]=a,r.ambient[1]=o,r.ambient[2]=s;let y=r.hash;(y.directionalLength!==c||y.pointLength!==l||y.spotLength!==u||y.rectAreaLength!==d||y.hemiLength!==f||y.numDirectionalShadows!==p||y.numPointShadows!==m||y.numSpotShadows!==h||y.numSpotMaps!==g||y.numLightProbes!==v)&&(r.directional.length=c,r.spot.length=u,r.rectArea.length=d,r.point.length=l,r.hemi.length=f,r.directionalShadow.length=p,r.directionalShadowMap.length=p,r.pointShadow.length=m,r.pointShadowMap.length=m,r.spotShadow.length=h,r.spotShadowMap.length=h,r.directionalShadowMatrix.length=p,r.pointShadowMatrix.length=m,r.spotLightMatrix.length=h+g-_,r.spotLightMap.length=g,r.numSpotLightShadowsWithMaps=_,r.numLightProbes=v,y.directionalLength=c,y.pointLength=l,y.spotLength=u,y.rectAreaLength=d,y.hemiLength=f,y.numDirectionalShadows=p,y.numPointShadows=m,y.numSpotShadows=h,y.numSpotMaps=g,y.numLightProbes=v,r.version=Pa++)}function c(e,t){let n=0,s=0,c=0,l=0,u=0,d=t.matrixWorldInverse;for(let t=0,f=e.length;t<f;t++){let f=e[t];if(f.isDirectionalLight){let e=r.directional[n];e.direction.setFromMatrixPosition(f.matrixWorld),i.setFromMatrixPosition(f.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(d),n++}else if(f.isSpotLight){let e=r.spot[c];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(d),e.direction.setFromMatrixPosition(f.matrixWorld),i.setFromMatrixPosition(f.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(d),c++}else if(f.isRectAreaLight){let e=r.rectArea[l];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(d),o.identity(),a.copy(f.matrixWorld),a.premultiply(d),o.extractRotation(a),e.halfWidth.set(f.width*.5,0,0),e.halfHeight.set(0,f.height*.5,0),e.halfWidth.applyMatrix4(o),e.halfHeight.applyMatrix4(o),l++}else if(f.isPointLight){let e=r.point[s];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(d),s++}else if(f.isHemisphereLight){let e=r.hemi[u];e.direction.setFromMatrixPosition(f.matrixWorld),e.direction.transformDirection(d),u++}}}return{setup:s,setupView:c,state:r}}function La(e){let t=new Ia(e),n=[],r=[];function i(e){l.camera=e,n.length=0,r.length=0}function a(e){n.push(e)}function o(e){r.push(e)}function s(){t.setup(n)}function c(e){t.setupView(n,e)}let l={lightsArray:n,shadowsArray:r,camera:null,lights:t,transmissionRenderTarget:{}};return{init:i,state:l,setupLights:s,setupLightsView:c,pushLight:a,pushShadow:o}}function Ra(e){let t=new WeakMap;function n(n,r=0){let i=t.get(n),a;return i===void 0?(a=new La(e),t.set(n,[a])):r>=i.length?(a=new La(e),i.push(a)):a=i[r],a}function r(){t=new WeakMap}return{get:n,dispose:r}}var za=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Ba=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,Va=[new S(1,0,0),new S(-1,0,0),new S(0,1,0),new S(0,-1,0),new S(0,0,1),new S(0,0,-1)],Ha=[new S(0,-1,0),new S(0,-1,0),new S(0,0,1),new S(0,0,-1),new S(0,-1,0),new S(0,-1,0)],Ua=new Ye,Wa=new S,Ga=new S;function Ka(e,t,n){let i=new oe,a=new ct,o=new ct,s=new be,c=new H,l=new ot,u={},d=n.maxTextureSize,f={0:1,1:0,2:2},p=new Ct({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new ct},radius:{value:4}},vertexShader:za,fragmentShader:Ba}),m=p.clone();m.defines.HORIZONTAL_PASS=1;let h=new at;h.setAttribute(`position`,new Ne(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let g=new U(h,p),_=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=1;let v=this.type;this.render=function(t,n,c){if(_.enabled===!1||_.autoUpdate===!1&&_.needsUpdate===!1||t.length===0)return;this.type===2&&(Je(`WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.`),this.type=1);let l=e.getRenderTarget(),u=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.state;p.setBlending(0),p.buffers.depth.getReversed()===!0?p.buffers.color.setClear(0,0,0,0):p.buffers.color.setClear(1,1,1,1),p.buffers.depth.setTest(!0),p.setScissorTest(!1);let m=v!==this.type;m&&n.traverse(function(e){e.material&&(Array.isArray(e.material)?e.material.forEach(e=>e.needsUpdate=!0):e.material.needsUpdate=!0)});for(let l=0,u=t.length;l<u;l++){let u=t[l],f=u.shadow;if(f===void 0){Je(`WebGLShadowMap:`,u,`has no shadow.`);continue}if(f.autoUpdate===!1&&f.needsUpdate===!1)continue;a.copy(f.mapSize);let h=f.getFrameExtents();a.multiply(h),o.copy(f.mapSize),(a.x>d||a.y>d)&&(a.x>d&&(o.x=Math.floor(d/h.x),a.x=o.x*h.x,f.mapSize.x=o.x),a.y>d&&(o.y=Math.floor(d/h.y),a.y=o.y*h.y,f.mapSize.y=o.y));let g=e.state.buffers.depth.getReversed();if(f.camera._reversedDepth=g,f.map===null||m===!0){if(f.map!==null&&(f.map.depthTexture!==null&&(f.map.depthTexture.dispose(),f.map.depthTexture=null),f.map.dispose()),this.type===3){if(u.isPointLight){Je(`WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.`);continue}f.map=new N(a.x,a.y,{format:qe,type:me,minFilter:ye,magFilter:ye,generateMipmaps:!1}),f.map.texture.name=u.name+`.shadowMap`,f.map.depthTexture=new r(a.x,a.y,T),f.map.depthTexture.name=u.name+`.shadowMapDepth`,f.map.depthTexture.format=j,f.map.depthTexture.compareFunction=null,f.map.depthTexture.minFilter=Ie,f.map.depthTexture.magFilter=Ie}else u.isPointLight?(f.map=new wr(a.x),f.map.depthTexture=new Tt(a.x,pe)):(f.map=new N(a.x,a.y),f.map.depthTexture=new r(a.x,a.y,pe)),f.map.depthTexture.name=u.name+`.shadowMap`,f.map.depthTexture.format=j,this.type===1?(f.map.depthTexture.compareFunction=g?518:515,f.map.depthTexture.minFilter=ye,f.map.depthTexture.magFilter=ye):(f.map.depthTexture.compareFunction=null,f.map.depthTexture.minFilter=Ie,f.map.depthTexture.magFilter=Ie);f.camera.updateProjectionMatrix()}let _=f.map.isWebGLCubeRenderTarget?6:1;for(let t=0;t<_;t++){if(f.map.isWebGLCubeRenderTarget)e.setRenderTarget(f.map,t),e.clear();else{t===0&&(e.setRenderTarget(f.map),e.clear());let n=f.getViewport(t);s.set(o.x*n.x,o.y*n.y,o.x*n.z,o.y*n.w),p.viewport(s)}if(u.isPointLight){let e=f.camera,n=f.matrix,r=u.distance||e.far;r!==e.far&&(e.far=r,e.updateProjectionMatrix()),Wa.setFromMatrixPosition(u.matrixWorld),e.position.copy(Wa),Ga.copy(e.position),Ga.add(Va[t]),e.up.copy(Ha[t]),e.lookAt(Ga),e.updateMatrixWorld(),n.makeTranslation(-Wa.x,-Wa.y,-Wa.z),Ua.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),f._frustum.setFromProjectionMatrix(Ua,e.coordinateSystem,e.reversedDepth)}else f.updateMatrices(u);i=f.getFrustum(),x(n,c,f.camera,u,this.type)}f.isPointLightShadow!==!0&&this.type===3&&y(f,c),f.needsUpdate=!1}v=this.type,_.needsUpdate=!1,e.setRenderTarget(l,u,f)};function y(n,r){let i=t.update(g);p.defines.VSM_SAMPLES!==n.blurSamples&&(p.defines.VSM_SAMPLES=n.blurSamples,m.defines.VSM_SAMPLES=n.blurSamples,p.needsUpdate=!0,m.needsUpdate=!0),n.mapPass===null&&(n.mapPass=new N(a.x,a.y,{format:qe,type:me})),p.uniforms.shadow_pass.value=n.map.depthTexture,p.uniforms.resolution.value=n.mapSize,p.uniforms.radius.value=n.radius,e.setRenderTarget(n.mapPass),e.clear(),e.renderBufferDirect(r,null,i,p,g,null),m.uniforms.shadow_pass.value=n.mapPass.texture,m.uniforms.resolution.value=n.mapSize,m.uniforms.radius.value=n.radius,e.setRenderTarget(n.map),e.clear(),e.renderBufferDirect(r,null,i,m,g,null)}function b(t,n,r,i){let a=null,o=r.isPointLight===!0?t.customDistanceMaterial:t.customDepthMaterial;if(o!==void 0)a=o;else if(a=r.isPointLight===!0?l:c,e.localClippingEnabled&&n.clipShadows===!0&&Array.isArray(n.clippingPlanes)&&n.clippingPlanes.length!==0||n.displacementMap&&n.displacementScale!==0||n.alphaMap&&n.alphaTest>0||n.map&&n.alphaTest>0||n.alphaToCoverage===!0){let e=a.uuid,t=n.uuid,r=u[e];r===void 0&&(r={},u[e]=r);let i=r[t];i===void 0&&(i=a.clone(),r[t]=i,n.addEventListener(`dispose`,S)),a=i}if(a.visible=n.visible,a.wireframe=n.wireframe,i===3?a.side=n.shadowSide===null?n.side:n.shadowSide:a.side=n.shadowSide===null?f[n.side]:n.shadowSide,a.alphaMap=n.alphaMap,a.alphaTest=n.alphaToCoverage===!0?.5:n.alphaTest,a.map=n.map,a.clipShadows=n.clipShadows,a.clippingPlanes=n.clippingPlanes,a.clipIntersection=n.clipIntersection,a.displacementMap=n.displacementMap,a.displacementScale=n.displacementScale,a.displacementBias=n.displacementBias,a.wireframeLinewidth=n.wireframeLinewidth,a.linewidth=n.linewidth,r.isPointLight===!0&&a.isMeshDistanceMaterial===!0){let t=e.properties.get(a);t.light=r}return a}function x(n,r,a,o,s){if(n.visible===!1)return;if(n.layers.test(r.layers)&&(n.isMesh||n.isLine||n.isPoints)&&(n.castShadow||n.receiveShadow&&s===3)&&(!n.frustumCulled||i.intersectsObject(n))){n.modelViewMatrix.multiplyMatrices(a.matrixWorldInverse,n.matrixWorld);let i=t.update(n),c=n.material;if(Array.isArray(c)){let t=i.groups;for(let l=0,u=t.length;l<u;l++){let u=t[l],d=c[u.materialIndex];if(d&&d.visible){let t=b(n,d,o,s);n.onBeforeShadow(e,n,r,a,i,t,u),e.renderBufferDirect(a,null,i,t,n,u),n.onAfterShadow(e,n,r,a,i,t,u)}}}else if(c.visible){let t=b(n,c,o,s);n.onBeforeShadow(e,n,r,a,i,t,null),e.renderBufferDirect(a,null,i,t,n,null),n.onAfterShadow(e,n,r,a,i,t,null)}}let c=n.children;for(let e=0,t=c.length;e<t;e++)x(c[e],r,a,o,s)}function S(e){e.target.removeEventListener(`dispose`,S);for(let t in u){let n=u[t],r=e.target.uuid;r in n&&(n[r].dispose(),delete n[r])}}}function qa(e,t){function n(){let t=!1,n=new be,r=null,i=new be(0,0,0,0);return{setMask:function(n){r!==n&&!t&&(e.colorMask(n,n,n,n),r=n)},setLocked:function(e){t=e},setClear:function(t,r,a,o,s){s===!0&&(t*=o,r*=o,a*=o),n.set(t,r,a,o),i.equals(n)===!1&&(e.clearColor(t,r,a,o),i.copy(n))},reset:function(){t=!1,r=null,i.set(-1,0,0,0)}}}function r(){let n=!1,r=!1,i=null,a=null,o=null;return{setReversed:function(e){if(r!==e){let n=t.get(`EXT_clip_control`);e?n.clipControlEXT(n.LOWER_LEFT_EXT,n.ZERO_TO_ONE_EXT):n.clipControlEXT(n.LOWER_LEFT_EXT,n.NEGATIVE_ONE_TO_ONE_EXT),r=e;let i=o;o=null,this.setClear(i)}},getReversed:function(){return r},setTest:function(t){t?F(e.DEPTH_TEST):ce(e.DEPTH_TEST)},setMask:function(t){i!==t&&!n&&(e.depthMask(t),i=t)},setFunc:function(t){if(r&&(t=Fe[t]),a!==t){switch(t){case 0:e.depthFunc(e.NEVER);break;case 1:e.depthFunc(e.ALWAYS);break;case 2:e.depthFunc(e.LESS);break;case 3:e.depthFunc(e.LEQUAL);break;case 4:e.depthFunc(e.EQUAL);break;case 5:e.depthFunc(e.GEQUAL);break;case 6:e.depthFunc(e.GREATER);break;case 7:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}a=t}},setLocked:function(e){n=e},setClear:function(t){o!==t&&(o=t,r&&(t=1-t),e.clearDepth(t))},reset:function(){n=!1,i=null,a=null,o=null,r=!1}}}function i(){let t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null;return{setTest:function(n){t||(n?F(e.STENCIL_TEST):ce(e.STENCIL_TEST))},setMask:function(r){n!==r&&!t&&(e.stencilMask(r),n=r)},setFunc:function(t,n,o){(r!==t||i!==n||a!==o)&&(e.stencilFunc(t,n,o),r=t,i=n,a=o)},setOp:function(t,n,r){(o!==t||s!==n||c!==r)&&(e.stencilOp(t,n,r),o=t,s=n,c=r)},setLocked:function(e){t=e},setClear:function(t){l!==t&&(e.clearStencil(t),l=t)},reset:function(){t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null}}}let a=new n,o=new r,s=new i,c=new WeakMap,l=new WeakMap,u={},d={},f=new WeakMap,p=[],m=null,h=!1,g=null,_=null,v=null,y=null,b=null,x=null,S=null,C=new I(0,0,0),w=0,T=!1,E=null,D=null,O=null,k=null,ee=null,A=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),te=!1,j=0,ne=e.getParameter(e.VERSION);ne.indexOf(`WebGL`)===-1?ne.indexOf(`OpenGL ES`)!==-1&&(j=parseFloat(/^OpenGL ES (\d)/.exec(ne)[1]),te=j>=2):(j=parseFloat(/^WebGL (\d)/.exec(ne)[1]),te=j>=1);let re=null,ie={},M=e.getParameter(e.SCISSOR_BOX),ae=e.getParameter(e.VIEWPORT),N=new be().fromArray(M),oe=new be().fromArray(ae);function P(t,n,r,i){let a=new Uint8Array(4),o=e.createTexture();e.bindTexture(t,o),e.texParameteri(t,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(t,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let o=0;o<r;o++)t===e.TEXTURE_3D||t===e.TEXTURE_2D_ARRAY?e.texImage3D(n,0,e.RGBA,1,1,i,0,e.RGBA,e.UNSIGNED_BYTE,a):e.texImage2D(n+o,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,a);return o}let se={};se[e.TEXTURE_2D]=P(e.TEXTURE_2D,e.TEXTURE_2D,1),se[e.TEXTURE_CUBE_MAP]=P(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),se[e.TEXTURE_2D_ARRAY]=P(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),se[e.TEXTURE_3D]=P(e.TEXTURE_3D,e.TEXTURE_3D,1,1),a.setClear(0,0,0,1),o.setClear(1),s.setClear(0),F(e.DEPTH_TEST),o.setFunc(3),ge(!1),_e(1),F(e.CULL_FACE),me(0);function F(t){u[t]!==!0&&(e.enable(t),u[t]=!0)}function ce(t){u[t]!==!1&&(e.disable(t),u[t]=!1)}function le(t,n){return d[t]!==n&&(e.bindFramebuffer(t,n),d[t]=n,t===e.DRAW_FRAMEBUFFER&&(d[e.FRAMEBUFFER]=n),t===e.FRAMEBUFFER&&(d[e.DRAW_FRAMEBUFFER]=n),!0)}function ue(t,n){let r=p,i=!1;if(t){r=f.get(n),r===void 0&&(r=[],f.set(n,r));let a=t.textures;if(r.length!==a.length||r[0]!==e.COLOR_ATTACHMENT0){for(let t=0,n=a.length;t<n;t++)r[t]=e.COLOR_ATTACHMENT0+t;r.length=a.length,i=!0}}else r[0]!==e.BACK&&(r[0]=e.BACK,i=!0);i&&e.drawBuffers(r)}function de(t){return m!==t&&(e.useProgram(t),m=t,!0)}let fe={100:e.FUNC_ADD,101:e.FUNC_SUBTRACT,102:e.FUNC_REVERSE_SUBTRACT};fe[103]=e.MIN,fe[104]=e.MAX;let pe={200:e.ZERO,201:e.ONE,202:e.SRC_COLOR,204:e.SRC_ALPHA,210:e.SRC_ALPHA_SATURATE,208:e.DST_COLOR,206:e.DST_ALPHA,203:e.ONE_MINUS_SRC_COLOR,205:e.ONE_MINUS_SRC_ALPHA,209:e.ONE_MINUS_DST_COLOR,207:e.ONE_MINUS_DST_ALPHA,211:e.CONSTANT_COLOR,212:e.ONE_MINUS_CONSTANT_COLOR,213:e.CONSTANT_ALPHA,214:e.ONE_MINUS_CONSTANT_ALPHA};function me(t,n,r,i,a,o,s,c,l,u){if(t===0)h===!0&&(ce(e.BLEND),h=!1);else if(h===!1&&(F(e.BLEND),h=!0),t!==5){if(t!==g||u!==T){if((_!==100||b!==100)&&(e.blendEquation(e.FUNC_ADD),_=100,b=100),u)switch(t){case 1:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFunc(e.ONE,e.ONE);break;case 3:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case 4:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:ut(`WebGLState: Invalid blending: `,t)}else switch(t){case 1:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case 3:ut(`WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true`);break;case 4:ut(`WebGLState: MultiplyBlending requires material.premultipliedAlpha = true`);break;default:ut(`WebGLState: Invalid blending: `,t)}v=null,y=null,x=null,S=null,C.set(0,0,0),w=0,g=t,T=u}}else a||=n,o||=r,s||=i,(n!==_||a!==b)&&(e.blendEquationSeparate(fe[n],fe[a]),_=n,b=a),(r!==v||i!==y||o!==x||s!==S)&&(e.blendFuncSeparate(pe[r],pe[i],pe[o],pe[s]),v=r,y=i,x=o,S=s),(c.equals(C)===!1||l!==w)&&(e.blendColor(c.r,c.g,c.b,l),C.copy(c),w=l),g=t,T=!1}function he(t,n){t.side===2?ce(e.CULL_FACE):F(e.CULL_FACE);let r=t.side===1;n&&(r=!r),ge(r),t.blending===1&&t.transparent===!1?me(0):me(t.blending,t.blendEquation,t.blendSrc,t.blendDst,t.blendEquationAlpha,t.blendSrcAlpha,t.blendDstAlpha,t.blendColor,t.blendAlpha,t.premultipliedAlpha),o.setFunc(t.depthFunc),o.setTest(t.depthTest),o.setMask(t.depthWrite),a.setMask(t.colorWrite);let i=t.stencilWrite;s.setTest(i),i&&(s.setMask(t.stencilWriteMask),s.setFunc(t.stencilFunc,t.stencilRef,t.stencilFuncMask),s.setOp(t.stencilFail,t.stencilZFail,t.stencilZPass)),ye(t.polygonOffset,t.polygonOffsetFactor,t.polygonOffsetUnits),t.alphaToCoverage===!0?F(e.SAMPLE_ALPHA_TO_COVERAGE):ce(e.SAMPLE_ALPHA_TO_COVERAGE)}function ge(t){E!==t&&(t?e.frontFace(e.CW):e.frontFace(e.CCW),E=t)}function _e(t){t===0?ce(e.CULL_FACE):(F(e.CULL_FACE),t!==D&&(t===1?e.cullFace(e.BACK):t===2?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))),D=t}function ve(t){t!==O&&(te&&e.lineWidth(t),O=t)}function ye(t,n,r){t?(F(e.POLYGON_OFFSET_FILL),(k!==n||ee!==r)&&(k=n,ee=r,o.getReversed()&&(n=-n),e.polygonOffset(n,r))):ce(e.POLYGON_OFFSET_FILL)}function xe(t){t?F(e.SCISSOR_TEST):ce(e.SCISSOR_TEST)}function Se(t){t===void 0&&(t=e.TEXTURE0+A-1),re!==t&&(e.activeTexture(t),re=t)}function Ce(t,n,r){r===void 0&&(r=re===null?e.TEXTURE0+A-1:re);let i=ie[r];i===void 0&&(i={type:void 0,texture:void 0},ie[r]=i),(i.type!==t||i.texture!==n)&&(re!==r&&(e.activeTexture(r),re=r),e.bindTexture(t,n||se[t]),i.type=t,i.texture=n)}function we(){let t=ie[re];t!==void 0&&t.type!==void 0&&(e.bindTexture(t.type,null),t.type=void 0,t.texture=void 0)}function Te(){try{e.compressedTexImage2D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function Ee(){try{e.compressedTexImage3D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function De(){try{e.texSubImage2D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function Oe(){try{e.texSubImage3D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function ke(){try{e.compressedTexSubImage2D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function Ae(){try{e.compressedTexSubImage3D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function L(){try{e.texStorage2D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function R(){try{e.texStorage3D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function je(){try{e.texImage2D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function z(){try{e.texImage3D(...arguments)}catch(e){ut(`WebGLState:`,e)}}function Me(t){N.equals(t)===!1&&(e.scissor(t.x,t.y,t.z,t.w),N.copy(t))}function B(t){oe.equals(t)===!1&&(e.viewport(t.x,t.y,t.z,t.w),oe.copy(t))}function Ne(t,n){let r=l.get(n);r===void 0&&(r=new WeakMap,l.set(n,r));let i=r.get(t);i===void 0&&(i=e.getUniformBlockIndex(n,t.name),r.set(t,i))}function V(t,n){let r=l.get(n).get(t);c.get(n)!==r&&(e.uniformBlockBinding(n,r,t.__bindingPointIndex),c.set(n,r))}function H(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),o.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),u={},re=null,ie={},d={},f=new WeakMap,p=[],m=null,h=!1,g=null,_=null,v=null,y=null,b=null,x=null,S=null,C=new I(0,0,0),w=0,T=!1,E=null,D=null,O=null,k=null,ee=null,N.set(0,0,e.canvas.width,e.canvas.height),oe.set(0,0,e.canvas.width,e.canvas.height),a.reset(),o.reset(),s.reset()}return{buffers:{color:a,depth:o,stencil:s},enable:F,disable:ce,bindFramebuffer:le,drawBuffers:ue,useProgram:de,setBlending:me,setMaterial:he,setFlipSided:ge,setCullFace:_e,setLineWidth:ve,setPolygonOffset:ye,setScissorTest:xe,activeTexture:Se,bindTexture:Ce,unbindTexture:we,compressedTexImage2D:Te,compressedTexImage3D:Ee,texImage2D:je,texImage3D:z,updateUBOMapping:Ne,uniformBlockBinding:V,texStorage2D:L,texStorage3D:R,texSubImage2D:De,texSubImage3D:Oe,compressedTexSubImage2D:ke,compressedTexSubImage3D:Ae,scissor:Me,viewport:B,reset:H}}function Ja(e,t,n,r,i,a,o){let s=t.has(`WEBGL_multisampled_render_to_texture`)?t.get(`WEBGL_multisampled_render_to_texture`):null,c=typeof navigator>`u`?!1:/OculusBrowser/g.test(navigator.userAgent),l=new ct,u=new WeakMap,d,f=new WeakMap,p=!1;try{p=typeof OffscreenCanvas<`u`&&new OffscreenCanvas(1,1).getContext(`2d`)!==null}catch{}function m(e,t){return p?new OffscreenCanvas(e,t):et(`canvas`)}function h(e,t,n){let r=1,i=Te(e);if((i.width>n||i.height>n)&&(r=n/Math.max(i.width,i.height)),r<1){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap||typeof VideoFrame<`u`&&e instanceof VideoFrame){let n=Math.floor(r*i.width),a=Math.floor(r*i.height);d===void 0&&(d=m(n,a));let o=t?m(n,a):d;return o.width=n,o.height=a,o.getContext(`2d`).drawImage(e,0,0,n,a),Je(`WebGLRenderer: Texture has been resized from (`+i.width+`x`+i.height+`) to (`+n+`x`+a+`).`),o}return`data`in e&&Je(`WebGLRenderer: Image in DataTexture is too big (`+i.width+`x`+i.height+`).`),e}return e}function g(e){return e.generateMipmaps}function _(t){e.generateMipmap(t)}function v(t){return t.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:t.isWebGL3DRenderTarget?e.TEXTURE_3D:t.isWebGLArrayRenderTarget||t.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function y(n,r,i,a,o=!1){if(n!==null){if(e[n]!==void 0)return e[n];Je(`WebGLRenderer: Attempt to use non-existing WebGL internal format '`+n+`'`)}let s=r;if(r===e.RED&&(i===e.FLOAT&&(s=e.R32F),i===e.HALF_FLOAT&&(s=e.R16F),i===e.UNSIGNED_BYTE&&(s=e.R8)),r===e.RED_INTEGER&&(i===e.UNSIGNED_BYTE&&(s=e.R8UI),i===e.UNSIGNED_SHORT&&(s=e.R16UI),i===e.UNSIGNED_INT&&(s=e.R32UI),i===e.BYTE&&(s=e.R8I),i===e.SHORT&&(s=e.R16I),i===e.INT&&(s=e.R32I)),r===e.RG&&(i===e.FLOAT&&(s=e.RG32F),i===e.HALF_FLOAT&&(s=e.RG16F),i===e.UNSIGNED_BYTE&&(s=e.RG8)),r===e.RG_INTEGER&&(i===e.UNSIGNED_BYTE&&(s=e.RG8UI),i===e.UNSIGNED_SHORT&&(s=e.RG16UI),i===e.UNSIGNED_INT&&(s=e.RG32UI),i===e.BYTE&&(s=e.RG8I),i===e.SHORT&&(s=e.RG16I),i===e.INT&&(s=e.RG32I)),r===e.RGB_INTEGER&&(i===e.UNSIGNED_BYTE&&(s=e.RGB8UI),i===e.UNSIGNED_SHORT&&(s=e.RGB16UI),i===e.UNSIGNED_INT&&(s=e.RGB32UI),i===e.BYTE&&(s=e.RGB8I),i===e.SHORT&&(s=e.RGB16I),i===e.INT&&(s=e.RGB32I)),r===e.RGBA_INTEGER&&(i===e.UNSIGNED_BYTE&&(s=e.RGBA8UI),i===e.UNSIGNED_SHORT&&(s=e.RGBA16UI),i===e.UNSIGNED_INT&&(s=e.RGBA32UI),i===e.BYTE&&(s=e.RGBA8I),i===e.SHORT&&(s=e.RGBA16I),i===e.INT&&(s=e.RGBA32I)),r===e.RGB&&(i===e.UNSIGNED_INT_5_9_9_9_REV&&(s=e.RGB9_E5),i===e.UNSIGNED_INT_10F_11F_11F_REV&&(s=e.R11F_G11F_B10F)),r===e.RGBA){let t=o?B:bt.getTransfer(a);i===e.FLOAT&&(s=e.RGBA32F),i===e.HALF_FLOAT&&(s=e.RGBA16F),i===e.UNSIGNED_BYTE&&(s=t===`srgb`?e.SRGB8_ALPHA8:e.RGBA8),i===e.UNSIGNED_SHORT_4_4_4_4&&(s=e.RGBA4),i===e.UNSIGNED_SHORT_5_5_5_1&&(s=e.RGB5_A1)}return(s===e.R16F||s===e.R32F||s===e.RG16F||s===e.RG32F||s===e.RGBA16F||s===e.RGBA32F)&&t.get(`EXT_color_buffer_float`),s}function b(t,n){let r;return t?n===null||n===1014||n===1020?r=e.DEPTH24_STENCIL8:n===1015?r=e.DEPTH32F_STENCIL8:n===1012&&(r=e.DEPTH24_STENCIL8,Je(`DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.`)):n===null||n===1014||n===1020?r=e.DEPTH_COMPONENT24:n===1015?r=e.DEPTH_COMPONENT32F:n===1012&&(r=e.DEPTH_COMPONENT16),r}function x(e,t){return g(e)===!0||e.isFramebufferTexture&&e.minFilter!==1003&&e.minFilter!==1006?Math.log2(Math.max(t.width,t.height))+1:e.mipmaps!==void 0&&e.mipmaps.length>0?e.mipmaps.length:e.isCompressedTexture&&Array.isArray(e.image)?t.mipmaps.length:1}function S(e){let t=e.target;t.removeEventListener(`dispose`,S),w(t),t.isVideoTexture&&u.delete(t)}function C(e){let t=e.target;t.removeEventListener(`dispose`,C),E(t)}function w(e){let t=r.get(e);if(t.__webglInit===void 0)return;let n=e.source,i=f.get(n);if(i){let r=i[t.__cacheKey];r.usedTimes--,r.usedTimes===0&&T(e),Object.keys(i).length===0&&f.delete(n)}r.remove(e)}function T(t){let n=r.get(t);e.deleteTexture(n.__webglTexture);let i=t.source,a=f.get(i);delete a[n.__cacheKey],o.memory.textures--}function E(t){let n=r.get(t);if(t.depthTexture&&(t.depthTexture.dispose(),r.remove(t.depthTexture)),t.isWebGLCubeRenderTarget)for(let t=0;t<6;t++){if(Array.isArray(n.__webglFramebuffer[t]))for(let r=0;r<n.__webglFramebuffer[t].length;r++)e.deleteFramebuffer(n.__webglFramebuffer[t][r]);else e.deleteFramebuffer(n.__webglFramebuffer[t]);n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer[t])}else{if(Array.isArray(n.__webglFramebuffer))for(let t=0;t<n.__webglFramebuffer.length;t++)e.deleteFramebuffer(n.__webglFramebuffer[t]);else e.deleteFramebuffer(n.__webglFramebuffer);if(n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer),n.__webglMultisampledFramebuffer&&e.deleteFramebuffer(n.__webglMultisampledFramebuffer),n.__webglColorRenderbuffer)for(let t=0;t<n.__webglColorRenderbuffer.length;t++)n.__webglColorRenderbuffer[t]&&e.deleteRenderbuffer(n.__webglColorRenderbuffer[t]);n.__webglDepthRenderbuffer&&e.deleteRenderbuffer(n.__webglDepthRenderbuffer)}let i=t.textures;for(let t=0,n=i.length;t<n;t++){let n=r.get(i[t]);n.__webglTexture&&(e.deleteTexture(n.__webglTexture),o.memory.textures--),r.remove(i[t])}r.remove(t)}let D=0;function O(){D=0}function k(){let e=D;return e>=i.maxTextures&&Je(`WebGLTextures: Trying to use `+e+` texture units while this GPU supports only `+i.maxTextures),D+=1,e}function ee(e){let t=[];return t.push(e.wrapS),t.push(e.wrapT),t.push(e.wrapR||0),t.push(e.magFilter),t.push(e.minFilter),t.push(e.anisotropy),t.push(e.internalFormat),t.push(e.format),t.push(e.type),t.push(e.generateMipmaps),t.push(e.premultiplyAlpha),t.push(e.flipY),t.push(e.unpackAlignment),t.push(e.colorSpace),t.join()}function A(t,i){let a=r.get(t);if(t.isVideoTexture&&I(t),t.isRenderTargetTexture===!1&&t.isExternalTexture!==!0&&t.version>0&&a.__version!==t.version){let e=t.image;if(e===null)Je(`WebGLRenderer: Texture marked for update but no image data found.`);else if(e.complete===!1)Je(`WebGLRenderer: Texture marked for update but image is incomplete`);else{F(a,t,i);return}}else t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null);n.bindTexture(e.TEXTURE_2D,a.__webglTexture,e.TEXTURE0+i)}function te(t,i){let a=r.get(t);t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version?F(a,t,i):(t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null),n.bindTexture(e.TEXTURE_2D_ARRAY,a.__webglTexture,e.TEXTURE0+i))}function j(t,i){let a=r.get(t);t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version?F(a,t,i):n.bindTexture(e.TEXTURE_3D,a.__webglTexture,e.TEXTURE0+i)}function ne(t,i){let a=r.get(t);t.isCubeDepthTexture!==!0&&t.version>0&&a.__version!==t.version?ce(a,t,i):n.bindTexture(e.TEXTURE_CUBE_MAP,a.__webglTexture,e.TEXTURE0+i)}let re={[Re]:e.REPEAT,[Pe]:e.CLAMP_TO_EDGE,[ze]:e.MIRRORED_REPEAT},ie={[Ie]:e.NEAREST,[xt]:e.NEAREST_MIPMAP_NEAREST,[Ce]:e.NEAREST_MIPMAP_LINEAR,[ye]:e.LINEAR,[ae]:e.LINEAR_MIPMAP_NEAREST,[xe]:e.LINEAR_MIPMAP_LINEAR},M={512:e.NEVER,519:e.ALWAYS,513:e.LESS,515:e.LEQUAL,514:e.EQUAL,518:e.GEQUAL,516:e.GREATER,517:e.NOTEQUAL};function N(n,a){if(a.type===1015&&t.has(`OES_texture_float_linear`)===!1&&(a.magFilter===1006||a.magFilter===1007||a.magFilter===1005||a.magFilter===1008||a.minFilter===1006||a.minFilter===1007||a.minFilter===1005||a.minFilter===1008)&&Je(`WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.`),e.texParameteri(n,e.TEXTURE_WRAP_S,re[a.wrapS]),e.texParameteri(n,e.TEXTURE_WRAP_T,re[a.wrapT]),(n===e.TEXTURE_3D||n===e.TEXTURE_2D_ARRAY)&&e.texParameteri(n,e.TEXTURE_WRAP_R,re[a.wrapR]),e.texParameteri(n,e.TEXTURE_MAG_FILTER,ie[a.magFilter]),e.texParameteri(n,e.TEXTURE_MIN_FILTER,ie[a.minFilter]),a.compareFunction&&(e.texParameteri(n,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(n,e.TEXTURE_COMPARE_FUNC,M[a.compareFunction])),t.has(`EXT_texture_filter_anisotropic`)===!0){if(a.magFilter===1003||a.minFilter!==1005&&a.minFilter!==1008||a.type===1015&&t.has(`OES_texture_float_linear`)===!1)return;if(a.anisotropy>1||r.get(a).__currentAnisotropy){let o=t.get(`EXT_texture_filter_anisotropic`);e.texParameterf(n,o.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(a.anisotropy,i.getMaxAnisotropy())),r.get(a).__currentAnisotropy=a.anisotropy}}}function oe(t,n){let r=!1;t.__webglInit===void 0&&(t.__webglInit=!0,n.addEventListener(`dispose`,S));let i=n.source,a=f.get(i);a===void 0&&(a={},f.set(i,a));let s=ee(n);if(s!==t.__cacheKey){a[s]===void 0&&(a[s]={texture:e.createTexture(),usedTimes:0},o.memory.textures++,r=!0),a[s].usedTimes++;let i=a[t.__cacheKey];i!==void 0&&(a[t.__cacheKey].usedTimes--,i.usedTimes===0&&T(n)),t.__cacheKey=s,t.__webglTexture=a[s].texture}return r}function P(e,t,n){return Math.floor(Math.floor(e/n)/t)}function se(t,r,i,a){let o=t.updateRanges;if(o.length===0)n.texSubImage2D(e.TEXTURE_2D,0,0,0,r.width,r.height,i,a,r.data);else{o.sort((e,t)=>e.start-t.start);let s=0;for(let e=1;e<o.length;e++){let t=o[s],n=o[e],i=t.start+t.count,a=P(n.start,r.width,4),c=P(t.start,r.width,4);n.start<=i+1&&a===c&&P(n.start+n.count-1,r.width,4)===a?t.count=Math.max(t.count,n.start+n.count-t.start):(++s,o[s]=n)}o.length=s+1;let c=e.getParameter(e.UNPACK_ROW_LENGTH),l=e.getParameter(e.UNPACK_SKIP_PIXELS),u=e.getParameter(e.UNPACK_SKIP_ROWS);e.pixelStorei(e.UNPACK_ROW_LENGTH,r.width);for(let t=0,s=o.length;t<s;t++){let s=o[t],c=Math.floor(s.start/4),l=Math.ceil(s.count/4),u=c%r.width,d=Math.floor(c/r.width),f=l;e.pixelStorei(e.UNPACK_SKIP_PIXELS,u),e.pixelStorei(e.UNPACK_SKIP_ROWS,d),n.texSubImage2D(e.TEXTURE_2D,0,u,d,f,1,i,a,r.data)}t.clearUpdateRanges(),e.pixelStorei(e.UNPACK_ROW_LENGTH,c),e.pixelStorei(e.UNPACK_SKIP_PIXELS,l),e.pixelStorei(e.UNPACK_SKIP_ROWS,u)}}function F(t,o,s){let c=e.TEXTURE_2D;(o.isDataArrayTexture||o.isCompressedArrayTexture)&&(c=e.TEXTURE_2D_ARRAY),o.isData3DTexture&&(c=e.TEXTURE_3D);let l=oe(t,o),u=o.source;n.bindTexture(c,t.__webglTexture,e.TEXTURE0+s);let d=r.get(u);if(u.version!==d.__version||l===!0){n.activeTexture(e.TEXTURE0+s);let t=bt.getPrimaries(bt.workingColorSpace),r=o.colorSpace===``?null:bt.getPrimaries(o.colorSpace),f=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),e.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,f);let p=h(o.image,!1,i.maxTextureSize);p=we(o,p);let m=a.convert(o.format,o.colorSpace),v=a.convert(o.type),S=y(o.internalFormat,m,v,o.colorSpace,o.isVideoTexture);N(c,o);let C,w=o.mipmaps,T=o.isVideoTexture!==!0,E=d.__version===void 0||l===!0,D=u.dataReady,O=x(o,p);if(o.isDepthTexture)S=b(o.format===We,o.type),E&&(T?n.texStorage2D(e.TEXTURE_2D,1,S,p.width,p.height):n.texImage2D(e.TEXTURE_2D,0,S,p.width,p.height,0,m,v,null));else if(o.isDataTexture){if(w.length>0){T&&E&&n.texStorage2D(e.TEXTURE_2D,O,S,w[0].width,w[0].height);for(let t=0,r=w.length;t<r;t++)C=w[t],T?D&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,C.width,C.height,m,v,C.data):n.texImage2D(e.TEXTURE_2D,t,S,C.width,C.height,0,m,v,C.data);o.generateMipmaps=!1}else T?(E&&n.texStorage2D(e.TEXTURE_2D,O,S,p.width,p.height),D&&se(o,p,m,v)):n.texImage2D(e.TEXTURE_2D,0,S,p.width,p.height,0,m,v,p.data)}else if(o.isCompressedTexture){if(o.isCompressedArrayTexture){T&&E&&n.texStorage3D(e.TEXTURE_2D_ARRAY,O,S,w[0].width,w[0].height,p.depth);for(let t=0,r=w.length;t<r;t++)if(C=w[t],o.format!==1023){if(m!==null){if(T){if(D){if(o.layerUpdates.size>0){let r=Be(C.width,C.height,o.format,o.type);for(let i of o.layerUpdates){let a=C.data.subarray(i*r/C.data.BYTES_PER_ELEMENT,(i+1)*r/C.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,t,0,0,i,C.width,C.height,1,m,a)}o.clearLayerUpdates()}else n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,t,0,0,0,C.width,C.height,p.depth,m,C.data)}}else n.compressedTexImage3D(e.TEXTURE_2D_ARRAY,t,S,C.width,C.height,p.depth,0,C.data,0,0)}else Je(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`)}else T?D&&n.texSubImage3D(e.TEXTURE_2D_ARRAY,t,0,0,0,C.width,C.height,p.depth,m,v,C.data):n.texImage3D(e.TEXTURE_2D_ARRAY,t,S,C.width,C.height,p.depth,0,m,v,C.data)}else{T&&E&&n.texStorage2D(e.TEXTURE_2D,O,S,w[0].width,w[0].height);for(let t=0,r=w.length;t<r;t++)C=w[t],o.format===1023?T?D&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,C.width,C.height,m,v,C.data):n.texImage2D(e.TEXTURE_2D,t,S,C.width,C.height,0,m,v,C.data):m===null?Je(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`):T?D&&n.compressedTexSubImage2D(e.TEXTURE_2D,t,0,0,C.width,C.height,m,C.data):n.compressedTexImage2D(e.TEXTURE_2D,t,S,C.width,C.height,0,C.data)}}else if(o.isDataArrayTexture){if(T){if(E&&n.texStorage3D(e.TEXTURE_2D_ARRAY,O,S,p.width,p.height,p.depth),D){if(o.layerUpdates.size>0){let t=Be(p.width,p.height,o.format,o.type);for(let r of o.layerUpdates){let i=p.data.subarray(r*t/p.data.BYTES_PER_ELEMENT,(r+1)*t/p.data.BYTES_PER_ELEMENT);n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,r,p.width,p.height,1,m,v,i)}o.clearLayerUpdates()}else n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,p.width,p.height,p.depth,m,v,p.data)}}else n.texImage3D(e.TEXTURE_2D_ARRAY,0,S,p.width,p.height,p.depth,0,m,v,p.data)}else if(o.isData3DTexture)T?(E&&n.texStorage3D(e.TEXTURE_3D,O,S,p.width,p.height,p.depth),D&&n.texSubImage3D(e.TEXTURE_3D,0,0,0,0,p.width,p.height,p.depth,m,v,p.data)):n.texImage3D(e.TEXTURE_3D,0,S,p.width,p.height,p.depth,0,m,v,p.data);else if(o.isFramebufferTexture){if(E){if(T)n.texStorage2D(e.TEXTURE_2D,O,S,p.width,p.height);else{let t=p.width,r=p.height;for(let i=0;i<O;i++)n.texImage2D(e.TEXTURE_2D,i,S,t,r,0,m,v,null),t>>=1,r>>=1}}}else if(w.length>0){if(T&&E){let t=Te(w[0]);n.texStorage2D(e.TEXTURE_2D,O,S,t.width,t.height)}for(let t=0,r=w.length;t<r;t++)C=w[t],T?D&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,m,v,C):n.texImage2D(e.TEXTURE_2D,t,S,m,v,C);o.generateMipmaps=!1}else if(T){if(E){let t=Te(p);n.texStorage2D(e.TEXTURE_2D,O,S,t.width,t.height)}D&&n.texSubImage2D(e.TEXTURE_2D,0,0,0,m,v,p)}else n.texImage2D(e.TEXTURE_2D,0,S,m,v,p);g(o)&&_(c),d.__version=u.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function ce(t,o,s){if(o.image.length!==6)return;let c=oe(t,o),l=o.source;n.bindTexture(e.TEXTURE_CUBE_MAP,t.__webglTexture,e.TEXTURE0+s);let u=r.get(l);if(l.version!==u.__version||c===!0){n.activeTexture(e.TEXTURE0+s);let t=bt.getPrimaries(bt.workingColorSpace),r=o.colorSpace===``?null:bt.getPrimaries(o.colorSpace),d=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),e.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,d);let f=o.isCompressedTexture||o.image[0].isCompressedTexture,p=o.image[0]&&o.image[0].isDataTexture,m=[];for(let e=0;e<6;e++)!f&&!p?m[e]=h(o.image[e],!0,i.maxCubemapSize):m[e]=p?o.image[e].image:o.image[e],m[e]=we(o,m[e]);let v=m[0],b=a.convert(o.format,o.colorSpace),S=a.convert(o.type),C=y(o.internalFormat,b,S,o.colorSpace),w=o.isVideoTexture!==!0,T=u.__version===void 0||c===!0,E=l.dataReady,D=x(o,v);N(e.TEXTURE_CUBE_MAP,o);let O;if(f){w&&T&&n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,v.width,v.height);for(let t=0;t<6;t++){O=m[t].mipmaps;for(let r=0;r<O.length;r++){let i=O[r];o.format===1023?w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,b,S,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,b,S,i.data):b===null?Je(`WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()`):w?E&&n.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,b,i.data):n.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,i.data)}}}else{if(O=o.mipmaps,w&&T){O.length>0&&D++;let t=Te(m[0]);n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,t.width,t.height)}for(let t=0;t<6;t++)if(p){w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,m[t].width,m[t].height,b,S,m[t].data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,m[t].width,m[t].height,0,b,S,m[t].data);for(let r=0;r<O.length;r++){let i=O[r].image[t].image;w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,i.width,i.height,b,S,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,i.width,i.height,0,b,S,i.data)}}else{w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,b,S,m[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,b,S,m[t]);for(let r=0;r<O.length;r++){let i=O[r];w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,b,S,i.image[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,b,S,i.image[t])}}}g(o)&&_(e.TEXTURE_CUBE_MAP),u.__version=l.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function le(t,i,o,c,l,u){let d=a.convert(o.format,o.colorSpace),f=a.convert(o.type),p=y(o.internalFormat,d,f,o.colorSpace),m=r.get(i),h=r.get(o);if(h.__renderTarget=i,!m.__hasExternalTextures){let t=Math.max(1,i.width>>u),r=Math.max(1,i.height>>u);l===e.TEXTURE_3D||l===e.TEXTURE_2D_ARRAY?n.texImage3D(l,u,p,t,r,i.depth,0,d,f,null):n.texImage2D(l,u,p,t,r,0,d,f,null)}n.bindFramebuffer(e.FRAMEBUFFER,t),Se(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,c,l,h.__webglTexture,0,be(i)):(l===e.TEXTURE_2D||l>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&l<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,c,l,h.__webglTexture,u),n.bindFramebuffer(e.FRAMEBUFFER,null)}function ue(t,n,r){if(e.bindRenderbuffer(e.RENDERBUFFER,t),n.depthBuffer){let i=n.depthTexture,a=i&&i.isDepthTexture?i.type:null,o=b(n.stencilBuffer,a),c=n.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;Se(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,be(n),o,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,be(n),o,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,o,n.width,n.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,c,e.RENDERBUFFER,t)}else{let t=n.textures;for(let i=0;i<t.length;i++){let o=t[i],c=a.convert(o.format,o.colorSpace),l=a.convert(o.type),u=y(o.internalFormat,c,l,o.colorSpace);Se(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,be(n),u,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,be(n),u,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,u,n.width,n.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function de(t,i,o){let c=i.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(e.FRAMEBUFFER,t),!(i.depthTexture&&i.depthTexture.isDepthTexture))throw Error(`renderTarget.depthTexture must be an instance of THREE.DepthTexture`);let l=r.get(i.depthTexture);if(l.__renderTarget=i,(!l.__webglTexture||i.depthTexture.image.width!==i.width||i.depthTexture.image.height!==i.height)&&(i.depthTexture.image.width=i.width,i.depthTexture.image.height=i.height,i.depthTexture.needsUpdate=!0),c){if(l.__webglInit===void 0&&(l.__webglInit=!0,i.depthTexture.addEventListener(`dispose`,S)),l.__webglTexture===void 0){l.__webglTexture=e.createTexture(),n.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),N(e.TEXTURE_CUBE_MAP,i.depthTexture);let t=a.convert(i.depthTexture.format),r=a.convert(i.depthTexture.type),o;i.depthTexture.format===1026?o=e.DEPTH_COMPONENT24:i.depthTexture.format===1027&&(o=e.DEPTH24_STENCIL8);for(let n=0;n<6;n++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0,o,i.width,i.height,0,t,r,null)}}else A(i.depthTexture,0);let u=l.__webglTexture,d=be(i),f=c?e.TEXTURE_CUBE_MAP_POSITIVE_X+o:e.TEXTURE_2D,p=i.depthTexture.format===1027?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(i.depthTexture.format===1026)Se(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else if(i.depthTexture.format===1027)Se(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else throw Error(`Unknown depthTexture format`)}function fe(t){let i=r.get(t),a=t.isWebGLCubeRenderTarget===!0;if(i.__boundDepthTexture!==t.depthTexture){let e=t.depthTexture;if(i.__depthDisposeCallback&&i.__depthDisposeCallback(),e){let t=()=>{delete i.__boundDepthTexture,delete i.__depthDisposeCallback,e.removeEventListener(`dispose`,t)};e.addEventListener(`dispose`,t),i.__depthDisposeCallback=t}i.__boundDepthTexture=e}if(t.depthTexture&&!i.__autoAllocateDepthBuffer){if(a)for(let e=0;e<6;e++)de(i.__webglFramebuffer[e],t,e);else{let e=t.texture.mipmaps;e&&e.length>0?de(i.__webglFramebuffer[0],t,0):de(i.__webglFramebuffer,t,0)}}else if(a){i.__webglDepthbuffer=[];for(let r=0;r<6;r++)if(n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[r]),i.__webglDepthbuffer[r]===void 0)i.__webglDepthbuffer[r]=e.createRenderbuffer(),ue(i.__webglDepthbuffer[r],t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,a=i.__webglDepthbuffer[r];e.bindRenderbuffer(e.RENDERBUFFER,a),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,a)}}else{let r=t.texture.mipmaps;if(r&&r.length>0?n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[0]):n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer),i.__webglDepthbuffer===void 0)i.__webglDepthbuffer=e.createRenderbuffer(),ue(i.__webglDepthbuffer,t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,r=i.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,r),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,r)}}n.bindFramebuffer(e.FRAMEBUFFER,null)}function pe(t,n,i){let a=r.get(t);n!==void 0&&le(a.__webglFramebuffer,t,t.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),i!==void 0&&fe(t)}function me(t){let i=t.texture,s=r.get(t),c=r.get(i);t.addEventListener(`dispose`,C);let l=t.textures,u=t.isWebGLCubeRenderTarget===!0,d=l.length>1;if(d||(c.__webglTexture===void 0&&(c.__webglTexture=e.createTexture()),c.__version=i.version,o.memory.textures++),u){s.__webglFramebuffer=[];for(let t=0;t<6;t++)if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer[t]=[];for(let n=0;n<i.mipmaps.length;n++)s.__webglFramebuffer[t][n]=e.createFramebuffer()}else s.__webglFramebuffer[t]=e.createFramebuffer()}else{if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer=[];for(let t=0;t<i.mipmaps.length;t++)s.__webglFramebuffer[t]=e.createFramebuffer()}else s.__webglFramebuffer=e.createFramebuffer();if(d)for(let t=0,n=l.length;t<n;t++){let n=r.get(l[t]);n.__webglTexture===void 0&&(n.__webglTexture=e.createTexture(),o.memory.textures++)}if(t.samples>0&&Se(t)===!1){s.__webglMultisampledFramebuffer=e.createFramebuffer(),s.__webglColorRenderbuffer=[],n.bindFramebuffer(e.FRAMEBUFFER,s.__webglMultisampledFramebuffer);for(let n=0;n<l.length;n++){let r=l[n];s.__webglColorRenderbuffer[n]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,s.__webglColorRenderbuffer[n]);let i=a.convert(r.format,r.colorSpace),o=a.convert(r.type),c=y(r.internalFormat,i,o,r.colorSpace,t.isXRRenderTarget===!0),u=be(t);e.renderbufferStorageMultisample(e.RENDERBUFFER,u,c,t.width,t.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+n,e.RENDERBUFFER,s.__webglColorRenderbuffer[n])}e.bindRenderbuffer(e.RENDERBUFFER,null),t.depthBuffer&&(s.__webglDepthRenderbuffer=e.createRenderbuffer(),ue(s.__webglDepthRenderbuffer,t,!0)),n.bindFramebuffer(e.FRAMEBUFFER,null)}}if(u){n.bindTexture(e.TEXTURE_CUBE_MAP,c.__webglTexture),N(e.TEXTURE_CUBE_MAP,i);for(let n=0;n<6;n++)if(i.mipmaps&&i.mipmaps.length>0)for(let r=0;r<i.mipmaps.length;r++)le(s.__webglFramebuffer[n][r],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,r);else le(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0);g(i)&&_(e.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(d){for(let i=0,a=l.length;i<a;i++){let a=l[i],o=r.get(a),c=e.TEXTURE_2D;(t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(c=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(c,o.__webglTexture),N(c,a),le(s.__webglFramebuffer,t,a,e.COLOR_ATTACHMENT0+i,c,0),g(a)&&_(c)}n.unbindTexture()}else{let r=e.TEXTURE_2D;if((t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(r=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(r,c.__webglTexture),N(r,i),i.mipmaps&&i.mipmaps.length>0)for(let n=0;n<i.mipmaps.length;n++)le(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,r,n);else le(s.__webglFramebuffer,t,i,e.COLOR_ATTACHMENT0,r,0);g(i)&&_(r),n.unbindTexture()}t.depthBuffer&&fe(t)}function he(e){let t=e.textures;for(let i=0,a=t.length;i<a;i++){let a=t[i];if(g(a)){let t=v(e),i=r.get(a).__webglTexture;n.bindTexture(t,i),_(t),n.unbindTexture()}}}let ge=[],_e=[];function ve(t){if(t.samples>0){if(Se(t)===!1){let i=t.textures,a=t.width,o=t.height,s=e.COLOR_BUFFER_BIT,l=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,u=r.get(t),d=i.length>1;if(d)for(let t=0;t<i.length;t++)n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,null),n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,null,0);n.bindFramebuffer(e.READ_FRAMEBUFFER,u.__webglMultisampledFramebuffer);let f=t.texture.mipmaps;f&&f.length>0?n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer[0]):n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer);for(let n=0;n<i.length;n++){if(t.resolveDepthBuffer&&(t.depthBuffer&&(s|=e.DEPTH_BUFFER_BIT),t.stencilBuffer&&t.resolveStencilBuffer&&(s|=e.STENCIL_BUFFER_BIT)),d){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,u.__webglColorRenderbuffer[n]);let t=r.get(i[n]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0)}e.blitFramebuffer(0,0,a,o,0,0,a,o,s,e.NEAREST),c===!0&&(ge.length=0,_e.length=0,ge.push(e.COLOR_ATTACHMENT0+n),t.depthBuffer&&t.resolveDepthBuffer===!1&&(ge.push(l),_e.push(l),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,_e)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,ge))}if(n.bindFramebuffer(e.READ_FRAMEBUFFER,null),n.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),d)for(let t=0;t<i.length;t++){n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,u.__webglColorRenderbuffer[t]);let a=r.get(i[t]).__webglTexture;n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,a,0)}n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglMultisampledFramebuffer)}else if(t.depthBuffer&&t.resolveDepthBuffer===!1&&c){let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[n])}}}function be(e){return Math.min(i.maxSamples,e.samples)}function Se(e){let n=r.get(e);return e.samples>0&&t.has(`WEBGL_multisampled_render_to_texture`)===!0&&n.__useRenderToTexture!==!1}function I(e){let t=o.render.frame;u.get(e)!==t&&(u.set(e,t),e.update())}function we(e,t){let n=e.colorSpace,r=e.format,i=e.type;return e.isCompressedTexture===!0||e.isVideoTexture===!0||n!==`srgb-linear`&&n!==``&&(bt.getTransfer(n)===`srgb`?(r!==1023||i!==1009)&&Je(`WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.`):ut(`WebGLTextures: Unsupported texture color space:`,n)),t}function Te(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement?(l.width=e.naturalWidth||e.width,l.height=e.naturalHeight||e.height):typeof VideoFrame<`u`&&e instanceof VideoFrame?(l.width=e.displayWidth,l.height=e.displayHeight):(l.width=e.width,l.height=e.height),l}this.allocateTextureUnit=k,this.resetTextureUnits=O,this.setTexture2D=A,this.setTexture2DArray=te,this.setTexture3D=j,this.setTextureCube=ne,this.rebindTextures=pe,this.setupRenderTarget=me,this.updateRenderTargetMipmap=he,this.updateMultisampleRenderTarget=ve,this.setupDepthRenderbuffer=fe,this.setupFrameBufferTexture=le,this.useMultisampledRTT=Se,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function Ya(e,t){function n(n,r=``){let i,a=bt.getTransfer(r);if(n===1009)return e.UNSIGNED_BYTE;if(n===1017)return e.UNSIGNED_SHORT_4_4_4_4;if(n===1018)return e.UNSIGNED_SHORT_5_5_5_1;if(n===35902)return e.UNSIGNED_INT_5_9_9_9_REV;if(n===35899)return e.UNSIGNED_INT_10F_11F_11F_REV;if(n===1010)return e.BYTE;if(n===1011)return e.SHORT;if(n===1012)return e.UNSIGNED_SHORT;if(n===1013)return e.INT;if(n===1014)return e.UNSIGNED_INT;if(n===1015)return e.FLOAT;if(n===1016)return e.HALF_FLOAT;if(n===1021)return e.ALPHA;if(n===1022)return e.RGB;if(n===1023)return e.RGBA;if(n===1026)return e.DEPTH_COMPONENT;if(n===1027)return e.DEPTH_STENCIL;if(n===1028)return e.RED;if(n===1029)return e.RED_INTEGER;if(n===1030)return e.RG;if(n===1031)return e.RG_INTEGER;if(n===1033)return e.RGBA_INTEGER;if(n===33776||n===33777||n===33778||n===33779){if(a===`srgb`){if(i=t.get(`WEBGL_compressed_texture_s3tc_srgb`),i!==null){if(n===33776)return i.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null}else if(i=t.get(`WEBGL_compressed_texture_s3tc`),i!==null){if(n===33776)return i.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null}if(n===35840||n===35841||n===35842||n===35843){if(i=t.get(`WEBGL_compressed_texture_pvrtc`),i!==null){if(n===35840)return i.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===35841)return i.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===35842)return i.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===35843)return i.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null}if(n===36196||n===37492||n===37496||n===37488||n===37489||n===37490||n===37491){if(i=t.get(`WEBGL_compressed_texture_etc`),i!==null){if(n===36196||n===37492)return a===`srgb`?i.COMPRESSED_SRGB8_ETC2:i.COMPRESSED_RGB8_ETC2;if(n===37496)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:i.COMPRESSED_RGBA8_ETC2_EAC;if(n===37488)return i.COMPRESSED_R11_EAC;if(n===37489)return i.COMPRESSED_SIGNED_R11_EAC;if(n===37490)return i.COMPRESSED_RG11_EAC;if(n===37491)return i.COMPRESSED_SIGNED_RG11_EAC}else return null}if(n===37808||n===37809||n===37810||n===37811||n===37812||n===37813||n===37814||n===37815||n===37816||n===37817||n===37818||n===37819||n===37820||n===37821){if(i=t.get(`WEBGL_compressed_texture_astc`),i!==null){if(n===37808)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:i.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===37809)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:i.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===37810)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:i.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===37811)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:i.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===37812)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:i.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===37813)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:i.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===37814)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:i.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===37815)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:i.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===37816)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:i.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===37817)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:i.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===37818)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:i.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===37819)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:i.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===37820)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:i.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===37821)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:i.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null}if(n===36492||n===36494||n===36495){if(i=t.get(`EXT_texture_compression_bptc`),i!==null){if(n===36492)return a===`srgb`?i.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:i.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===36494)return i.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===36495)return i.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null}if(n===36283||n===36284||n===36285||n===36286){if(i=t.get(`EXT_texture_compression_rgtc`),i!==null){if(n===36283)return i.COMPRESSED_RED_RGTC1_EXT;if(n===36284)return i.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===36285)return i.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===36286)return i.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null}return n===1020?e.UNSIGNED_INT_24_8:e[n]===void 0?null:e[n]}return{convert:n}}var Xa=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Za=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Qa=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new ie(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new Ct({vertexShader:Xa,fragmentShader:Za,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new U(new c(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},$a=class extends ee{constructor(e,t){super();let i=this,a=null,o=1,s=null,c=`local-floor`,l=1,u=null,d=null,f=null,p=null,m=null,h=null,g=typeof XRWebGLBinding<`u`,_=new Qa,v={},y=t.getContextAttributes(),b=null,x=null,C=[],w=[],T=new ct,E=null,D=new Dt;D.viewport=new be;let O=new Dt;O.viewport=new be;let ee=[D,O],A=new Ke,te=null,ne=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(e){let t=C[e];return t===void 0&&(t=new n,C[e]=t),t.getTargetRaySpace()},this.getControllerGrip=function(e){let t=C[e];return t===void 0&&(t=new n,C[e]=t),t.getGripSpace()},this.getHand=function(e){let t=C[e];return t===void 0&&(t=new n,C[e]=t),t.getHandSpace()};function M(e){let t=w.indexOf(e.inputSource);if(t===-1)return;let n=C[t];n!==void 0&&(n.update(e.inputSource,e.frame,u||s),n.dispatchEvent({type:e.type,data:e.inputSource}))}function ae(){a.removeEventListener(`select`,M),a.removeEventListener(`selectstart`,M),a.removeEventListener(`selectend`,M),a.removeEventListener(`squeeze`,M),a.removeEventListener(`squeezestart`,M),a.removeEventListener(`squeezeend`,M),a.removeEventListener(`end`,ae),a.removeEventListener(`inputsourceschange`,oe);for(let e=0;e<C.length;e++){let t=w[e];t!==null&&(w[e]=null,C[e].disconnect(t))}te=null,ne=null,_.reset();for(let e in v)delete v[e];e.setRenderTarget(b),m=null,p=null,f=null,a=null,x=null,fe.stop(),i.isPresenting=!1,e.setPixelRatio(E),e.setSize(T.width,T.height,!1),i.dispatchEvent({type:`sessionend`})}this.setFramebufferScaleFactor=function(e){o=e,i.isPresenting===!0&&Je(`WebXRManager: Cannot change framebuffer scale while presenting.`)},this.setReferenceSpaceType=function(e){c=e,i.isPresenting===!0&&Je(`WebXRManager: Cannot change reference space type while presenting.`)},this.getReferenceSpace=function(){return u||s},this.setReferenceSpace=function(e){u=e},this.getBaseLayer=function(){return p===null?m:p},this.getBinding=function(){return f===null&&g&&(f=new XRWebGLBinding(a,t)),f},this.getFrame=function(){return h},this.getSession=function(){return a},this.setSession=async function(n){if(a=n,a!==null){if(b=e.getRenderTarget(),a.addEventListener(`select`,M),a.addEventListener(`selectstart`,M),a.addEventListener(`selectend`,M),a.addEventListener(`squeeze`,M),a.addEventListener(`squeezestart`,M),a.addEventListener(`squeezeend`,M),a.addEventListener(`end`,ae),a.addEventListener(`inputsourceschange`,oe),y.xrCompatible!==!0&&await t.makeXRCompatible(),E=e.getPixelRatio(),e.getSize(T),g&&`createProjectionLayer`in XRWebGLBinding.prototype){let n=null,i=null,s=null;y.depth&&(s=y.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,n=y.stencil?We:j,i=y.stencil?he:pe);let c={colorFormat:t.RGBA8,depthFormat:s,scaleFactor:o};f=this.getBinding(),p=f.createProjectionLayer(c),a.updateRenderState({layers:[p]}),e.setPixelRatio(1),e.setSize(p.textureWidth,p.textureHeight,!1),x=new N(p.textureWidth,p.textureHeight,{format:k,type:At,depthTexture:new r(p.textureWidth,p.textureHeight,i,void 0,void 0,void 0,void 0,void 0,void 0,n),stencilBuffer:y.stencil,colorSpace:e.outputColorSpace,samples:y.antialias?4:0,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}else{let n={antialias:y.antialias,alpha:!0,depth:y.depth,stencil:y.stencil,framebufferScaleFactor:o};m=new XRWebGLLayer(a,t,n),a.updateRenderState({baseLayer:m}),e.setPixelRatio(1),e.setSize(m.framebufferWidth,m.framebufferHeight,!1),x=new N(m.framebufferWidth,m.framebufferHeight,{format:k,type:At,colorSpace:e.outputColorSpace,stencilBuffer:y.stencil,resolveDepthBuffer:m.ignoreDepthValues===!1,resolveStencilBuffer:m.ignoreDepthValues===!1})}x.isXRRenderTarget=!0,this.setFoveation(l),u=null,s=await a.requestReferenceSpace(c),fe.setContext(a),fe.start(),i.isPresenting=!0,i.dispatchEvent({type:`sessionstart`})}},this.getEnvironmentBlendMode=function(){if(a!==null)return a.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function oe(e){for(let t=0;t<e.removed.length;t++){let n=e.removed[t],r=w.indexOf(n);r>=0&&(w[r]=null,C[r].disconnect(n))}for(let t=0;t<e.added.length;t++){let n=e.added[t],r=w.indexOf(n);if(r===-1){for(let e=0;e<C.length;e++)if(e>=w.length){w.push(n),r=e;break}else if(w[e]===null){w[e]=n,r=e;break}if(r===-1)break}let i=C[r];i&&i.connect(n)}}let P=new S,se=new S;function F(e,t,n){P.setFromMatrixPosition(t.matrixWorld),se.setFromMatrixPosition(n.matrixWorld);let r=P.distanceTo(se),i=t.projectionMatrix.elements,a=n.projectionMatrix.elements,o=i[14]/(i[10]-1),s=i[14]/(i[10]+1),c=(i[9]+1)/i[5],l=(i[9]-1)/i[5],u=(i[8]-1)/i[0],d=(a[8]+1)/a[0],f=o*u,p=o*d,m=r/(-u+d),h=m*-u;if(t.matrixWorld.decompose(e.position,e.quaternion,e.scale),e.translateX(h),e.translateZ(m),e.matrixWorld.compose(e.position,e.quaternion,e.scale),e.matrixWorldInverse.copy(e.matrixWorld).invert(),i[10]===-1)e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse);else{let t=o+m,n=s+m,i=f-h,a=p+(r-h),u=c*s/n*t,d=l*s/n*t;e.projectionMatrix.makePerspective(i,a,u,d,t,n),e.projectionMatrixInverse.copy(e.projectionMatrix).invert()}}function ce(e,t){t===null?e.matrixWorld.copy(e.matrix):e.matrixWorld.multiplyMatrices(t.matrixWorld,e.matrix),e.matrixWorldInverse.copy(e.matrixWorld).invert()}this.updateCamera=function(e){if(a===null)return;let t=e.near,n=e.far;_.texture!==null&&(_.depthNear>0&&(t=_.depthNear),_.depthFar>0&&(n=_.depthFar)),A.near=O.near=D.near=t,A.far=O.far=D.far=n,(te!==A.near||ne!==A.far)&&(a.updateRenderState({depthNear:A.near,depthFar:A.far}),te=A.near,ne=A.far),A.layers.mask=e.layers.mask|6,D.layers.mask=A.layers.mask&-5,O.layers.mask=A.layers.mask&-3;let r=e.parent,i=A.cameras;ce(A,r);for(let e=0;e<i.length;e++)ce(i[e],r);i.length===2?F(A,D,O):A.projectionMatrix.copy(D.projectionMatrix),le(e,A,r)};function le(e,t,n){n===null?e.matrix.copy(t.matrixWorld):(e.matrix.copy(n.matrixWorld),e.matrix.invert(),e.matrix.multiply(t.matrixWorld)),e.matrix.decompose(e.position,e.quaternion,e.scale),e.updateMatrixWorld(!0),e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse),e.isPerspectiveCamera&&(e.fov=re*2*Math.atan(1/e.projectionMatrix.elements[5]),e.zoom=1)}this.getCamera=function(){return A},this.getFoveation=function(){if(p!==null||m!==null)return l},this.setFoveation=function(e){l=e,p!==null&&(p.fixedFoveation=e),m!==null&&m.fixedFoveation!==void 0&&(m.fixedFoveation=e)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(A)},this.getCameraTexture=function(e){return v[e]};let ue=null;function de(t,n){if(d=n.getViewerPose(u||s),h=n,d!==null){let t=d.views;m!==null&&(e.setRenderTargetFramebuffer(x,m.framebuffer),e.setRenderTarget(x));let n=!1;t.length!==A.cameras.length&&(A.cameras.length=0,n=!0);for(let r=0;r<t.length;r++){let i=t[r],a=null;if(m!==null)a=m.getViewport(i);else{let t=f.getViewSubImage(p,i);a=t.viewport,r===0&&(e.setRenderTargetTextures(x,t.colorTexture,t.depthStencilTexture),e.setRenderTarget(x))}let o=ee[r];o===void 0&&(o=new Dt,o.layers.enable(r),o.viewport=new be,ee[r]=o),o.matrix.fromArray(i.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.projectionMatrix.fromArray(i.projectionMatrix),o.projectionMatrixInverse.copy(o.projectionMatrix).invert(),o.viewport.set(a.x,a.y,a.width,a.height),r===0&&(A.matrix.copy(o.matrix),A.matrix.decompose(A.position,A.quaternion,A.scale)),n===!0&&A.cameras.push(o)}let r=a.enabledFeatures;if(r&&r.includes(`depth-sensing`)&&a.depthUsage==`gpu-optimized`&&g){f=i.getBinding();let e=f.getDepthInformation(t[0]);e&&e.isValid&&e.texture&&_.init(e,a.renderState)}if(r&&r.includes(`camera-access`)&&g){e.state.unbindTexture(),f=i.getBinding();for(let e=0;e<t.length;e++){let n=t[e].camera;if(n){let e=v[n];e||(e=new ie,v[n]=e);let t=f.getCameraImage(n);e.sourceTexture=t}}}}for(let e=0;e<C.length;e++){let t=w[e],r=C[e];t!==null&&r!==void 0&&r.update(t,n,u||s)}ue&&ue(t,n),n.detectedPlanes&&i.dispatchEvent({type:`planesdetected`,data:n}),h=null}let fe=new qn;fe.setAnimationLoop(de),this.setAnimationLoop=function(e){ue=e},this.dispose=function(){}}},eo=new D,to=new Ye;function no(e,t){function n(e,t){e.matrixAutoUpdate===!0&&e.updateMatrix(),t.value.copy(e.matrix)}function r(t,n){n.color.getRGB(t.fogColor.value,Te(e)),n.isFog?(t.fogNear.value=n.near,t.fogFar.value=n.far):n.isFogExp2&&(t.fogDensity.value=n.density)}function i(e,t,n,r,i){t.isMeshBasicMaterial?a(e,t):t.isMeshLambertMaterial?(a(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshToonMaterial?(a(e,t),d(e,t)):t.isMeshPhongMaterial?(a(e,t),u(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshStandardMaterial?(a(e,t),f(e,t),t.isMeshPhysicalMaterial&&p(e,t,i)):t.isMeshMatcapMaterial?(a(e,t),m(e,t)):t.isMeshDepthMaterial?a(e,t):t.isMeshDistanceMaterial?(a(e,t),h(e,t)):t.isMeshNormalMaterial?a(e,t):t.isLineBasicMaterial?(o(e,t),t.isLineDashedMaterial&&s(e,t)):t.isPointsMaterial?c(e,t,n,r):t.isSpriteMaterial?l(e,t):t.isShadowMaterial?(e.color.value.copy(t.color),e.opacity.value=t.opacity):t.isShaderMaterial&&(t.uniformsNeedUpdate=!1)}function a(e,r){e.opacity.value=r.opacity,r.color&&e.diffuse.value.copy(r.color),r.emissive&&e.emissive.value.copy(r.emissive).multiplyScalar(r.emissiveIntensity),r.map&&(e.map.value=r.map,n(r.map,e.mapTransform)),r.alphaMap&&(e.alphaMap.value=r.alphaMap,n(r.alphaMap,e.alphaMapTransform)),r.bumpMap&&(e.bumpMap.value=r.bumpMap,n(r.bumpMap,e.bumpMapTransform),e.bumpScale.value=r.bumpScale,r.side===1&&(e.bumpScale.value*=-1)),r.normalMap&&(e.normalMap.value=r.normalMap,n(r.normalMap,e.normalMapTransform),e.normalScale.value.copy(r.normalScale),r.side===1&&e.normalScale.value.negate()),r.displacementMap&&(e.displacementMap.value=r.displacementMap,n(r.displacementMap,e.displacementMapTransform),e.displacementScale.value=r.displacementScale,e.displacementBias.value=r.displacementBias),r.emissiveMap&&(e.emissiveMap.value=r.emissiveMap,n(r.emissiveMap,e.emissiveMapTransform)),r.specularMap&&(e.specularMap.value=r.specularMap,n(r.specularMap,e.specularMapTransform)),r.alphaTest>0&&(e.alphaTest.value=r.alphaTest);let i=t.get(r),a=i.envMap,o=i.envMapRotation;a&&(e.envMap.value=a,eo.copy(o),eo.x*=-1,eo.y*=-1,eo.z*=-1,a.isCubeTexture&&a.isRenderTargetTexture===!1&&(eo.y*=-1,eo.z*=-1),e.envMapRotation.value.setFromMatrix4(to.makeRotationFromEuler(eo)),e.flipEnvMap.value=a.isCubeTexture&&a.isRenderTargetTexture===!1?-1:1,e.reflectivity.value=r.reflectivity,e.ior.value=r.ior,e.refractionRatio.value=r.refractionRatio),r.lightMap&&(e.lightMap.value=r.lightMap,e.lightMapIntensity.value=r.lightMapIntensity,n(r.lightMap,e.lightMapTransform)),r.aoMap&&(e.aoMap.value=r.aoMap,e.aoMapIntensity.value=r.aoMapIntensity,n(r.aoMap,e.aoMapTransform))}function o(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform))}function s(e,t){e.dashSize.value=t.dashSize,e.totalSize.value=t.dashSize+t.gapSize,e.scale.value=t.scale}function c(e,t,r,i){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.size.value=t.size*r,e.scale.value=i*.5,t.map&&(e.map.value=t.map,n(t.map,e.uvTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function l(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.rotation.value=t.rotation,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function u(e,t){e.specular.value.copy(t.specular),e.shininess.value=Math.max(t.shininess,1e-4)}function d(e,t){t.gradientMap&&(e.gradientMap.value=t.gradientMap)}function f(e,t){e.metalness.value=t.metalness,t.metalnessMap&&(e.metalnessMap.value=t.metalnessMap,n(t.metalnessMap,e.metalnessMapTransform)),e.roughness.value=t.roughness,t.roughnessMap&&(e.roughnessMap.value=t.roughnessMap,n(t.roughnessMap,e.roughnessMapTransform)),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)}function p(e,t,r){e.ior.value=t.ior,t.sheen>0&&(e.sheenColor.value.copy(t.sheenColor).multiplyScalar(t.sheen),e.sheenRoughness.value=t.sheenRoughness,t.sheenColorMap&&(e.sheenColorMap.value=t.sheenColorMap,n(t.sheenColorMap,e.sheenColorMapTransform)),t.sheenRoughnessMap&&(e.sheenRoughnessMap.value=t.sheenRoughnessMap,n(t.sheenRoughnessMap,e.sheenRoughnessMapTransform))),t.clearcoat>0&&(e.clearcoat.value=t.clearcoat,e.clearcoatRoughness.value=t.clearcoatRoughness,t.clearcoatMap&&(e.clearcoatMap.value=t.clearcoatMap,n(t.clearcoatMap,e.clearcoatMapTransform)),t.clearcoatRoughnessMap&&(e.clearcoatRoughnessMap.value=t.clearcoatRoughnessMap,n(t.clearcoatRoughnessMap,e.clearcoatRoughnessMapTransform)),t.clearcoatNormalMap&&(e.clearcoatNormalMap.value=t.clearcoatNormalMap,n(t.clearcoatNormalMap,e.clearcoatNormalMapTransform),e.clearcoatNormalScale.value.copy(t.clearcoatNormalScale),t.side===1&&e.clearcoatNormalScale.value.negate())),t.dispersion>0&&(e.dispersion.value=t.dispersion),t.iridescence>0&&(e.iridescence.value=t.iridescence,e.iridescenceIOR.value=t.iridescenceIOR,e.iridescenceThicknessMinimum.value=t.iridescenceThicknessRange[0],e.iridescenceThicknessMaximum.value=t.iridescenceThicknessRange[1],t.iridescenceMap&&(e.iridescenceMap.value=t.iridescenceMap,n(t.iridescenceMap,e.iridescenceMapTransform)),t.iridescenceThicknessMap&&(e.iridescenceThicknessMap.value=t.iridescenceThicknessMap,n(t.iridescenceThicknessMap,e.iridescenceThicknessMapTransform))),t.transmission>0&&(e.transmission.value=t.transmission,e.transmissionSamplerMap.value=r.texture,e.transmissionSamplerSize.value.set(r.width,r.height),t.transmissionMap&&(e.transmissionMap.value=t.transmissionMap,n(t.transmissionMap,e.transmissionMapTransform)),e.thickness.value=t.thickness,t.thicknessMap&&(e.thicknessMap.value=t.thicknessMap,n(t.thicknessMap,e.thicknessMapTransform)),e.attenuationDistance.value=t.attenuationDistance,e.attenuationColor.value.copy(t.attenuationColor)),t.anisotropy>0&&(e.anisotropyVector.value.set(t.anisotropy*Math.cos(t.anisotropyRotation),t.anisotropy*Math.sin(t.anisotropyRotation)),t.anisotropyMap&&(e.anisotropyMap.value=t.anisotropyMap,n(t.anisotropyMap,e.anisotropyMapTransform))),e.specularIntensity.value=t.specularIntensity,e.specularColor.value.copy(t.specularColor),t.specularColorMap&&(e.specularColorMap.value=t.specularColorMap,n(t.specularColorMap,e.specularColorMapTransform)),t.specularIntensityMap&&(e.specularIntensityMap.value=t.specularIntensityMap,n(t.specularIntensityMap,e.specularIntensityMapTransform))}function m(e,t){t.matcap&&(e.matcap.value=t.matcap)}function h(e,n){let r=t.get(n).light;e.referencePosition.value.setFromMatrixPosition(r.matrixWorld),e.nearDistance.value=r.shadow.camera.near,e.farDistance.value=r.shadow.camera.far}return{refreshFogUniforms:r,refreshMaterialUniforms:i}}function ro(e,t,n,r){let i={},a={},o=[],s=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function c(e,t){let n=t.program;r.uniformBlockBinding(e,n)}function l(e,n){let o=i[e.id];o===void 0&&(m(e),o=u(e),i[e.id]=o,e.addEventListener(`dispose`,g));let s=n.program;r.updateUBOMapping(e,s);let c=t.render.frame;a[e.id]!==c&&(f(e),a[e.id]=c)}function u(t){let n=d();t.__bindingPointIndex=n;let r=e.createBuffer(),i=t.__size,a=t.usage;return e.bindBuffer(e.UNIFORM_BUFFER,r),e.bufferData(e.UNIFORM_BUFFER,i,a),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,n,r),r}function d(){for(let e=0;e<s;e++)if(o.indexOf(e)===-1)return o.push(e),e;return ut(`WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached.`),0}function f(t){let n=i[t.id],r=t.uniforms,a=t.__cache;e.bindBuffer(e.UNIFORM_BUFFER,n);for(let t=0,n=r.length;t<n;t++){let n=Array.isArray(r[t])?r[t]:[r[t]];for(let r=0,i=n.length;r<i;r++){let i=n[r];if(p(i,t,r,a)===!0){let t=i.__offset,n=Array.isArray(i.value)?i.value:[i.value],r=0;for(let a=0;a<n.length;a++){let o=n[a],s=h(o);typeof o==`number`||typeof o==`boolean`?(i.__data[0]=o,e.bufferSubData(e.UNIFORM_BUFFER,t+r,i.__data)):o.isMatrix3?(i.__data[0]=o.elements[0],i.__data[1]=o.elements[1],i.__data[2]=o.elements[2],i.__data[3]=0,i.__data[4]=o.elements[3],i.__data[5]=o.elements[4],i.__data[6]=o.elements[5],i.__data[7]=0,i.__data[8]=o.elements[6],i.__data[9]=o.elements[7],i.__data[10]=o.elements[8],i.__data[11]=0):(o.toArray(i.__data,r),r+=s.storage/Float32Array.BYTES_PER_ELEMENT)}e.bufferSubData(e.UNIFORM_BUFFER,t,i.__data)}}}e.bindBuffer(e.UNIFORM_BUFFER,null)}function p(e,t,n,r){let i=e.value,a=t+`_`+n;if(r[a]===void 0)return r[a]=typeof i==`number`||typeof i==`boolean`?i:i.clone(),!0;{let e=r[a];if(typeof i==`number`||typeof i==`boolean`){if(e!==i)return r[a]=i,!0}else if(e.equals(i)===!1)return e.copy(i),!0}return!1}function m(e){let t=e.uniforms,n=0;for(let e=0,r=t.length;e<r;e++){let r=Array.isArray(t[e])?t[e]:[t[e]];for(let e=0,t=r.length;e<t;e++){let t=r[e],i=Array.isArray(t.value)?t.value:[t.value];for(let e=0,r=i.length;e<r;e++){let r=i[e],a=h(r),o=n%16,s=o%a.boundary,c=o+s;n+=s,c!==0&&16-c<a.storage&&(n+=16-c),t.__data=new Float32Array(a.storage/Float32Array.BYTES_PER_ELEMENT),t.__offset=n,n+=a.storage}}}let r=n%16;return r>0&&(n+=16-r),e.__size=n,e.__cache={},this}function h(e){let t={boundary:0,storage:0};return typeof e==`number`||typeof e==`boolean`?(t.boundary=4,t.storage=4):e.isVector2?(t.boundary=8,t.storage=8):e.isVector3||e.isColor?(t.boundary=16,t.storage=12):e.isVector4?(t.boundary=16,t.storage=16):e.isMatrix3?(t.boundary=48,t.storage=48):e.isMatrix4?(t.boundary=64,t.storage=64):e.isTexture?Je(`WebGLRenderer: Texture samplers can not be part of an uniforms group.`):Je(`WebGLRenderer: Unsupported uniform value type.`,e),t}function g(t){let n=t.target;n.removeEventListener(`dispose`,g);let r=o.indexOf(n.__bindingPointIndex);o.splice(r,1),e.deleteBuffer(i[n.id]),delete i[n.id],delete a[n.id]}function _(){for(let t in i)e.deleteBuffer(i[t]);o=[],i={},a={}}return{bind:c,update:l,dispose:_}}var io=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),ao=null;function oo(){return ao===null&&(ao=new le(io,16,16,qe,me),ao.name=`DFG_LUT`,ao.minFilter=ye,ao.magFilter=ye,ao.wrapS=Pe,ao.wrapT=Pe,ao.generateMipmaps=!1,ao.needsUpdate=!0),ao}var so=class{constructor(e={}){let{canvas:n=ht(),context:r=null,depth:i=!0,stencil:a=!1,alpha:o=!1,antialias:s=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:u=`default`,failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:f=!1,outputBufferType:p=At}=e;this.isWebGLRenderer=!0;let m;if(r!==null){if(typeof WebGLRenderingContext<`u`&&r instanceof WebGLRenderingContext)throw Error(`THREE.WebGLRenderer: WebGL 1 is not supported since r163.`);m=r.getContextAttributes().alpha}else m=o;let h=p,g=new Set([te,vt,Ze]),v=new Set([At,pe,w,he,ge,_]),y=new Uint32Array(4),b=new Int32Array(4),x=null,C=null,T=[],E=[],D=null;this.domElement=n,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=0,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let O=this,k=!1;this._outputColorSpace=Et;let ee=0,A=0,j=null,ne=-1,re=null,ie=new be,M=new be,ae=null,P=new I(0),se=0,F=n.width,ce=n.height,le=1,ue=null,de=null,fe=new be(0,0,F,ce),_e=new be(0,0,F,ce),ve=!1,ye=new oe,Ce=!1,we=!1,Te=new Ye,Ee=new S,De=new be,Oe={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ke=!1;function L(){return j===null?le:1}let R=r;function je(e,t){return n.getContext(e,t)}try{let e={alpha:!0,depth:i,stencil:a,antialias:s,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:u,failIfMajorPerformanceCaveat:d};if(`setAttribute`in n&&n.setAttribute(`data-engine`,`three.js r183`),n.addEventListener(`webglcontextlost`,nt,!1),n.addEventListener(`webglcontextrestored`,it,!1),n.addEventListener(`webglcontextcreationerror`,at,!1),R===null){let t=`webgl2`;if(R=je(t,e),R===null)throw je(t)?Error(`Error creating WebGL context with your selected attributes.`):Error(`Error creating WebGL context.`)}}catch(e){throw ut(`WebGLRenderer: `+e.message),e}let z,Me,B,Ne,V,H,Pe,Fe,Ie,Le,Re,ze,Be,Ve,He,Ue,We,Ge,Ke,qe,Xe,Qe,$e;function et(){z=new Er(R),z.init(),Xe=new Ya(R,z),Me=new nr(R,z,e,Xe),B=new qa(R,z),Me.reversedDepthBuffer&&f&&B.buffers.depth.setReversed(!0),Ne=new kr(R),V=new Da,H=new Ja(R,z,B,V,Me,Xe,Ne),Pe=new Tr(O),Fe=new Jn(R),Qe=new er(R,Fe),Ie=new Dr(R,Fe,Ne,Qe),Le=new jr(R,Ie,Fe,Qe,Ne),Ge=new Ar(R,Me,H),He=new rr(V),Re=new Ea(O,Pe,z,Me,Qe,He),ze=new no(O,V),Be=new ja,Ve=new Ra(z),We=new $n(O,Pe,B,Le,m,c),Ue=new Ka(O,Le,Me),$e=new ro(R,Ne,Me,B),Ke=new tr(R,z,Ne),qe=new Or(R,z,Ne),Ne.programs=Re.programs,O.capabilities=Me,O.extensions=z,O.properties=V,O.renderLists=Be,O.shadowMap=Ue,O.state=B,O.info=Ne}et(),h!==1009&&(D=new Nr(h,n.width,n.height,i,a));let tt=new $a(O,R);this.xr=tt,this.getContext=function(){return R},this.getContextAttributes=function(){return R.getContextAttributes()},this.forceContextLoss=function(){let e=z.get(`WEBGL_lose_context`);e&&e.loseContext()},this.forceContextRestore=function(){let e=z.get(`WEBGL_lose_context`);e&&e.restoreContext()},this.getPixelRatio=function(){return le},this.setPixelRatio=function(e){e!==void 0&&(le=e,this.setSize(F,ce,!1))},this.getSize=function(e){return e.set(F,ce)},this.setSize=function(e,t,r=!0){tt.isPresenting?Je(`WebGLRenderer: Can't change size while VR device is presenting.`):(F=e,ce=t,n.width=Math.floor(e*le),n.height=Math.floor(t*le),r===!0&&(n.style.width=e+`px`,n.style.height=t+`px`),D!==null&&D.setSize(n.width,n.height),this.setViewport(0,0,e,t))},this.getDrawingBufferSize=function(e){return e.set(F*le,ce*le).floor()},this.setDrawingBufferSize=function(e,t,r){F=e,ce=t,le=r,n.width=Math.floor(e*r),n.height=Math.floor(t*r),this.setViewport(0,0,e,t)},this.setEffects=function(e){if(h===1009)console.error(`THREE.WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.`);else{if(e){for(let t=0;t<e.length;t++)if(e[t].isOutputPass===!0){console.warn(`THREE.WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.`);break}}D.setEffects(e||[])}},this.getCurrentViewport=function(e){return e.copy(ie)},this.getViewport=function(e){return e.copy(fe)},this.setViewport=function(e,t,n,r){e.isVector4?fe.set(e.x,e.y,e.z,e.w):fe.set(e,t,n,r),B.viewport(ie.copy(fe).multiplyScalar(le).round())},this.getScissor=function(e){return e.copy(_e)},this.setScissor=function(e,t,n,r){e.isVector4?_e.set(e.x,e.y,e.z,e.w):_e.set(e,t,n,r),B.scissor(M.copy(_e).multiplyScalar(le).round())},this.getScissorTest=function(){return ve},this.setScissorTest=function(e){B.setScissorTest(ve=e)},this.setOpaqueSort=function(e){ue=e},this.setTransparentSort=function(e){de=e},this.getClearColor=function(e){return e.copy(We.getClearColor())},this.setClearColor=function(){We.setClearColor(...arguments)},this.getClearAlpha=function(){return We.getClearAlpha()},this.setClearAlpha=function(){We.setClearAlpha(...arguments)},this.clear=function(e=!0,t=!0,n=!0){let r=0;if(e){let e=!1;if(j!==null){let t=j.texture.format;e=g.has(t)}if(e){let e=j.texture.type,t=v.has(e),n=We.getClearColor(),r=We.getClearAlpha(),i=n.r,a=n.g,o=n.b;t?(y[0]=i,y[1]=a,y[2]=o,y[3]=r,R.clearBufferuiv(R.COLOR,0,y)):(b[0]=i,b[1]=a,b[2]=o,b[3]=r,R.clearBufferiv(R.COLOR,0,b))}else r|=R.COLOR_BUFFER_BIT}t&&(r|=R.DEPTH_BUFFER_BIT),n&&(r|=R.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),r!==0&&R.clear(r)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){n.removeEventListener(`webglcontextlost`,nt,!1),n.removeEventListener(`webglcontextrestored`,it,!1),n.removeEventListener(`webglcontextcreationerror`,at,!1),We.dispose(),Be.dispose(),Ve.dispose(),V.dispose(),Pe.dispose(),Le.dispose(),Qe.dispose(),$e.dispose(),Re.dispose(),tt.dispose(),tt.removeEventListener(`sessionstart`,pt),tt.removeEventListener(`sessionend`,mt),gt.stop()};function nt(e){e.preventDefault(),rt(`WebGLRenderer: Context Lost.`),k=!0}function it(){rt(`WebGLRenderer: Context Restored.`),k=!1;let e=Ne.autoReset,t=Ue.enabled,n=Ue.autoUpdate,r=Ue.needsUpdate,i=Ue.type;et(),Ne.autoReset=e,Ue.enabled=t,Ue.autoUpdate=n,Ue.needsUpdate=r,Ue.type=i}function at(e){ut(`WebGLRenderer: A WebGL context could not be created. Reason: `,e.statusMessage)}function ot(e){let t=e.target;t.removeEventListener(`dispose`,ot),st(t)}function st(e){ct(e),V.remove(e)}function ct(e){let t=V.get(e).programs;t!==void 0&&(t.forEach(function(e){Re.releaseProgram(e)}),e.isShaderMaterial&&Re.releaseShaderCache(e))}this.renderBufferDirect=function(e,t,n,r,i,a){t===null&&(t=Oe);let o=i.isMesh&&i.matrixWorld.determinant()<0,s=Ot(e,t,n,r,i);B.setMaterial(r,o);let c=n.index,l=1;if(r.wireframe===!0){if(c=Ie.getWireframeAttribute(n),c===void 0)return;l=2}let u=n.drawRange,d=n.attributes.position,f=u.start*l,p=(u.start+u.count)*l;a!==null&&(f=Math.max(f,a.start*l),p=Math.min(p,(a.start+a.count)*l)),c===null?d!=null&&(f=Math.max(f,0),p=Math.min(p,d.count)):(f=Math.max(f,0),p=Math.min(p,c.count));let m=p-f;if(m<0||m===1/0)return;Qe.setup(i,r,s,n,c);let h,g=Ke;if(c!==null&&(h=Fe.get(c),g=qe,g.setIndex(h)),i.isMesh)r.wireframe===!0?(B.setLineWidth(r.wireframeLinewidth*L()),g.setMode(R.LINES)):g.setMode(R.TRIANGLES);else if(i.isLine){let e=r.linewidth;e===void 0&&(e=1),B.setLineWidth(e*L()),i.isLineSegments?g.setMode(R.LINES):i.isLineLoop?g.setMode(R.LINE_LOOP):g.setMode(R.LINE_STRIP)}else i.isPoints?g.setMode(R.POINTS):i.isSprite&&g.setMode(R.TRIANGLES);if(i.isBatchedMesh){if(i._multiDrawInstances!==null)yt(`WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection.`),g.renderMultiDrawInstances(i._multiDrawStarts,i._multiDrawCounts,i._multiDrawCount,i._multiDrawInstances);else if(z.get(`WEBGL_multi_draw`))g.renderMultiDraw(i._multiDrawStarts,i._multiDrawCounts,i._multiDrawCount);else{let e=i._multiDrawStarts,t=i._multiDrawCounts,n=i._multiDrawCount,a=c?Fe.get(c).bytesPerElement:1,o=V.get(r).currentProgram.getUniforms();for(let r=0;r<n;r++)o.setValue(R,`_gl_DrawID`,r),g.render(e[r]/a,t[r])}}else if(i.isInstancedMesh)g.renderInstances(f,m,i.count);else if(n.isInstancedBufferGeometry){let e=n._maxInstanceCount===void 0?1/0:n._maxInstanceCount,t=Math.min(n.instanceCount,e);g.renderInstances(f,m,t)}else g.render(f,m)};function lt(e,t,n){e.transparent===!0&&e.side===2&&e.forceSinglePass===!1?(e.side=1,e.needsUpdate=!0,wt(e,t,n),e.side=0,e.needsUpdate=!0,wt(e,t,n),e.side=2):wt(e,t,n)}this.compile=function(e,t,n=null){n===null&&(n=e),C=Ve.get(n),C.init(t),E.push(C),n.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(C.pushLight(e),e.castShadow&&C.pushShadow(e))}),e!==n&&e.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(C.pushLight(e),e.castShadow&&C.pushShadow(e))}),C.setupLights();let r=new Set;return e.traverse(function(e){if(!(e.isMesh||e.isPoints||e.isLine||e.isSprite))return;let t=e.material;if(t){if(Array.isArray(t))for(let i=0;i<t.length;i++){let a=t[i];lt(a,n,e),r.add(a)}else lt(t,n,e),r.add(t)}}),C=E.pop(),r},this.compileAsync=function(e,t,n=null){let r=this.compile(e,t,n);return new Promise(t=>{function n(){r.forEach(function(e){V.get(e).currentProgram.isReady()&&r.delete(e)}),r.size===0?t(e):setTimeout(n,10)}z.get(`KHR_parallel_shader_compile`)===null?setTimeout(n,10):n()})};let dt=null;function ft(e){dt&&dt(e)}function pt(){gt.stop()}function mt(){gt.start()}let gt=new qn;gt.setAnimationLoop(ft),typeof self<`u`&&gt.setContext(self),this.setAnimationLoop=function(e){dt=e,tt.setAnimationLoop(e),e===null?gt.stop():gt.start()},tt.addEventListener(`sessionstart`,pt),tt.addEventListener(`sessionend`,mt),this.render=function(e,t){if(t!==void 0&&t.isCamera!==!0){ut(`WebGLRenderer.render: camera is not an instance of THREE.Camera.`);return}if(k===!0)return;let n=tt.enabled===!0&&tt.isPresenting===!0,r=D!==null&&(j===null||n)&&D.begin(O,j);if(e.matrixWorldAutoUpdate===!0&&e.updateMatrixWorld(),t.parent===null&&t.matrixWorldAutoUpdate===!0&&t.updateMatrixWorld(),tt.enabled===!0&&tt.isPresenting===!0&&(D===null||D.isCompositing()===!1)&&(tt.cameraAutoUpdate===!0&&tt.updateCamera(t),t=tt.getCamera()),e.isScene===!0&&e.onBeforeRender(O,e,t,j),C=Ve.get(e,E.length),C.init(t),E.push(C),Te.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),ye.setFromProjectionMatrix(Te,Se,t.reversedDepth),we=this.localClippingEnabled,Ce=He.init(this.clippingPlanes,we),x=Be.get(e,T.length),x.init(),T.push(x),tt.enabled===!0&&tt.isPresenting===!0){let e=O.xr.getDepthSensingMesh();e!==null&&_t(e,t,-1/0,O.sortObjects)}_t(e,t,0,O.sortObjects),x.finish(),O.sortObjects===!0&&x.sort(ue,de),ke=tt.enabled===!1||tt.isPresenting===!1||tt.hasDepthSensing()===!1,ke&&We.addToRenderList(x,e),this.info.render.frame++,Ce===!0&&He.beginShadows();let i=C.state.shadowsArray;if(Ue.render(i,e,t),Ce===!0&&He.endShadows(),this.info.autoReset===!0&&this.info.reset(),(r&&D.hasRenderPass())===!1){let n=x.opaque,r=x.transmissive;if(C.setupLights(),t.isArrayCamera){let i=t.cameras;if(r.length>0)for(let t=0,a=i.length;t<a;t++){let a=i[t];xt(n,r,e,a)}ke&&We.render(e);for(let t=0,n=i.length;t<n;t++){let n=i[t];U(x,e,n,n.viewport)}}else r.length>0&&xt(n,r,e,t),ke&&We.render(e),U(x,e,t)}j!==null&&A===0&&(H.updateMultisampleRenderTarget(j),H.updateRenderTargetMipmap(j)),r&&D.end(O),e.isScene===!0&&e.onAfterRender(O,e,t),Qe.resetDefaultState(),ne=-1,re=null,E.pop(),E.length>0?(C=E[E.length-1],Ce===!0&&He.setGlobalState(O.clippingPlanes,C.state.camera)):C=null,T.pop(),x=T.length>0?T[T.length-1]:null};function _t(e,t,n,r){if(e.visible===!1)return;if(e.layers.test(t.layers)){if(e.isGroup)n=e.renderOrder;else if(e.isLOD)e.autoUpdate===!0&&e.update(t);else if(e.isLight)C.pushLight(e),e.castShadow&&C.pushShadow(e);else if(e.isSprite){if(!e.frustumCulled||ye.intersectsSprite(e)){r&&De.setFromMatrixPosition(e.matrixWorld).applyMatrix4(Te);let t=Le.update(e),i=e.material;i.visible&&x.push(e,t,i,n,De.z,null)}}else if((e.isMesh||e.isLine||e.isPoints)&&(!e.frustumCulled||ye.intersectsObject(e))){let t=Le.update(e),i=e.material;if(r&&(e.boundingSphere===void 0?(t.boundingSphere===null&&t.computeBoundingSphere(),De.copy(t.boundingSphere.center)):(e.boundingSphere===null&&e.computeBoundingSphere(),De.copy(e.boundingSphere.center)),De.applyMatrix4(e.matrixWorld).applyMatrix4(Te)),Array.isArray(i)){let r=t.groups;for(let a=0,o=r.length;a<o;a++){let o=r[a],s=i[o.materialIndex];s&&s.visible&&x.push(e,t,s,n,De.z,o)}}else i.visible&&x.push(e,t,i,n,De.z,null)}}let i=e.children;for(let e=0,a=i.length;e<a;e++)_t(i[e],t,n,r)}function U(e,t,n,r){let{opaque:i,transmissive:a,transparent:o}=e;C.setupLightsView(n),Ce===!0&&He.setGlobalState(O.clippingPlanes,n),r&&B.viewport(ie.copy(r)),i.length>0&&St(i,t,n),a.length>0&&St(a,t,n),o.length>0&&St(o,t,n),B.buffers.depth.setTest(!0),B.buffers.depth.setMask(!0),B.buffers.color.setMask(!0),B.setPolygonOffset(!1)}function xt(e,t,n,r){if((n.isScene===!0?n.overrideMaterial:null)!==null)return;if(C.state.transmissionRenderTarget[r.id]===void 0){let e=z.has(`EXT_color_buffer_half_float`)||z.has(`EXT_color_buffer_float`);C.state.transmissionRenderTarget[r.id]=new N(1,1,{generateMipmaps:!0,type:e?me:At,minFilter:xe,samples:Math.max(4,Me.samples),stencilBuffer:a,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:bt.workingColorSpace})}let i=C.state.transmissionRenderTarget[r.id],o=r.viewport||ie;i.setSize(o.z*O.transmissionResolutionScale,o.w*O.transmissionResolutionScale);let s=O.getRenderTarget(),c=O.getActiveCubeFace(),l=O.getActiveMipmapLevel();O.setRenderTarget(i),O.getClearColor(P),se=O.getClearAlpha(),se<1&&O.setClearColor(16777215,.5),O.clear(),ke&&We.render(n);let u=O.toneMapping;O.toneMapping=0;let d=r.viewport;if(r.viewport!==void 0&&(r.viewport=void 0),C.setupLightsView(r),Ce===!0&&He.setGlobalState(O.clippingPlanes,r),St(e,n,r),H.updateMultisampleRenderTarget(i),H.updateRenderTargetMipmap(i),z.has(`WEBGL_multisampled_render_to_texture`)===!1){let e=!1;for(let i=0,a=t.length;i<a;i++){let{object:a,geometry:o,material:s,group:c}=t[i];if(s.side===2&&a.layers.test(r.layers)){let t=s.side;s.side=1,s.needsUpdate=!0,Ct(a,n,r,o,s,c),s.side=t,s.needsUpdate=!0,e=!0}}e===!0&&(H.updateMultisampleRenderTarget(i),H.updateRenderTargetMipmap(i))}O.setRenderTarget(s,c,l),O.setClearColor(P,se),d!==void 0&&(r.viewport=d),O.toneMapping=u}function St(e,t,n){let r=t.isScene===!0?t.overrideMaterial:null;for(let i=0,a=e.length;i<a;i++){let a=e[i],{object:o,geometry:s,group:c}=a,l=a.material;l.allowOverride===!0&&r!==null&&(l=r),o.layers.test(n.layers)&&Ct(o,t,n,s,l,c)}}function Ct(e,t,n,r,i,a){e.onBeforeRender(O,t,n,r,i,a),e.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse,e.matrixWorld),e.normalMatrix.getNormalMatrix(e.modelViewMatrix),i.onBeforeRender(O,t,n,r,e,a),i.transparent===!0&&i.side===2&&i.forceSinglePass===!1?(i.side=1,i.needsUpdate=!0,O.renderBufferDirect(n,t,r,i,e,a),i.side=0,i.needsUpdate=!0,O.renderBufferDirect(n,t,r,i,e,a),i.side=2):O.renderBufferDirect(n,t,r,i,e,a),e.onAfterRender(O,t,n,r,i,a)}function wt(e,t,n){t.isScene!==!0&&(t=Oe);let r=V.get(e),i=C.state.lights,a=C.state.shadowsArray,o=i.state.version,s=Re.getParameters(e,i.state,a,t,n),c=Re.getProgramCacheKey(s),l=r.programs;r.environment=e.isMeshStandardMaterial||e.isMeshLambertMaterial||e.isMeshPhongMaterial?t.environment:null,r.fog=t.fog;let u=e.isMeshStandardMaterial||e.isMeshLambertMaterial&&!e.envMap||e.isMeshPhongMaterial&&!e.envMap;r.envMap=Pe.get(e.envMap||r.environment,u),r.envMapRotation=r.environment!==null&&e.envMap===null?t.environmentRotation:e.envMapRotation,l===void 0&&(e.addEventListener(`dispose`,ot),l=new Map,r.programs=l);let d=l.get(c);if(d!==void 0){if(r.currentProgram===d&&r.lightsStateVersion===o)return Dt(e,s),d}else s.uniforms=Re.getUniforms(e),e.onBeforeCompile(s,O),d=Re.acquireProgram(s,c),l.set(c,d),r.uniforms=s.uniforms;let f=r.uniforms;return(!e.isShaderMaterial&&!e.isRawShaderMaterial||e.clipping===!0)&&(f.clippingPlanes=He.uniform),Dt(e,s),r.needsLights=jt(e),r.lightsStateVersion=o,r.needsLights&&(f.ambientLightColor.value=i.state.ambient,f.lightProbe.value=i.state.probe,f.directionalLights.value=i.state.directional,f.directionalLightShadows.value=i.state.directionalShadow,f.spotLights.value=i.state.spot,f.spotLightShadows.value=i.state.spotShadow,f.rectAreaLights.value=i.state.rectArea,f.ltc_1.value=i.state.rectAreaLTC1,f.ltc_2.value=i.state.rectAreaLTC2,f.pointLights.value=i.state.point,f.pointLightShadows.value=i.state.pointShadow,f.hemisphereLights.value=i.state.hemi,f.directionalShadowMatrix.value=i.state.directionalShadowMatrix,f.spotLightMatrix.value=i.state.spotLightMatrix,f.spotLightMap.value=i.state.spotLightMap,f.pointShadowMatrix.value=i.state.pointShadowMatrix),r.currentProgram=d,r.uniformsList=null,d}function Tt(e){if(e.uniformsList===null){let t=e.currentProgram.getUniforms();e.uniformsList=Bi.seqWithValue(t.seq,e.uniforms)}return e.uniformsList}function Dt(e,t){let n=V.get(e);n.outputColorSpace=t.outputColorSpace,n.batching=t.batching,n.batchingColor=t.batchingColor,n.instancing=t.instancing,n.instancingColor=t.instancingColor,n.instancingMorph=t.instancingMorph,n.skinning=t.skinning,n.morphTargets=t.morphTargets,n.morphNormals=t.morphNormals,n.morphColors=t.morphColors,n.morphTargetsCount=t.morphTargetsCount,n.numClippingPlanes=t.numClippingPlanes,n.numIntersection=t.numClipIntersection,n.vertexAlphas=t.vertexAlphas,n.vertexTangents=t.vertexTangents,n.toneMapping=t.toneMapping}function Ot(e,n,r,i,a){n.isScene!==!0&&(n=Oe),H.resetTextureUnits();let o=n.fog,s=i.isMeshStandardMaterial||i.isMeshLambertMaterial||i.isMeshPhongMaterial?n.environment:null,c=j===null?O.outputColorSpace:j.isXRRenderTarget===!0?j.texture.colorSpace:t,l=i.isMeshStandardMaterial||i.isMeshLambertMaterial&&!i.envMap||i.isMeshPhongMaterial&&!i.envMap,u=Pe.get(i.envMap||s,l),d=i.vertexColors===!0&&!!r.attributes.color&&r.attributes.color.itemSize===4,f=!!r.attributes.tangent&&(!!i.normalMap||i.anisotropy>0),p=!!r.morphAttributes.position,m=!!r.morphAttributes.normal,h=!!r.morphAttributes.color,g=0;i.toneMapped&&(j===null||j.isXRRenderTarget===!0)&&(g=O.toneMapping);let _=r.morphAttributes.position||r.morphAttributes.normal||r.morphAttributes.color,v=_===void 0?0:_.length,y=V.get(i),b=C.state.lights;if(Ce===!0&&(we===!0||e!==re)){let t=e===re&&i.id===ne;He.setState(i,e,t)}let x=!1;i.version===y.__version?y.needsLights&&y.lightsStateVersion!==b.state.version?x=!0:y.outputColorSpace===c?a.isBatchedMesh&&y.batching===!1||!a.isBatchedMesh&&y.batching===!0||a.isBatchedMesh&&y.batchingColor===!0&&a.colorTexture===null||a.isBatchedMesh&&y.batchingColor===!1&&a.colorTexture!==null||a.isInstancedMesh&&y.instancing===!1||!a.isInstancedMesh&&y.instancing===!0||a.isSkinnedMesh&&y.skinning===!1||!a.isSkinnedMesh&&y.skinning===!0||a.isInstancedMesh&&y.instancingColor===!0&&a.instanceColor===null||a.isInstancedMesh&&y.instancingColor===!1&&a.instanceColor!==null||a.isInstancedMesh&&y.instancingMorph===!0&&a.morphTexture===null||a.isInstancedMesh&&y.instancingMorph===!1&&a.morphTexture!==null?x=!0:y.envMap===u?i.fog===!0&&y.fog!==o||y.numClippingPlanes!==void 0&&(y.numClippingPlanes!==He.numPlanes||y.numIntersection!==He.numIntersection)?x=!0:y.vertexAlphas===d&&y.vertexTangents===f&&y.morphTargets===p&&y.morphNormals===m&&y.morphColors===h&&y.toneMapping===g?y.morphTargetsCount!==v&&(x=!0):x=!0:x=!0:x=!0:(x=!0,y.__version=i.version);let S=y.currentProgram;x===!0&&(S=wt(i,n,a));let w=!1,T=!1,E=!1,D=S.getUniforms(),k=y.uniforms;if(B.useProgram(S.program)&&(w=!0,T=!0,E=!0),i.id!==ne&&(ne=i.id,T=!0),w||re!==e){B.buffers.depth.getReversed()&&e.reversedDepth!==!0&&(e._reversedDepth=!0,e.updateProjectionMatrix()),D.setValue(R,`projectionMatrix`,e.projectionMatrix),D.setValue(R,`viewMatrix`,e.matrixWorldInverse);let t=D.map.cameraPosition;t!==void 0&&t.setValue(R,Ee.setFromMatrixPosition(e.matrixWorld)),Me.logarithmicDepthBuffer&&D.setValue(R,`logDepthBufFC`,2/(Math.log(e.far+1)/Math.LN2)),(i.isMeshPhongMaterial||i.isMeshToonMaterial||i.isMeshLambertMaterial||i.isMeshBasicMaterial||i.isMeshStandardMaterial||i.isShaderMaterial)&&D.setValue(R,`isOrthographic`,e.isOrthographicCamera===!0),re!==e&&(re=e,T=!0,E=!0)}if(y.needsLights&&(b.state.directionalShadowMap.length>0&&D.setValue(R,`directionalShadowMap`,b.state.directionalShadowMap,H),b.state.spotShadowMap.length>0&&D.setValue(R,`spotShadowMap`,b.state.spotShadowMap,H),b.state.pointShadowMap.length>0&&D.setValue(R,`pointShadowMap`,b.state.pointShadowMap,H)),a.isSkinnedMesh){D.setOptional(R,a,`bindMatrix`),D.setOptional(R,a,`bindMatrixInverse`);let e=a.skeleton;e&&(e.boneTexture===null&&e.computeBoneTexture(),D.setValue(R,`boneTexture`,e.boneTexture,H))}a.isBatchedMesh&&(D.setOptional(R,a,`batchingTexture`),D.setValue(R,`batchingTexture`,a._matricesTexture,H),D.setOptional(R,a,`batchingIdTexture`),D.setValue(R,`batchingIdTexture`,a._indirectTexture,H),D.setOptional(R,a,`batchingColorTexture`),a._colorsTexture!==null&&D.setValue(R,`batchingColorTexture`,a._colorsTexture,H));let ee=r.morphAttributes;if((ee.position!==void 0||ee.normal!==void 0||ee.color!==void 0)&&Ge.update(a,r,S),(T||y.receiveShadow!==a.receiveShadow)&&(y.receiveShadow=a.receiveShadow,D.setValue(R,`receiveShadow`,a.receiveShadow)),(i.isMeshStandardMaterial||i.isMeshLambertMaterial||i.isMeshPhongMaterial)&&i.envMap===null&&n.environment!==null&&(k.envMapIntensity.value=n.environmentIntensity),k.dfgLUT!==void 0&&(k.dfgLUT.value=oo()),T&&(D.setValue(R,`toneMappingExposure`,O.toneMappingExposure),y.needsLights&&kt(k,E),o&&i.fog===!0&&ze.refreshFogUniforms(k,o),ze.refreshMaterialUniforms(k,i,le,ce,C.state.transmissionRenderTarget[e.id]),Bi.upload(R,Tt(y),k,H)),i.isShaderMaterial&&i.uniformsNeedUpdate===!0&&(Bi.upload(R,Tt(y),k,H),i.uniformsNeedUpdate=!1),i.isSpriteMaterial&&D.setValue(R,`center`,a.center),D.setValue(R,`modelViewMatrix`,a.modelViewMatrix),D.setValue(R,`normalMatrix`,a.normalMatrix),D.setValue(R,`modelMatrix`,a.matrixWorld),i.isShaderMaterial||i.isRawShaderMaterial){let e=i.uniformsGroups;for(let t=0,n=e.length;t<n;t++){let n=e[t];$e.update(n,S),$e.bind(n,S)}}return S}function kt(e,t){e.ambientLightColor.needsUpdate=t,e.lightProbe.needsUpdate=t,e.directionalLights.needsUpdate=t,e.directionalLightShadows.needsUpdate=t,e.pointLights.needsUpdate=t,e.pointLightShadows.needsUpdate=t,e.spotLights.needsUpdate=t,e.spotLightShadows.needsUpdate=t,e.rectAreaLights.needsUpdate=t,e.hemisphereLights.needsUpdate=t}function jt(e){return e.isMeshLambertMaterial||e.isMeshToonMaterial||e.isMeshPhongMaterial||e.isMeshStandardMaterial||e.isShadowMaterial||e.isShaderMaterial&&e.lights===!0}this.getActiveCubeFace=function(){return ee},this.getActiveMipmapLevel=function(){return A},this.getRenderTarget=function(){return j},this.setRenderTargetTextures=function(e,t,n){let r=V.get(e);r.__autoAllocateDepthBuffer=e.resolveDepthBuffer===!1,r.__autoAllocateDepthBuffer===!1&&(r.__useRenderToTexture=!1),V.get(e.texture).__webglTexture=t,V.get(e.depthTexture).__webglTexture=r.__autoAllocateDepthBuffer?void 0:n,r.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(e,t){let n=V.get(e);n.__webglFramebuffer=t,n.__useDefaultFramebuffer=t===void 0};let Mt=R.createFramebuffer();this.setRenderTarget=function(e,t=0,n=0){j=e,ee=t,A=n;let r=null,i=!1,a=!1;if(e){let o=V.get(e);if(o.__useDefaultFramebuffer!==void 0){B.bindFramebuffer(R.FRAMEBUFFER,o.__webglFramebuffer),ie.copy(e.viewport),M.copy(e.scissor),ae=e.scissorTest,B.viewport(ie),B.scissor(M),B.setScissorTest(ae),ne=-1;return}if(o.__webglFramebuffer===void 0)H.setupRenderTarget(e);else if(o.__hasExternalTextures)H.rebindTextures(e,V.get(e.texture).__webglTexture,V.get(e.depthTexture).__webglTexture);else if(e.depthBuffer){let t=e.depthTexture;if(o.__boundDepthTexture!==t){if(t!==null&&V.has(t)&&(e.width!==t.image.width||e.height!==t.image.height))throw Error(`WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.`);H.setupDepthRenderbuffer(e)}}let s=e.texture;(s.isData3DTexture||s.isDataArrayTexture||s.isCompressedArrayTexture)&&(a=!0);let c=V.get(e).__webglFramebuffer;e.isWebGLCubeRenderTarget?(r=Array.isArray(c[t])?c[t][n]:c[t],i=!0):r=e.samples>0&&H.useMultisampledRTT(e)===!1?V.get(e).__webglMultisampledFramebuffer:Array.isArray(c)?c[n]:c,ie.copy(e.viewport),M.copy(e.scissor),ae=e.scissorTest}else ie.copy(fe).multiplyScalar(le).floor(),M.copy(_e).multiplyScalar(le).floor(),ae=ve;if(n!==0&&(r=Mt),B.bindFramebuffer(R.FRAMEBUFFER,r)&&B.drawBuffers(e,r),B.viewport(ie),B.scissor(M),B.setScissorTest(ae),i){let r=V.get(e.texture);R.framebufferTexture2D(R.FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_CUBE_MAP_POSITIVE_X+t,r.__webglTexture,n)}else if(a){let r=t;for(let t=0;t<e.textures.length;t++){let i=V.get(e.textures[t]);R.framebufferTextureLayer(R.FRAMEBUFFER,R.COLOR_ATTACHMENT0+t,i.__webglTexture,n,r)}}else if(e!==null&&n!==0){let t=V.get(e.texture);R.framebufferTexture2D(R.FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_2D,t.__webglTexture,n)}ne=-1},this.readRenderTargetPixels=function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget)){ut(`WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);return}let c=V.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){B.bindFramebuffer(R.FRAMEBUFFER,c);try{let o=e.textures[s],c=o.format,l=o.type;if(e.textures.length>1&&R.readBuffer(R.COLOR_ATTACHMENT0+s),!Me.textureFormatReadable(c)){ut(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.`);return}if(!Me.textureTypeReadable(l)){ut(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.`);return}t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i&&R.readPixels(t,n,r,i,Xe.convert(c),Xe.convert(l),a)}finally{let e=j===null?null:V.get(j).__webglFramebuffer;B.bindFramebuffer(R.FRAMEBUFFER,e)}}},this.readRenderTargetPixelsAsync=async function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget))throw Error(`THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);let c=V.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){if(t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i){B.bindFramebuffer(R.FRAMEBUFFER,c);let o=e.textures[s],l=o.format,u=o.type;if(e.textures.length>1&&R.readBuffer(R.COLOR_ATTACHMENT0+s),!Me.textureFormatReadable(l))throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.`);if(!Me.textureTypeReadable(u))throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.`);let d=R.createBuffer();R.bindBuffer(R.PIXEL_PACK_BUFFER,d),R.bufferData(R.PIXEL_PACK_BUFFER,a.byteLength,R.STREAM_READ),R.readPixels(t,n,r,i,Xe.convert(l),Xe.convert(u),0);let f=j===null?null:V.get(j).__webglFramebuffer;B.bindFramebuffer(R.FRAMEBUFFER,f);let p=R.fenceSync(R.SYNC_GPU_COMMANDS_COMPLETE,0);return R.flush(),await Ae(R,p,4),R.bindBuffer(R.PIXEL_PACK_BUFFER,d),R.getBufferSubData(R.PIXEL_PACK_BUFFER,0,a),R.deleteBuffer(d),R.deleteSync(p),a}throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.`)}},this.copyFramebufferToTexture=function(e,t=null,n=0){let r=2**-n,i=Math.floor(e.image.width*r),a=Math.floor(e.image.height*r),o=t===null?0:t.x,s=t===null?0:t.y;H.setTexture2D(e,0),R.copyTexSubImage2D(R.TEXTURE_2D,n,0,0,o,s,i,a),B.unbindTexture()};let Nt=R.createFramebuffer(),Pt=R.createFramebuffer();this.copyTextureToTexture=function(e,t,n=null,r=null,i=0,a=0){let o,s,c,l,u,d,f,p,m,h=e.isCompressedTexture?e.mipmaps[a]:e.image;if(n!==null)o=n.max.x-n.min.x,s=n.max.y-n.min.y,c=n.isBox3?n.max.z-n.min.z:1,l=n.min.x,u=n.min.y,d=n.isBox3?n.min.z:0;else{let t=2**-i;o=Math.floor(h.width*t),s=Math.floor(h.height*t),c=e.isDataArrayTexture?h.depth:e.isData3DTexture?Math.floor(h.depth*t):1,l=0,u=0,d=0}r===null?(f=0,p=0,m=0):(f=r.x,p=r.y,m=r.z);let g=Xe.convert(t.format),_=Xe.convert(t.type),v;t.isData3DTexture?(H.setTexture3D(t,0),v=R.TEXTURE_3D):t.isDataArrayTexture||t.isCompressedArrayTexture?(H.setTexture2DArray(t,0),v=R.TEXTURE_2D_ARRAY):(H.setTexture2D(t,0),v=R.TEXTURE_2D),R.pixelStorei(R.UNPACK_FLIP_Y_WEBGL,t.flipY),R.pixelStorei(R.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t.premultiplyAlpha),R.pixelStorei(R.UNPACK_ALIGNMENT,t.unpackAlignment);let y=R.getParameter(R.UNPACK_ROW_LENGTH),b=R.getParameter(R.UNPACK_IMAGE_HEIGHT),x=R.getParameter(R.UNPACK_SKIP_PIXELS),S=R.getParameter(R.UNPACK_SKIP_ROWS),C=R.getParameter(R.UNPACK_SKIP_IMAGES);R.pixelStorei(R.UNPACK_ROW_LENGTH,h.width),R.pixelStorei(R.UNPACK_IMAGE_HEIGHT,h.height),R.pixelStorei(R.UNPACK_SKIP_PIXELS,l),R.pixelStorei(R.UNPACK_SKIP_ROWS,u),R.pixelStorei(R.UNPACK_SKIP_IMAGES,d);let w=e.isDataArrayTexture||e.isData3DTexture,T=t.isDataArrayTexture||t.isData3DTexture;if(e.isDepthTexture){let n=V.get(e),r=V.get(t),h=V.get(n.__renderTarget),g=V.get(r.__renderTarget);B.bindFramebuffer(R.READ_FRAMEBUFFER,h.__webglFramebuffer),B.bindFramebuffer(R.DRAW_FRAMEBUFFER,g.__webglFramebuffer);for(let n=0;n<c;n++)w&&(R.framebufferTextureLayer(R.READ_FRAMEBUFFER,R.COLOR_ATTACHMENT0,V.get(e).__webglTexture,i,d+n),R.framebufferTextureLayer(R.DRAW_FRAMEBUFFER,R.COLOR_ATTACHMENT0,V.get(t).__webglTexture,a,m+n)),R.blitFramebuffer(l,u,o,s,f,p,o,s,R.DEPTH_BUFFER_BIT,R.NEAREST);B.bindFramebuffer(R.READ_FRAMEBUFFER,null),B.bindFramebuffer(R.DRAW_FRAMEBUFFER,null)}else if(i!==0||e.isRenderTargetTexture||V.has(e)){let n=V.get(e),r=V.get(t);B.bindFramebuffer(R.READ_FRAMEBUFFER,Nt),B.bindFramebuffer(R.DRAW_FRAMEBUFFER,Pt);for(let e=0;e<c;e++)w?R.framebufferTextureLayer(R.READ_FRAMEBUFFER,R.COLOR_ATTACHMENT0,n.__webglTexture,i,d+e):R.framebufferTexture2D(R.READ_FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_2D,n.__webglTexture,i),T?R.framebufferTextureLayer(R.DRAW_FRAMEBUFFER,R.COLOR_ATTACHMENT0,r.__webglTexture,a,m+e):R.framebufferTexture2D(R.DRAW_FRAMEBUFFER,R.COLOR_ATTACHMENT0,R.TEXTURE_2D,r.__webglTexture,a),i===0?T?R.copyTexSubImage3D(v,a,f,p,m+e,l,u,o,s):R.copyTexSubImage2D(v,a,f,p,l,u,o,s):R.blitFramebuffer(l,u,o,s,f,p,o,s,R.COLOR_BUFFER_BIT,R.NEAREST);B.bindFramebuffer(R.READ_FRAMEBUFFER,null),B.bindFramebuffer(R.DRAW_FRAMEBUFFER,null)}else T?e.isDataTexture||e.isData3DTexture?R.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h.data):t.isCompressedArrayTexture?R.compressedTexSubImage3D(v,a,f,p,m,o,s,c,g,h.data):R.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h):e.isDataTexture?R.texSubImage2D(R.TEXTURE_2D,a,f,p,o,s,g,_,h.data):e.isCompressedTexture?R.compressedTexSubImage2D(R.TEXTURE_2D,a,f,p,h.width,h.height,g,h.data):R.texSubImage2D(R.TEXTURE_2D,a,f,p,o,s,g,_,h);R.pixelStorei(R.UNPACK_ROW_LENGTH,y),R.pixelStorei(R.UNPACK_IMAGE_HEIGHT,b),R.pixelStorei(R.UNPACK_SKIP_PIXELS,x),R.pixelStorei(R.UNPACK_SKIP_ROWS,S),R.pixelStorei(R.UNPACK_SKIP_IMAGES,C),a===0&&t.generateMipmaps&&R.generateMipmap(v),B.unbindTexture()},this.initRenderTarget=function(e){V.get(e).__webglFramebuffer===void 0&&H.setupRenderTarget(e)},this.initTexture=function(e){e.isCubeTexture?H.setTextureCube(e,0):e.isData3DTexture?H.setTexture3D(e,0):e.isDataArrayTexture||e.isCompressedArrayTexture?H.setTexture2DArray(e,0):H.setTexture2D(e,0),B.unbindTexture()},this.resetState=function(){ee=0,A=0,j=null,B.reset(),Qe.reset()},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}get coordinateSystem(){return Se}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=bt._getDrawingBufferColorSpace(e),t.unpackColorSpace=bt._getUnpackColorSpace()}},co=navigator.xr!=null&&self.XRSession!=null&&navigator.xr.isSessionSupported!=null,lo=co&&self.XRSession.prototype.requestHitTestSource!=null,uo=self.ResizeObserver!=null,fo=self.IntersectionObserver!=null,po=lo;(()=>{let e=navigator.userAgent||navigator.vendor||self.opera,t=!1;return(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(e)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(e.substr(0,4)))&&(t=!0),t})(),/\bCrOS\b/.test(navigator.userAgent);var mo=/android/i.test(navigator.userAgent),ho=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!self.MSStream||navigator.platform===`MacIntel`&&navigator.maxTouchPoints>1;/Safari\//.test(navigator.userAgent);var go=/firefox/i.test(navigator.userAgent),_o=/OculusBrowser/.test(navigator.userAgent);ho&&/CriOS\//.test(navigator.userAgent);var vo=ho&&/CriOS\/|EdgiOS\/|FxiOS\/|GSA\/|DuckDuckGo\//.test(navigator.userAgent),yo=ho&&/GSA\//.test(navigator.userAgent),bo=mo&&!go&&!_o;window.webkit&&window.webkit.messageHandlers;var xo=(()=>{if(ho){if(vo)return!0;let e=document.createElement(`a`);return!!(e.relList&&e.relList.supports&&e.relList.supports(`ar`))}return!1})(),So=e=>e&&e!==`null`?wo(e):null,Co=()=>{if(po)return;let e=[];throw co||e.push(`WebXR Device API`),lo||e.push(`WebXR Hit Test API`),Error(`The following APIs are required for AR, but are missing in this browser: ${e.join(`, `)}`)},wo=e=>new URL(e,window.location.toString()).toString(),To=(e,t)=>{let n=null,r=(...r)=>{n??=(e(...r),self.setTimeout(()=>n=null,t))};return r.flush=()=>{n!=null&&(self.clearTimeout(n),n=null)},r},Eo=(e,t)=>{let n=null;return(...r)=>{n!=null&&self.clearTimeout(n),n=self.setTimeout(()=>{n=null,e(...r)},t)}},Do=(e,t,n)=>Math.max(t,Math.min(n,e)),Oo=(()=>{let e=RegExp(`[?&]model-viewer-debug-mode(&|$)`);return()=>self.ModelViewerElement&&self.ModelViewerElement.debugMode||self.location&&self.location.search&&self.location.search.match(e)})(),ko=(e=0)=>new Promise(t=>setTimeout(t,e)),Ao=(e,t,n=null)=>new Promise(r=>{function i(a){(!n||n(a))&&(r(a),e.removeEventListener(t,i))}e.addEventListener(t,i)}),jo=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Mo=.5,No=0,Po=1,Fo=1,Io=Symbol(`currentEnvironmentMap`),Lo=Symbol(`currentBackground`),Ro=Symbol(`updateEnvironment`),zo=Symbol(`cancelEnvironmentUpdate`),Bo=e=>{var t,n,r;class i extends e{constructor(){super(...arguments),this.environmentImage=null,this.skyboxImage=null,this.shadowIntensity=No,this.shadowSoftness=Po,this.exposure=Fo,this.toneMapping=`auto`,this.skyboxHeight=`0`,this[t]=null,this[n]=null,this[r]=null}updated(e){if(super.updated(e),e.has(`shadowIntensity`)&&(this[Q].setShadowIntensity(this.shadowIntensity*Mo),this[qm]()),e.has(`shadowSoftness`)&&(this[Q].setShadowSoftness(this.shadowSoftness),this[qm]()),e.has(`exposure`)&&(this[Q].exposure=this.exposure,this[qm]()),e.has(`toneMapping`)){let e=new Map([[`aces`,4],[`agx`,6],[`reinhard`,2],[`cineon`,3],[`linear`,1],[`none`,0]]);this[Q].toneMapping=e.get(this.toneMapping)??7,this[qm]()}(e.has(`environmentImage`)||e.has(`skyboxImage`))&&this[eh]()&&this[Ro](),e.has(`skyboxHeight`)&&(this[Q].setGroundedSkybox(),this[qm]())}hasBakedShadow(){return this[Q].bakedShadows.size>0}async[(t=Io,n=Lo,r=zo,Ro)](){let{skyboxImage:e,environmentImage:t}=this;this[zo]!=null&&(this[zo](),this[zo]=null);let{textureUtils:n}=this[$];if(n==null)return;let r=this[Zm].beginActivity(`environment-update`);try{let{environmentMap:i,skybox:a}=await n.generateEnvironmentMapAndSkybox(So(e),t,e=>r(Do(e,0,1)),this.withCredentials);this[Io]!==i&&(this[Io]=i,this.dispatchEvent(new CustomEvent(`environment-change`))),this[Lo]=a==null?null:a.name===i.name?i:a,this[Q].setEnvironmentAndSkybox(this[Io],this[Lo])}catch(e){if(e instanceof Error)throw this[Q].setEnvironmentAndSkybox(null,null),e}finally{r(1)}}}return jo([W({type:String,attribute:`environment-image`})],i.prototype,`environmentImage`,void 0),jo([W({type:String,attribute:`skybox-image`})],i.prototype,`skyboxImage`,void 0),jo([W({type:Number,attribute:`shadow-intensity`})],i.prototype,`shadowIntensity`,void 0),jo([W({type:Number,attribute:`shadow-softness`})],i.prototype,`shadowSoftness`,void 0),jo([W({type:Number})],i.prototype,`exposure`,void 0),jo([W({type:String,attribute:`tone-mapping`})],i.prototype,`toneMapping`,void 0),jo([W({type:String,attribute:`skybox-height`})],i.prototype,`skyboxHeight`,void 0),i},Vo=Sn`
<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="#000000">
    <!-- NOTE(cdata): This SVG filter is a stop-gap until we can implement
         support for dynamic re-coloring of UI components -->
    <defs>
      <filter id="drop-shadow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
        <feOffset dx="0" dy="0" result="offsetblur"/>
        <feFlood flood-color="#000000"/>
        <feComposite in2="offsetblur" operator="in"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <path filter="url(#drop-shadow)" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    <path d="M0 0h24v24H0z" fill="none"/>
</svg>`,Ho=Sn`
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="25" height="36">
    <defs>
        <path id="A" d="M.001.232h24.997V36H.001z" />
    </defs>
    <g transform="translate(-11 -4)" fill="none" fill-rule="evenodd">
        <path fill-opacity="0" fill="#fff" d="M0 0h44v44H0z" />
        <g transform="translate(11 3)">
            <path d="M8.733 11.165c.04-1.108.766-2.027 1.743-2.307a2.54 2.54 0 0 1 .628-.089c.16 0 .314.017.463.044 1.088.2 1.9 1.092 1.9 2.16v8.88h1.26c2.943-1.39 5-4.45 5-8.025a9.01 9.01 0 0 0-1.9-5.56l-.43-.5c-.765-.838-1.683-1.522-2.712-2-1.057-.49-2.226-.77-3.46-.77s-2.4.278-3.46.77c-1.03.478-1.947 1.162-2.71 2l-.43.5a9.01 9.01 0 0 0-1.9 5.56 9.04 9.04 0 0 0 .094 1.305c.03.21.088.41.13.617l.136.624c.083.286.196.56.305.832l.124.333a8.78 8.78 0 0 0 .509.953l.065.122a8.69 8.69 0 0 0 3.521 3.191l1.11.537v-9.178z" fill-opacity=".5" fill="#e4e4e4" />
            <path d="M22.94 26.218l-2.76 7.74c-.172.485-.676.8-1.253.8H12.24c-1.606 0-3.092-.68-3.98-1.82-1.592-2.048-3.647-3.822-6.11-5.27-.095-.055-.15-.137-.152-.23-.004-.1.046-.196.193-.297.56-.393 1.234-.6 1.926-.6a3.43 3.43 0 0 1 .691.069l4.922.994V10.972c0-.663.615-1.203 1.37-1.203s1.373.54 1.373 1.203v9.882h2.953c.273 0 .533.073.757.21l6.257 3.874c.027.017.045.042.07.06.41.296.586.77.426 1.22M4.1 16.614c-.024-.04-.042-.083-.065-.122a8.69 8.69 0 0 1-.509-.953c-.048-.107-.08-.223-.124-.333l-.305-.832c-.058-.202-.09-.416-.136-.624l-.13-.617a9.03 9.03 0 0 1-.094-1.305c0-2.107.714-4.04 1.9-5.56l.43-.5c.764-.84 1.682-1.523 2.71-2 1.058-.49 2.226-.77 3.46-.77s2.402.28 3.46.77c1.03.477 1.947 1.16 2.712 2l.428.5a9 9 0 0 1 1.901 5.559c0 3.577-2.056 6.636-5 8.026h-1.26v-8.882c0-1.067-.822-1.96-1.9-2.16-.15-.028-.304-.044-.463-.044-.22 0-.427.037-.628.09-.977.28-1.703 1.198-1.743 2.306v9.178l-1.11-.537C6.18 19.098 4.96 18 4.1 16.614M22.97 24.09l-6.256-3.874c-.102-.063-.218-.098-.33-.144 2.683-1.8 4.354-4.855 4.354-8.243 0-.486-.037-.964-.104-1.43a9.97 9.97 0 0 0-1.57-4.128l-.295-.408-.066-.092a10.05 10.05 0 0 0-.949-1.078c-.342-.334-.708-.643-1.094-.922-1.155-.834-2.492-1.412-3.94-1.65l-.732-.088-.748-.03a9.29 9.29 0 0 0-1.482.119c-1.447.238-2.786.816-3.94 1.65a9.33 9.33 0 0 0-.813.686 9.59 9.59 0 0 0-.845.877l-.385.437-.36.5-.288.468-.418.778-.04.09c-.593 1.28-.93 2.71-.93 4.222 0 3.832 2.182 7.342 5.56 8.938l1.437.68v4.946L5 25.64a4.44 4.44 0 0 0-.888-.086c-.017 0-.034.003-.05.003-.252.004-.503.033-.75.08a5.08 5.08 0 0 0-.237.056c-.193.046-.382.107-.568.18-.075.03-.15.057-.225.1-.25.114-.494.244-.723.405a1.31 1.31 0 0 0-.566 1.122 1.28 1.28 0 0 0 .645 1.051C4 29.925 5.96 31.614 7.473 33.563a5.06 5.06 0 0 0 .434.491c1.086 1.082 2.656 1.713 4.326 1.715h6.697c.748-.001 1.43-.333 1.858-.872.142-.18.256-.38.336-.602l2.757-7.74c.094-.26.13-.53.112-.794s-.088-.52-.203-.76a2.19 2.19 0 0 0-.821-.91" fill-opacity=".6" fill="#000" />
            <path d="M22.444 24.94l-6.257-3.874a1.45 1.45 0 0 0-.757-.211h-2.953v-9.88c0-.663-.616-1.203-1.373-1.203s-1.37.54-1.37 1.203v16.643l-4.922-.994a3.44 3.44 0 0 0-.692-.069 3.35 3.35 0 0 0-1.925.598c-.147.102-.198.198-.194.298.004.094.058.176.153.23 2.462 1.448 4.517 3.22 6.11 5.27.887 1.14 2.373 1.82 3.98 1.82h6.686c.577 0 1.08-.326 1.253-.8l2.76-7.74c.16-.448-.017-.923-.426-1.22-.025-.02-.043-.043-.07-.06z" fill="#fff" />
            <g transform="translate(0 .769)">
                <mask id="B" fill="#fff">
                    <use xlink:href="#A" />
                </mask>
                <path d="M23.993 24.992a1.96 1.96 0 0 1-.111.794l-2.758 7.74c-.08.22-.194.423-.336.602-.427.54-1.11.87-1.857.872h-6.698c-1.67-.002-3.24-.633-4.326-1.715-.154-.154-.3-.318-.434-.49C5.96 30.846 4 29.157 1.646 27.773c-.385-.225-.626-.618-.645-1.05a1.31 1.31 0 0 1 .566-1.122 4.56 4.56 0 0 1 .723-.405l.225-.1a4.3 4.3 0 0 1 .568-.18l.237-.056c.248-.046.5-.075.75-.08.018 0 .034-.003.05-.003.303-.001.597.027.89.086l3.722.752V20.68l-1.436-.68c-3.377-1.596-5.56-5.106-5.56-8.938 0-1.51.336-2.94.93-4.222.015-.03.025-.06.04-.09.127-.267.268-.525.418-.778.093-.16.186-.316.288-.468.063-.095.133-.186.2-.277L3.773 5c.118-.155.26-.29.385-.437.266-.3.544-.604.845-.877a9.33 9.33 0 0 1 .813-.686C6.97 2.167 8.31 1.59 9.757 1.35a9.27 9.27 0 0 1 1.481-.119 8.82 8.82 0 0 1 .748.031c.247.02.49.05.733.088 1.448.238 2.786.816 3.94 1.65.387.28.752.588 1.094.922a9.94 9.94 0 0 1 .949 1.078l.066.092c.102.133.203.268.295.408a9.97 9.97 0 0 1 1.571 4.128c.066.467.103.945.103 1.43 0 3.388-1.67 6.453-4.353 8.243.11.046.227.08.33.144l6.256 3.874c.37.23.645.55.82.9.115.24.185.498.203.76m.697-1.195c-.265-.55-.677-1.007-1.194-1.326l-5.323-3.297c2.255-2.037 3.564-4.97 3.564-8.114 0-2.19-.637-4.304-1.84-6.114-.126-.188-.26-.37-.4-.552-.645-.848-1.402-1.6-2.252-2.204C15.472.91 13.393.232 11.238.232A10.21 10.21 0 0 0 5.23 2.19c-.848.614-1.606 1.356-2.253 2.205-.136.18-.272.363-.398.55C1.374 6.756.737 8.87.737 11.06c0 4.218 2.407 8.08 6.133 9.842l.863.41v3.092l-2.525-.51c-.356-.07-.717-.106-1.076-.106a5.45 5.45 0 0 0-3.14.996c-.653.46-1.022 1.202-.99 1.983a2.28 2.28 0 0 0 1.138 1.872c2.24 1.318 4.106 2.923 5.543 4.772 1.26 1.62 3.333 2.59 5.55 2.592h6.698c1.42-.001 2.68-.86 3.134-2.138l2.76-7.74c.272-.757.224-1.584-.134-2.325" fill-opacity=".05" fill="#000" mask="url(#B)" />
            </g>
        </g>
    </g>
</svg>`,Uo=Sn`
<style>
:host {
  display: block;
  position: relative;
  contain: strict;
  width: 300px;
  height: 150px;
}

.container {
  position: relative;
  overflow: hidden;
}

.userInput {
  width: 100%;
  height: 100%;
  display: none;
  position: relative;
  outline-offset: -1px;
  outline-width: 1px;
}

canvas {
  position: absolute;
  display: none;
  pointer-events: none;
  /* NOTE(cdata): Chrome 76 and below apparently have a bug
   * that causes our canvas not to display pixels unless it is
   * on its own render layer
   * @see https://github.com/google/model-viewer/pull/755#issuecomment-536597893
   */
  transform: translateZ(0);
}

.show {
  display: block;
}

/* Adapted from HTML5 Boilerplate
 *
 * @see https://github.com/h5bp/html5-boilerplate/blob/ceb4620c78fc82e13534fc44202a3f168754873f/dist/css/main.css#L122-L133 */
.screen-reader-only {
  border: 0;
  left: 0;
  top: 0;
  clip: rect(0, 0, 0, 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
  pointer-events: none;
}

.slot {
  position: absolute;
  pointer-events: none;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.slot > * {
  pointer-events: initial;
}

.annotation-wrapper ::slotted(*) {
  opacity: var(--max-hotspot-opacity, 1);
  transition: opacity 0.3s;
}

.pointer-tumbling .annotation-wrapper ::slotted(*) {
  pointer-events: none;
}

.annotation-wrapper ::slotted(*) {
  pointer-events: initial;
}

.annotation-wrapper.hide ::slotted(*) {
  opacity: var(--min-hotspot-opacity, 0.25);
}

.slot.poster {
  display: none;
  background-color: inherit;
}

.slot.poster.show {
  display: inherit;
}

.slot.poster > * {
  pointer-events: initial;
}

.slot.poster:not(.show) > * {
  pointer-events: none;
}

#default-poster {
  width: 100%;
  height: 100%;
  /* The default poster is a <button> so we need to set display
   * to prevent it from being affected by text-align: */
  display: block;
  position: absolute;
  border: none;
  padding: 0;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  background-color: #fff0;
}

#default-progress-bar {
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}

#default-progress-bar > .bar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--progress-bar-height, 5px);
  background-color: var(--progress-bar-color, rgba(0, 0, 0, 0.4));
  transition: transform 0.09s;
  transform-origin: top left;
  transform: scaleX(0);
  overflow: hidden;
}

#default-progress-bar > .bar.hide {
  transition: opacity 0.3s 1s;
  opacity: 0;
}

.centered {
  align-items: center;
  justify-content: center;
}

.cover {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.slot.interaction-prompt {
  display: var(--interaction-prompt-display, flex);
  overflow: hidden;
  opacity: 0;
  will-change: opacity;
  transition: opacity 0.3s;
}

.slot.interaction-prompt.visible {
  opacity: 1;
}

.animated-container {
  will-change: transform, opacity;
  opacity: 0;
  transition: opacity 0.3s;
}

.slot.interaction-prompt > * {
  pointer-events: none;
}

.slot.ar-button {
  -moz-user-select: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;

  display: var(--ar-button-display, block);
}

.slot.ar-button:not(.enabled) {
  display: none;
}

.fab {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  cursor: pointer;
  background-color: #fff;
  box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.15);
  border-radius: 100px;
}

.fab > * {
  opacity: 0.87;
}

#default-ar-button {
  position: absolute;
  bottom: 16px;
  right: 16px;
  transform: scale(var(--ar-button-scale, 1));
  transform-origin: bottom right;
}

.slot.pan-target {
  display: block;
  position: absolute;
  width: 0;
  height: 0;
  left: 50%;
  top: 50%;
  transform: translate3d(-50%, -50%, 0);
  background-color: transparent;
  opacity: 0;
  transition: opacity 0.3s;
}

#default-pan-target {
  width: 6px;
  height: 6px;
  border-radius: 6px;
  border: 1px solid white;
  box-shadow: 0px 0px 2px 1px rgba(0, 0, 0, 0.8);
}

.slot.default {
  pointer-events: none;
}

.slot.progress-bar {
  pointer-events: none;
}

.slot.exit-webxr-ar-button {
  pointer-events: none;
}

.slot.exit-webxr-ar-button > slot,
.slot.exit-webxr-ar-button ::slotted(*) {
  pointer-events: auto;
}

.slot.exit-webxr-ar-button:not(.enabled) {
  display: none;
}

#default-exit-webxr-ar-button {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: env(safe-area-inset-top, 16px);
  right: 16px;
  width: 40px;
  height: 40px;
  box-sizing: border-box;
}

#default-exit-webxr-ar-button > svg {
  fill: #fff;
}
</style>
<div class="container">
  <div class="userInput" tabindex="0" role="img"
      aria-label="3D model">
      <div class="slot canvas">
        <slot name="canvas">
          <canvas></canvas>
        </slot>
      </div>

  </div>

  <!-- NOTE(cdata): We need to wrap slots because browsers without ShadowDOM
        will have their <slot> elements removed by ShadyCSS -->
  <div class="slot poster">
    <slot name="poster">
      <button type="button" id="default-poster" aria-hidden="true" aria-label="Loading 3D model"></button>
    </slot>
  </div>

  <div class="slot ar-button">
    <slot name="ar-button">
      <a id="default-ar-button" part="default-ar-button" class="fab"
          tabindex="2"
          role="button"
          href="javascript:void(0);"
          aria-label="View in your space">
        ${Sn`
<svg version="1.1" id="view_x5F_in_x5F_AR_x5F_icon"
	 xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="24px" height="24px"
	 viewBox="0 0 24 24" enable-background="new 0 0 24 24" xml:space="preserve">
<rect id="Bounding_Box" x="0" y="0" fill="none" width="24" height="24"/>
<g id="Art_layer">
	<path d="M3,4c0-0.55,0.45-1,1-1h2V1H4C2.35,1,1,2.35,1,4v2h2V4z"/>
	<path d="M20,3c0.55,0,1,0.45,1,1v2h2V4c0-1.65-1.35-3-3-3h-2v2H20z"/>
	<path d="M4,21c-0.55,0-1-0.45-1-1v-2H1v2c0,1.65,1.35,3,3,3h2v-2H4z"/>
	<path d="M20,21c0.55,0,1-0.45,1-1v-2h2v2c0,1.65-1.35,3-3,3h-2v-2H20z"/>
	<g>
		<path d="M18.25,7.6l-5.5-3.18c-0.46-0.27-1.04-0.27-1.5,0L5.75,7.6C5.29,7.87,5,8.36,5,8.9v6.35c0,0.54,0.29,1.03,0.75,1.3
			l5.5,3.18c0.46,0.27,1.04,0.27,1.5,0l5.5-3.18c0.46-0.27,0.75-0.76,0.75-1.3V8.9C19,8.36,18.71,7.87,18.25,7.6z M7,14.96v-4.62
			l4,2.32v4.61L7,14.96z M12,10.93L8,8.61l4-2.31l4,2.31L12,10.93z M13,17.27v-4.61l4-2.32v4.62L13,17.27z"/>
	</g>
</g>
</svg>`}
      </a>
    </slot>
  </div>

  <div class="slot pan-target">
    <slot name="pan-target">
      <div id="default-pan-target">
      </div>
    </slot>
  </div>

  <div class="slot interaction-prompt cover centered">
    <div id="prompt" class="animated-container">
      <slot name="interaction-prompt" aria-hidden="true">
        ${Ho}
      </slot>
    </div>
  </div>

  <div id="finger0" class="animated-container cover">
    <slot name="finger0" aria-hidden="true">
    </slot>
  </div>
  <div id="finger1" class="animated-container cover">
    <slot name="finger1" aria-hidden="true">
    </slot>
  </div>

  <div class="slot default">
    <slot></slot>

    <div class="slot progress-bar">
      <slot name="progress-bar">
        <div id="default-progress-bar" aria-hidden="true">
          <div class="bar" part="default-progress-bar"></div>
        </div>
      </slot>
    </div>

    <div class="slot exit-webxr-ar-button">
      <slot name="exit-webxr-ar-button">
        <a id="default-exit-webxr-ar-button" part="default-exit-webxr-ar-button"
            tabindex="3"
            aria-label="Exit AR"
            aria-hidden="true">
          ${Vo}
        </a>
      </slot>
    </div>
  </div>
</div>
<div class="screen-reader-only" role="region" aria-label="Live announcements">
  <span id="status" role="status"></span>
</div>`,Wo=e=>{zn(Uo,e)},Go=class extends kt{constructor(e=document.createElement(`div`)){super(),this.isCSS2DObject=!0,this.element=e,this.element.style.position=`absolute`,this.element.style.userSelect=`none`,this.element.setAttribute(`draggable`,!1),this.center=new ct(.5,.5),this.addEventListener(`removed`,function(){this.traverse(function(e){e.element&&e.element instanceof e.element.ownerDocument.defaultView.Element&&e.element.parentNode!==null&&e.element.remove()})})}copy(e,t){return super.copy(e,t),this.element=e.element.cloneNode(!0),this.center=e.center,this}},Ko=new S,qo=new Ye,Jo=new Ye,Yo=new S,Xo=new S,Zo=class{constructor(e={}){let t=this,n,r,i,a,o={objects:new WeakMap},s=e.element===void 0?document.createElement(`div`):e.element;s.style.overflow=`hidden`,this.domElement=s,this.sortObjects=!0,this.getSize=function(){return{width:n,height:r}},this.render=function(e,t){e.matrixWorldAutoUpdate===!0&&e.updateMatrixWorld(),t.parent===null&&t.matrixWorldAutoUpdate===!0&&t.updateMatrixWorld(),qo.copy(t.matrixWorldInverse),Jo.multiplyMatrices(t.projectionMatrix,qo),l(e,e,t),this.sortObjects&&f(e)},this.setSize=function(e,t){n=e,r=t,i=n/2,a=r/2,s.style.width=e+`px`,s.style.height=t+`px`};function c(e){e.isCSS2DObject&&(e.element.style.display=`none`);for(let t=0,n=e.children.length;t<n;t++)c(e.children[t])}function l(e,n,r){if(e.visible===!1)c(e);else{if(e.isCSS2DObject){Ko.setFromMatrixPosition(e.matrixWorld),Ko.applyMatrix4(Jo);let c=Ko.z>=-1&&Ko.z<=1&&e.layers.test(r.layers)===!0,l=e.element;l.style.display=c===!0?``:`none`,c===!0&&(e.onBeforeRender(t,n,r),l.style.transform=`translate(`+-100*e.center.x+`%,`+-100*e.center.y+`%)translate(`+(Ko.x*i+i)+`px,`+(-Ko.y*a+a)+`px)`,l.parentNode!==s&&s.appendChild(l),e.onAfterRender(t,n,r));let d={distanceToCameraSquared:u(r,e)};o.objects.set(e,d)}for(let t=0,i=e.children.length;t<i;t++)l(e.children[t],n,r)}}function u(e,t){return Yo.setFromMatrixPosition(e.matrixWorld),Xo.setFromMatrixPosition(t.matrixWorld),Yo.distanceToSquared(Xo)}function d(e){let t=[];return e.traverseVisible(function(e){e.isCSS2DObject&&t.push(e)}),t}function f(e){let t=d(e).sort(function(e,t){return e.renderOrder===t.renderOrder?o.objects.get(e).distanceToCameraSquared-o.objects.get(t).distanceToCameraSquared:t.renderOrder-e.renderOrder}),n=t.length;for(let e=0,r=t.length;e<r;e++)t[e].element.style.zIndex=n-e}}};function Qo(e,t,n){let r=n,i=new S;return e.updateWorldMatrix(!0,!0),e.traverseVisible(e=>{let{geometry:n}=e;if(n!==void 0){let{position:a}=n.attributes;if(a!==void 0)for(let n=0,o=a.count;n<o;n++)e.isMesh?e.getVertexPosition(n,i):i.fromBufferAttribute(a,n),e.isSkinnedMesh||i.applyMatrix4(e.matrixWorld),r=t(r,i)}}),r}var $o={POSITION:[`byte`,`byte normalized`,`unsigned byte`,`unsigned byte normalized`,`short`,`short normalized`,`unsigned short`,`unsigned short normalized`],NORMAL:[`byte normalized`,`short normalized`],TANGENT:[`byte normalized`,`short normalized`],TEXCOORD:[`byte`,`byte normalized`,`unsigned byte`,`short`,`short normalized`,`unsigned short`]},es=class{constructor(){this.textureUtils=null,this.pluginCallbacks=[],this.register(function(e){return new bs(e)}),this.register(function(e){return new xs(e)}),this.register(function(e){return new Ts(e)}),this.register(function(e){return new Es(e)}),this.register(function(e){return new Ds(e)}),this.register(function(e){return new Os(e)}),this.register(function(e){return new Ss(e)}),this.register(function(e){return new Cs(e)}),this.register(function(e){return new ws(e)}),this.register(function(e){return new ks(e)}),this.register(function(e){return new As(e)}),this.register(function(e){return new js(e)}),this.register(function(e){return new Ms(e)}),this.register(function(e){return new Ns(e)})}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}setTextureUtils(e){return this.textureUtils=e,this}parse(e,t,n,r){let i=new ys,a=[];for(let e=0,t=this.pluginCallbacks.length;e<t;e++)a.push(this.pluginCallbacks[e](i));i.setPlugins(a),i.setTextureUtils(this.textureUtils),i.writeAsync(e,t,r).catch(n)}parseAsync(e,t){let n=this;return new Promise(function(r,i){n.parse(e,r,i,t)})}},q={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,BYTE:5120,UNSIGNED_BYTE:5121,SHORT:5122,UNSIGNED_SHORT:5123,INT:5124,UNSIGNED_INT:5125,FLOAT:5126,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,NEAREST:9728,LINEAR:9729,NEAREST_MIPMAP_NEAREST:9984,LINEAR_MIPMAP_NEAREST:9985,NEAREST_MIPMAP_LINEAR:9986,LINEAR_MIPMAP_LINEAR:9987,CLAMP_TO_EDGE:33071,MIRRORED_REPEAT:33648,REPEAT:10497},ts=`KHR_mesh_quantization`,ns={};ns[Ie]=q.NEAREST,ns[xt]=q.NEAREST_MIPMAP_NEAREST,ns[Ce]=q.NEAREST_MIPMAP_LINEAR,ns[ye]=q.LINEAR,ns[ae]=q.LINEAR_MIPMAP_NEAREST,ns[xe]=q.LINEAR_MIPMAP_LINEAR,ns[Pe]=q.CLAMP_TO_EDGE,ns[Re]=q.REPEAT,ns[ze]=q.MIRRORED_REPEAT;var rs={scale:`scale`,position:`translation`,quaternion:`rotation`,morphTargetInfluences:`weights`},is=new I,as=12,os=1179937895,ss=2,cs=8,ls=1313821514,us=5130562;function ds(e,t){return e.length===t.length&&e.every(function(e,n){return e===t[n]})}function fs(e){return new TextEncoder().encode(e).buffer}function ps(e){return ds(e.elements,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}function ms(e,t,n){let r={min:Array(e.itemSize).fill(1/0),max:Array(e.itemSize).fill(-1/0)};for(let i=t;i<t+n;i++)for(let t=0;t<e.itemSize;t++){let n;e.itemSize>4?n=e.array[i*e.itemSize+t]:(t===0?n=e.getX(i):t===1?n=e.getY(i):t===2?n=e.getZ(i):t===3&&(n=e.getW(i)),e.normalized===!0&&(n=pt.normalize(n,e.array))),r.min[t]=Math.min(r.min[t],n),r.max[t]=Math.max(r.max[t],n)}return r}function hs(e){return Math.ceil(e/4)*4}function gs(e,t=0){let n=hs(e.byteLength);if(n!==e.byteLength){let r=new Uint8Array(n);if(r.set(new Uint8Array(e)),t!==0)for(let i=e.byteLength;i<n;i++)r[i]=t;return r.buffer}return e}function _s(){return typeof document>`u`&&typeof OffscreenCanvas<`u`?new OffscreenCanvas(1,1):document.createElement(`canvas`)}function vs(e,t){if(typeof OffscreenCanvas<`u`&&e instanceof OffscreenCanvas){let n;return t===`image/jpeg`?n=.92:t===`image/webp`&&(n=.8),e.convertToBlob({type:t,quality:n})}return new Promise(n=>e.toBlob(n,t))}var ys=class{constructor(){this.plugins=[],this.options={},this.pending=[],this.buffers=[],this.byteOffset=0,this.buffers=[],this.nodeMap=new Map,this.skins=[],this.extensionsUsed={},this.extensionsRequired={},this.uids=new Map,this.uid=0,this.json={asset:{version:`2.0`,generator:`THREE.GLTFExporter r183`}},this.cache={meshes:new Map,attributes:new Map,attributesNormalized:new Map,materials:new Map,textures:new Map,images:new Map},this.textureUtils=null}setPlugins(e){this.plugins=e}setTextureUtils(e){this.textureUtils=e}async writeAsync(e,t,n={}){this.options=Object.assign({binary:!1,trs:!1,onlyVisible:!0,maxTextureSize:1/0,animations:[],includeCustomExtensions:!1},n),this.options.animations.length>0&&(this.options.trs=!0),await this.processInputAsync(e),await Promise.all(this.pending);let r=this,i=r.buffers,a=r.json;n=r.options;let o=r.extensionsUsed,s=r.extensionsRequired,c=new Blob(i,{type:`application/octet-stream`}),l=Object.keys(o),u=Object.keys(s);if(l.length>0&&(a.extensionsUsed=l),u.length>0&&(a.extensionsRequired=u),a.buffers&&a.buffers.length>0&&(a.buffers[0].byteLength=c.size),n.binary===!0){let e=new FileReader;e.readAsArrayBuffer(c),e.onloadend=function(){let n=gs(e.result),r=new DataView(new ArrayBuffer(cs));r.setUint32(0,n.byteLength,!0),r.setUint32(4,us,!0);let i=gs(fs(JSON.stringify(a)),32),o=new DataView(new ArrayBuffer(cs));o.setUint32(0,i.byteLength,!0),o.setUint32(4,ls,!0);let s=new ArrayBuffer(as),c=new DataView(s);c.setUint32(0,os,!0),c.setUint32(4,ss,!0);let l=as+o.byteLength+i.byteLength+r.byteLength+n.byteLength;c.setUint32(8,l,!0);let u=new Blob([s,o,i,r,n],{type:`application/octet-stream`}),d=new FileReader;d.readAsArrayBuffer(u),d.onloadend=function(){t(d.result)}}}else if(a.buffers&&a.buffers.length>0){let e=new FileReader;e.readAsDataURL(c),e.onloadend=function(){let n=e.result;a.buffers[0].uri=n,t(a)}}else t(a)}serializeUserData(e,t){if(Object.keys(e.userData).length===0)return;let n=this.options,r=this.extensionsUsed;try{let i=JSON.parse(JSON.stringify(e.userData));if(n.includeCustomExtensions&&i.gltfExtensions){t.extensions===void 0&&(t.extensions={});for(let e in i.gltfExtensions)t.extensions[e]=i.gltfExtensions[e],r[e]=!0;delete i.gltfExtensions}Object.keys(i).length>0&&(t.extras=i)}catch(t){console.warn(`THREE.GLTFExporter: userData of '`+e.name+`' won't be serialized because of JSON.stringify error - `+t.message)}}getUID(e,t=!1){if(this.uids.has(e)===!1){let t=new Map;t.set(!0,this.uid++),t.set(!1,this.uid++),this.uids.set(e,t)}return this.uids.get(e).get(t)}isNormalizedNormalAttribute(e){if(this.cache.attributesNormalized.has(e))return!1;let t=new S;for(let n=0,r=e.count;n<r;n++)if(Math.abs(t.fromBufferAttribute(e,n).length()-1)>5e-4)return!1;return!0}createNormalizedNormalAttribute(e){let t=this.cache;if(t.attributesNormalized.has(e))return t.attributesNormalized.get(e);let n=e.clone(),r=new S;for(let e=0,t=n.count;e<t;e++)r.fromBufferAttribute(n,e),r.x===0&&r.y===0&&r.z===0?r.setX(1):r.normalize(),n.setXYZ(e,r.x,r.y,r.z);return t.attributesNormalized.set(e,n),n}applyTextureTransform(e,t){let n=!1,r={};(t.offset.x!==0||t.offset.y!==0)&&(r.offset=t.offset.toArray(),n=!0),t.rotation!==0&&(r.rotation=t.rotation,n=!0),(t.repeat.x!==1||t.repeat.y!==1)&&(r.scale=t.repeat.toArray(),n=!0),n&&(e.extensions=e.extensions||{},e.extensions.KHR_texture_transform=r,this.extensionsUsed.KHR_texture_transform=!0)}async buildMetalRoughTextureAsync(e,t){if(e===t)return e;function n(e){return e.colorSpace===`srgb`?function(e){return e<.04045?e*.0773993808:(e*.9478672986+.0521327014)**2.4}:function(e){return e}}e instanceof Ot&&(e=await this.decompressTextureAsync(e)),t instanceof Ot&&(t=await this.decompressTextureAsync(t));let r=e?e.image:null,i=t?t.image:null,a=Math.max(r?r.width:0,i?i.width:0),o=Math.max(r?r.height:0,i?i.height:0),s=_s();s.width=a,s.height=o;let c=s.getContext(`2d`,{willReadFrequently:!0});c.fillStyle=`#00ffff`,c.fillRect(0,0,a,o);let l=c.getImageData(0,0,a,o);if(r){c.drawImage(r,0,0,a,o);let t=n(e),i=c.getImageData(0,0,a,o).data;for(let e=2;e<i.length;e+=4)l.data[e]=t(i[e]/256)*256}if(i){c.drawImage(i,0,0,a,o);let e=n(t),r=c.getImageData(0,0,a,o).data;for(let t=1;t<r.length;t+=4)l.data[t]=e(r[t]/256)*256}c.putImageData(l,0,0);let u=(e||t).clone();return u.source=new ne(s),u.colorSpace=``,u.channel=(e||t).channel,e&&t&&e.channel!==t.channel&&console.warn(`THREE.GLTFExporter: UV channels for metalnessMap and roughnessMap textures must match.`),console.warn(`THREE.GLTFExporter: Merged metalnessMap and roughnessMap textures.`),u}async decompressTextureAsync(e,t=1/0){if(this.textureUtils===null)throw Error(`THREE.GLTFExporter: setTextureUtils() must be called to process compressed textures.`);return await this.textureUtils.decompress(e,t)}processBuffer(e){let t=this.json,n=this.buffers;return t.buffers||=[{byteLength:0}],n.push(e),0}processBufferView(e,t,n,r,i){let a=this.json;a.bufferViews||=[];let o;switch(t){case q.BYTE:case q.UNSIGNED_BYTE:o=1;break;case q.SHORT:case q.UNSIGNED_SHORT:o=2;break;default:o=4}let s=e.itemSize*o;i===q.ARRAY_BUFFER&&(s=Math.ceil(s/4)*4);let c=hs(r*s),l=new DataView(new ArrayBuffer(c)),u=0;for(let i=n;i<n+r;i++){for(let n=0;n<e.itemSize;n++){let r;e.itemSize>4?r=e.array[i*e.itemSize+n]:(n===0?r=e.getX(i):n===1?r=e.getY(i):n===2?r=e.getZ(i):n===3&&(r=e.getW(i)),e.normalized===!0&&(r=pt.normalize(r,e.array))),t===q.FLOAT?l.setFloat32(u,r,!0):t===q.INT?l.setInt32(u,r,!0):t===q.UNSIGNED_INT?l.setUint32(u,r,!0):t===q.SHORT?l.setInt16(u,r,!0):t===q.UNSIGNED_SHORT?l.setUint16(u,r,!0):t===q.BYTE?l.setInt8(u,r):t===q.UNSIGNED_BYTE&&l.setUint8(u,r),u+=o}u%s!==0&&(u+=s-u%s)}let d={buffer:this.processBuffer(l.buffer),byteOffset:this.byteOffset,byteLength:c};return i!==void 0&&(d.target=i),i===q.ARRAY_BUFFER&&(d.byteStride=s),this.byteOffset+=c,a.bufferViews.push(d),{id:a.bufferViews.length-1,byteLength:0}}processBufferViewImage(e){let t=this,n=t.json;return n.bufferViews||=[],new Promise(function(r){let i=new FileReader;i.readAsArrayBuffer(e),i.onloadend=function(){let e=gs(i.result),a={buffer:t.processBuffer(e),byteOffset:t.byteOffset,byteLength:e.byteLength};t.byteOffset+=e.byteLength,r(n.bufferViews.push(a)-1)}})}processAccessor(e,t,n,r){let i=this.json,a={1:`SCALAR`,2:`VEC2`,3:`VEC3`,4:`VEC4`,9:`MAT3`,16:`MAT4`},o;if(e.array.constructor===Float32Array)o=q.FLOAT;else if(e.array.constructor===Int32Array)o=q.INT;else if(e.array.constructor===Uint32Array)o=q.UNSIGNED_INT;else if(e.array.constructor===Int16Array)o=q.SHORT;else if(e.array.constructor===Uint16Array)o=q.UNSIGNED_SHORT;else if(e.array.constructor===Int8Array)o=q.BYTE;else if(e.array.constructor===Uint8Array)o=q.UNSIGNED_BYTE;else throw Error(`THREE.GLTFExporter: Unsupported bufferAttribute component type: `+e.array.constructor.name);if(n===void 0&&(n=0),(r===void 0||r===1/0)&&(r=e.count),r===0)return null;let s=ms(e,n,r),c;t!==void 0&&(c=e===t.index?q.ELEMENT_ARRAY_BUFFER:q.ARRAY_BUFFER);let l=this.processBufferView(e,o,n,r,c),u={bufferView:l.id,byteOffset:l.byteOffset,componentType:o,count:r,max:s.max,min:s.min,type:a[e.itemSize]};return e.normalized===!0&&(u.normalized=!0),i.accessors||=[],i.accessors.push(u)-1}processImage(e,t,n,r=`image/png`){if(e!==null){let i=this,a=i.cache,o=i.json,s=i.options,c=i.pending;a.images.has(e)||a.images.set(e,{});let l=a.images.get(e),u=r+`:flipY/`+n.toString();if(l[u]!==void 0)return l[u];o.images||=[];let d={mimeType:r},f=_s();f.width=Math.min(e.width,s.maxTextureSize),f.height=Math.min(e.height,s.maxTextureSize);let p=f.getContext(`2d`,{willReadFrequently:!0});if(n===!0&&(p.translate(0,f.height),p.scale(1,-1)),e.data!==void 0){t!==1023&&console.error(`GLTFExporter: Only RGBAFormat is supported.`,t),(e.width>s.maxTextureSize||e.height>s.maxTextureSize)&&console.warn(`GLTFExporter: Image size is bigger than maxTextureSize`,e);let n=new Uint8ClampedArray(e.height*e.width*4);for(let t=0;t<n.length;t+=4)n[t+0]=e.data[t+0],n[t+1]=e.data[t+1],n[t+2]=e.data[t+2],n[t+3]=e.data[t+3];p.putImageData(new ImageData(n,e.width,e.height),0,0)}else if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap||typeof OffscreenCanvas<`u`&&e instanceof OffscreenCanvas)p.drawImage(e,0,0,f.width,f.height);else throw Error(`THREE.GLTFExporter: Invalid image type. Use HTMLImageElement, HTMLCanvasElement, ImageBitmap or OffscreenCanvas.`);s.binary===!0?c.push(vs(f,r).then(e=>i.processBufferViewImage(e)).then(e=>{d.bufferView=e})):d.uri=v.getDataURL(f,r);let m=o.images.push(d)-1;return l[u]=m,m}throw Error(`THREE.GLTFExporter: No valid image data found. Unable to process texture.`)}processSampler(e){let t=this.json;t.samplers||=[];let n={magFilter:ns[e.magFilter],minFilter:ns[e.minFilter],wrapS:ns[e.wrapS],wrapT:ns[e.wrapT]};return t.samplers.push(n)-1}async processTextureAsync(e){let t=this.options,n=this.cache,r=this.json;if(n.textures.has(e))return n.textures.get(e);r.textures||=[],e instanceof Ot&&(e=await this.decompressTextureAsync(e,t.maxTextureSize));let i=e.userData.mimeType;i===`image/webp`&&(i=`image/png`);let a={sampler:this.processSampler(e),source:this.processImage(e.image,e.format,e.flipY,i)};e.name&&(a.name=e.name),await this._invokeAllAsync(async function(t){t.writeTexture&&await t.writeTexture(e,a)});let o=r.textures.push(a)-1;return n.textures.set(e,o),o}async processMaterialAsync(e){let t=this.cache,n=this.json;if(t.materials.has(e))return t.materials.get(e);if(e.isShaderMaterial)return console.warn(`GLTFExporter: THREE.ShaderMaterial not supported.`),null;n.materials||=[];let r={pbrMetallicRoughness:{}};e.isMeshStandardMaterial!==!0&&e.isMeshBasicMaterial!==!0&&console.warn(`GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.`);let i=e.color.toArray().concat([e.opacity]);if(ds(i,[1,1,1,1])||(r.pbrMetallicRoughness.baseColorFactor=i),e.isMeshStandardMaterial?(r.pbrMetallicRoughness.metallicFactor=e.metalness,r.pbrMetallicRoughness.roughnessFactor=e.roughness):(r.pbrMetallicRoughness.metallicFactor=0,r.pbrMetallicRoughness.roughnessFactor=1),e.metalnessMap||e.roughnessMap){let t=await this.buildMetalRoughTextureAsync(e.metalnessMap,e.roughnessMap),n={index:await this.processTextureAsync(t),texCoord:t.channel};this.applyTextureTransform(n,t),r.pbrMetallicRoughness.metallicRoughnessTexture=n}if(e.map){let t={index:await this.processTextureAsync(e.map),texCoord:e.map.channel};this.applyTextureTransform(t,e.map),r.pbrMetallicRoughness.baseColorTexture=t}if(e.emissive){let t=e.emissive;if(Math.max(t.r,t.g,t.b)>0&&(r.emissiveFactor=e.emissive.toArray()),e.emissiveMap){let t={index:await this.processTextureAsync(e.emissiveMap),texCoord:e.emissiveMap.channel};this.applyTextureTransform(t,e.emissiveMap),r.emissiveTexture=t}}if(e.normalMap){let t={index:await this.processTextureAsync(e.normalMap),texCoord:e.normalMap.channel};e.normalScale&&e.normalScale.x!==1&&(t.scale=e.normalScale.x),this.applyTextureTransform(t,e.normalMap),r.normalTexture=t}if(e.aoMap){let t={index:await this.processTextureAsync(e.aoMap),texCoord:e.aoMap.channel};e.aoMapIntensity!==1&&(t.strength=e.aoMapIntensity),this.applyTextureTransform(t,e.aoMap),r.occlusionTexture=t}e.transparent?r.alphaMode=`BLEND`:e.alphaTest>0&&(r.alphaMode=`MASK`,r.alphaCutoff=e.alphaTest),e.side===2&&(r.doubleSided=!0),e.name!==``&&(r.name=e.name),this.serializeUserData(e,r),await this._invokeAllAsync(async function(t){t.writeMaterialAsync&&await t.writeMaterialAsync(e,r)});let a=n.materials.push(r)-1;return t.materials.set(e,a),a}async processMeshAsync(e){let t=this.cache,n=this.json,r=[e.geometry.uuid];if(Array.isArray(e.material))for(let t=0,n=e.material.length;t<n;t++)r.push(e.material[t].uuid);else r.push(e.material.uuid);let i=r.join(`:`);if(t.meshes.has(i))return t.meshes.get(i);let a=e.geometry,o;o=e.isLineSegments?q.LINES:e.isLineLoop?q.LINE_LOOP:e.isLine?q.LINE_STRIP:e.isPoints?q.POINTS:e.material.wireframe?q.LINES:q.TRIANGLES;let s={},c={},l=[],u=[],d={uv:`TEXCOORD_0`,uv1:`TEXCOORD_1`,uv2:`TEXCOORD_2`,uv3:`TEXCOORD_3`,color:`COLOR_0`,skinWeight:`WEIGHTS_0`,skinIndex:`JOINTS_0`},f=a.getAttribute(`normal`);f!==void 0&&!this.isNormalizedNormalAttribute(f)&&(console.warn(`THREE.GLTFExporter: Creating normalized normal attribute from the non-normalized one.`),a.setAttribute(`normal`,this.createNormalizedNormalAttribute(f)));let p=null;for(let e in a.attributes){if(e.slice(0,5)===`morph`)continue;let n=a.attributes[e];if(e=d[e]||e.toUpperCase(),/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+)$/.test(e)||(e=`_`+e),t.attributes.has(this.getUID(n))){c[e]=t.attributes.get(this.getUID(n));continue}p=null;let r=n.array;e===`JOINTS_0`&&!(r instanceof Uint16Array)&&!(r instanceof Uint8Array)?(console.warn(`GLTFExporter: Attribute "skinIndex" converted to type UNSIGNED_SHORT.`),p=es.Utils.toTypedBufferAttribute(n,Uint16Array)):(r instanceof Uint32Array||r instanceof Int32Array)&&!e.startsWith(`_`)&&(console.warn(`GLTFExporter: Attribute "${e}" converted to type FLOAT.`),p=es.Utils.toTypedBufferAttribute(n,Float32Array));let i=this.processAccessor(p||n,a);i!==null&&(e.startsWith(`_`)||this.detectMeshQuantization(e,n),c[e]=i,t.attributes.set(this.getUID(n),i))}if(f!==void 0&&a.setAttribute(`normal`,f),Object.keys(c).length===0)return null;if(e.morphTargetInfluences!==void 0&&e.morphTargetInfluences.length>0){let n=[],r=[],i={};if(e.morphTargetDictionary!==void 0)for(let t in e.morphTargetDictionary)i[e.morphTargetDictionary[t]]=t;for(let o=0;o<e.morphTargetInfluences.length;++o){let s={},c=!1;for(let e in a.morphAttributes){if(e!==`position`&&e!==`normal`){c||=(console.warn(`GLTFExporter: Only POSITION and NORMAL morph are supported.`),!0);continue}let n=a.morphAttributes[e][o],r=e.toUpperCase(),i=a.attributes[e];if(t.attributes.has(this.getUID(n,!0))){s[r]=t.attributes.get(this.getUID(n,!0));continue}let l=n.clone();if(!a.morphTargetsRelative)for(let e=0,t=n.count;e<t;e++)for(let t=0;t<n.itemSize;t++)t===0&&l.setX(e,n.getX(e)-i.getX(e)),t===1&&l.setY(e,n.getY(e)-i.getY(e)),t===2&&l.setZ(e,n.getZ(e)-i.getZ(e)),t===3&&l.setW(e,n.getW(e)-i.getW(e));s[r]=this.processAccessor(l,a),t.attributes.set(this.getUID(i,!0),s[r])}u.push(s),n.push(e.morphTargetInfluences[o]),e.morphTargetDictionary!==void 0&&r.push(i[o])}s.weights=n,r.length>0&&(s.extras={},s.extras.targetNames=r)}let m=Array.isArray(e.material);if(m&&a.groups.length===0)return null;let h=!1;if(m&&a.index===null){let e=[];for(let t=0,n=a.attributes.position.count;t<n;t++)e[t]=t;a.setIndex(e),h=!0}let g=m?e.material:[e.material],_=m?a.groups:[{materialIndex:0,start:void 0,count:void 0}];for(let e=0,n=_.length;e<n;e++){let n={mode:o,attributes:c};if(this.serializeUserData(a,n),u.length>0&&(n.targets=u),a.index!==null){let r=this.getUID(a.index);(_[e].start!==void 0||_[e].count!==void 0)&&(r+=`:`+_[e].start+`:`+_[e].count),t.attributes.has(r)?n.indices=t.attributes.get(r):(n.indices=this.processAccessor(a.index,a,_[e].start,_[e].count),t.attributes.set(r,n.indices)),n.indices===null&&delete n.indices}let r=await this.processMaterialAsync(g[_[e].materialIndex]);r!==null&&(n.material=r),l.push(n)}h===!0&&a.setIndex(null),s.primitives=l,n.meshes||=[],await this._invokeAllAsync(function(t){t.writeMesh&&t.writeMesh(e,s)});let v=n.meshes.push(s)-1;return t.meshes.set(i,v),v}detectMeshQuantization(e,t){if(this.extensionsUsed[ts])return;let n;switch(t.array.constructor){case Int8Array:n=`byte`;break;case Uint8Array:n=`unsigned byte`;break;case Int16Array:n=`short`;break;case Uint16Array:n=`unsigned short`;break;default:return}t.normalized&&(n+=` normalized`);let r=e.split(`_`,1)[0];$o[r]&&$o[r].includes(n)&&(this.extensionsUsed[ts]=!0,this.extensionsRequired[ts]=!0)}processCamera(e){let t=this.json;t.cameras||=[];let n=e.isOrthographicCamera,r={type:n?`orthographic`:`perspective`};return n?r.orthographic={xmag:e.right*2,ymag:e.top*2,zfar:e.far<=0?.001:e.far,znear:e.near<0?0:e.near}:r.perspective={aspectRatio:e.aspect,yfov:pt.degToRad(e.fov),zfar:e.far<=0?.001:e.far,znear:e.near<0?0:e.near},e.name!==``&&(r.name=e.type),t.cameras.push(r)-1}processAnimation(e,t){let n=this.json,r=this.nodeMap;n.animations||=[],e=es.Utils.mergeMorphTargetTracks(e.clone(),t);let i=e.tracks,a=[],o=[];for(let e=0;e<i.length;++e){let n=i[e],s=de.parseTrackName(n.name),c=de.findNode(t,s.nodeName),l=rs[s.propertyName];if(s.objectName===`bones`&&(c=c.isSkinnedMesh===!0?c.skeleton.getBoneByName(s.objectIndex):void 0),!c||!l){console.warn(`THREE.GLTFExporter: Could not export animation track "%s".`,n.name);continue}let u=n.values.length/n.times.length;l===rs.morphTargetInfluences&&(u/=c.morphTargetInfluences.length);let d;n.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline===!0?(d=`CUBICSPLINE`,u/=3):d=n.getInterpolation()===2300?`STEP`:`LINEAR`,o.push({input:this.processAccessor(new Ne(n.times,1)),output:this.processAccessor(new Ne(n.values,u)),interpolation:d}),a.push({sampler:o.length-1,target:{node:r.get(c),path:l}})}let s={name:e.name||`clip_`+n.animations.length,samplers:o,channels:a};return this.serializeUserData(e,s),n.animations.push(s),n.animations.length-1}processSkin(e){let t=this.json,n=this.nodeMap,r=t.nodes[n.get(e)],i=e.skeleton;if(i===void 0)return null;let a=e.skeleton.bones[0];if(a===void 0)return null;let o=[],s=new Float32Array(i.bones.length*16),c=new Ye;for(let t=0;t<i.bones.length;++t)o.push(n.get(i.bones[t])),c.copy(i.boneInverses[t]),c.multiply(e.bindMatrix).toArray(s,t*16);return t.skins===void 0&&(t.skins=[]),t.skins.push({inverseBindMatrices:this.processAccessor(new Ne(s,16)),joints:o,skeleton:n.get(a)}),r.skin=t.skins.length-1}async processNodeAsync(e){let t=this.json,n=this.options,r=this.nodeMap;if(t.nodes||=[],e.pivot!==null)return await this._processNodeWithPivotAsync(e);let i={};if(n.trs){let t=e.quaternion.toArray(),n=e.position.toArray(),r=e.scale.toArray();ds(t,[0,0,0,1])||(i.rotation=t),ds(n,[0,0,0])||(i.translation=n),ds(r,[1,1,1])||(i.scale=r)}else e.matrixAutoUpdate&&e.updateMatrix(),ps(e.matrix)===!1&&(i.matrix=e.matrix.elements);if(e.name!==``&&(i.name=String(e.name)),this.serializeUserData(e,i),e.isMesh||e.isLine||e.isPoints){let t=await this.processMeshAsync(e);t!==null&&(i.mesh=t)}else e.isCamera&&(i.camera=this.processCamera(e));e.isSkinnedMesh&&this.skins.push(e);let a=t.nodes.push(i)-1;if(r.set(e,a),e.children.length>0){let t=[];for(let r=0,i=e.children.length;r<i;r++){let i=e.children[r];if(i.visible||n.onlyVisible===!1){let e=await this.processNodeAsync(i);e!==null&&t.push(e)}}t.length>0&&(i.children=t)}return await this._invokeAllAsync(function(t){t.writeNode&&t.writeNode(e,i)}),a}async _processNodeWithPivotAsync(e){let t=this.json,n=this.options,r=this.nodeMap,i=e.pivot,a={},o=e.quaternion.toArray(),s=[e.position.x+i.x,e.position.y+i.y,e.position.z+i.z],c=e.scale.toArray();ds(o,[0,0,0,1])||(a.rotation=o),ds(s,[0,0,0])||(a.translation=s),ds(c,[1,1,1])||(a.scale=c),a.extras={pivot:i.toArray()},e.name!==``&&(a.name=String(e.name)),this.serializeUserData(e,a);let l=t.nodes.push(a)-1;r.set(e,l);let u={},d=[-i.x,-i.y,-i.z];if(ds(d,[0,0,0])||(u.translation=d),e.isMesh||e.isLine||e.isPoints){let t=await this.processMeshAsync(e);t!==null&&(u.mesh=t)}else e.isCamera&&(u.camera=this.processCamera(e));e.isSkinnedMesh&&this.skins.push(e);let f=[t.nodes.push(u)-1];if(e.children.length>0){let t=[];for(let r=0,i=e.children.length;r<i;r++){let i=e.children[r];if(i.visible||n.onlyVisible===!1){let e=await this.processNodeAsync(i);e!==null&&t.push(e)}}t.length>0&&(u.children=t)}return a.children=f,await this._invokeAllAsync(function(t){t.writeNode&&t.writeNode(e,a)}),l}async processSceneAsync(e){let t=this.json,n=this.options;t.scenes||(t.scenes=[],t.scene=0);let r={};e.name!==``&&(r.name=e.name),t.scenes.push(r);let i=[];for(let t=0,r=e.children.length;t<r;t++){let r=e.children[t];if(r.visible||n.onlyVisible===!1){let e=await this.processNodeAsync(r);e!==null&&i.push(e)}}i.length>0&&(r.nodes=i),this.serializeUserData(e,r)}async processObjectsAsync(e){let t=new s;t.name=`AuxScene`;for(let n=0;n<e.length;n++)t.children.push(e[n]);await this.processSceneAsync(t)}async processInputAsync(e){let t=this.options;e=e instanceof Array?e:[e],await this._invokeAllAsync(function(t){t.beforeParse&&t.beforeParse(e)});let n=[];for(let t=0;t<e.length;t++)e[t]instanceof s?await this.processSceneAsync(e[t]):n.push(e[t]);n.length>0&&await this.processObjectsAsync(n);for(let e=0;e<this.skins.length;++e)this.processSkin(this.skins[e]);for(let n=0;n<t.animations.length;++n)this.processAnimation(t.animations[n],e[0]);await this._invokeAllAsync(function(t){t.afterParse&&t.afterParse(e)})}async _invokeAllAsync(e){for(let t=0,n=this.plugins.length;t<n;t++)await e(this.plugins[t])}},bs=class{constructor(e){this.writer=e,this.name=`KHR_lights_punctual`}writeNode(e,t){if(!e.isLight)return;if(!e.isDirectionalLight&&!e.isPointLight&&!e.isSpotLight){console.warn(`THREE.GLTFExporter: Only directional, point, and spot lights are supported.`,e);return}let n=this.writer,r=n.json,i=n.extensionsUsed,a={};e.name&&(a.name=e.name),a.color=e.color.toArray(),a.intensity=e.intensity,e.isDirectionalLight?a.type=`directional`:e.isPointLight?(a.type=`point`,e.distance>0&&(a.range=e.distance)):e.isSpotLight&&(a.type=`spot`,e.distance>0&&(a.range=e.distance),a.spot={},a.spot.innerConeAngle=(1-e.penumbra)*e.angle,a.spot.outerConeAngle=e.angle),e.decay!==void 0&&e.decay!==2&&console.warn(`THREE.GLTFExporter: Light decay may be lost. glTF is physically-based, and expects light.decay=2.`),e.target&&(e.target.parent!==e||e.target.position.x!==0||e.target.position.y!==0||e.target.position.z!==-1)&&console.warn(`THREE.GLTFExporter: Light direction may be lost. For best results, make light.target a child of the light with position 0,0,-1.`),i[this.name]||(r.extensions=r.extensions||{},r.extensions[this.name]={lights:[]},i[this.name]=!0);let o=r.extensions[this.name].lights;o.push(a),t.extensions=t.extensions||{},t.extensions[this.name]={light:o.length-1}}},xs=class{constructor(e){this.writer=e,this.name=`KHR_materials_unlit`}async writeMaterialAsync(e,t){if(!e.isMeshBasicMaterial)return;let n=this.writer.extensionsUsed;t.extensions=t.extensions||{},t.extensions[this.name]={},n[this.name]=!0,t.pbrMetallicRoughness.metallicFactor=0,t.pbrMetallicRoughness.roughnessFactor=.9}},Ss=class{constructor(e){this.writer=e,this.name=`KHR_materials_clearcoat`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.clearcoat===0)return;let n=this.writer,r=n.extensionsUsed,i={};if(i.clearcoatFactor=e.clearcoat,e.clearcoatMap){let t={index:await n.processTextureAsync(e.clearcoatMap),texCoord:e.clearcoatMap.channel};n.applyTextureTransform(t,e.clearcoatMap),i.clearcoatTexture=t}if(i.clearcoatRoughnessFactor=e.clearcoatRoughness,e.clearcoatRoughnessMap){let t={index:await n.processTextureAsync(e.clearcoatRoughnessMap),texCoord:e.clearcoatRoughnessMap.channel};n.applyTextureTransform(t,e.clearcoatRoughnessMap),i.clearcoatRoughnessTexture=t}if(e.clearcoatNormalMap){let t={index:await n.processTextureAsync(e.clearcoatNormalMap),texCoord:e.clearcoatNormalMap.channel};e.clearcoatNormalScale.x!==1&&(t.scale=e.clearcoatNormalScale.x),n.applyTextureTransform(t,e.clearcoatNormalMap),i.clearcoatNormalTexture=t}t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},Cs=class{constructor(e){this.writer=e,this.name=`KHR_materials_dispersion`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.dispersion===0)return;let n=this.writer.extensionsUsed,r={};r.dispersion=e.dispersion,t.extensions=t.extensions||{},t.extensions[this.name]=r,n[this.name]=!0}},ws=class{constructor(e){this.writer=e,this.name=`KHR_materials_iridescence`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.iridescence===0)return;let n=this.writer,r=n.extensionsUsed,i={};if(i.iridescenceFactor=e.iridescence,e.iridescenceMap){let t={index:await n.processTextureAsync(e.iridescenceMap),texCoord:e.iridescenceMap.channel};n.applyTextureTransform(t,e.iridescenceMap),i.iridescenceTexture=t}if(i.iridescenceIor=e.iridescenceIOR,i.iridescenceThicknessMinimum=e.iridescenceThicknessRange[0],i.iridescenceThicknessMaximum=e.iridescenceThicknessRange[1],e.iridescenceThicknessMap){let t={index:await n.processTextureAsync(e.iridescenceThicknessMap),texCoord:e.iridescenceThicknessMap.channel};n.applyTextureTransform(t,e.iridescenceThicknessMap),i.iridescenceThicknessTexture=t}t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},Ts=class{constructor(e){this.writer=e,this.name=`KHR_materials_transmission`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.transmission===0)return;let n=this.writer,r=n.extensionsUsed,i={};if(i.transmissionFactor=e.transmission,e.transmissionMap){let t={index:await n.processTextureAsync(e.transmissionMap),texCoord:e.transmissionMap.channel};n.applyTextureTransform(t,e.transmissionMap),i.transmissionTexture=t}t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},Es=class{constructor(e){this.writer=e,this.name=`KHR_materials_volume`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.transmission===0)return;let n=this.writer,r=n.extensionsUsed,i={};if(i.thicknessFactor=e.thickness,e.thicknessMap){let t={index:await n.processTextureAsync(e.thicknessMap),texCoord:e.thicknessMap.channel};n.applyTextureTransform(t,e.thicknessMap),i.thicknessTexture=t}e.attenuationDistance!==1/0&&(i.attenuationDistance=e.attenuationDistance),i.attenuationColor=e.attenuationColor.toArray(),t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},Ds=class{constructor(e){this.writer=e,this.name=`KHR_materials_ior`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.ior===1.5)return;let n=this.writer.extensionsUsed,r={};r.ior=e.ior,t.extensions=t.extensions||{},t.extensions[this.name]=r,n[this.name]=!0}},Os=class{constructor(e){this.writer=e,this.name=`KHR_materials_specular`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.specularIntensity===1&&e.specularColor.equals(is)&&!e.specularIntensityMap&&!e.specularColorMap)return;let n=this.writer,r=n.extensionsUsed,i={};if(e.specularIntensityMap){let t={index:await n.processTextureAsync(e.specularIntensityMap),texCoord:e.specularIntensityMap.channel};n.applyTextureTransform(t,e.specularIntensityMap),i.specularTexture=t}if(e.specularColorMap){let t={index:await n.processTextureAsync(e.specularColorMap),texCoord:e.specularColorMap.channel};n.applyTextureTransform(t,e.specularColorMap),i.specularColorTexture=t}i.specularFactor=e.specularIntensity,i.specularColorFactor=e.specularColor.toArray(),t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},ks=class{constructor(e){this.writer=e,this.name=`KHR_materials_sheen`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.sheen==0)return;let n=this.writer,r=n.extensionsUsed,i={};if(e.sheenRoughnessMap){let t={index:await n.processTextureAsync(e.sheenRoughnessMap),texCoord:e.sheenRoughnessMap.channel};n.applyTextureTransform(t,e.sheenRoughnessMap),i.sheenRoughnessTexture=t}if(e.sheenColorMap){let t={index:await n.processTextureAsync(e.sheenColorMap),texCoord:e.sheenColorMap.channel};n.applyTextureTransform(t,e.sheenColorMap),i.sheenColorTexture=t}i.sheenRoughnessFactor=e.sheenRoughness,i.sheenColorFactor=e.sheenColor.toArray(),t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},As=class{constructor(e){this.writer=e,this.name=`KHR_materials_anisotropy`}async writeMaterialAsync(e,t){if(!e.isMeshPhysicalMaterial||e.anisotropy==0)return;let n=this.writer,r=n.extensionsUsed,i={};if(e.anisotropyMap){let t={index:await n.processTextureAsync(e.anisotropyMap)};n.applyTextureTransform(t,e.anisotropyMap),i.anisotropyTexture=t}i.anisotropyStrength=e.anisotropy,i.anisotropyRotation=e.anisotropyRotation,t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},js=class{constructor(e){this.writer=e,this.name=`KHR_materials_emissive_strength`}async writeMaterialAsync(e,t){if(!e.isMeshStandardMaterial||e.emissiveIntensity===1)return;let n=this.writer.extensionsUsed,r={};r.emissiveStrength=e.emissiveIntensity,t.extensions=t.extensions||{},t.extensions[this.name]=r,n[this.name]=!0}},Ms=class{constructor(e){this.writer=e,this.name=`EXT_materials_bump`}async writeMaterialAsync(e,t){if(!e.isMeshStandardMaterial||e.bumpScale===1&&!e.bumpMap)return;let n=this.writer,r=n.extensionsUsed,i={};if(e.bumpMap){let t={index:await n.processTextureAsync(e.bumpMap),texCoord:e.bumpMap.channel};n.applyTextureTransform(t,e.bumpMap),i.bumpTexture=t}i.bumpFactor=e.bumpScale,t.extensions=t.extensions||{},t.extensions[this.name]=i,r[this.name]=!0}},Ns=class{constructor(e){this.writer=e,this.name=`EXT_mesh_gpu_instancing`}writeNode(e,t){if(!e.isInstancedMesh)return;let n=this.writer,r=e,i=new Float32Array(r.count*3),a=new Float32Array(r.count*4),o=new Float32Array(r.count*3),s=new Ye,c=new S,l=new p,u=new S;for(let e=0;e<r.count;e++)r.getMatrixAt(e,s),s.decompose(c,l,u),c.toArray(i,e*3),l.toArray(a,e*4),u.toArray(o,e*3);let d={TRANSLATION:n.processAccessor(new Ne(i,3)),ROTATION:n.processAccessor(new Ne(a,4)),SCALE:n.processAccessor(new Ne(o,3))};r.instanceColor&&(d._COLOR_0=n.processAccessor(r.instanceColor)),t.extensions=t.extensions||{},t.extensions[this.name]={attributes:d},n.extensionsUsed[this.name]=!0,n.extensionsRequired[this.name]=!0}};es.Utils={insertKeyframe:function(e,t){let n=.001,r=e.getValueSize(),i=new e.TimeBufferType(e.times.length+1),a=new e.ValueBufferType(e.values.length+r),o=e.createInterpolant(new e.ValueBufferType(r)),s;if(e.times.length===0){i[0]=t;for(let e=0;e<r;e++)a[e]=0;s=0}else if(t<e.times[0]){if(Math.abs(e.times[0]-t)<n)return 0;i[0]=t,i.set(e.times,1),a.set(o.evaluate(t),0),a.set(e.values,r),s=0}else if(t>e.times[e.times.length-1]){if(Math.abs(e.times[e.times.length-1]-t)<n)return e.times.length-1;i[i.length-1]=t,i.set(e.times,0),a.set(e.values,0),a.set(o.evaluate(t),e.values.length),s=i.length-1}else for(let c=0;c<e.times.length;c++){if(Math.abs(e.times[c]-t)<n)return c;if(e.times[c]<t&&e.times[c+1]>t){i.set(e.times.slice(0,c+1),0),i[c+1]=t,i.set(e.times.slice(c+1),c+2),a.set(e.values.slice(0,(c+1)*r),0),a.set(o.evaluate(t),(c+1)*r),a.set(e.values.slice((c+1)*r),(c+2)*r),s=c+1;break}}return e.times=i,e.values=a,s},mergeMorphTargetTracks:function(e,t){let n=[],r={},i=e.tracks;for(let e=0;e<i.length;++e){let a=i[e],o=de.parseTrackName(a.name),s=de.findNode(t,o.nodeName);if(o.propertyName!==`morphTargetInfluences`||o.propertyIndex===void 0){n.push(a);continue}if(a.createInterpolant!==a.InterpolantFactoryMethodDiscrete&&a.createInterpolant!==a.InterpolantFactoryMethodLinear){if(a.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline)throw Error(`THREE.GLTFExporter: Cannot merge tracks with glTF CUBICSPLINE interpolation.`);console.warn(`THREE.GLTFExporter: Morph target interpolation mode not yet supported. Using LINEAR instead.`),a=a.clone(),a.setInterpolation(g)}let c=s.morphTargetInfluences.length,l=s.morphTargetDictionary[o.propertyIndex];if(l===void 0)throw Error(`THREE.GLTFExporter: Morph target name not found: `+o.propertyIndex);let u;if(r[s.uuid]===void 0){u=a.clone();let e=new u.ValueBufferType(c*u.times.length);for(let t=0;t<u.times.length;t++)e[t*c+l]=u.values[t];u.name=(o.nodeName||``)+`.morphTargetInfluences`,u.values=e,r[s.uuid]=u,n.push(u);continue}let d=a.createInterpolant(new a.ValueBufferType(1));u=r[s.uuid];for(let e=0;e<u.times.length;e++)u.values[e*c+l]=d.evaluate(u.times[e]);for(let e=0;e<a.times.length;e++){let t=this.insertKeyframe(u,a.times[e]);u.values[t*c+l]=a.values[e]}}return e.tracks=n,e},toTypedBufferAttribute:function(e,t){let n=new Ne(new t(e.count*e.itemSize),e.itemSize,!1);if(!e.normalized&&!e.isInterleavedBufferAttribute)return n.array.set(e.array),n;for(let t=0,r=e.count;t<r;t++)for(let r=0;r<e.itemSize;r++)n.setComponent(t,r,e.getComponent(t,r));return n}};var Ps,Fs,Is,Ls;function Rs(e,t=1/0,n=null){Fs||=new c(2,2,1,1),Is||=new Ct({uniforms:{blitTexture:new E(e)},vertexShader:`
			varying vec2 vUv;
			void main(){
				vUv = uv;
				gl_Position = vec4(position.xy * 1.0,0.,.999999);
			}`,fragmentShader:`
			uniform sampler2D blitTexture; 
			varying vec2 vUv;

			void main(){ 
				gl_FragColor = vec4(vUv.xy, 0, 1);
				
				#ifdef IS_SRGB
				gl_FragColor = sRGBTransferOETF( texture2D( blitTexture, vUv) );
				#else
				gl_FragColor = texture2D( blitTexture, vUv);
				#endif
			}`}),Is.uniforms.blitTexture.value=e,Is.defines.IS_SRGB=e.colorSpace==Et,Is.needsUpdate=!0,Ls||(Ls=new U(Fs,Is),Ls.frustumCulled=!1);let r=new Dt,i=new s;i.add(Ls),n===null&&(n=Ps=new so({antialias:!1}));let a=Math.min(e.image.width,t),o=Math.min(e.image.height,t);n.setSize(a,o),n.clear(),n.render(i,r);let l=document.createElement(`canvas`),u=l.getContext(`2d`);l.width=a,l.height=o,u.drawImage(n.domElement,0,0,a,o);let d=new Le(l);return d.minFilter=e.minFilter,d.magFilter=e.magFilter,d.wrapS=e.wrapS,d.wrapT=e.wrapT,d.colorSpace=e.colorSpace,d.name=e.name,Ps&&=(Ps.forceContextLoss(),Ps.dispose(),null),d}var zs=e=>e.material!==void 0&&e.userData&&e.userData.variantMaterials&&!!Array.from(e.userData.variantMaterials.values()).filter(e=>Bs(e.material)),Bs=e=>e&&e.isMaterial&&!Array.isArray(e),Vs=class{constructor(e){this.writer=e,this.name=`KHR_materials_variants`,this.variantNames=[]}beforeParse(e){let t=new Set,n=e=>{if(!zs(e))return;let n=e.userData.variantMaterials,r=e.userData.variantData;for(let[e,i]of r){let r=n.get(i.index);r&&Bs(r.material)&&t.add(e)}};if(Array.isArray(e))for(let t of e)t.traverse(n);else e.traverse(n);t.forEach(e=>this.variantNames.push(e))}async writeMesh(e,t){if(!zs(e))return;let n=e.userData,r=n.variantMaterials,i=n.variantData,a=new Map,o=new Map,s=Array.from(i.values()).sort((e,t)=>e.index-t.index);for(let[e,t]of s.entries())o.set(t.index,e);for(let e of i.values()){let t=r.get(e.index);if(!t||!Bs(t.material))continue;let n=await this.writer.processMaterialAsync(t.material);a.has(n)||a.set(n,{material:n,variants:[]}),a.get(n).variants.push(o.get(e.index))}let c=Array.from(a.values()).map((e=>e.variants.sort((e,t)=>e-t)&&e)).sort((e,t)=>e.material-t.material);if(c.length===0)return;let l=Bs(n.originalMaterial)?await this.writer.processMaterialAsync(n.originalMaterial):-1;for(let e of t.primitives)l>=0&&(e.material=l),e.extensions=e.extensions||{},e.extensions[this.name]={mappings:c}}afterParse(){if(this.variantNames.length===0)return;let e=this.writer.json;e.extensions=e.extensions||{};let t=this.variantNames.map(e=>({name:e}));e.extensions[this.name]={variants:t},this.writer.extensionsUsed[this.name]=!0}},Hs=class{constructor(e,t,n,r,i){this.xrLight=e,this.renderer=t,this.lightProbe=n,this.xrWebGLBinding=null,this.estimationStartCallback=i,this.frameCallback=this.onXRFrame.bind(this);let a=t.xr.getSession();if(r&&`XRWebGLBinding`in window){e.environment=new wr(16).texture;let n=t.getContext();switch(a.preferredReflectionFormat){case`srgba8`:n.getExtension(`EXT_sRGB`);break;case`rgba16f`:n.getExtension(`OES_texture_half_float`)}this.xrWebGLBinding=new XRWebGLBinding(a,n),this.lightProbe.addEventListener(`reflectionchange`,()=>{this.updateReflection()})}a.requestAnimationFrame(this.frameCallback)}updateReflection(){let e=this.renderer.properties.get(this.xrLight.environment);if(e){let t=this.xrWebGLBinding.getReflectionCubeMap(this.lightProbe);t&&(e.__webglTexture=t,this.xrLight.environment.needsPMREMUpdate=!0)}}onXRFrame(e,t){if(!this.xrLight)return;t.session.requestAnimationFrame(this.frameCallback);let n=t.getLightEstimate(this.lightProbe);if(n){this.xrLight.lightProbe.sh.fromArray(n.sphericalHarmonicsCoefficients),this.xrLight.lightProbe.intensity=1;let e=Math.max(1,Math.max(n.primaryLightIntensity.x,Math.max(n.primaryLightIntensity.y,n.primaryLightIntensity.z)));this.xrLight.directionalLight.color.setRGB(n.primaryLightIntensity.x/e,n.primaryLightIntensity.y/e,n.primaryLightIntensity.z/e),this.xrLight.directionalLight.intensity=e,this.xrLight.directionalLight.position.copy(n.primaryLightDirection),this.estimationStartCallback&&=(this.estimationStartCallback(),null)}}dispose(){this.xrLight=null,this.renderer=null,this.lightProbe=null,this.xrWebGLBinding=null}},Us=class extends a{constructor(e,t=!0){super(),this.lightProbe=new st,this.lightProbe.intensity=0,this.add(this.lightProbe),this.directionalLight=new He,this.directionalLight.intensity=0,this.add(this.directionalLight),this.environment=null;let n=null,r=!1;e.xr.addEventListener(`sessionstart`,()=>{let i=e.xr.getSession();`requestLightProbe`in i&&i.requestLightProbe({reflectionFormat:i.preferredReflectionFormat}).then(i=>{n=new Hs(this,e,i,t,()=>{r=!0,this.dispatchEvent({type:`estimationstart`})})})}),e.xr.addEventListener(`sessionend`,()=>{n&&=(n.dispose(),null),r&&this.dispatchEvent({type:`estimationend`})}),this.dispose=()=>{n&&=(n.dispose(),null),this.remove(this.lightProbe),this.lightProbe=null,this.remove(this.directionalLight),this.directionalLight=null,this.environment=null}}},Ws=1e4,Gs=.001,Ks=class{constructor(e=50){this.velocity=0,this.naturalFrequency=0,this.setDecayTime(e)}setDecayTime(e){this.naturalFrequency=1/Math.max(Gs,e)}update(e,t,n,r){let i=2e-4*this.naturalFrequency;if(e==null||r===0||e===t&&this.velocity===0)return t;if(n<0)return e;let a=e-t,o=this.velocity+this.naturalFrequency*a,s=a+n*o,c=Math.exp(-this.naturalFrequency*n),l=(o-this.naturalFrequency*s)*c,u=-this.naturalFrequency*(l+o*c);return Math.abs(l)<i*Math.abs(r)&&u*a>=0?(this.velocity=0,t):(this.velocity=l,t+s*c)}},J={MIN_TOUCH_AREA:.05,BASE_RADIUS:.15,LINE_WIDTH:.02,SEGMENTS:16,DELTA_PHI:Math.PI/32,COLORS:{EDGE_FALLOFF:new I(.98,.98,.98),EDGE_CUTOFF:new I(.8,.8,.8),FILL_FALLOFF:new I(.4,.4,.4),FILL_CUTOFF:new I(.4,.4,.4),ACTIVE_EDGE:new I(1,1,1),ACTIVE_FILL:new I(.6,.6,.6)},MAX_OPACITY:.75,ACTIVE_OPACITY:.9,FILL_OPACITY_MULTIPLIER:.5,INTERACTIVE_OPACITY_MULTIPLIER:1.2,MIN_DISTANCE:.5,MAX_DISTANCE:10,BASE_SCALE:1,DISTANCE_SCALE_FACTOR:.3,FADE_IN_DURATION:.12,FADE_OUT_DURATION:.12,SIZE_UPDATE_DURATION:.05,COLOR_LERP_FACTOR:.15,SCREEN_SPACE_SCALE:1.2,SIZE_UPDATE_THRESHOLD:.001,GEOMETRY_UPDATE_DEBOUNCE:100},qs=new ct,Js=(e,t,n,r,i)=>{let a=t>0?n>0?0:-Math.PI/2:n>0?Math.PI/2:Math.PI;for(let o=0;o<=J.SEGMENTS;++o)e.push(t+(r-i)*Math.cos(a),n+(r-i)*Math.sin(a),0,t+r*Math.cos(a),n+r*Math.sin(a),0),a+=J.DELTA_PHI},Ys=class extends U{constructor(e,t){let n=new at;super(n),this.shadowHeight=0,this.isActive=!1,this.isHovered=!1,this.lastGeometryUpdateTime=0,this.needsGeometryUpdate=!1,this.scene=e,this.side=t,this.currentSize=new S,this.goalSize=new S,this.sizeDamper=new Ks,this.updateSizeFromScene(),this.edgeMaterial=new z({color:J.COLORS.EDGE_FALLOFF,transparent:!0,opacity:0,side:2,depthWrite:!1,blending:2}),this.fillMaterial=new z({color:J.COLORS.FILL_FALLOFF,transparent:!0,opacity:0,side:2,depthWrite:!1,blending:1}),this.material=this.edgeMaterial,this.goalOpacity=0,this.opacityDamper=new Ks,this.createHitMeshes(),this.updatePositionFromScene(),e.target.add(this),e.target.add(this.hitBox),this.offsetHeight=0}updateSizeFromScene(){let{size:e}=this.scene;this.goalSize.copy(e);let t=Math.sqrt(e.x*e.x+e.z*e.z),n=Math.max(J.MIN_TOUCH_AREA,t*.4);this.goalSize.x<n&&(this.goalSize.x=n),this.goalSize.z<n&&(this.goalSize.z=n),this.updateGeometry()}updateGeometry(){let e=this.geometry,t=[],n=[],r=this.goalSize.x/2,i=(this.side===`back`?this.goalSize.y:this.goalSize.z)/2,a=Math.min(r,i),o=Math.max(J.BASE_RADIUS*.7,a*.2),s=Math.max(J.LINE_WIDTH*.7,a*.025);Js(n,r,i,o,s),Js(n,-r,i,o,s),Js(n,-r,-i,o,s),Js(n,r,-i,o,s);let c=n.length/3;for(let e=0;e<c-2;e+=2)t.push(e,e+1,e+3,e,e+3,e+2);let l=c-2;t.push(l,l+1,1,l,1,0),e.setAttribute(`position`,new y(n,3)),e.setIndex(t),e.computeBoundingSphere()}createHitMeshes(){let e=this.goalSize.x/2,t=(this.side===`back`?this.goalSize.y:this.goalSize.z)/2,n=Math.min(e,t),r=Math.max(J.BASE_RADIUS*.7,n*.2);this.hitPlane=new U(new c(2*(e+r),2*(t+r))),this.hitPlane.visible=!1,this.hitPlane.material.side=2,this.add(this.hitPlane),this.hitBox=new U(new R(this.goalSize.x+2*r,this.goalSize.y+r,this.goalSize.z+2*r)),this.hitBox.visible=!1,this.hitBox.material.side=2,this.add(this.hitBox)}updatePositionFromScene(){let{boundingBox:e}=this.scene;switch(e.getCenter(this.position),this.rotation.set(0,0,0),this.side){case`bottom`:this.rotateX(-Math.PI/2),this.shadowHeight=e.min.y,this.position.y=this.shadowHeight;break;case`back`:this.shadowHeight=e.min.z,this.position.z=this.shadowHeight}if(this.hitBox){let t=(this.side,(this.goalSize.y+J.BASE_RADIUS)/2);this.hitBox.position.y=t+e.min.y}}updateFromModelChanges(){this.updateSizeFromScene(),this.updatePositionFromScene(),this.updateGeometry(),this.updateHitMeshes(),this.ensureProperOrientation(),this.needsGeometryUpdate=!1,this.lastGeometryUpdateTime=performance.now()}ensureProperOrientation(){this.side===`bottom`?(this.rotation.x=-Math.PI/2,this.rotation.y=0,this.rotation.z=0):this.side===`back`&&(this.rotation.x=0,this.rotation.y=0,this.rotation.z=0)}setScreenSpaceMode(e){e?this.scale.set(J.SCREEN_SPACE_SCALE,J.SCREEN_SPACE_SCALE,J.SCREEN_SPACE_SCALE):this.scale.set(1,1,1)}updateHitMeshes(){if(this.hitPlane&&this.hitBox){let e=this.goalSize.x/2,t=(this.side===`back`?this.goalSize.y:this.goalSize.z)/2,n=Math.min(e,t),r=Math.max(J.BASE_RADIUS*.7,n*.2),i=new c(2*(e+r),2*(t+r));this.hitPlane.geometry.dispose(),this.hitPlane.geometry=i;let a=new R(this.goalSize.x+2*r,this.goalSize.y+r,this.goalSize.z+2*r);this.hitBox.geometry.dispose(),this.hitBox.geometry=a}}setInteractionState(e,t=!1){this.isActive=e,this.isHovered=t,this.updateVisualState()}updateVisualState(){let e,t;this.isActive?(e=J.COLORS.ACTIVE_EDGE,t=J.COLORS.ACTIVE_FILL):this.isHovered?(e=J.COLORS.EDGE_FALLOFF,t=J.COLORS.FILL_FALLOFF):(e=J.COLORS.EDGE_CUTOFF,t=J.COLORS.FILL_CUTOFF),this.edgeMaterial.color.lerp(e,J.COLOR_LERP_FACTOR),this.fillMaterial.color.lerp(t,J.COLOR_LERP_FACTOR)}applyDistanceScaling(e){let t=e.distanceTo(this.position),n=Math.max(J.MIN_DISTANCE,Math.min(J.MAX_DISTANCE,t)),r=J.BASE_SCALE+(n-J.MIN_DISTANCE)*J.DISTANCE_SCALE_FACTOR;this.scale.set(r,r,r)}getHit(e,t,n){qs.set(t,-n),this.hitPlane.visible=!0;let r=e.positionAndNormalFromPoint(qs,this.hitPlane);return this.hitPlane.visible=!1,r==null?null:r.position}getExpandedHit(e,t,n){this.hitPlane.scale.set(1e3,1e3,1e3),this.hitPlane.updateMatrixWorld();let r=this.getHit(e,t,n);return this.hitPlane.scale.set(1,1,1),r}controllerIntersection(e,t){this.hitBox.visible=!0;let n=e.hitFromController(t,this.hitBox);return this.hitBox.visible=!1,n}set offsetHeight(e){e-=.001,this.side===`back`?this.position.z=this.shadowHeight+e:this.position.y=this.shadowHeight+e}get offsetHeight(){return this.side===`back`?this.position.z-this.shadowHeight:this.position.y-this.shadowHeight}set show(e){this.goalOpacity=e?J.MAX_OPACITY:0}updateOpacity(e){let t=this.material,n=this.opacityDamper.update(t.opacity,this.goalOpacity,e,1);this.edgeMaterial.opacity=n,this.fillMaterial.opacity=n*J.FILL_OPACITY_MULTIPLIER,(this.isActive||this.isHovered)&&(this.edgeMaterial.opacity=n*J.INTERACTIVE_OPACITY_MULTIPLIER),this.visible=n>0}update(e,t){if(this.updateOpacity(e),!this.currentSize.equals(this.goalSize)){let t=new S;t.x=this.sizeDamper.update(this.currentSize.x,this.goalSize.x,e,1),t.y=this.sizeDamper.update(this.currentSize.y,this.goalSize.y,e,1),t.z=this.sizeDamper.update(this.currentSize.z,this.goalSize.z,e,1),t.distanceTo(this.currentSize)>J.SIZE_UPDATE_THRESHOLD&&(this.currentSize.copy(t),this.needsGeometryUpdate=!0)}let n=performance.now();this.needsGeometryUpdate&&n-this.lastGeometryUpdateTime>J.GEOMETRY_UPDATE_DEBOUNCE&&(this.updateGeometry(),this.updateHitMeshes(),this.needsGeometryUpdate=!1,this.lastGeometryUpdateTime=n),t&&this.applyDistanceScaling(t),this.updateVisualState()}getSize(){return this.goalSize.clone()}dispose(){let{geometry:e,material:t}=this.hitPlane;e.dispose(),t.dispose(),this.hitBox.geometry.dispose(),this.hitBox.material.dispose(),this.geometry.dispose(),this.edgeMaterial.dispose(),this.fillMaterial.dispose(),this.hitBox.removeFromParent(),this.removeFromParent()}},Xs=(e,t)=>({type:`number`,number:e,unit:t}),Zs=(()=>{let e={};return t=>{let n=t;if(n in e)return e[n];let r=[],i=0;for(;t;){if(++i>1e3){t=``;break}let e=Qs(t),n=e.nodes[0];if(n==null||n.terms.length===0)break;r.push(n),t=e.remainingInput}return e[n]=r}})(),Qs=(()=>{let e=/^(\-\-|[a-z\u0240-\uffff])/i,t=/^([\*\+\/]|[\-]\s)/i,n=/^[\),]/;return r=>{let i=[];for(;r.length&&(r=r.trim(),!n.test(r));)if(r[0]===`(`){let{nodes:e,remainingInput:t}=nc(r);r=t,i.push({type:`function`,name:{type:`ident`,value:`calc`},arguments:e})}else if(e.test(r)){let e=$s(r),t=e.nodes[0];if(r=e.remainingInput,r[0]===`(`){let{nodes:e,remainingInput:n}=nc(r);i.push({type:`function`,name:t,arguments:e}),r=n}else i.push(t)}else if(t.test(r))i.push({type:`operator`,value:r[0]}),r=r.slice(1);else{let{nodes:e,remainingInput:t}=r[0]===`#`?tc(r):ec(r);if(e.length===0)break;i.push(e[0]),r=t}return{nodes:[{type:`expression`,terms:i}],remainingInput:r}}})(),$s=(()=>{let e=/[^a-z0-9_\-\u0240-\uffff]/i;return t=>{let n=t.match(e),r=n==null?t:t.substr(0,n.index),i=n==null?``:t.substr(n.index);return{nodes:[{type:`ident`,value:r}],remainingInput:i}}})(),ec=(()=>{let e=/[\+\-]?(\d+[\.]\d+|\d+|[\.]\d+)([eE][\+\-]?\d+)?/,t=/^[a-z%]+/i,n=/^(m|mm|cm|rad|deg|[%])$/;return r=>{let i=r.match(e),a=i==null?`0`:i[0];r=a==null?r:r.slice(a.length);let o=r.match(t),s=o!=null&&o[0]!==``?o[0]:null,c=o==null?r:r.slice(s.length);return s!=null&&!n.test(s)&&(s=null),{nodes:[{type:`number`,number:parseFloat(a)||0,unit:s}],remainingInput:c}}})(),tc=(()=>{let e=/^[a-f0-9]*/i;return t=>{t=t.slice(1).trim();let n=t.match(e);return{nodes:n==null?[]:[{type:`hex`,value:n[0]}],remainingInput:n==null?t:t.slice(n[0].length)}}})(),nc=e=>{let t=[];for(e=e.slice(1).trim();e.length;){let n=Qs(e);if(t.push(n.nodes[0]),e=n.remainingInput.trim(),e[0]===`,`)e=e.slice(1).trim();else if(e[0]===`)`){e=e.slice(1);break}}return{nodes:t,remainingInput:e}},rc=Symbol(`visitedTypes`),ic=class{constructor(e){this[rc]=e}walk(e,t){let n=e.slice();for(;n.length;){let e=n.shift();switch(this[rc].indexOf(e.type)>-1&&t(e),e.type){case`expression`:n.unshift(...e.terms);break;case`function`:n.unshift(e.name,...e.arguments)}}}},ac=Object.freeze({type:`number`,number:0,unit:null}),oc=(e,t=0)=>{let{number:n,unit:r}=e;if(!isFinite(n))n=t,r=`rad`;else if(e.unit===`rad`||e.unit==null)return e;return{type:`number`,number:(r===`deg`&&n!=null?n:0)*Math.PI/180,unit:`rad`}},sc=(e,t=0)=>{let{number:n,unit:r}=e;if(!isFinite(n))n=t,r=`m`;else if(e.unit===`m`)return e;let i;switch(r){default:i=1;break;case`cm`:i=1/100;break;case`mm`:i=1/1e3}return{type:`number`,number:i*n,unit:`m`}},cc=(()=>{let e=e=>e,t={rad:e,deg:oc,m:e,mm:sc,cm:sc};return(e,n=ac)=>{isFinite(e.number)||(e.number=n.number,e.unit=n.unit);let{unit:r}=e;if(r==null)return e;let i=t[r];return i==null?n:i(e)}})(),lc,uc,dc,fc=Symbol(`evaluate`),pc=Symbol(`lastValue`),mc=class e{constructor(){this[lc]=null}static evaluatableFor(t,n=ac){if(t instanceof e)return t;if(t.type===`number`)return t.unit===`%`?new _c(t,n):t;switch(t.name.value){case`calc`:return new Sc(t,n);case`env`:return new yc(t)}return ac}static evaluate(t){return t instanceof e?t.evaluate():t}static isConstant(t){return t instanceof e?t.isConstant:!0}static applyIntrinsics(e,t){let{basis:n,keywords:r}=t,{auto:i}=r;return n.map((t,n)=>{let a=i[n]==null?t:i[n],o=e[n]?e[n]:a;if(o.type===`ident`){let e=o.value;e in r&&(o=r[e][n])}return(o==null||o.type===`ident`)&&(o=a),o.unit===`%`?Xs(o.number/100*t.number,t.unit):(o=cc(o,t),o.unit===t.unit?o:t)})}get isConstant(){return!1}evaluate(){return(!this.isConstant||this[pc]==null)&&(this[pc]=this[fc]()),this[pc]}};lc=pc;var hc=Symbol(`percentage`),gc=Symbol(`basis`),_c=class extends mc{constructor(e,t){super(),this[hc]=e,this[gc]=t}get isConstant(){return!0}[fc](){return Xs(this[hc].number/100*this[gc].number,this[gc].unit)}},vc=Symbol(`identNode`),yc=class extends mc{constructor(e){super(),this[uc]=null;let t=e.arguments.length?e.arguments[0].terms[0]:null;t!=null&&t.type===`ident`&&(this[vc]=t)}get isConstant(){return!1}[(uc=vc,fc)](){if(this[vc]!=null)switch(this[vc].value){case`window-scroll-y`:return{type:`number`,number:window.pageYOffset/(Math.max(document.body.scrollHeight,document.body.offsetHeight,document.documentElement.clientHeight,document.documentElement.scrollHeight,document.documentElement.offsetHeight)-window.innerHeight)||0,unit:null}}return ac}},bc=/[\*\/]/,xc=Symbol(`evaluator`),Sc=class extends mc{constructor(e,t=ac){if(super(),this[dc]=null,e.arguments.length!==1)return;let n=e.arguments[0].terms.slice(),r=[];for(;n.length;){let e=n.shift();if(r.length>0){let n=r[r.length-1];if(n.type===`operator`&&bc.test(n.value)){let n=r.pop(),i=r.pop();if(i==null)return;r.push(new Ec(n,mc.evaluatableFor(i,t),mc.evaluatableFor(e,t)));continue}}r.push(e.type===`operator`?e:mc.evaluatableFor(e,t))}for(;r.length>2;){let[e,n,i]=r.splice(0,3);if(n.type!==`operator`)return;r.unshift(new Ec(n,mc.evaluatableFor(e,t),mc.evaluatableFor(i,t)))}r.length===1&&(this[xc]=r[0])}get isConstant(){return this[xc]==null||mc.isConstant(this[xc])}[(dc=xc,fc)](){return this[xc]==null?ac:mc.evaluate(this[xc])}},Cc=Symbol(`operator`),wc=Symbol(`left`),Tc=Symbol(`right`),Ec=class extends mc{constructor(e,t,n){super(),this[Cc]=e,this[wc]=t,this[Tc]=n}get isConstant(){return mc.isConstant(this[wc])&&mc.isConstant(this[Tc])}[fc](){let e=cc(mc.evaluate(this[wc])),t=cc(mc.evaluate(this[Tc])),{number:n,unit:r}=e,{number:i,unit:a}=t;if(a!=null&&r!=null&&a!=r)return ac;let o=r||a,s;switch(this[Cc].value){case`+`:s=n+i;break;case`-`:s=n-i;break;case`/`:s=n/i;break;case`*`:s=n*i;break;default:return ac}return{type:`number`,number:s,unit:o}}},Dc=Symbol(`evaluatables`),Oc=Symbol(`intrinsics`),kc=class extends mc{constructor(e,t){super(),this[Oc]=t;let n=e[0],r=n==null?[]:n.terms;this[Dc]=t.basis.map((e,t)=>{let n=r[t];return n==null?{type:`ident`,value:`auto`}:n.type===`ident`?n:mc.evaluatableFor(n,e)})}get isConstant(){for(let e of this[Dc])if(!mc.isConstant(e))return!1;return!0}[fc](){let e=this[Dc].map(e=>mc.evaluate(e));return mc.applyIntrinsics(e,this[Oc]).map(e=>e.number)}},Ac,jc,Mc,Nc,Pc=Symbol(`instances`),Fc=Symbol(`activateListener`),Ic=Symbol(`deactivateListener`),Lc=Symbol(`notifyInstances`),Rc=Symbol(`notify`),zc=Symbol(`callback`),Bc=class e{static[Lc](){for(let t of e[Pc])t[Rc]()}static[(Ac=Pc,Fc)](){window.addEventListener(`scroll`,this[Lc],{passive:!0})}static[Ic](){window.removeEventListener(`scroll`,this[Lc])}constructor(e){this[zc]=e}observe(){e[Pc].size===0&&e[Fc](),e[Pc].add(this)}disconnect(){e[Pc].delete(this),e[Pc].size===0&&e[Ic]()}[Rc](){this[zc]()}};Bc[Ac]=new Set;var Vc=Symbol(`computeStyleCallback`),Hc=Symbol(`astWalker`),Uc=Symbol(`dependencies`),Wc=Symbol(`onScroll`),Gc=class{constructor(e){this[jc]={},this[Mc]=new ic([`function`]),this[Nc]=()=>{this[Vc]({relatedState:`window-scroll`})},this[Vc]=e}observeEffectsFor(e){let t={},n=this[Uc];this[Hc].walk(e,e=>{let{name:r}=e,i=e.arguments[0].terms[0];if(r.value===`env`&&i!=null&&i.type===`ident`&&i.value===`window-scroll-y`&&t[`window-scroll`]==null){let e=`window-scroll`in n?n[`window-scroll`]:new Bc(this[Wc]);e.observe(),delete n[`window-scroll`],t[`window-scroll`]=e}});for(let e in n)n[e].disconnect();this[Uc]=t}dispose(){for(let e in this[Uc])this[Uc][e].disconnect()}};jc=Uc,Mc=Hc,Nc=Wc;var Kc=e=>{let t=e.observeEffects||!1,n=e.intrinsics instanceof Function?e.intrinsics:(()=>e.intrinsics);return(r,i)=>{let a=r.updated,o=r.connectedCallback,s=r.disconnectedCallback,c=Symbol(`${i}StyleEffector`),l=Symbol(`${i}StyleEvaluator`),u=Symbol(`${i}UpdateEvaluator`),d=Symbol(`${i}EvaluateAndSync`);Object.defineProperties(r,{[c]:{value:null,writable:!0},[l]:{value:null,writable:!0},[u]:{value:function(){let e=Zs(this[i]);this[l]=new kc(e,n(this)),this[c]==null&&t&&(this[c]=new Gc(()=>this[d]())),this[c]!=null&&this[c].observeEffectsFor(e)}},[d]:{value:function(){if(this[l]==null)return;let t=this[l].evaluate();this[e.updateHandler](t)}},updated:{value:function(e){e.has(i)&&(this[u](),this[d]()),a.call(this,e)}},connectedCallback:{value:function(){o.call(this),this.requestUpdate(i,this[i])}},disconnectedCallback:{value:function(){s.call(this),this[c]!=null&&(this[c].dispose(),this[c]=null)}}})}},qc=e=>e<.5?2*e*e:-1+(4-2*e)*e,Jc=(e,t,n=qc)=>r=>e+(t-e)*n(r),Yc=(e,t)=>{let n=t.map((e=>t=>e+=t)(0));return t=>{t=Do(t,0,1),t*=n[n.length-1];let r=n.findIndex(e=>e>=t),i=r<1?0:n[r-1],a=n[r];return e[r]((t-i)/(a-i))}},Xc=e=>{let t=[],n=[],r=e.initialValue;for(let i=0;i<e.keyframes.length;++i){let a=e.keyframes[i],{value:o,frames:s}=a,c=a.ease||qc,l=Jc(r,o,c);t.push(l),n.push(s),r=o}return Yc(t,n)},Zc=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Qc=5e3,$c=Xc({initialValue:0,keyframes:[{frames:5,value:-1},{frames:1,value:-1},{frames:8,value:1},{frames:1,value:1},{frames:5,value:0},{frames:18,value:0}]}),el=Xc({initialValue:0,keyframes:[{frames:1,value:1},{frames:5,value:1},{frames:1,value:0},{frames:6,value:0}]}),tl=`0deg 75deg 105%`,nl=`auto auto auto`,rl=`auto`,il=2.2,al=[`front`,`right`,`back`,`left`],ol=[`upper-`,``,`lower-`],sl=3e3,cl=`. Use mouse, touch or arrow keys to move.`,ll={AUTO:`auto`,NONE:`none`},ul={BASIC:`basic`,WIGGLE:`wiggle`},dl={PAN_Y:`pan-y`,PAN_X:`pan-x`,NONE:`none`},fl=()=>({basis:[oc(Xs(30,`deg`))],keywords:{auto:[null]}}),pl=()=>({basis:[oc(Xs(12,`deg`))],keywords:{auto:[null]}}),ml=(()=>{let e=Zs(tl)[0].terms,t=cc(e[0]),n=cc(e[1]);return e=>{let r=e[Q].idealCameraDistance();return{basis:[t,n,Xs(r,`m`)],keywords:{auto:[null,null,Xs(105,`%`)]}}}})(),hl=e=>{let t=il*e[Q].boundingSphere.radius;return{basis:[Xs(-1/0,`rad`),Xs(0,`rad`),Xs(t,`m`)],keywords:{auto:[null,null,null]}}},gl=e=>{let t=new kc([],ml(e)).evaluate()[2];return{basis:[Xs(1/0,`rad`),Xs(Math.PI,`rad`),Xs(t,`m`)],keywords:{auto:[null,null,null]}}},_l=e=>{e[Q].updateBoundingBoxAndShadowIfDirty();let t=e[Q].boundingBox.getCenter(new S);return{basis:[Xs(t.x,`m`),Xs(t.y,`m`),Xs(t.z,`m`)],keywords:{auto:[null,null,null]}}},vl=Math.PI/2,yl=Math.PI/3,bl=vl/2,xl=2*Math.PI,Sl=Symbol(`controls`),Cl=Symbol(`panElement`),wl=Symbol(`promptElement`),Tl=Symbol(`promptAnimatedContainer`),El=Symbol(`fingerAnimatedContainers`),Dl=Symbol(`deferInteractionPrompt`),Ol=Symbol(`updateAria`),kl=Symbol(`a11y`),Al=Symbol(`updateA11y`),jl=Symbol(`updateCameraForRadius`),Ml=Symbol(`cancelPrompts`),Nl=Symbol(`onChange`),Pl=Symbol(`onPointerChange`),Fl=Symbol(`waitingToPromptUser`),Il=Symbol(`userHasInteracted`),Ll=Symbol(`promptElementVisibleTime`),Rl=Symbol(`lastPromptOffset`),zl=Symbol(`cancellationSource`),Bl=Symbol(`lastSpherical`),Vl=Symbol(`jumpCamera`),Hl=Symbol(`initialized`),Ul=Symbol(`maintainThetaPhi`),Wl=Symbol(`syncCameraOrbit`),Gl=Symbol(`syncFieldOfView`),Kl=Symbol(`syncCameraTarget`),ql=Symbol(`syncMinCameraOrbit`),Jl=Symbol(`syncMaxCameraOrbit`),Yl=Symbol(`syncMinFieldOfView`),Xl=Symbol(`syncMaxFieldOfView`),Zl=e=>{var t,n,r,i,a,o,s,c,l,u,d,f,p,m,h,g,_,v;class y extends e{constructor(){super(...arguments),this.cameraControls=!1,this.cameraOrbit=tl,this.cameraTarget=nl,this.fieldOfView=rl,this.minCameraOrbit=`auto`,this.maxCameraOrbit=`auto`,this.minFieldOfView=`auto`,this.maxFieldOfView=`auto`,this.interactionPromptThreshold=sl,this.interactionPrompt=ll.AUTO,this.interactionPromptStyle=ul.WIGGLE,this.orbitSensitivity=1,this.zoomSensitivity=1,this.panSensitivity=1,this.touchAction=dl.NONE,this.disableZoom=!1,this.disablePan=!1,this.disableTap=!1,this.interpolationDecay=50,this.a11y=null,this[t]=this.shadowRoot.querySelector(`.interaction-prompt`),this[n]=this.shadowRoot.querySelector(`#prompt`),this[r]=[this.shadowRoot.querySelector(`#finger0`),this.shadowRoot.querySelector(`#finger1`)],this[i]=this.shadowRoot.querySelector(`.pan-target`),this[a]=0,this[o]=1/0,this[s]=!1,this[c]=!1,this[l]=su.AUTOMATIC,this[u]=new cu(this[Q].camera,this[Gm],this[Q]),this[d]=new Ue,this[f]=!1,this[p]=!1,this[m]=!1,this[h]={},this[g]=()=>{let e=this[Sl].changeSource;this[zl]=e,e===su.USER_INTERACTION&&(this[Il]=!0,this[Dl]())},this[_]=()=>{this[Ol](),this[qm]();let e=this[Sl].changeSource;this.dispatchEvent(new CustomEvent(`camera-change`,{detail:{source:e}}))},this[v]=e=>{this[Wm].classList.toggle(`pointer-tumbling`,e.type===`pointer-change-start`)}}get inputSensitivity(){return this[Sl].inputSensitivity}set inputSensitivity(e){this[Sl].inputSensitivity=e}getCameraOrbit(){let{theta:e,phi:t,radius:n}=this[Bl];return{theta:e,phi:t,radius:n,toString(){return`${this.theta}rad ${this.phi}rad ${this.radius}m`}}}getCameraTarget(){return th(this[$].isPresenting?this[$].arRenderer.target:this[Q].getDynamicTarget())}getFieldOfView(){return this[Sl].getFieldOfView()}getMinimumFieldOfView(){return this[Sl].options.minimumFieldOfView}getMaximumFieldOfView(){return this[Sl].options.maximumFieldOfView}getIdealAspect(){return this[Q].idealAspect}jumpCameraToGoal(){this[Vl]=!0,this.requestUpdate(Vl,!1)}resetInteractionPrompt(){this[Rl]=0,this[Ll]=1/0,this[Il]=!1,this[Fl]=this.interactionPrompt===ll.AUTO&&this.cameraControls}zoom(e){let t=new WheelEvent(`wheel`,{deltaY:-30*e});this[Gm].dispatchEvent(t)}connectedCallback(){super.connectedCallback(),this[Sl].addEventListener(`user-interaction`,this[Ml]),this[Sl].addEventListener(`pointer-change-start`,this[Pl]),this[Sl].addEventListener(`pointer-change-end`,this[Pl])}disconnectedCallback(){super.disconnectedCallback(),this[Sl].removeEventListener(`user-interaction`,this[Ml]),this[Sl].removeEventListener(`pointer-change-start`,this[Pl]),this[Sl].removeEventListener(`pointer-change-end`,this[Pl])}updated(e){super.updated(e);let t=this[Sl],n=this[Q];if(e.has(`cameraControls`)&&(this.cameraControls?(t.enableInteraction(),this.interactionPrompt===ll.AUTO&&(this[Fl]=!0)):(t.disableInteraction(),this[Dl]()),this[Gm].setAttribute(`aria-label`,this[Lm])),e.has(`disableZoom`)&&(t.disableZoom=this.disableZoom),e.has(`disablePan`)&&(t.enablePan=!this.disablePan),e.has(`disableTap`)&&(t.enableTap=!this.disableTap),(e.has(`interactionPrompt`)||e.has(`cameraControls`)||e.has(`src`))&&(this.interactionPrompt===ll.AUTO&&this.cameraControls&&!this[Il]?this[Fl]=!0:this[Dl]()),e.has(`interactionPromptStyle`)&&(this[Tl].style.opacity=this.interactionPromptStyle==ul.BASIC?`1`:`0`),e.has(`touchAction`)){let e=this.touchAction;t.applyOptions({touchAction:e}),t.updateTouchActionStyle()}e.has(`orbitSensitivity`)&&(t.orbitSensitivity=this.orbitSensitivity),e.has(`zoomSensitivity`)&&(t.zoomSensitivity=this.zoomSensitivity),e.has(`panSensitivity`)&&(t.panSensitivity=this.panSensitivity),e.has(`interpolationDecay`)&&(t.setDamperDecayTime(this.interpolationDecay),n.setTargetDamperDecayTime(this.interpolationDecay)),e.has(`a11y`)&&this[Al](),this[Vl]===!0&&Promise.resolve().then(()=>{t.jumpToGoal(),n.jumpToGoal(),this[Nl](),this[Vl]=!1})}async updateFraming(){let e=this[Q],t=e.adjustedFoV(e.framedFoVDeg);await e.updateFraming();let n=e.adjustedFoV(e.framedFoVDeg),r=this[Sl].getFieldOfView()/t;this[Sl].setFieldOfView(n*r),this[Ul]=!0,this.requestUpdate(`maxFieldOfView`),this.requestUpdate(`fieldOfView`),this.requestUpdate(`minCameraOrbit`),this.requestUpdate(`maxCameraOrbit`),this.requestUpdate(`cameraOrbit`),await this.updateComplete}interact(e,t,n){let r=this[Gm],i=this[El];if(i[0].style.opacity===`1`){console.warn(`interact() failed because an existing interaction is running.`);return}let a=[];a.push({x:Xc(t.x),y:Xc(t.y)});let o=[{x:a[0].x(0),y:a[0].y(0)}];n!=null&&(a.push({x:Xc(n.x),y:Xc(n.y)}),o.push({x:a[1].x(0),y:a[1].y(0)}));let s=performance.now(),{width:c,height:l}=this[Q],u=this.getBoundingClientRect(),d=e=>{for(let[t,n]of o.entries()){let{style:a}=i[t];a.transform=`translateX(${c*n.x}px) translateY(${l*n.y}px)`,e===`pointerdown`?a.opacity=`1`:e===`pointerup`&&(a.opacity=`0`);let o={pointerId:t-5678,pointerType:`touch`,target:r,clientX:c*n.x+u.x,clientY:l*n.y+u.y,altKey:!0};r.dispatchEvent(new PointerEvent(e,o))}},f=()=>{let t=this[zl];if(t!==su.AUTOMATIC||!r.isConnected){for(let e of this[El])e.style.opacity=`0`;d(`pointercancel`),this.dispatchEvent(new CustomEvent(`interact-stopped`,{detail:{source:t}})),document.removeEventListener(`visibilitychange`,p);return}let n=Math.min(1,(performance.now()-s)/e);for(let[e,t]of o.entries())t.x=a[e].x(n),t.y=a[e].y(n);d(`pointermove`),n<1?requestAnimationFrame(f):(d(`pointerup`),this.dispatchEvent(new CustomEvent(`interact-stopped`,{detail:{source:su.AUTOMATIC}})),document.removeEventListener(`visibilitychange`,p))},p=()=>{let e=0;document.visibilityState===`hidden`?e=performance.now()-s:s=performance.now()-e};document.addEventListener(`visibilitychange`,p),d(`pointerdown`),this[zl]=su.AUTOMATIC,requestAnimationFrame(f)}[(t=wl,n=Tl,r=El,i=Cl,a=Rl,o=Ll,s=Il,c=Fl,l=zl,u=Sl,d=Bl,f=Vl,p=Hl,m=Ul,h=kl,Gl)](e){let t=this[Sl],n=this[Q];n.framedFoVDeg=e[0]*180/Math.PI,t.changeSource=su.NONE,t.setFieldOfView(n.adjustedFoV(n.framedFoVDeg)),this[Ml]()}[Wl](e){let t=this[Sl];if(this[Ul]){let{theta:t,phi:n}=this.getCameraOrbit();e[0]=t,e[1]=n,this[Ul]=!1}t.changeSource=su.NONE,t.setOrbit(e[0],e[1],e[2]),this[Ml]()}[ql](e){this[Sl].applyOptions({minimumAzimuthalAngle:e[0],minimumPolarAngle:e[1],minimumRadius:e[2]}),this.jumpCameraToGoal()}[Jl](e){this[Sl].applyOptions({maximumAzimuthalAngle:e[0],maximumPolarAngle:e[1],maximumRadius:e[2]}),this[jl](e[2]),this.jumpCameraToGoal()}[Yl](e){this[Sl].applyOptions({minimumFieldOfView:e[0]*180/Math.PI}),this.jumpCameraToGoal()}[Xl](e){let t=this[Q].adjustedFoV(e[0]*180/Math.PI);this[Sl].applyOptions({maximumFieldOfView:t}),this.jumpCameraToGoal()}[Kl](e){let[t,n,r]=e;this[$].arRenderer.isPresenting||this[Q].setTarget(t,n,r),this[Sl].changeSource=su.NONE,this[$].arRenderer.updateTarget(),this[Ml]()}[Jm](e,t){if(super[Jm](e,t),this[$].isPresenting||!this[$m]())return;let n=this[Sl],r=this[Q],i=performance.now();if(this[Fl]&&this.loaded&&i>this[Vm]+this.interactionPromptThreshold&&(this[Fl]=!1,this[Ll]=i,this[wl].classList.add(`visible`)),isFinite(this[Ll])&&this.interactionPromptStyle===ul.WIGGLE){let e=(i-this[Ll])/Qc%1,t=$c(e),a=el(e);if(this[Tl].style.opacity=`${a}`,t!==this[Rl]){let e=t*r.width*.05,i=(t-this[Rl])*Math.PI/16;this[Tl].style.transform=`translateX(${e}px)`,n.changeSource=su.AUTOMATIC,n.adjustOrbit(i,0,0),this[Rl]=t}}let a=n.update(e,t),o=r.updateTarget(t);(a||o)&&this[Nl]()}[Dl](){this[Fl]=!1,this[wl].classList.remove(`visible`),this[Ll]=1/0}[jl](e){let t=Math.max(this[Q].farRadius(),e),n=Math.abs(2*t);this[Sl].updateNearFar(0,n)}[Ol](){let{theta:e,phi:t}=this[Sl].getCameraSpherical(this[Bl]),n=(4+Math.floor((e%xl+bl)/vl))%4,r=Math.floor(t/yl),i=al[n],a=`${ol[r]}${i}`,o=a;o in this[kl]?this[Bm](this[kl][o]):this[Bm](`View from stage ${a}`)}get[Lm](){let e=cl;return`interaction-prompt`in this[kl]&&(e=`. ${this[kl][`interaction-prompt`]}`),super[Lm].replace(/\.$/,``)+(this.cameraControls?e:``)}async[Xm](e){let t=this[Sl],n=this[Q],r=n.adjustedFoV(n.framedFoVDeg);super[Xm](e);let i=n.adjustedFoV(n.framedFoVDeg)/r,a=t.getFieldOfView()*(isFinite(i)?i:1);t.updateAspect(this[Q].aspect),this.requestUpdate(`maxFieldOfView`,this.maxFieldOfView),await this.updateComplete,this[Sl].setFieldOfView(a),this.jumpCameraToGoal()}[Ym](){super[Ym](),this[Hl]?this[Ul]=!0:this[Hl]=!0,this.requestUpdate(`maxFieldOfView`,this.maxFieldOfView),this.requestUpdate(`fieldOfView`,this.fieldOfView),this.requestUpdate(`minCameraOrbit`,this.minCameraOrbit),this.requestUpdate(`maxCameraOrbit`,this.maxCameraOrbit),this.requestUpdate(`cameraOrbit`,this.cameraOrbit),this.requestUpdate(`cameraTarget`,this.cameraTarget),this.jumpCameraToGoal()}[(g=Ml,_=Nl,v=Pl,Al)](){if(typeof this.a11y==`string`){if(this.a11y.startsWith(`{`))try{this[kl]=JSON.parse(this.a11y)}catch(e){console.warn(`Error parsing a11y JSON:`,e)}else this.a11y.length>0?console.warn(`Error not supported format, should be a JSON string:`,this.a11y):this[kl]={}}else this[kl]=typeof this.a11y==`object`&&this.a11y!=null?Object.assign({},this.a11y):{};this[Gm].setAttribute(`aria-label`,this[Lm])}}return Zc([W({type:Boolean,attribute:`camera-controls`})],y.prototype,`cameraControls`,void 0),Zc([Kc({intrinsics:ml,observeEffects:!0,updateHandler:Wl}),W({type:String,attribute:`camera-orbit`,hasChanged:()=>!0})],y.prototype,`cameraOrbit`,void 0),Zc([Kc({intrinsics:_l,observeEffects:!0,updateHandler:Kl}),W({type:String,attribute:`camera-target`,hasChanged:()=>!0})],y.prototype,`cameraTarget`,void 0),Zc([Kc({intrinsics:fl,observeEffects:!0,updateHandler:Gl}),W({type:String,attribute:`field-of-view`,hasChanged:()=>!0})],y.prototype,`fieldOfView`,void 0),Zc([Kc({intrinsics:hl,updateHandler:ql}),W({type:String,attribute:`min-camera-orbit`,hasChanged:()=>!0})],y.prototype,`minCameraOrbit`,void 0),Zc([Kc({intrinsics:gl,updateHandler:Jl}),W({type:String,attribute:`max-camera-orbit`,hasChanged:()=>!0})],y.prototype,`maxCameraOrbit`,void 0),Zc([Kc({intrinsics:pl,updateHandler:Yl}),W({type:String,attribute:`min-field-of-view`,hasChanged:()=>!0})],y.prototype,`minFieldOfView`,void 0),Zc([Kc({intrinsics:fl,updateHandler:Xl}),W({type:String,attribute:`max-field-of-view`,hasChanged:()=>!0})],y.prototype,`maxFieldOfView`,void 0),Zc([W({type:Number,attribute:`interaction-prompt-threshold`})],y.prototype,`interactionPromptThreshold`,void 0),Zc([W({type:String,attribute:`interaction-prompt`})],y.prototype,`interactionPrompt`,void 0),Zc([W({type:String,attribute:`interaction-prompt-style`})],y.prototype,`interactionPromptStyle`,void 0),Zc([W({type:Number,attribute:`orbit-sensitivity`})],y.prototype,`orbitSensitivity`,void 0),Zc([W({type:Number,attribute:`zoom-sensitivity`})],y.prototype,`zoomSensitivity`,void 0),Zc([W({type:Number,attribute:`pan-sensitivity`})],y.prototype,`panSensitivity`,void 0),Zc([W({type:String,attribute:`touch-action`})],y.prototype,`touchAction`,void 0),Zc([W({type:Boolean,attribute:`disable-zoom`})],y.prototype,`disableZoom`,void 0),Zc([W({type:Boolean,attribute:`disable-pan`})],y.prototype,`disablePan`,void 0),Zc([W({type:Boolean,attribute:`disable-tap`})],y.prototype,`disableTap`,void 0),Zc([W({type:Number,attribute:`interpolation-decay`})],y.prototype,`interpolationDecay`,void 0),Zc([W()],y.prototype,`a11y`,void 0),y},Ql=.018,$l=2,eu=300,tu=new ct,nu=new S,ru=Object.freeze({minimumRadius:0,maximumRadius:1/0,minimumPolarAngle:0,maximumPolarAngle:Math.PI,minimumAzimuthalAngle:-1/0,maximumAzimuthalAngle:1/0,minimumFieldOfView:10,maximumFieldOfView:45,touchAction:`none`}),iu=Math.PI/8,au=.04,ou=10,su={USER_INTERACTION:`user-interaction`,NONE:`none`,AUTOMATIC:`automatic`},cu=class extends ee{constructor(e,t,n){super(),this.camera=e,this.element=t,this.scene=n,this.orbitSensitivity=1,this.zoomSensitivity=1,this.panSensitivity=1,this.inputSensitivity=1,this.changeSource=su.NONE,this._interactionEnabled=!1,this._disableZoom=!1,this.isUserPointing=!1,this.enablePan=!0,this.enableTap=!0,this.panProjection=new L,this.panPerPixel=0,this.spherical=new Ue,this.goalSpherical=new Ue,this.thetaDamper=new Ks,this.phiDamper=new Ks,this.radiusDamper=new Ks,this.logFov=Math.log(ru.maximumFieldOfView),this.goalLogFov=this.logFov,this.fovDamper=new Ks,this.touchMode=null,this.pointers=[],this.startTime=0,this.startPointerPosition={clientX:0,clientY:0},this.lastSeparation=0,this.touchDecided=!1,this.onContext=e=>{if(this.enablePan)e.preventDefault();else for(let e of this.pointers)this.onPointerUp(new PointerEvent(`pointercancel`,Object.assign(Object.assign({},this.startPointerPosition),{pointerId:e.id})))},this.touchModeZoom=(e,t)=>{if(!this._disableZoom){let e=this.twoTouchDistance(this.pointers[0],this.pointers[1]),t=au*this.zoomSensitivity*(this.lastSeparation-e)*50/this.scene.height;this.lastSeparation=e,this.userAdjustOrbit(0,0,t)}this.panPerPixel>0&&this.movePan(e,t)},this.disableScroll=e=>{e.preventDefault()},this.touchModeRotate=(e,t)=>{let{touchAction:n}=this._options;if(!this.touchDecided&&n!==`none`){this.touchDecided=!0;let r=Math.abs(e),i=Math.abs(t);if(this.changeSource===su.USER_INTERACTION&&(n===`pan-y`&&i>r||n===`pan-x`&&r>i)){this.touchMode=null;return}this.element.addEventListener(`touchmove`,this.disableScroll,{passive:!1})}this.handleSinglePointerMove(e,t)},this.onPointerDown=e=>{if(this.pointers.length>2)return;let{element:t}=this;this.pointers.length===0&&(t.addEventListener(`pointermove`,this.onPointerMove),t.addEventListener(`pointerup`,this.onPointerUp),this.touchMode=null,this.touchDecided=!1,this.startPointerPosition.clientX=e.clientX,this.startPointerPosition.clientY=e.clientY,this.startTime=performance.now());try{t.setPointerCapture(e.pointerId)}catch{}this.pointers.push({clientX:e.clientX,clientY:e.clientY,id:e.pointerId}),this.isUserPointing=!1,e.pointerType===`touch`?(this.changeSource=e.altKey?su.AUTOMATIC:su.USER_INTERACTION,this.onTouchChange(e)):(this.changeSource=su.USER_INTERACTION,this.onMouseDown(e)),this.changeSource===su.USER_INTERACTION&&this.dispatchEvent({type:`user-interaction`})},this.onPointerMove=e=>{let t=this.pointers.find(t=>t.id===e.pointerId);if(t==null)return;if(e.pointerType===`mouse`&&e.buttons===0){this.onPointerUp(e);return}let n=this.pointers.length,r=(e.clientX-t.clientX)/n,i=(e.clientY-t.clientY)/n;(r!==0||i!==0)&&(t.clientX=e.clientX,t.clientY=e.clientY,e.pointerType===`touch`?(this.changeSource=e.altKey?su.AUTOMATIC:su.USER_INTERACTION,this.touchMode!==null&&this.touchMode(r,i)):(this.changeSource=su.USER_INTERACTION,this.panPerPixel>0?this.movePan(r,i):this.handleSinglePointerMove(r,i)))},this.onPointerUp=e=>{let{element:t}=this,n=this.pointers.findIndex(t=>t.id===e.pointerId);n!==-1&&this.pointers.splice(n,1),this.panPerPixel>0&&!e.altKey&&this.resetRadius(),this.pointers.length===0?(t.removeEventListener(`pointermove`,this.onPointerMove),t.removeEventListener(`pointerup`,this.onPointerUp),t.removeEventListener(`touchmove`,this.disableScroll),this.enablePan&&this.enableTap&&this.recenter(e)):this.touchMode!==null&&this.onTouchChange(e),this.scene.element[Cl].style.opacity=0,t.style.cursor=`grab`,this.panPerPixel=0,this.isUserPointing&&this.dispatchEvent({type:`pointer-change-end`})},this.onWheel=e=>{this.changeSource=su.USER_INTERACTION;let t=e.deltaY*(e.deltaMode==1?18:1)*au*this.zoomSensitivity/30;this.userAdjustOrbit(0,0,t),e.preventDefault(),this.dispatchEvent({type:`user-interaction`})},this.onKeyDown=e=>{let{changeSource:t}=this;this.changeSource=su.USER_INTERACTION,(e.shiftKey&&this.enablePan?this.panKeyCodeHandler(e):this.orbitZoomKeyCodeHandler(e))?(e.preventDefault(),this.dispatchEvent({type:`user-interaction`})):this.changeSource=t},this._options=Object.assign({},ru),this.setOrbit(0,Math.PI/2,1),this.setFieldOfView(100),this.jumpToGoal()}get interactionEnabled(){return this._interactionEnabled}enableInteraction(){if(this._interactionEnabled===!1){let{element:e}=this;e.addEventListener(`pointerdown`,this.onPointerDown),e.addEventListener(`pointercancel`,this.onPointerUp),this._disableZoom||e.addEventListener(`wheel`,this.onWheel),e.addEventListener(`keydown`,this.onKeyDown),e.addEventListener(`touchmove`,()=>{},{passive:!1}),e.addEventListener(`contextmenu`,this.onContext),this.element.style.cursor=`grab`,this._interactionEnabled=!0,this.updateTouchActionStyle()}}disableInteraction(){if(this._interactionEnabled===!0){let{element:e}=this;e.removeEventListener(`pointerdown`,this.onPointerDown),e.removeEventListener(`pointermove`,this.onPointerMove),e.removeEventListener(`pointerup`,this.onPointerUp),e.removeEventListener(`pointercancel`,this.onPointerUp),e.removeEventListener(`wheel`,this.onWheel),e.removeEventListener(`keydown`,this.onKeyDown),e.removeEventListener(`contextmenu`,this.onContext),e.style.cursor=``,this.touchMode=null,this._interactionEnabled=!1,this.updateTouchActionStyle()}}get options(){return this._options}set disableZoom(e){this._disableZoom!=e&&(this._disableZoom=e,e===!0?this.element.removeEventListener(`wheel`,this.onWheel):this.element.addEventListener(`wheel`,this.onWheel),this.updateTouchActionStyle())}getCameraSpherical(e=new Ue){return e.copy(this.spherical)}getFieldOfView(){return this.camera.fov}applyOptions(e){Object.assign(this._options,e),this.setOrbit(),this.setFieldOfView(Math.exp(this.goalLogFov))}updateNearFar(e,t){this.camera.far=t===0?2:t,this.camera.near=Math.max(e,this.camera.far/1e3),this.camera.updateProjectionMatrix()}updateAspect(e){this.camera.aspect=e,this.camera.updateProjectionMatrix()}setOrbit(e=this.goalSpherical.theta,t=this.goalSpherical.phi,n=this.goalSpherical.radius){let{minimumAzimuthalAngle:r,maximumAzimuthalAngle:i,minimumPolarAngle:a,maximumPolarAngle:o,minimumRadius:s,maximumRadius:c}=this._options,{theta:l,phi:u,radius:d}=this.goalSpherical,f=Do(e,r,i);!isFinite(r)&&!isFinite(i)&&(this.spherical.theta=this.wrapAngle(this.spherical.theta-f)+f);let p=Do(t,a,o),m=Do(n,s,c);return f===l&&p===u&&m===d||!isFinite(f)||!isFinite(p)||!isFinite(m)?!1:(this.goalSpherical.theta=f,this.goalSpherical.phi=p,this.goalSpherical.radius=m,this.goalSpherical.makeSafe(),!0)}setRadius(e){this.goalSpherical.radius=e,this.setOrbit()}setFieldOfView(e){let{minimumFieldOfView:t,maximumFieldOfView:n}=this._options;e=Do(e,t,n),this.goalLogFov=Math.log(e)}setDamperDecayTime(e){this.thetaDamper.setDecayTime(e),this.phiDamper.setDecayTime(e),this.radiusDamper.setDecayTime(e),this.fovDamper.setDecayTime(e)}adjustOrbit(e,t,n){let{theta:r,phi:i,radius:a}=this.goalSpherical,{minimumRadius:o,maximumRadius:s,minimumFieldOfView:c,maximumFieldOfView:l}=this._options,u=this.spherical.theta-r,d=Math.PI-.001,f=r-Do(e,-d-u,d-u),p=i-t,m=n===0?0:((n>0?s:o)-a)/(Math.log(n>0?l:c)-this.goalLogFov),h=a+n*(isFinite(m)?m:(s-o)*2);if(this.setOrbit(f,p,h),n!==0){let e=this.goalLogFov+n;this.setFieldOfView(Math.exp(e))}}jumpToGoal(){this.update(0,Ws)}update(e,t){if(this.isStationary())return!1;let{maximumPolarAngle:n,maximumRadius:r}=this._options,i=this.spherical.theta-this.goalSpherical.theta;return Math.abs(i)>Math.PI&&!isFinite(this._options.minimumAzimuthalAngle)&&!isFinite(this._options.maximumAzimuthalAngle)&&(this.spherical.theta-=Math.sign(i)*2*Math.PI),this.spherical.theta=this.thetaDamper.update(this.spherical.theta,this.goalSpherical.theta,t,Math.PI),this.spherical.phi=this.phiDamper.update(this.spherical.phi,this.goalSpherical.phi,t,n),this.spherical.radius=this.radiusDamper.update(this.spherical.radius,this.goalSpherical.radius,t,r),this.logFov=this.fovDamper.update(this.logFov,this.goalLogFov,t,1),this.moveCamera(),!0}updateTouchActionStyle(){let{style:e}=this.element;if(this._interactionEnabled){let{touchAction:t}=this._options;e.touchAction=this._disableZoom&&t!==`none`?`manipulation`:t}else e.touchAction=``}isStationary(){return this.goalSpherical.theta===this.spherical.theta&&this.goalSpherical.phi===this.spherical.phi&&this.goalSpherical.radius===this.spherical.radius&&this.goalLogFov===this.logFov}moveCamera(){this.spherical.makeSafe(),this.camera.position.setFromSpherical(this.spherical),this.camera.setRotationFromEuler(new D(this.spherical.phi-Math.PI/2,this.spherical.theta,0,`YXZ`)),this.camera.fov!==Math.exp(this.logFov)&&(this.camera.fov=Math.exp(this.logFov),this.camera.updateProjectionMatrix())}userAdjustOrbit(e,t,n){this.adjustOrbit(e*this.orbitSensitivity*this.inputSensitivity,t*this.orbitSensitivity*this.inputSensitivity,n*this.inputSensitivity)}wrapAngle(e){let t=(e+Math.PI)/(2*Math.PI);return(t-Math.floor(t))*2*Math.PI-Math.PI}pixelLengthToSphericalAngle(e){return 2*Math.PI*e/this.scene.height}twoTouchDistance(e,t){let{clientX:n,clientY:r}=e,{clientX:i,clientY:a}=t,o=i-n,s=a-r;return Math.sqrt(o*o+s*s)}handleSinglePointerMove(e,t){let n=this.pixelLengthToSphericalAngle(e),r=this.pixelLengthToSphericalAngle(t);this.isUserPointing===!1&&(this.isUserPointing=!0,this.dispatchEvent({type:`pointer-change-start`})),this.userAdjustOrbit(n,r,0)}initializePan(){let{theta:e,phi:t}=this.spherical,n=e-this.scene.yaw;this.panPerPixel=Ql*this.panSensitivity/this.scene.height,this.panProjection.set(-Math.cos(n),-Math.cos(t)*Math.sin(n),0,0,Math.sin(t),0,Math.sin(n),-Math.cos(t)*Math.cos(n),0)}movePan(e,t){let{scene:n}=this,r=nu.set(e,t,0).multiplyScalar(this.inputSensitivity),i=this.spherical.radius*Math.exp(this.logFov)*this.panPerPixel;r.multiplyScalar(i);let a=n.getTarget();a.add(r.applyMatrix3(this.panProjection)),n.boundingSphere.clampPoint(a,a),n.setTarget(a.x,a.y,a.z)}recenter(e){if(performance.now()>this.startTime+eu||Math.abs(e.clientX-this.startPointerPosition.clientX)>$l||Math.abs(e.clientY-this.startPointerPosition.clientY)>$l)return;let{scene:t}=this,n=t.positionAndNormalFromPoint(t.getNDC(e.clientX,e.clientY));if(n==null){let{cameraTarget:e}=t.element;t.element.cameraTarget=``,t.element.cameraTarget=e,this.userAdjustOrbit(0,0,1)}else t.target.worldToLocal(n.position),t.setTarget(n.position.x,n.position.y,n.position.z)}resetRadius(){let{scene:e}=this,t=e.positionAndNormalFromPoint(tu.set(0,0));if(t==null)return;e.target.worldToLocal(t.position);let n=e.getTarget(),{theta:r,phi:i}=this.spherical,a=r-e.yaw,o=nu.set(Math.sin(i)*Math.sin(a),Math.cos(i),Math.sin(i)*Math.cos(a)),s=o.dot(t.position.sub(n));n.add(o.multiplyScalar(s)),e.setTarget(n.x,n.y,n.z),this.setOrbit(void 0,void 0,this.goalSpherical.radius-s)}onTouchChange(e){if(this.pointers.length===1)this.touchMode=this.touchModeRotate;else{if(this._disableZoom){this.touchMode=null,this.element.removeEventListener(`touchmove`,this.disableScroll);return}this.touchMode=this.touchDecided&&this.touchMode===null?null:this.touchModeZoom,this.touchDecided=!0,this.element.addEventListener(`touchmove`,this.disableScroll,{passive:!1}),this.lastSeparation=this.twoTouchDistance(this.pointers[0],this.pointers[1]),this.enablePan&&this.touchMode!=null&&(this.initializePan(),e.altKey||(this.scene.element[Cl].style.opacity=1))}}onMouseDown(e){this.panPerPixel=0,this.enablePan&&(e.button===2||e.ctrlKey||e.metaKey||e.shiftKey)&&(this.initializePan(),this.scene.element[Cl].style.opacity=1),this.element.style.cursor=`grabbing`}orbitZoomKeyCodeHandler(e){let t=!0;switch(e.key){case`PageUp`:this.userAdjustOrbit(0,0,au*this.zoomSensitivity);break;case`PageDown`:this.userAdjustOrbit(0,0,-1*au*this.zoomSensitivity);break;case`ArrowUp`:this.userAdjustOrbit(0,-iu,0);break;case`ArrowDown`:this.userAdjustOrbit(0,iu,0);break;case`ArrowLeft`:this.userAdjustOrbit(-iu,0,0);break;case`ArrowRight`:this.userAdjustOrbit(iu,0,0);break;default:t=!1}return t}panKeyCodeHandler(e){this.initializePan();let t=!0;switch(e.key){case`ArrowUp`:this.movePan(0,-10);break;case`ArrowDown`:this.movePan(0,ou);break;case`ArrowLeft`:this.movePan(-10,0);break;case`ArrowRight`:this.movePan(ou,0);break;default:t=!1}return t}},lu=`<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="#e8eaed">
   <path d="M6.4,19L5,17.6L10.6,12L5,6.4L6.4,5L12,10.6L17.6,5L19,6.4L13.4,12L19,17.6L17.6,19L12,13.4L6.4,19Z"/>
</svg>`,uu=`<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="#e8eaed">
   <path d="M7,17V9H5V7H9V17H7ZM11,17V15H13V17H11ZM16,17V9H14V7H18V17H16ZM11,13V11H13V13H11Z"/>
</svg>`,du=`<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="#E1E2E8">
   <defs>
       <clipPath id="clip0">
           <path d="M0,0h24v24h-24z"/>
       </clipPath>
   </defs>
   <g clip-path="url(#clip0)">
       <path d="M12,22C10.75,22 9.575,21.767 8.475,21.3C7.392,20.817 6.442,20.175 5.625,19.375C4.825,18.558 4.183,17.608 3.7,16.525C3.233,15.425 3,14.25 3,13H5C5,14.95 5.675,16.608 7.025,17.975C8.392,19.325 10.05,20 12,20C13.95,20 15.6,19.325 16.95,17.975C18.317,16.608 19,14.95 19,13C19,11.05 18.317,9.4 16.95,8.05C15.6,6.683 13.95,6 12,6H11.85L13.4,7.55L12,9L8,5L12,1L13.4,2.45L11.85,4H12C13.25,4 14.417,4.242 15.5,4.725C16.6,5.192 17.55,5.833 18.35,6.65C19.167,7.45 19.808,8.4 20.275,9.5C20.758,10.583 21,11.75 21,13C21,14.25 20.758,15.425 20.275,16.525C19.808,17.608 19.167,18.558 18.35,19.375C17.55,20.175 16.6,20.817 15.5,21.3C14.417,21.767 13.25,22 12,22Z"/>
   </g>
</svg>`,fu={width:.16,height:.07,cornerRadius:.03,opacity:1,color:0,minDistance:.5,maxDistance:10,baseScale:1,distanceScaleFactor:.3},pu={size:.05,zOffset:.01,spacing:.07},mu={canvasSize:128,filter:ye},hu=class e extends kt{constructor(){super(),this.isActualSize=!1,this.preRenderIcons(),this.createPanel(),this.createButtons(),this.opacityDamper=new Ks,this.goalOpacity=fu.opacity}createPanel(){let e=this.createPanelShape(),t=new f(e),n=new z({color:fu.color,opacity:fu.opacity,transparent:!0});this.panelMesh=new U(t,n),this.panelMesh.name=`MenuPanel`,this.add(this.panelMesh)}createButtons(){this.exitButton=this.createButton(`close`),this.exitButton.name=`ExitButton`,this.exitButton.position.set(pu.spacing/2,0,pu.zOffset),this.add(this.exitButton),this.toggleButton=this.createButton(`view-real-size`),this.toggleButton.name=`ToggleButton`,this.toggleButton.position.set(-pu.spacing/2,0,pu.zOffset),this.add(this.toggleButton)}createPanelShape(){let e=new ue,{width:t,height:n,cornerRadius:r}=fu;return e.moveTo(-t/2+r,-n/2),e.lineTo(t/2-r,-n/2),e.quadraticCurveTo(t/2,-n/2,t/2,-n/2+r),e.lineTo(t/2,n/2-r),e.quadraticCurveTo(t/2,n/2,t/2-r,n/2),e.lineTo(-t/2+r,n/2),e.quadraticCurveTo(-t/2,n/2,-t/2,n/2-r),e.lineTo(-t/2,-n/2+r),e.quadraticCurveTo(-t/2,-n/2,-t/2+r,-n/2),e}preRenderIcons(){[{key:`close`,svg:lu},{key:`view-real-size`,svg:uu},{key:`replay`,svg:du}].forEach(({key:t,svg:n})=>{e.iconTextures.has(t)||this.createTextureFromSvg(n,t)})}createTextureFromSvg(t,n){let r=document.createElement(`canvas`);r.width=mu.canvasSize,r.height=mu.canvasSize;let i=r.getContext(`2d`),a=new Image,o=new Blob([t],{type:`image/svg+xml`}),s=URL.createObjectURL(o);a.onload=()=>{i.drawImage(a,0,0,mu.canvasSize,mu.canvasSize);let t=new Le(r);t.needsUpdate=!0,t.minFilter=mu.filter,e.iconTextures.set(n,t),URL.revokeObjectURL(s)},a.src=s}createButton(t){let n=new z({transparent:!0}),r=new c(pu.size,pu.size),i=new U(r,n),a=e.iconTextures.get(t);if(a)i.material.map=a,i.material.needsUpdate=!0;else{this.createTextureFromSvg(t===`close`?lu:t===`view-real-size`?uu:du,t);let n=()=>{let r=e.iconTextures.get(t);r?(i.material.map=r,i.material.needsUpdate=!0):setTimeout(n,10)};n()}return i}exitButtonControllerIntersection(e,t){return e.hitFromController(t,this.exitButton)}scaleModeButtonControllerIntersection(e,t){return e.hitFromController(t,this.toggleButton)}handleScaleToggle(e,t,n,r){if(!e)return null;this.isActualSize=!this.isActualSize;let i=this.isActualSize?`replay`:`view-real-size`;this.updateScaleModeButtonLabel(i);let a=this.isActualSize?1:t;return Math.max(n,Math.min(r,a))}updateScaleModeButtonLabel(t){let n=e.iconTextures.get(t);n&&(this.toggleButton.material.map=n,this.toggleButton.material.needsUpdate=!0)}updatePosition(e,t){if(!t)return;let n=new S;t.getWorldPosition(n);let r=t.getSize(),i=Math.min(r.x,r.z),a=Math.max(.5,Math.min(2,i/1)),o=-.2*a,s=.9*a,c=new S().copy(e.position).sub(n);c.y=0,c.normalize();let l=new S().copy(n).add(new S(0,o,0)).add(c.multiplyScalar(s));this.position.copy(l);let u=e.position.distanceTo(l),d=Math.max(fu.minDistance,Math.min(fu.maxDistance,u)),f=fu.baseScale+(d-fu.minDistance)*fu.distanceScaleFactor;this.scale.set(f,f,f),this.lookAt(e.position)}set show(e){this.goalOpacity=e?fu.opacity:0}updateOpacity(e){let t=this.panelMesh.material.opacity,n=this.opacityDamper.update(t,this.goalOpacity,e,1);this.traverse(e=>{if(e instanceof U){let t=e.material;t.transparent&&(t.opacity=n)}}),this.visible=n>0}dispose(){var e;this.children.forEach(e=>{e instanceof U&&(e.geometry&&e.geometry.dispose(),(Array.isArray(e.material)?e.material:[e.material]).forEach(e=>{e&&(`map`in e&&e.map instanceof Le&&e.map.dispose(),e.dispose())}))}),(e=this.parent)==null||e.remove(this)}};hu.iconTextures=new Map;var gu=30,_u=.8,vu=1.5,yu=20,bu=.2,xu=.25,Su=10,Cu=150,wu=5,Tu=new S(0,1,0),Eu=.3,Du=15,Ou=.3,ku=.01,Au=.15,ju=70,Mu=.001,Nu=.2,Pu={NOT_PRESENTING:`not-presenting`,SESSION_STARTED:`session-started`,OBJECT_PLACED:`object-placed`,FAILED:`failed`},Fu={TRACKING:`tracking`,NOT_TRACKING:`not-tracking`},Iu=new S,Lu=new p,Ru=new Ye,zu=new S,Bu=new Dt(45,1,.1,100),Vu=new at().setFromPoints([new S(0,0,0),new S(0,0,-1)]),Hu={SCREEN_SPACE:`screen-space`,WORLD_SPACE:`world-space`},Uu=class extends ee{isWorldSpaceReady(){return this.xrMode===Hu.WORLD_SPACE&&this.worldSpaceInitialPlacementDone}constructor(e){super(),this.renderer=e,this.currentSession=null,this.placeOnWall=!1,this.placementBox=null,this.menuPanel=null,this.lastTick=null,this.turntableRotation=null,this.oldShadowIntensity=null,this.frame=null,this.initialHitSource=null,this.transientHitTestSource=null,this.inputSource=null,this._presentedScene=null,this.resolveCleanup=null,this.exitWebXRButtonContainer=null,this.overlay=null,this.xrLight=null,this.xrMode=null,this.xrController1=null,this.xrController2=null,this.selectedXRController=null,this.tracking=!0,this.frames=0,this.initialized=!1,this.oldTarget=new S,this.placementComplete=!1,this.isTranslating=!1,this.isRotating=!1,this.isTwoHandInteraction=!1,this.lastDragPosition=new S,this.deltaRotation=new p,this.scaleLine=new x(Vu),this.firstRatio=0,this.lastAngle=0,this.goalPosition=new S,this.goalYaw=0,this.goalScale=1,this.xDamper=new Ks,this.yDamper=new Ks,this.zDamper=new Ks,this.yawDamper=new Ks,this.pitchDamper=new Ks,this.rollDamper=new Ks,this.scaleDamper=new Ks,this.wasTwoFingering=!1,this.worldSpaceInitialPlacementDone=!1,this.initialModelScale=1,this.minScale=1,this.maxScale=1,this.onExitWebXRButtonContainerClick=()=>this.stopPresenting(),this.onControllerSelectStart=e=>{var t;let n=this.presentedScene,r=e.target,i=this.menuPanel;if(this.menuPanel.exitButtonControllerIntersection(n,r)!=null){(t=this.menuPanel)==null||t.dispose(),this.stopPresenting();return}if(this.menuPanel.scaleModeButtonControllerIntersection(n,r)!=null){let e=this.menuPanel.handleScaleToggle(this.worldSpaceInitialPlacementDone,this.initialModelScale,this.minScale,this.maxScale);e!==null&&(this.goalScale=e);return}i&&(i.show=!1);let a=this.placementBox.controllerIntersection(n,r);if(a!=null){let e=new _t().setFromObject(n.scenePivot).min.y+Nu;if(a.point.y<=e)this.selectedXRController==null?r.attach(n.scenePivot):(this.selectedXRController.userData.line.visible=!1,n.canScale&&this.isWorldSpaceReady()&&(this.isTwoHandInteraction=!0,this.firstRatio=this.controllerSeparation()/n.scenePivot.scale.x,this.scaleLine.visible=!0)),this.selectedXRController=r,n.setShadowIntensity(.01);else if(r==this.xrController1?this.xrController1.userData.isSelected=!0:r==this.xrController2&&(this.xrController2.userData.isSelected=!0),this.xrController1?.userData.isSelected&&this.xrController2?.userData.isSelected)n.canScale&&this.isWorldSpaceReady()&&(this.isTwoHandInteraction=!0,this.firstRatio=this.controllerSeparation()/n.scenePivot.scale.x,this.scaleLine.visible=!0);else{let e=r===this.xrController1?this.xrController2:this.xrController1;r.userData.initialX=r.position.x,e.userData.turning=!1,r.userData.turning=!0,r.userData.line.visible=!1}}},this.onControllerSelectEnd=e=>{let t=e.target;if(t.userData.turning=!1,t.userData.line.visible=!0,this.isTwoHandInteraction=!1,this.scaleLine.visible=!1,t==this.xrController1?this.xrController1.userData.isSelected=!1:t==this.xrController2&&(this.xrController2.userData.isSelected=!1),this.selectedXRController!=null&&this.selectedXRController!=t)return;let n=this.presentedScene;n.attach(n.scenePivot),this.selectedXRController=null,this.goalYaw=Math.atan2(n.scenePivot.matrix.elements[8],n.scenePivot.matrix.elements[10]),this.goalPosition.x=n.scenePivot.position.x,this.goalPosition.z=n.scenePivot.position.z,this.isWorldSpaceReady()&&(this.goalPosition.y=n.scenePivot.position.y);let r=this.menuPanel;r.show=!0},this.onUpdateScene=()=>{this.placementBox!=null&&this.isPresenting&&(this.placementBox.updateFromModelChanges(),this.placementBox.setScreenSpaceMode(this.xrMode===Hu.SCREEN_SPACE)),this.xrMode!==Hu.SCREEN_SPACE&&(this.menuPanel&&=(this.menuPanel.dispose(),null),this.menuPanel=new hu,this.presentedScene.add(this.menuPanel),this.menuPanel.updatePosition(this.presentedScene.getCamera(),this.placementBox))},this.onSelectStart=e=>{let t=this.transientHitTestSource;if(t==null)return;let n=this.frame.getHitTestResultsForTransientInput(t),r=this.presentedScene,i=this.placementBox;if(n.length===1){this.inputSource=e.inputSource;let{axes:t}=this.inputSource.gamepad,n=i.getHit(this.presentedScene,t[0],t[1]);i.show=!0,n==null?this.placeOnWall===!1&&(this.isRotating=!0,this.lastAngle=t[0]*vu):(this.isTranslating=!0,this.lastDragPosition.copy(n))}else if(n.length===2){i.show=!0,this.isTwoHandInteraction=!0;let{separation:e,angle:t}=this.fingerPolar(n);this.lastAngle=t,this.firstRatio===0&&(this.firstRatio=e/r.scenePivot.scale.x),r.canScale&&this.setScale(e);return}},this.onSelectEnd=()=>{this.isTranslating=!1,this.isRotating=!1,this.isTwoHandInteraction=!1,this.inputSource=null,this.goalPosition.y+=this.placementBox.offsetHeight*this.presentedScene.scale.x,this.placementBox.show=!1},this.onBeforeXRSelect=e=>{let t=e.composedPath();for(let n of t)if(n instanceof HTMLElement){let t=n.tagName.toLowerCase();if(t===`input`||t===`button`||t===`select`||t===`textarea`||t===`a`||n.hasAttribute(`data-pointer-coalesce`)||n.classList.contains(`interactive`)){e.preventDefault();break}}},this.threeRenderer=e.threeRenderer,this.threeRenderer.xr.enabled=!0}async resolveARSession(){Co();let e=await navigator.xr.requestSession(`immersive-ar`,{requiredFeatures:[],optionalFeatures:[`hit-test`,`dom-overlay`,`light-estimation`],domOverlay:this.overlay?{root:this.overlay}:void 0});return this.threeRenderer.xr.setReferenceSpaceType(`local`),await this.threeRenderer.xr.setSession(e),this.threeRenderer.xr.cameraAutoUpdate=!1,e}get presentedScene(){return this._presentedScene}async supportsPresentation(){try{return Co(),await navigator.xr.isSessionSupported(`immersive-ar`)}catch(e){return console.warn(`Request to present in WebXR denied:`),console.warn(e),console.warn(`Falling back to next ar-mode`),!1}}async present(e,t=!1){this.isPresenting&&console.warn(`Cannot present while a model is already presenting`);let n=new Promise((e,t)=>{requestAnimationFrame(()=>e())});e.setHotspotsVisibility(!1),e.queueRender(),await n,this._presentedScene=e,this.overlay=e.element.shadowRoot.querySelector(`div.default`),this.overlay!=null&&this.overlay.addEventListener(`beforexrselect`,this.onBeforeXRSelect),t===!0&&(this.xrLight=new Us(this.threeRenderer),this.xrLight.addEventListener(`estimationstart`,()=>{if(!this.isPresenting||this.xrLight==null)return;let e=this.presentedScene;e.add(this.xrLight),e.environment=this.xrLight.environment}));let r=await this.resolveARSession();r.addEventListener(`end`,()=>{this.postSessionCleanup()},{once:!0});let i=e.element.shadowRoot.querySelector(`.slot.exit-webxr-ar-button`);i.classList.add(`enabled`),i.addEventListener(`click`,this.onExitWebXRButtonContainerClick),this.exitWebXRButtonContainer=i;let a=await r.requestReferenceSpace(`viewer`);this.xrMode=r.interactionMode,this.tracking=!0,this.frames=0,this.initialized=!1,this.turntableRotation=e.yaw,this.goalYaw=e.yaw,this.goalScale=1,e.setBackground(null),this.oldShadowIntensity=e.shadowIntensity,e.setShadowIntensity(.01),this.oldTarget.copy(e.getTarget()),e.element.addEventListener(`load`,this.onUpdateScene);let o=yu*Math.PI/180,s=this.placeOnWall===!0?void 0:new XRRay(new DOMPoint(0,0,0),{x:0,y:-Math.sin(o),z:-Math.cos(o)});r.requestHitTestSource({space:a,offsetRay:s}).then(e=>{this.initialHitSource=e}),this.xrMode!==Hu.SCREEN_SPACE&&(this.setupXRControllers(),this.xDamper.setDecayTime(Cu),this.yDamper.setDecayTime(Cu),this.zDamper.setDecayTime(Cu),this.yawDamper.setDecayTime(Cu),this.pitchDamper.setDecayTime(Cu),this.rollDamper.setDecayTime(Cu),this.scaleDamper.setDecayTime(Cu)),this.currentSession=r,this.placementBox=new Ys(e,this.placeOnWall?`back`:`bottom`),this.placementBox&&this.placementBox.setScreenSpaceMode(this.xrMode===Hu.SCREEN_SPACE),this.placementComplete=!1,this.xrMode!==Hu.SCREEN_SPACE&&(this.menuPanel=new hu,e.add(this.menuPanel),this.menuPanel.updatePosition(e.getCamera(),this.placementBox)),this.lastTick=performance.now(),this.dispatchEvent({type:`status`,status:Pu.SESSION_STARTED})}setupXRControllerLine(e){if(!e.userData.line){let t=new x(Vu);t.name=`line`,t.scale.z=wu,e.userData.turning=!1,e.userData.line=t,e.add(t)}}setupController(e){this.setupXRControllerLine(e),e.addEventListener(`selectstart`,this.onControllerSelectStart),e.addEventListener(`selectend`,this.onControllerSelectEnd)}setupXRControllers(){this.xrController1=this.threeRenderer.xr.getController(0),this.xrController2=this.threeRenderer.xr.getController(1),this.setupController(this.xrController1),this.setupController(this.xrController2),this.scaleLine.name=`scale line`,this.scaleLine.visible=!1,this.xrController1.add(this.scaleLine);let e=this.presentedScene;e.add(this.xrController1),e.add(this.xrController2)}hover(e){if(this.xrMode===Hu.SCREEN_SPACE||this.selectedXRController==e)return!1;let t=this.presentedScene,n=this.placementBox.controllerIntersection(t,e);return e.userData.line.scale.z=n==null?wu:n.distance,n!=null}controllerSeparation(){return this.xrController1.position.distanceTo(this.xrController2.position)}async stopPresenting(){if(!this.isPresenting)return;let e=new Promise(e=>{this.resolveCleanup=e});try{await this.currentSession.end(),await e}catch(e){console.warn(`Error while trying to end WebXR AR session`),console.warn(e),this.postSessionCleanup()}}get isPresenting(){return this.presentedScene!=null}get target(){return this.oldTarget}updateTarget(){let e=this.presentedScene;if(e!=null){let t=e.getTarget();this.oldTarget.copy(t),this.placeOnWall?t.z=e.boundingBox.min.z:t.y=e.boundingBox.min.y,e.setTarget(t.x,t.y,t.z)}}cleanupXRController(e){e.userData.turning=!1,e.userData.line.visible=!0,e.removeEventListener(`selectstart`,this.onControllerSelectStart),e.removeEventListener(`selectend`,this.onControllerSelectEnd),e.removeFromParent()}postSessionCleanup(){let e=this.currentSession;e!=null&&(e.removeEventListener(`selectstart`,this.onSelectStart),e.removeEventListener(`selectend`,this.onSelectEnd),this.currentSession=null);let t=this.presentedScene;if(this._presentedScene=null,t!=null){let{element:e}=t;this.xrLight!=null&&(t.remove(this.xrLight),this.xrLight.dispose(),this.xrLight=null),this.menuPanel!=null&&(this.menuPanel.dispose(),this.menuPanel=null),t.add(t.scenePivot),t.scenePivot.quaternion.set(0,0,0,1),t.scenePivot.position.set(0,0,0),t.scenePivot.scale.set(1,1,1),t.setShadowOffset(0);let n=this.turntableRotation;n!=null&&(t.yaw=n);let r=this.oldShadowIntensity;r!=null&&t.setShadowIntensity(r),t.setEnvironmentAndSkybox(e[Io],e[Lo]);let i=this.oldTarget;t.setTarget(i.x,i.y,i.z),t.xrCamera=null,t.element.removeEventListener(`load`,this.onUpdateScene),t.orientHotspots(0);let{width:a,height:o}=e.getBoundingClientRect();t.setSize(a,o),requestAnimationFrame(()=>{t.element.dispatchEvent(new CustomEvent(`camera-change`,{detail:{source:su.NONE}}))})}this.renderer.height=0;let n=this.exitWebXRButtonContainer;n!=null&&(n.classList.remove(`enabled`),n.removeEventListener(`click`,this.onExitWebXRButtonContainerClick),this.exitWebXRButtonContainer=null);let r=this.transientHitTestSource;r!=null&&(r.cancel(),this.transientHitTestSource=null);let i=this.initialHitSource;i!=null&&(i.cancel(),this.initialHitSource=null),this.placementBox!=null&&(this.placementBox.dispose(),this.placementBox=null),this.xrMode!==Hu.SCREEN_SPACE&&(this.xrController1!=null&&(this.cleanupXRController(this.xrController1),this.xrController1=null),this.xrController2!=null&&(this.cleanupXRController(this.xrController2),this.xrController2=null),this.selectedXRController=null,this.scaleLine.visible=!1),this.isTranslating=!1,this.isRotating=!1,this.isTwoHandInteraction=!1,this.lastTick=null,this.turntableRotation=null,this.oldShadowIntensity=null,this.frame=null,this.inputSource=null,this.overlay!=null&&(this.overlay.removeEventListener(`beforexrselect`,this.onBeforeXRSelect),this.overlay=null),this.worldSpaceInitialPlacementDone=!1,this.resolveCleanup!=null&&this.resolveCleanup(),this.dispatchEvent({type:`status`,status:Pu.NOT_PRESENTING})}updateView(e){let t=this.presentedScene,n=this.threeRenderer.xr;n.updateCamera(Bu),t.xrCamera=n.getCamera();let{elements:r}=t.getCamera().matrixWorld;if(t.orientHotspots(Math.atan2(r[1],r[5])),this.initialized||=(this.placeInitially(),!0),e.requestViewportScale&&e.recommendedViewportScale){let t=e.recommendedViewportScale;e.requestViewportScale(Math.max(t,xu))}let i=n.getBaseLayer();if(i!=null){let t=i instanceof XRWebGLLayer?i.getViewport(e):n.getBinding().getViewSubImage(i,e).viewport;this.threeRenderer.setViewport(t.x,t.y,t.width,t.height)}}placeInitially(){let e=this.presentedScene,{scenePivot:t,element:n}=e,{position:r}=t,i=e.getCamera(),{width:a,height:o}=this.overlay.getBoundingClientRect();e.setSize(a,o),i.projectionMatrixInverse.copy(i.projectionMatrix).invert();let{theta:s}=n.getCameraOrbit(),c=i.getWorldDirection(Iu);if(e.yaw=Math.atan2(-c.x,-c.z)-s,this.goalYaw=e.yaw,this.xrMode===Hu.WORLD_SPACE&&!this.worldSpaceInitialPlacementDone){let{position:n,scale:a}=this.calculateWorldSpaceOptimalPlacement(e,i);this.goalPosition.copy(n),this.goalScale=a,this.initialModelScale=a,r.copy(n),t.scale.set(a,a,a),this.worldSpaceInitialPlacementDone=!0,this.calculateWorldSpaceScaleLimits(e),this.enableWorldSpaceUserInteraction()}else if(this.xrMode===Hu.SCREEN_SPACE){let t=Math.max(1,2*e.boundingSphere.radius);r.copy(i.position).add(c.multiplyScalar(t)),this.updateTarget();let n=e.getTarget();r.add(n).sub(this.oldTarget),this.goalPosition.copy(r)}if(e.setHotspotsVisibility(!0),this.xrMode===Hu.SCREEN_SPACE){let{session:e}=this.frame;e.addEventListener(`selectstart`,this.onSelectStart),e.addEventListener(`selectend`,this.onSelectEnd),e.requestHitTestSourceForTransientInput({profile:`generic-touchscreen`}).then(e=>{this.transientHitTestSource=e})}}getTouchLocation(){let{axes:e}=this.inputSource.gamepad,t=this.placementBox.getExpandedHit(this.presentedScene,e[0],e[1]);return t!=null&&(Iu.copy(t).sub(this.presentedScene.getCamera().position),Iu.length()>Su)?null:t}getHitPoint(e){let t=this.threeRenderer.xr.getReferenceSpace(),n=e.getPose(t);if(n==null)return null;let r=Ru.fromArray(n.transform.matrix);return this.placeOnWall===!0&&(this.goalYaw=Math.atan2(r.elements[4],r.elements[6])),r.elements[5]>.75===this.placeOnWall?null:zu.setFromMatrixPosition(r)}moveToFloor(e){if(this.xrMode===Hu.WORLD_SPACE&&!this.worldSpaceInitialPlacementDone){this.placementBox.show=!1,this.dispatchEvent({type:`status`,status:Pu.OBJECT_PLACED});return}let t=this.initialHitSource;if(t==null)return;let n=e.getHitTestResults(t);if(n.length==0)return;let r=n[0],i=this.getHitPoint(r);i!=null&&(this.placementBox.show=!0,this.isTranslating||(this.placeOnWall?this.goalPosition.copy(i):this.goalPosition.y=i.y),t.cancel(),this.initialHitSource=null,this.dispatchEvent({type:`status`,status:Pu.OBJECT_PLACED}))}fingerPolar(e){let t=e[0].inputSource.gamepad.axes,n=e[1].inputSource.gamepad.axes,r=n[0]-t[0],i=n[1]-t[1],a=Math.atan2(i,r),o=this.lastAngle-a;return o>Math.PI?o-=2*Math.PI:o<-Math.PI&&(o+=2*Math.PI),{separation:Math.sqrt(r*r+i*i),deltaYaw:o,angle:a}}setScale(e){let t=e/this.firstRatio;t=Math.abs(t-1)<bu?1:t,this.isWorldSpaceReady()&&(t=Math.max(this.minScale,Math.min(this.maxScale,t))),this.goalScale=t}processInput(e){let t=this.transientHitTestSource;if(t==null)return;let n=e.getHitTestResultsForTransientInput(t),r=this.presentedScene,i=r.scenePivot.scale.x;if(n.length===2){if(!this.wasTwoFingering){let{separation:e,angle:t}=this.fingerPolar(n);this.firstRatio=e/i,this.lastAngle=t,this.wasTwoFingering=!0,this.isTwoHandInteraction=!0;return}let{separation:e,deltaYaw:t,angle:a}=this.fingerPolar(n);this.goalYaw+=t,this.lastAngle=a,r.canScale&&this.setScale(e),this.isTwoHandInteraction=!0}else if(this.wasTwoFingering&&(this.wasTwoFingering=!1,this.isTwoHandInteraction=!1,this.firstRatio=0),this.isTranslating||this.isTwoHandInteraction||this.isRotating){if(this.isRotating){let e=this.inputSource.gamepad.axes[0]*vu;this.goalYaw+=e-this.lastAngle,this.lastAngle=e}else this.isTranslating&&n.forEach(e=>{if(e.inputSource!==this.inputSource)return;let t=null;if(e.results.length>0&&(t=this.getHitPoint(e.results[0])),t??=this.getTouchLocation(),t!=null){if(this.goalPosition.sub(this.lastDragPosition),this.isWorldSpaceReady())console.log(`[processInput] Setting goalPosition.y to hit.y:`,t.y),this.goalPosition.add(t);else if(this.placeOnWall===!1){let e=t.y-this.lastDragPosition.y;if(e<0){this.placementBox.offsetHeight=e/i,this.presentedScene.setShadowOffset(e);let n=Iu.copy(r.getCamera().position),a=-e/(n.y-t.y);n.multiplyScalar(a),t.multiplyScalar(1-a).add(n)}this.goalPosition.add(t)}else this.goalPosition.add(t);this.lastDragPosition.copy(t)}})}}applyXRControllerRotation(e,t){if(!e.userData.turning)return;let n=(e.position.x-e.userData.initialX)*Eu;this.deltaRotation.setFromAxisAngle(Tu,n),t.quaternion.multiplyQuaternions(this.deltaRotation,t.quaternion)}handleScalingInXR(e,t){if(this.xrMode===Hu.WORLD_SPACE&&!this.worldSpaceInitialPlacementDone)return;if(this.xrController1&&this.xrController2&&this.isTwoHandInteraction){let e=this.controllerSeparation();this.setScale(e),this.scaleLine.scale.z=-e,this.scaleLine.lookAt(this.xrController2.position)}let n=e.scenePivot.scale.x;if(this.goalScale!==n){let r=this.scaleDamper.update(n,this.goalScale,t,1);e.scenePivot.scale.set(r,r,r)}}updatePivotPosition(e,t){let{scenePivot:n}=e,r=this.placementBox,i=e.boundingSphere.radius,a=this.goalPosition,o=n.position,s=su.NONE;if(!a.equals(o)){s=su.USER_INTERACTION;let{x:n,y:c,z:l}=o;if(n=this.xDamper.update(n,a.x,t,i),c=this.yDamper.update(c,a.y,t,i),l=this.zDamper.update(l,a.z,t,i),o.set(n,c,l),this.xrMode===Hu.SCREEN_SPACE&&!this.isTranslating){let t=a.y-c;this.placementComplete&&this.placeOnWall===!1?(r.offsetHeight=t/e.scenePivot.scale.x,e.setShadowOffset(t)):t===0&&(this.placementComplete=!0,r.show=!1,e.setShadowIntensity(_u))}this.xrMode!==Hu.SCREEN_SPACE&&a.equals(o)&&e.setShadowIntensity(_u),this.isWorldSpaceReady()&&e.setShadowIntensity(_u)}if(this.xrMode===Hu.WORLD_SPACE&&!this.worldSpaceInitialPlacementDone&&this.goalScale!==n.scale.x){let e=this.scaleDamper.update(n.scale.x,this.goalScale,t,1);n.scale.set(e,e,e)}return e.updateTarget(t),s}updateYaw(e,t){Lu.setFromAxisAngle(Iu.set(0,1,0),this.goalYaw);let n=e.scenePivot.quaternion.angleTo(Lu),r=n-this.yawDamper.update(n,0,t,Math.PI);e.scenePivot.quaternion.rotateTowards(Lu,r)}updateMenuPanel(e,t,n){this.menuPanel&&(this.menuPanel.updateOpacity(n),this.menuPanel.updatePosition(e.getCamera(),t))}applyXRInputToScene(e){let t=this.presentedScene,n=t.scenePivot,r=this.placementBox;if(this.updatePlacementBoxOpacity(r,e),this.updateTwoHandInteractionState(),this.applyXRControllerRotations(n),this.handleScalingInXR(t,e),n.parent!==t){this.updateMenuPanel(t,r,e);return}let i=this.updatePivotPosition(t,e);this.updateYaw(t,e),this.dispatchCameraChangeEvent(t,i),this.updateMenuPanel(t,r,e)}updatePlacementBoxOpacity(e,t){let n=this.presentedScene.getCamera();e.update(t,n.position);let r=this.hover(this.xrController1),i=this.hover(this.xrController2),a=(r||i)&&!this.isTwoHandInteraction;e.setInteractionState(this.isTranslating||this.isRotating,a)}updateTwoHandInteractionState(){let e=this.xrController1?.userData.isSelected&&this.xrController2?.userData.isSelected;this.isTwoHandInteraction=!!e}applyXRControllerRotations(e){this.isTwoHandInteraction||(this.xrController1&&this.applyXRControllerRotation(this.xrController1,e),this.xrController2&&this.applyXRControllerRotation(this.xrController2,e))}dispatchCameraChangeEvent(e,t){e.element.dispatchEvent(new CustomEvent(`camera-change`,{detail:{source:t}}))}updateXRControllerHover(){let e=this.hover(this.xrController1),t=this.hover(this.xrController2),n=(e||t)&&!this.isTwoHandInteraction;this.placementBox&&(this.placementBox.setInteractionState(this.isTranslating||this.isRotating,n),this.placementBox.show=n)}enableWorldSpaceUserInteraction(){this.placementBox&&(this.placementBox.show=!0),this.presentedScene&&this.presentedScene.setShadowIntensity(_u)}handleFirstView(e,t){(this.xrMode!==Hu.WORLD_SPACE||!this.worldSpaceInitialPlacementDone)&&this.moveToFloor(e),this.processInput(e);let n=t-this.lastTick;this.applyXRInputToScene(n),this.renderer.preRender(this.presentedScene,t,n),this.lastTick=t,this.presentedScene.renderShadow(this.threeRenderer)}onWebXRFrame(e,t){this.xrMode!==Hu.SCREEN_SPACE&&this.updateXRControllerHover(),this.frame=t,++this.frames;let n=this.threeRenderer.xr.getReferenceSpace(),r=t.getViewerPose(n);r==null&&this.tracking===!0&&this.frames>gu&&(this.tracking=!1,this.dispatchEvent({type:`tracking`,status:Fu.NOT_TRACKING}));let i=this.presentedScene;if(r==null||i==null||!i.element.loaded){this.threeRenderer.clear();return}this.tracking===!1&&(this.tracking=!0,this.dispatchEvent({type:`tracking`,status:Fu.TRACKING}));let a=!0;for(let n of r.views)this.updateView(n),a&&=(this.handleFirstView(t,e),!1),this.threeRenderer.render(i,i.getCamera())}calculateWorldSpaceOptimalPlacement(e,t){let n=e.boundingBox,r={x:(n.max.x-n.min.x)/2,y:(n.max.y-n.min.y)/2,z:(n.max.z-n.min.z)/2},i=Au,a=Math.max(1.65,2*Math.max(r.x,r.z)+i),o=Du*Math.PI/180,s=new S(0,-a*Math.sin(o),-a*Math.cos(o)),c=t.matrixWorld,l=s.clone().applyMatrix4(c),u=Math.max(r.x,r.z)+i,d=r.y,f=a*Ou,p=a*Ou/Math.max(d,ku),m=f/Math.max(u,ku),h=Math.min(p,m);return{position:l.clone().sub(new S(0,h*r.y,0)),scale:h}}calculateWorldSpaceScaleLimits(e){let t=e.size,n=Math.max(t.x,t.y,t.z),r=Math.max(Math.min(t.x,t.y,t.z),Mu),i=ku/Math.max(n,Mu),a=ju/Math.max(r,Mu);this.minScale=Math.min(i,a,this.goalScale),this.maxScale=Math.max(i,a,this.goalScale)}},Wu=Symbol(`prepared`),Gu=Symbol(`prepare`),Ku=Symbol(`preparedGLTF`),qu=Symbol(`clone`),Ju=class{static prepare(e){if(e.scene==null)throw Error(`Model does not have a scene`);if(e[Wu])return e;let t=this[Gu](e);return t[Wu]=!0,t}static[Gu](e){let{scene:t}=e,n=[t];return Object.assign(Object.assign({},e),{scene:t,scenes:n})}get parser(){return this[Ku].parser}get animations(){return this[Ku].animations}get scene(){return this[Ku].scene}get scenes(){return this[Ku].scenes}get cameras(){return this[Ku].cameras}get asset(){return this[Ku].asset}get userData(){return this[Ku].userData}constructor(e){this[Ku]=e}clone(){let e=this.constructor;return new e(this[qu]())}dispose(){this.scenes.forEach(e=>{e.traverse(e=>{let t=e;t.material&&((Array.isArray(t.material)?t.material:[t.material]).forEach(e=>{for(let t in e){let n=e[t];if(n instanceof O){let e=n.source.data;e.close!=null&&e.close(),n.dispose()}}e.dispose()}),t.geometry.dispose())})})}[qu](){let e=this[Ku],t=nt(this.scene);Yu(t,this.scene);let n=[t],r=e.userData?Object.assign({},e.userData):{};return Object.assign(Object.assign({},e),{scene:t,scenes:n,userData:r})}},Yu=(e,t)=>{Xu(e,t,(e,t)=>{t.userData.variantMaterials!==void 0&&(e.userData.variantMaterials=new Map(t.userData.variantMaterials)),t.userData.variantData!==void 0&&(e.userData.variantData=t.userData.variantData),t.userData.originalMaterial!==void 0&&(e.userData.originalMaterial=t.userData.originalMaterial)})},Xu=(e,t,n)=>{n(e,t);for(let r=0;r<e.children.length;r++)Xu(e.children[r],t.children[r],n)},Zu=Symbol(`threeGLTF`),Qu=Symbol(`gltf`),$u=Symbol(`gltfElementMap`),ed=Symbol(`threeObjectMap`),td=Symbol(`parallelTraverseThreeScene`),nd=Symbol(`correlateOriginalThreeGLTF`),rd=Symbol(`correlateCloneThreeGLTF`),id=class e{static from(e,t){return t==null?this[nd](e):this[rd](e,t)}static[nd](t){let n=t.parser.json,r=t.parser.associations,i=new Map,a={name:`Default`},o={type:`materials`,index:-1};for(let e of r.keys())e instanceof it&&r.get(e)==null&&(o.index<0&&(n.materials??=[],o.index=n.materials.length,n.materials.push(a)),e.name=a.name,r.set(e,{materials:o.index}));for(let[e,t]of r){t&&(e.userData=e.userData||{},e.userData.associations=t);for(let r in t)if(r!=null&&r!==`primitives`){let a=r,o=(n[a]||[])[t[a]];if(o==null)continue;let s=i.get(o);s??(s=new Set,i.set(o,s)),s.add(e)}}return new e(t,n,r,i)}static[rd](t,n){let r=n.threeGLTF,i=n.gltf,a=JSON.parse(JSON.stringify(i)),o=new Map,s=new Map;for(let e=0;e<r.scenes.length;e++)this[td](r.scenes[e],t.scenes[e],(e,t)=>{let r=n.threeObjectMap.get(e);if(r!=null){for(let e in r)if(e!=null&&e!==`primitives`){let n=e,i=r[n],c=a[n][i],l=o.get(t)||{};l[n]=i,o.set(t,l);let u=s.get(c)||new Set;u.add(t),s.set(c,u)}}});return new e(t,a,o,s)}static[td](e,t,n){let r=(e,t)=>{if(n(e,t),e.isObject3D){let i=e,a=t;if(i.material){if(Array.isArray(i.material))for(let e=0;e<i.material.length;++e)n(i.material[e],a.material[e]);else n(i.material,a.material)}for(let n=0;n<e.children.length;++n)r(e.children[n],t.children[n])}};r(e,t)}get threeGLTF(){return this[Zu]}get gltf(){return this[Qu]}get gltfElementMap(){return this[$u]}get threeObjectMap(){return this[ed]}constructor(e,t,n,r){this[Zu]=e,this[Qu]=t,this[$u]=r,this[ed]=n}},ad=Symbol(`correlatedSceneGraph`),od=class extends Ju{static[Gu](e){let t=super[Gu](e);t[ad]??(t[ad]=id.from(t));let{scene:n}=t,r=new Ge(void 0,1/0);return n.traverse(e=>{e.renderOrder=1e3,e.frustumCulled=!1,e.name||=e.uuid;let n=e;if(n.material){let{geometry:e}=n;n.castShadow=!0,n.isSkinnedMesh&&(e.boundingSphere=r,e.boundingBox=null);let i=n.material;if(i.isMeshBasicMaterial===!0&&(i.toneMapped=!1),i.shadowSide=0,i.aoMap){let{gltf:n,threeObjectMap:r}=t[ad],a=r.get(i);if(n.materials!=null&&a!=null&&a.materials!=null){let t=n.materials[a.materials];t.occlusionTexture&&t.occlusionTexture.texCoord===0&&e.attributes.uv!=null&&e.setAttribute(`uv2`,e.attributes.uv)}}}}),t}get correlatedSceneGraph(){return this[Ku][ad]}[qu](){let e=super[qu](),t=new Map;return e.scene.traverse(e=>{let n=e;if(n.material){let e=n.material;if(e!=null){if(t.has(e.uuid)){n.material=t.get(e.uuid);return}n.material=e.clone(),t.set(e.uuid,n.material)}}let r=e;r.target!==void 0&&r.add(r.target)}),e[ad]=id.from(e,this.correlatedSceneGraph),e}},sd=(e,t,n)=>{let r;switch(e){case At:r=new Uint8ClampedArray(t*n*4);break;case me:r=new Uint16Array(t*n*4);break;case pe:r=new Uint32Array(t*n*4);break;case Xe:r=new Int8Array(t*n*4);break;case u:r=new Int16Array(t*n*4);break;case fe:r=new Int32Array(t*n*4);break;case T:r=new Float32Array(t*n*4);break;default:throw Error(`Unsupported data type`)}return r},cd,ld=(e,t,n,r)=>{if(cd!==void 0)return cd;let i=new N(1,1,r);t.setRenderTarget(i);let a=new U(new c,new z({color:16777215}));t.render(a,n),t.setRenderTarget(null);let o=sd(e,i.width,i.height);return t.readRenderTargetPixels(i,0,0,i.width,i.height,o),i.dispose(),a.geometry.dispose(),a.material.dispose(),cd=o[0]!==0,cd},ud=class e{_renderer;_rendererIsDisposable=!1;_material;_scene;_camera;_quad;_renderTarget;_width;_height;_type;_colorSpace;_supportsReadPixels=!0;constructor(t){this._width=t.width,this._height=t.height,this._type=t.type,this._colorSpace=t.colorSpace;let n={format:k,depthBuffer:!1,stencilBuffer:!1,type:this._type,colorSpace:this._colorSpace,anisotropy:t.renderTargetOptions?.anisotropy===void 0?1:t.renderTargetOptions?.anisotropy,generateMipmaps:t.renderTargetOptions?.generateMipmaps!==void 0&&t.renderTargetOptions?.generateMipmaps,magFilter:t.renderTargetOptions?.magFilter===void 0?ye:t.renderTargetOptions?.magFilter,minFilter:t.renderTargetOptions?.minFilter===void 0?ye:t.renderTargetOptions?.minFilter,samples:t.renderTargetOptions?.samples===void 0?void 0:t.renderTargetOptions?.samples,wrapS:t.renderTargetOptions?.wrapS===void 0?Pe:t.renderTargetOptions?.wrapS,wrapT:t.renderTargetOptions?.wrapT===void 0?Pe:t.renderTargetOptions?.wrapT};if(this._material=t.material,t.renderer?this._renderer=t.renderer:(this._renderer=e.instantiateRenderer(),this._rendererIsDisposable=!0),this._scene=new s,this._camera=new Oe,this._camera.position.set(0,0,10),this._camera.left=-.5,this._camera.right=.5,this._camera.top=.5,this._camera.bottom=-.5,this._camera.updateProjectionMatrix(),!ld(this._type,this._renderer,this._camera,n)){let e;switch(this._type){case me:e=this._renderer.extensions.has(`EXT_color_buffer_float`)?T:void 0}e===void 0?(this._supportsReadPixels=!1,console.warn(`This browser dos not support toArray or toDataTexture, calls to those methods will result in an error thrown`)):(console.warn(`This browser does not support reading pixels from ${this._type} RenderTargets, switching to ${T}`),this._type=e)}this._quad=new U(new c,this._material),this._quad.geometry.computeBoundingBox(),this._scene.add(this._quad),this._renderTarget=new N(this.width,this.height,n),this._renderTarget.texture.mapping=t.renderTargetOptions?.mapping===void 0?300:t.renderTargetOptions?.mapping}static instantiateRenderer(){let e=new so;return e.setSize(128,128),e}render=()=>{this._renderer.setRenderTarget(this._renderTarget);try{this._renderer.render(this._scene,this._camera)}catch(e){throw this._renderer.setRenderTarget(null),e}this._renderer.setRenderTarget(null)};toArray(){if(!this._supportsReadPixels)throw Error(`Can't read pixels in this browser`);let e=sd(this._type,this._width,this._height);return this._renderer.readRenderTargetPixels(this._renderTarget,0,0,this._width,this._height,e),e}toDataTexture(e){let n=new le(this.toArray(),this.width,this.height,k,this._type,e?.mapping||300,e?.wrapS||1001,e?.wrapT||1001,e?.magFilter||1006,e?.minFilter||1006,e?.anisotropy||1,t);return n.generateMipmaps=e?.generateMipmaps!==void 0&&e?.generateMipmaps,n}disposeOnDemandRenderer(){this._renderer.setRenderTarget(null),this._rendererIsDisposable&&(this._renderer.dispose(),this._renderer.forceContextLoss())}dispose(e){this.disposeOnDemandRenderer(),e&&this.renderTarget.dispose(),this.material instanceof Ct&&Object.values(this.material.uniforms).forEach(e=>{e.value instanceof O&&e.value.dispose()}),Object.values(this.material).forEach(e=>{e instanceof O&&e.dispose()}),this.material.dispose(),this._quad.geometry.dispose()}get width(){return this._width}set width(e){this._width=e,this._renderTarget.setSize(this._width,this._height)}get height(){return this._height}set height(e){this._height=e,this._renderTarget.setSize(this._width,this._height)}get renderer(){return this._renderer}get renderTarget(){return this._renderTarget}set renderTarget(e){this._renderTarget=e,this._width=e.width,this._height=e.height}get material(){return this._material}get type(){return this._type}get colorSpace(){return this._colorSpace}},dd=class extends Error{},fd=class extends Error{},pd=(e,t,n)=>{let r=RegExp(`${t}="([^"]*)"`,`i`).exec(e);if(r)return r[1];let i=RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`,`i`).exec(e);if(i){let e=i[1].match(/<rdf:li>([^<]*)<\/rdf:li>/g);return e&&e.length===3?e.map(e=>e.replace(/<\/?rdf:li>/g,``)):i[1].trim()}if(n!==void 0)return n;throw Error(`Can't find ${t} in gainmap metadata`)},md=e=>{let t;t=typeof TextDecoder<`u`?new TextDecoder().decode(e):e.toString();let n=t.indexOf(`<x:xmpmeta`);for(;n!==-1;){let e=t.indexOf(`x:xmpmeta>`,n),r=t.slice(n,e+10);try{let e=pd(r,`hdrgm:GainMapMin`,`0`),t=pd(r,`hdrgm:GainMapMax`),n=pd(r,`hdrgm:Gamma`,`1`),i=pd(r,`hdrgm:OffsetSDR`,`0.015625`),a=pd(r,`hdrgm:OffsetHDR`,`0.015625`),o=/hdrgm:HDRCapacityMin="([^"]*)"/.exec(r),s=o?o[1]:`0`,c=/hdrgm:HDRCapacityMax="([^"]*)"/.exec(r);if(!c)throw Error(`Incomplete gainmap metadata`);let l=c[1];return{gainMapMin:Array.isArray(e)?e.map(e=>parseFloat(e)):[parseFloat(e),parseFloat(e),parseFloat(e)],gainMapMax:Array.isArray(t)?t.map(e=>parseFloat(e)):[parseFloat(t),parseFloat(t),parseFloat(t)],gamma:Array.isArray(n)?n.map(e=>parseFloat(e)):[parseFloat(n),parseFloat(n),parseFloat(n)],offsetSdr:Array.isArray(i)?i.map(e=>parseFloat(e)):[parseFloat(i),parseFloat(i),parseFloat(i)],offsetHdr:Array.isArray(a)?a.map(e=>parseFloat(e)):[parseFloat(a),parseFloat(a),parseFloat(a)],hdrCapacityMin:parseFloat(s),hdrCapacityMax:parseFloat(l)}}catch{}n=t.indexOf(`<x:xmpmeta`,e)}},hd=class{options;constructor(e){this.options={debug:e&&e.debug!==void 0?e.debug:!1,extractFII:e&&e.extractFII!==void 0?e.extractFII:!0,extractNonFII:e&&e.extractNonFII!==void 0?e.extractNonFII:!0}}extract(e){return new Promise((t,n)=>{let r=this.options.debug,i=new DataView(e.buffer);if(i.getUint16(0)!==65496){n(Error(`Not a valid jpeg`));return}let a=i.byteLength,o=2,s=0,c;for(;o<a;){if(++s>250){n(Error(`Found no marker after ${s} loops 😵`));return}if(i.getUint8(o)!==255){n(Error(`Not a valid marker at offset 0x${o.toString(16)}, found: 0x${i.getUint8(o).toString(16)}`));return}if(c=i.getUint8(o+1),r&&console.log(`Marker: ${c.toString(16)}`),c===226){r&&console.log(`Found APP2 marker (0xffe2)`);let e=o+4;if(i.getUint32(e)===1297106432){let r=e+4,a;if(i.getUint16(r)===18761)a=!1;else if(i.getUint16(r)===19789)a=!0;else{n(Error(`No valid endianness marker found in TIFF header`));return}if(i.getUint16(r+2,!a)!==42){n(Error(`Not valid TIFF data! (no 0x002A marker)`));return}let o=i.getUint32(r+4,!a);if(o<8){n(Error(`Not valid TIFF data! (First offset less than 8)`));return}let s=r+o,c=i.getUint16(s,!a),l=s+2,u=0;for(let e=l;e<l+12*c;e+=12)i.getUint16(e,!a)===45057&&(u=i.getUint32(e+8,!a));let d=s+2+c*12+4,f=[];for(let e=d;e<d+u*16;e+=16){let t={MPType:i.getUint32(e,!a),size:i.getUint32(e+4,!a),dataOffset:i.getUint32(e+8,!a),dependantImages:i.getUint32(e+12,!a),start:-1,end:-1,isFII:!1};t.dataOffset?(t.start=r+t.dataOffset,t.isFII=!1):(t.start=0,t.isFII=!0),t.end=t.start+t.size,f.push(t)}if(this.options.extractNonFII&&f.length){let e=new Blob([i]),n=[];for(let t of f){if(t.isFII&&!this.options.extractFII)continue;let r=e.slice(t.start,t.end+1,`image/jpeg`);n.push(r)}t(n)}}}o+=2+i.getUint16(o+2)}})}},gd=async e=>{let t=md(e);if(!t)throw new fd(`Gain map XMP metadata not found`);let n=await new hd({extractFII:!0,extractNonFII:!0}).extract(e);if(n.length!==2)throw new dd(`Gain map recovery image not found`);return{sdr:new Uint8Array(await n[0].arrayBuffer()),gainMap:new Uint8Array(await n[1].arrayBuffer()),metadata:t}},_d=e=>new Promise((t,n)=>{let r=document.createElement(`img`);r.onload=()=>{t(r)},r.onerror=e=>{n(e)},r.src=URL.createObjectURL(e)}),vd=class extends gt{_renderer;_renderTargetOptions;_internalLoadingManager;_config;constructor(e,t){super(t),this._config=e,e.renderer&&(this._renderer=e.renderer),this._internalLoadingManager=new tt}setRenderer(e){return this._renderer=e,this}setRenderTargetOptions(e){return this._renderTargetOptions=e,this}prepareQuadRenderer(){this._renderer||console.warn(`WARNING: A Renderer was not passed to this Loader constructor or in setRenderer, the result of this Loader will need to be converted to a Data Texture with toDataTexture() before you can use it in your renderer.`);let e=this._config.createMaterial({gainMapMax:[1,1,1],gainMapMin:[0,0,0],gamma:[1,1,1],offsetHdr:[1,1,1],offsetSdr:[1,1,1],hdrCapacityMax:1,hdrCapacityMin:0,maxDisplayBoost:1,gainMap:new O,sdr:new O});return this._config.createQuadRenderer({width:16,height:16,type:me,colorSpace:t,material:e,renderer:this._renderer,renderTargetOptions:this._renderTargetOptions})}async processImages(e,t,n){let r=t?new Blob([t],{type:`image/jpeg`}):void 0,i=new Blob([e],{type:`image/jpeg`}),a,o,s=!1;if(typeof createImageBitmap>`u`){let e=await Promise.all([r?_d(r):Promise.resolve(void 0),_d(i)]);o=e[0],a=e[1],s=n===`flipY`}else{let e=await Promise.all([r?createImageBitmap(r,{imageOrientation:n||`flipY`}):Promise.resolve(void 0),createImageBitmap(i,{imageOrientation:n||`flipY`})]);o=e[0],a=e[1]}return{sdrImage:a,gainMapImage:o,needsFlip:s}}createTextures(e,n,r){let i=new O(n||new ImageData(2,2),300,Pe,Pe,ye,_e,k,At,1,t);i.flipY=r,i.needsUpdate=!0;let a=new O(e,300,Pe,Pe,ye,_e,k,At,1,Et);return a.flipY=r,a.needsUpdate=!0,{gainMap:i,sdr:a}}updateQuadRenderer(e,t,n,r,i){e.width=t.width,e.height=t.height,e.material.gainMap=n,e.material.sdr=r,e.material.gainMapMin=i.gainMapMin,e.material.gainMapMax=i.gainMapMax,e.material.offsetHdr=i.offsetHdr,e.material.offsetSdr=i.offsetSdr,e.material.gamma=i.gamma,e.material.hdrCapacityMin=i.hdrCapacityMin,e.material.hdrCapacityMax=i.hdrCapacityMax,e.material.maxDisplayBoost=2**i.hdrCapacityMax,e.material.needsUpdate=!0}},yd=`
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,bd=`
// min half float value
#define HALF_FLOAT_MIN vec3( -65504, -65504, -65504 )
// max half float value
#define HALF_FLOAT_MAX vec3( 65504, 65504, 65504 )

uniform sampler2D sdr;
uniform sampler2D gainMap;
uniform vec3 gamma;
uniform vec3 offsetHdr;
uniform vec3 offsetSdr;
uniform vec3 gainMapMin;
uniform vec3 gainMapMax;
uniform float weightFactor;

varying vec2 vUv;

void main() {
  vec3 rgb = texture2D( sdr, vUv ).rgb;
  vec3 recovery = texture2D( gainMap, vUv ).rgb;
  vec3 logRecovery = pow( recovery, gamma );
  vec3 logBoost = gainMapMin * ( 1.0 - logRecovery ) + gainMapMax * logRecovery;
  vec3 hdrColor = (rgb + offsetSdr) * exp2( logBoost * weightFactor ) - offsetHdr;
  vec3 clampedHdrColor = max( HALF_FLOAT_MIN, min( HALF_FLOAT_MAX, hdrColor ));
  gl_FragColor = vec4( clampedHdrColor , 1.0 );
}
`,xd=class extends Ct{_maxDisplayBoost;_hdrCapacityMin;_hdrCapacityMax;constructor({gamma:e,offsetHdr:t,offsetSdr:n,gainMapMin:r,gainMapMax:i,maxDisplayBoost:a,hdrCapacityMin:o,hdrCapacityMax:s,sdr:c,gainMap:l}){super({name:`GainMapDecoderMaterial`,vertexShader:yd,fragmentShader:bd,uniforms:{sdr:{value:c},gainMap:{value:l},gamma:{value:new S(1/e[0],1/e[1],1/e[2])},offsetHdr:{value:new S().fromArray(t)},offsetSdr:{value:new S().fromArray(n)},gainMapMin:{value:new S().fromArray(r)},gainMapMax:{value:new S().fromArray(i)},weightFactor:{value:(Math.log2(a)-o)/(s-o)}},blending:0,depthTest:!1,depthWrite:!1}),this._maxDisplayBoost=a,this._hdrCapacityMin=o,this._hdrCapacityMax=s,this.needsUpdate=!0,this.uniformsNeedUpdate=!0}get sdr(){return this.uniforms.sdr.value}set sdr(e){this.uniforms.sdr.value=e}get gainMap(){return this.uniforms.gainMap.value}set gainMap(e){this.uniforms.gainMap.value=e}get offsetHdr(){return this.uniforms.offsetHdr.value.toArray()}set offsetHdr(e){this.uniforms.offsetHdr.value.fromArray(e)}get offsetSdr(){return this.uniforms.offsetSdr.value.toArray()}set offsetSdr(e){this.uniforms.offsetSdr.value.fromArray(e)}get gainMapMin(){return this.uniforms.gainMapMin.value.toArray()}set gainMapMin(e){this.uniforms.gainMapMin.value.fromArray(e)}get gainMapMax(){return this.uniforms.gainMapMax.value.toArray()}set gainMapMax(e){this.uniforms.gainMapMax.value.fromArray(e)}get gamma(){let e=this.uniforms.gamma.value;return[1/e.x,1/e.y,1/e.z]}set gamma(e){let t=this.uniforms.gamma.value;t.x=1/e[0],t.y=1/e[1],t.z=1/e[2]}get hdrCapacityMin(){return this._hdrCapacityMin}set hdrCapacityMin(e){this._hdrCapacityMin=e,this.calculateWeight()}get hdrCapacityMax(){return this._hdrCapacityMax}set hdrCapacityMax(e){this._hdrCapacityMax=e,this.calculateWeight()}get maxDisplayBoost(){return this._maxDisplayBoost}set maxDisplayBoost(e){this._maxDisplayBoost=Math.max(1,Math.min(65504,e)),this.calculateWeight()}calculateWeight(){let e=(Math.log2(this._maxDisplayBoost)-this._hdrCapacityMin)/(this._hdrCapacityMax-this._hdrCapacityMin);this.uniforms.weightFactor.value=Math.max(0,Math.min(1,e))}},Sd=class extends vd{constructor(e,t){super({renderer:e,createMaterial:e=>new xd(e),createQuadRenderer:e=>new ud(e)},t)}async render(e,t,n,r){let{sdrImage:i,gainMapImage:a,needsFlip:o}=await this.processImages(n,r,`flipY`),{gainMap:s,sdr:c}=this.createTextures(i,a,o);this.updateQuadRenderer(e,i,s,c,t),e.render()}},Cd=class extends Sd{load(e,t,n,r){let i=this.prepareQuadRenderer(),a=new m(this._internalLoadingManager);return a.setResponseType(`arraybuffer`),a.setRequestHeader(this.requestHeader),a.setPath(this.path),a.setWithCredentials(this.withCredentials),this.manager.itemStart(e),a.load(e,async n=>{if(typeof n==`string`)throw Error(`Invalid buffer, received [string], was expecting [ArrayBuffer]`);let a=new Uint8Array(n),o,s,c;try{let e=await gd(a);o=e.sdr,s=e.gainMap,c=e.metadata}catch(t){if(t instanceof fd||t instanceof dd)console.warn(`Failure to reconstruct an HDR image from ${e}: Gain map metadata not found in the file, HDRJPGLoader will render the SDR jpeg`),c={gainMapMin:[0,0,0],gainMapMax:[1,1,1],gamma:[1,1,1],hdrCapacityMin:0,hdrCapacityMax:1,offsetHdr:[0,0,0],offsetSdr:[0,0,0]},o=a;else throw t}try{await this.render(i,c,o.buffer,s?.buffer)}catch(t){this.manager.itemError(e),typeof r==`function`&&r(t),i.disposeOnDemandRenderer();return}typeof t==`function`&&t(i),this.manager.itemEnd(e),i.disposeOnDemandRenderer()},n,t=>{this.manager.itemError(e),typeof r==`function`&&r(t)}),i}},wd=class extends d{constructor(e){super(e),this.type=me}parse(e){let t=function(e,t){switch(e){case 1:throw Error(`THREE.HDRLoader: Read Error: `+(t||``));case 2:throw Error(`THREE.HDRLoader: Write Error: `+(t||``));case 3:throw Error(`THREE.HDRLoader: Bad File Format: `+(t||``));default:case 4:throw Error(`THREE.HDRLoader: Memory Error: `+(t||``))}},n=function(e,t,n){t||=1024;let r=e.pos,i=-1,a=0,o=``,s=String.fromCharCode.apply(null,new Uint16Array(e.subarray(r,r+128)));for(;0>(i=s.indexOf(`
`))&&a<t&&r<e.byteLength;)o+=s,a+=s.length,r+=128,s+=String.fromCharCode.apply(null,new Uint16Array(e.subarray(r,r+128)));return-1<i&&(!1!==n&&(e.pos+=a+i+1),o+s.slice(0,i))},r=function(e){let r=/^#\?(\S+)/,i=/^\s*GAMMA\s*=\s*(\d+(\.\d+)?)\s*$/,a=/^\s*EXPOSURE\s*=\s*(\d+(\.\d+)?)\s*$/,o=/^\s*FORMAT=(\S+)\s*$/,s=/^\s*\-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/,c={valid:0,string:``,comments:``,programtype:`RGBE`,format:``,gamma:1,exposure:1,width:0,height:0},l,u;for((e.pos>=e.byteLength||!(l=n(e)))&&t(1,`no header found`),(u=l.match(r))||t(3,`bad initial token`),c.valid|=1,c.programtype=u[1],c.string+=l+`
`;l=n(e),!1!==l;)if(c.string+=l+`
`,l.charAt(0)===`#`)c.comments+=l+`
`;else if((u=l.match(i))&&(c.gamma=parseFloat(u[1])),(u=l.match(a))&&(c.exposure=parseFloat(u[1])),(u=l.match(o))&&(c.valid|=2,c.format=u[1]),(u=l.match(s))&&(c.valid|=4,c.height=parseInt(u[1],10),c.width=parseInt(u[2],10)),c.valid&2&&c.valid&4)break;return c.valid&2||t(3,`missing format specifier`),c.valid&4||t(3,`missing image size specifier`),c},i=function(e,n,r){let i=n;if(i<8||i>32767||e[0]!==2||e[1]!==2||e[2]&128)return new Uint8Array(e);i!==(e[2]<<8|e[3])&&t(3,`wrong scanline width`);let a=new Uint8Array(4*n*r);a.length||t(4,`unable to allocate buffer space`);let o=0,s=0,c=4*i,l=new Uint8Array(4),u=new Uint8Array(c),d=r;for(;d>0&&s<e.byteLength;){s+4>e.byteLength&&t(1),l[0]=e[s++],l[1]=e[s++],l[2]=e[s++],l[3]=e[s++],(l[0]!=2||l[1]!=2||(l[2]<<8|l[3])!=i)&&t(3,`bad rgbe scanline format`);let n=0,r;for(;n<c&&s<e.byteLength;){r=e[s++];let i=r>128;if(i&&(r-=128),(r===0||n+r>c)&&t(3,`bad scanline data`),i){let t=e[s++];for(let e=0;e<r;e++)u[n++]=t}else u.set(e.subarray(s,s+r),n),n+=r,s+=r}let f=i;for(let e=0;e<f;e++){let t=0;a[o]=u[e+t],t+=i,a[o+1]=u[e+t],t+=i,a[o+2]=u[e+t],t+=i,a[o+3]=u[e+t],o+=4}d--}return a},a=function(e,t,n,r){let i=2**(e[t+3]-128)/255;n[r+0]=e[t+0]*i,n[r+1]=e[t+1]*i,n[r+2]=e[t+2]*i,n[r+3]=1},o=function(e,t,n,r){let i=2**(e[t+3]-128)/255;n[r+0]=l.toHalfFloat(Math.min(e[t+0]*i,65504)),n[r+1]=l.toHalfFloat(Math.min(e[t+1]*i,65504)),n[r+2]=l.toHalfFloat(Math.min(e[t+2]*i,65504)),n[r+3]=l.toHalfFloat(1)},s=new Uint8Array(e);s.pos=0;let c=r(s),u=c.width,d=c.height,f=i(s.subarray(s.pos),u,d),p,m,h;switch(this.type){case T:h=f.length/4;let e=new Float32Array(h*4);for(let t=0;t<h;t++)a(f,t*4,e,t*4);p=e,m=T;break;case me:h=f.length/4;let t=new Uint16Array(h*4);for(let e=0;e<h;e++)o(f,e*4,t,e*4);p=t,m=me;break;default:throw Error(`THREE.HDRLoader: Unsupported type: `+this.type)}return{width:u,height:d,data:p,header:c.string,gamma:c.gamma,exposure:c.exposure,type:m}}setDataType(e){return this.type=e,this}load(e,n,r,i){function a(e,r){switch(e.type){case T:case me:e.colorSpace=t,e.minFilter=ye,e.magFilter=ye,e.generateMipmaps=!1,e.flipY=!0}n&&n(e,r)}return super.load(e,a,r,i)}},Td=class extends wd{constructor(e){console.warn(`RGBELoader has been deprecated. Please use HDRLoader instead.`),super(e)}},Ed={topLight:{intensity:500,position:[.418,16.199,.3]},room:{position:[-.757,13.219,.717],scale:[31.713,28.305,28.591]},boxes:[{position:[-10.906,2.009,1.846],rotation:-.195,scale:[2.328,7.905,4.651]},{position:[-5.607,-.754,-.758],rotation:.994,scale:[1.97,1.534,3.955]},{position:[6.167,.857,7.803],rotation:.561,scale:[3.927,6.285,3.687]},{position:[-2.017,.018,6.124],rotation:.333,scale:[2.002,4.566,2.064]},{position:[2.291,-.756,-2.621],rotation:-.286,scale:[1.546,1.552,1.496]},{position:[-2.193,-.369,-5.547],rotation:.516,scale:[3.875,3.487,2.986]}],lights:[{intensity:50,position:[-16.116,14.37,8.208],scale:[.1,2.428,2.739]},{intensity:50,position:[-16.109,18.021,-8.207],scale:[.1,2.425,2.751]},{intensity:17,position:[14.904,12.198,-1.832],scale:[.15,4.265,6.331]},{intensity:43,position:[-.462,8.89,14.52],scale:[4.38,5.441,.088]},{intensity:20,position:[3.235,11.486,-12.541],scale:[2.5,2,.1]},{intensity:100,position:[0,20,0],scale:[1,.1,1]}]},Dd={topLight:{intensity:400,position:[.5,14,.5]},room:{position:[0,13.2,0],scale:[31.5,28.5,31.5]},boxes:[{position:[-10.906,-1,1.846],rotation:-.195,scale:[2.328,7.905,4.651]},{position:[-5.607,-.754,-.758],rotation:.994,scale:[1.97,1.534,3.955]},{position:[6.167,-.16,7.803],rotation:.561,scale:[3.927,6.285,3.687]},{position:[-2.017,.018,6.124],rotation:.333,scale:[2.002,4.566,2.064]},{position:[2.291,-.756,-2.621],rotation:-.286,scale:[1.546,1.552,1.496]},{position:[-2.193,-.369,-5.547],rotation:.516,scale:[3.875,3.487,2.986]}],lights:[{intensity:80,position:[-14,10,8],scale:[.1,2.5,2.5]},{intensity:80,position:[-14,14,-4],scale:[.1,2.5,2.5]},{intensity:23,position:[14,12,0],scale:[.1,5,5]},{intensity:16,position:[0,9,14],scale:[5,5,.1]},{intensity:80,position:[7,8,-14],scale:[2.5,2.5,.1]},{intensity:80,position:[-7,16,-14],scale:[2.5,2.5,.1]},{intensity:1,position:[0,20,0],scale:[.1,.1,.1]}]},Od=class extends s{constructor(e){super(),this.position.y=-3.5;let t=new R;t.deleteAttribute(`uv`);let n=new Qe({metalness:0,side:1}),r=new Qe({metalness:0}),i=e==`legacy`?Ed:Dd,a=new wt(16777215,i.topLight.intensity,28,2);a.position.set(...i.topLight.position),this.add(a);let o=new U(t,n);o.position.set(...i.room.position),o.scale.set(...i.room.scale),this.add(o);for(let e of i.boxes){let n=new U(t,r);n.position.set(...e.position),n.rotation.set(0,e.rotation,0),n.scale.set(...e.scale),this.add(n)}for(let e of i.lights){let n=new U(t,this.createAreaLightMaterial(e.intensity));n.position.set(...e.position),n.scale.set(...e.scale),this.add(n)}}createAreaLightMaterial(e){let t=new z;return t.color.setScalar(e),t}},kd=.04,Ad=20,jd=/\.hdr(\.js)?$/,Md=/\.ktx2(\?|#|$)/,Nd=class{constructor(e){this.threeRenderer=e,this.lottieLoaderUrl=``,this._ldrLoader=null,this._imageLoader=null,this._hdrLoader=null,this._lottieLoader=null,this.generatedEnvironmentMap=null,this.generatedEnvironmentMapAlt=null,this.skyboxCache=new Map,this.blurMaterial=null,this.blurScene=null}ldrLoader(e){return this._ldrLoader??=new A,this._ldrLoader.setWithCredentials(e),this._ldrLoader}imageLoader(e){return this._imageLoader??=new Cd(this.threeRenderer),this._imageLoader.setWithCredentials(e),this._imageLoader}hdrLoader(e){return this._hdrLoader??(this._hdrLoader=new Td,this._hdrLoader.setDataType(me)),this._hdrLoader.setWithCredentials(e),this._hdrLoader}async getLottieLoader(t){if(this._lottieLoader==null){let{LottieLoader:t}=await e(async()=>{let{LottieLoader:e}=await import(this.lottieLoaderUrl);return{LottieLoader:e}},[],import.meta.url);this._lottieLoader=new t}return this._lottieLoader.setWithCredentials(t),this._lottieLoader}async loadImage(e,t,n){if(n===`image/ktx2`||Md.test(e))return this.loadKTX2(e,t);let r=await new Promise((n,r)=>this.ldrLoader(t).load(e,n,()=>{},r));return r.name=e,r.flipY=!1,r}async loadKTX2(e,t){we.setWithCredentials(t);let n=await new Promise((t,n)=>we.load(e,t,()=>{},n));return n.name=e,n.flipY=!1,n}async loadLottie(e,t,n){let r=await this.getLottieLoader(n);r.setQuality(t);let i=await new Promise((t,n)=>r.load(e,t,()=>{},n));return i.name=e,i}async loadEquirect(e,t=!1,n=()=>{}){try{let r=jd.test(e),i=r?this.hdrLoader(t):this.imageLoader(t),a=await new Promise((t,r)=>i.load(e,e=>{let{renderTarget:n}=e;if(n!=null){let r;try{let t=e.toDataTexture();t.needsUpdate=!0;let i=t.image.data,a=!1,o=i.length;for(let e=0;e<o;e++)if(i[e]!==0){a=!0;break}a?(r=t,e.dispose(!0)):(console.warn(`Decoded DataTexture is completely black, falling back to render target texture.`),r=n.texture,e.dispose(!1))}catch(t){console.warn(`Failed to convert gainmap to DataTexture, falling back to render target texture:`,t),r=n.texture,e.dispose(!1)}t(r)}else t(e)},e=>{n(e.loaded/e.total*.9)},r));return n(1),a.name=e,a.mapping=303,!r&&a.type!==1016&&(a.colorSpace=Et),a}finally{n&&n(1)}}async generateEnvironmentMapAndSkybox(e=null,t=null,n=()=>{},r=!1){let i=t!==`legacy`;(t===`legacy`||t===`neutral`)&&(t=null),t=So(t);let a=Promise.resolve(null),o;e&&(a=this.loadEquirectFromUrl(e,r,n)),o=t?this.loadEquirectFromUrl(t,r,n):e?this.loadEquirectFromUrl(e,r,n):i?this.loadGeneratedEnvironmentMapAlt():this.loadGeneratedEnvironmentMap();let[s,c]=await Promise.all([o,a]);if(s==null)throw Error(`Failed to load environment map.`);return{environmentMap:s,skybox:c}}async loadEquirectFromUrl(e,t,n){if(!this.skyboxCache.has(e)){let r=this.loadEquirect(e,t,n);this.skyboxCache.set(e,r)}return this.skyboxCache.get(e)}async GenerateEnvironmentMap(e,n){await ko();let r=this.threeRenderer,i=new wr(256,{generateMipmaps:!1,type:me,format:k,colorSpace:t,depthBuffer:!0}),a=new De(.1,100,i),o=a.renderTarget.texture;o.name=n;let s=r.outputColorSpace,c=r.toneMapping;return r.toneMapping=0,r.outputColorSpace=t,a.update(r,e),this.blurCubemap(i,kd),r.toneMapping=c,r.outputColorSpace=s,o}async loadGeneratedEnvironmentMap(){return this.generatedEnvironmentMap??=this.GenerateEnvironmentMap(new Od(`legacy`),`legacy`),this.generatedEnvironmentMap}async loadGeneratedEnvironmentMapAlt(){return this.generatedEnvironmentMapAlt??=this.GenerateEnvironmentMap(new Od(`neutral`),`neutral`),this.generatedEnvironmentMapAlt}blurCubemap(e,t){if(this.blurMaterial==null){this.blurMaterial=this.getBlurShader(Ad);let e=new R,t=new U(e,this.blurMaterial);this.blurScene=new s,this.blurScene.add(t)}let n=e.clone();this.halfblur(e,n,t,`latitudinal`),this.halfblur(n,e,t,`longitudinal`)}halfblur(e,t,n,r){let i=e.width,a=isFinite(n)?Math.PI/(2*i):2*Math.PI/39,o=n/a,s=isFinite(n)?1+Math.floor(3*o):Ad;s>Ad&&console.warn(`sigmaRadians, ${n}, is too large and will clip, as it requested ${s} samples when the maximum is set to ${Ad}`);let c=[],l=0;for(let e=0;e<Ad;++e){let t=e/o,n=Math.exp(-t*t/2);c.push(n),e==0?l+=n:e<s&&(l+=2*n)}for(let e=0;e<c.length;e++)c[e]=c[e]/l;let u=this.blurMaterial.uniforms;u.envMap.value=e.texture,u.samples.value=s,u.weights.value=c,u.latitudinal.value=r===`latitudinal`,u.dTheta.value=a,new De(.1,100,t).update(this.threeRenderer,this.blurScene)}getBlurShader(e){let t=new Float32Array(e),n=new S(0,1,0);return new Ct({name:`SphericalGaussianBlur`,defines:{n:e},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:t},latitudinal:{value:!1},dTheta:{value:0},poleAxis:{value:n}},vertexShader:`
      
      varying vec3 vOutputDirection;
  
      void main() {
  
        vOutputDirection = vec3( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
      }
    `,fragmentShader:`
        varying vec3 vOutputDirection;
  
        uniform samplerCube envMap;
        uniform int samples;
        uniform float weights[ n ];
        uniform bool latitudinal;
        uniform float dTheta;
        uniform vec3 poleAxis;
  
        vec3 getSample( float theta, vec3 axis ) {
  
          float cosTheta = cos( theta );
          // Rodrigues' axis-angle rotation
          vec3 sampleDirection = vOutputDirection * cosTheta
            + cross( axis, vOutputDirection ) * sin( theta )
            + axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );
  
          return vec3( textureCube( envMap, sampleDirection ) );
  
        }
  
        void main() {
  
          vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );
  
          if ( all( equal( axis, vec3( 0.0 ) ) ) ) {
  
            axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );
  
          }
  
          axis = normalize( axis );
  
          gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
          gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );
  
          for ( int i = 1; i < n; i++ ) {
  
            if ( i >= samples ) {
  
              break;
  
            }
  
            float theta = dTheta * float( i );
            gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
            gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );
  
          }
        }
      `,blending:0,depthTest:!1,depthWrite:!1,side:1})}async dispose(){for(let[,e]of this.skyboxCache)(await e).dispose();this.generatedEnvironmentMap!=null&&((await this.generatedEnvironmentMap).dispose(),this.generatedEnvironmentMap=null),this.generatedEnvironmentMapAlt!=null&&((await this.generatedEnvironmentMapAlt).dispose(),this.generatedEnvironmentMapAlt=null),this.blurMaterial!=null&&this.blurMaterial.dispose()}},Pd=.2,Fd=40,Id=60,Ld=5,Rd=[1,.79,.62,.5,.4,.31,.25],zd=3,Bd=1.3,Vd=class e extends ee{static get singleton(){return this._singleton||=new e({powerPreference:(self.ModelViewerElement||{}).powerPreference||`high-performance`,debug:Oo()}),this._singleton}static resetSingleton(){let t=this._singleton.dispose();for(let e of t)e.disconnectedCallback();this._singleton=new e({powerPreference:(self.ModelViewerElement||{}).powerPreference||`high-performance`,debug:Oo()});for(let e of t)e.connectedCallback()}get canRender(){return this.threeRenderer!=null}get scaleFactor(){return Rd[this.scaleStep]}set minScale(e){let t=1;for(;t<Rd.length&&!(Rd[t]<e);)++t;this.lastStep=t-1}constructor(e){super(),this.loader=new lt(od),this.width=0,this.height=0,this.dpr=1,this.scenes=new Set,this.multipleScenesVisible=!1,this.lastTick=performance.now(),this.renderedLastFrame=!1,this.scaleStep=0,this.lastStep=zd,this.avgFrameDuration=50,this.onWebGLContextLost=e=>{this.dispatchEvent({type:`contextlost`,sourceEvent:e})},this.onWebGLContextRestored=()=>{var e;(e=this.textureUtils)==null||e.dispose(),this.textureUtils=this.canRender?new Nd(this.threeRenderer):null;for(let e of this.scenes)e.element[Ro]()},this.dpr=window.devicePixelRatio,this.canvas3D=document.createElement(`canvas`),this.canvas3D.id=`webgl-canvas`,this.canvas3D.classList.add(`show`);try{this.threeRenderer=new so({canvas:this.canvas3D,alpha:!0,antialias:!0,powerPreference:e.powerPreference,preserveDrawingBuffer:!0}),this.threeRenderer.autoClear=!0,this.threeRenderer.setPixelRatio(1),this.threeRenderer.debug={checkShaderErrors:!!e.debug,onShaderError:null},this.threeRenderer.toneMapping=7}catch(e){console.warn(e)}this.arRenderer=this.canRender?new Uu(this):null,this.textureUtils=this.canRender?new Nd(this.threeRenderer):null,this.canRender&&lt.initializeKTX2Loader(this.threeRenderer),this.canvas3D.addEventListener(`webglcontextlost`,this.onWebGLContextLost),this.canvas3D.addEventListener(`webglcontextrestored`,this.onWebGLContextRestored),this.updateRendererSize()}registerScene(e){if(this.scenes.add(e),e.forceRescale(),this.canRender){let t=new ct;this.threeRenderer.getSize(t),e.canvas.width=t.x,e.canvas.height=t.y,this.scenes.size>0&&this.threeRenderer.setAnimationLoop((e,t)=>this.render(e,t))}}unregisterScene(e){this.scenes.delete(e),this.canvas3D.parentElement===e.canvas.parentElement&&e.canvas.parentElement.removeChild(this.canvas3D),this.canRender&&this.scenes.size===0&&this.threeRenderer.setAnimationLoop(null)}displayCanvas(e){return e.element.modelIsVisible&&!this.multipleScenesVisible?this.canvas3D:e.element[Km]}countVisibleScenes(){let{canvas3D:e}=this,t=0,n=null;for(let r of this.scenes){let{element:i}=r;i.modelIsVisible&&r.externalRenderer==null&&++t,e.parentElement===r.canvas.parentElement&&(n=r)}let r=t>1;if(n!=null){let t=r&&!this.multipleScenesVisible,i=!n.element.modelIsVisible;if(t||i){let{width:t,height:r}=this.sceneSize(n);this.copyPixels(n,t,r),e.parentElement.removeChild(e)}}this.multipleScenesVisible=r}updateRendererSize(){var e;let t=window.devicePixelRatio;if(t!==this.dpr)for(let e of this.scenes){let{element:t}=e;t[Nm](t.getBoundingClientRect())}let n=0,r=0;for(let e of this.scenes)n=Math.max(n,e.width),r=Math.max(r,e.height);if(n!==this.width||r!==this.height||t!==this.dpr){this.width=n,this.height=r,this.dpr=t,n=Math.ceil(n*t),r=Math.ceil(r*t),this.canRender&&this.threeRenderer.setSize(n,r,!1);for(let t of this.scenes){let{canvas:i}=t;i.width=n,i.height=r,t.forceRescale(),(e=t.effectRenderer)==null||e.setSize(n,r)}}}updateRendererScale(e){let t=this.scaleStep;this.avgFrameDuration+=Do(Pd*(e-this.avgFrameDuration),-5,Ld),this.avgFrameDuration>Id?++this.scaleStep:this.avgFrameDuration<Fd&&this.scaleStep>0&&--this.scaleStep,this.scaleStep=Math.min(this.scaleStep,this.lastStep),t!==this.scaleStep&&(this.avgFrameDuration=50)}shouldRender(e){if(e.shouldRender())e.scaleStep!=this.scaleStep&&(e.scaleStep=this.scaleStep,this.rescaleCanvas(e));else if(e.scaleStep!=0)e.scaleStep=0,this.rescaleCanvas(e);else return!1;return!0}rescaleCanvas(e){let t=Rd[e.scaleStep],n=Math.ceil(this.width/t),r=Math.ceil(this.height/t),{style:i}=e.canvas;i.width=`${n}px`,i.height=`${r}px`,this.canvas3D.style.width=`${n}px`,this.canvas3D.style.height=`${r}px`;let a=this.dpr*t,o=t<1?`GPU throttling`:this.dpr===window.devicePixelRatio?``:`No meta viewport tag`;e.element.dispatchEvent(new CustomEvent(`render-scale`,{detail:{reportedDpr:window.devicePixelRatio,renderedDpr:a,minimumDpr:this.dpr*Rd[this.lastStep],pixelWidth:Math.ceil(e.width*a),pixelHeight:Math.ceil(e.height*a),reason:o}}))}sceneSize(e){let{dpr:t}=this,n=Rd[e.scaleStep];return{width:Math.min(Math.ceil(e.width*n*t),this.canvas3D.width),height:Math.min(Math.ceil(e.height*n*t),this.canvas3D.height)}}copyPixels(e,t,n){let r=e.context;r==null?console.log(`could not acquire 2d context`):(r.clearRect(0,0,t,n),r.drawImage(this.canvas3D,0,0,t,n,0,0,t,n),e.canvas.classList.add(`show`))}orderedScenes(){let e=[];for(let t of[!1,!0])for(let n of this.scenes)n.element.modelIsVisible===t&&e.push(n);return e}get isPresenting(){return this.arRenderer?.isPresenting===!0}preRender(e,t,n){let{element:r,exposure:i,toneMapping:a}=e;r[Jm](t,n);let o=typeof i==`number`&&!Number.isNaN(i),s=r.environmentImage,c=r.skyboxImage,l=a===7&&(s===`neutral`||s===`legacy`||!s&&!c);this.threeRenderer.toneMappingExposure=(o?i:1)*(l?Bd:1)}render(e,t){if(t!=null){this.arRenderer!=null&&this.arRenderer.onWebXRFrame(e,t);return}let n=e-this.lastTick;if(this.lastTick=e,!this.canRender||this.isPresenting)return;this.countVisibleScenes(),this.updateRendererSize(),this.renderedLastFrame&&=(this.updateRendererScale(n),!1);let{canvas3D:r}=this;for(let t of this.orderedScenes()){let{element:i}=t;if(!i.loaded||!i.modelIsVisible&&t.renderCount>0||(this.preRender(t,e,n),!this.shouldRender(t)))continue;if(t.externalRenderer!=null){let e=t.getCamera();e.updateMatrix();let{matrix:n,projectionMatrix:r}=e,i=n.elements.slice(),a=t.getTarget();i[12]+=a.x,i[13]+=a.y,i[14]+=a.z,t.externalRenderer.render({viewMatrix:i,projectionMatrix:r.elements});continue}if(!i.modelIsVisible&&!this.multipleScenesVisible)for(let e of this.scenes)e.element.modelIsVisible&&e.queueRender();let{width:a,height:o}=this.sceneSize(t);t.renderShadow(this.threeRenderer),this.threeRenderer.setRenderTarget(null),this.threeRenderer.setViewport(0,Math.ceil(this.height*this.dpr)-o,a,o),t.effectRenderer==null?(this.threeRenderer.autoClear=!0,this.threeRenderer.toneMapping=t.toneMapping,this.threeRenderer.render(t,t.camera)):t.effectRenderer.render(n),this.multipleScenesVisible||!t.element.modelIsVisible&&t.renderCount===0?this.copyPixels(t,a,o):r.parentElement!==t.canvas.parentElement&&(t.canvas.parentElement.appendChild(r),t.canvas.classList.remove(`show`)),t.hasRendered(),++t.renderCount,this.renderedLastFrame=!0}}dispose(){this.textureUtils!=null&&this.textureUtils.dispose(),this.threeRenderer!=null&&this.threeRenderer.dispose(),this.textureUtils=null,this.threeRenderer=null;let e=[];for(let t of this.scenes)e.push(t.element);return this.canvas3D.removeEventListener(`webglcontextlost`,this.onWebGLContextLost),this.canvas3D.removeEventListener(`webglcontextrestored`,this.onWebGLContextRestored),e}},Y=Symbol(`correlatedObjects`),Hd=Symbol(`onUpdate`),Ud=class{constructor(e,t){this[Hd]=e,this[Y]=t}},Wd=new z,Gd=new c(2,2),Kd=0,qd=Symbol(`threeTexture`),Jd=Symbol(`threeTextures`),Yd=class extends Ud{get[qd](){return this[Y]?.values().next().value}get[Jd](){return this[Y]}constructor(e,t){super(e,new Set(t?[t]:[]));let n=this[qd].image;n.src||=t.name?t.name:`adhoc_image`+Kd++,n.name||=t&&n&&n.src?n.src.split(`/`).pop():`adhoc_image`}get name(){return this[qd].image.name||``}get uri(){return this[qd].image.src}get bufferView(){return this[qd].image.bufferView}get element(){let e=this[qd];if(e&&(e.isCanvasTexture||e.isVideoTexture))return e.image}get animation(){let e=this[qd];if(e&&e.isCanvasTexture&&e.animation)return e.animation}get type(){return this.uri==null?`embedded`:`external`}set name(e){for(let t of this[Jd])t.image.name=e}update(){let e=this[qd];e&&e.isCanvasTexture&&!e.animation&&(this[qd].needsUpdate=!0,this[Hd]())}async createThumbnail(e,t){let n=new s;Wd.map=this[qd];let r=new U(Gd,Wd);n.add(r);let i=new Oe(-1,1,1,-1,0,1),{threeRenderer:a}=Vd.singleton,o=new N(e,t);a.setRenderTarget(o),a.render(n,i),a.setRenderTarget(null);let c=new Uint8Array(e*t*4);a.readRenderTargetPixels(o,0,0,e,t,c),xm.width=e,xm.height=t;let l=xm.getContext(`2d`),u=l.createImageData(e,t);return u.data.set(c),l.putImageData(u,0,0),new Promise(async(e,t)=>{xm.toBlob(n=>{if(!n)return t(`Failed to capture thumbnail.`);e(URL.createObjectURL(n))},`image/png`)})}},Xd;(function(e){e[e.Nearest=9728]=`Nearest`,e[e.Linear=9729]=`Linear`,e[e.NearestMipmapNearest=9984]=`NearestMipmapNearest`,e[e.LinearMipmapNearest=9985]=`LinearMipmapNearest`,e[e.NearestMipmapLinear=9986]=`NearestMipmapLinear`,e[e.LinearMipmapLinear=9987]=`LinearMipmapLinear`})(Xd||={});var Zd;(function(e){e[e.ClampToEdge=33071]=`ClampToEdge`,e[e.MirroredRepeat=33648]=`MirroredRepeat`,e[e.Repeat=10497]=`Repeat`})(Zd||={});var Qd=new Map([[Zd.Repeat,Re],[Zd.ClampToEdge,Pe],[Zd.MirroredRepeat,ze]]),$d=new Map([[Re,Zd.Repeat],[Pe,Zd.ClampToEdge],[ze,Zd.MirroredRepeat]]),ef=new Map([[Xd.Nearest,Ie],[Xd.Linear,ye],[Xd.NearestMipmapNearest,xt],[Xd.LinearMipmapNearest,ae],[Xd.NearestMipmapLinear,Ce],[Xd.LinearMipmapLinear,xe]]),tf=new Map([[Ie,Xd.Nearest],[ye,Xd.Linear],[xt,Xd.NearestMipmapNearest],[ae,Xd.LinearMipmapNearest],[Ce,Xd.NearestMipmapLinear],[xe,Xd.LinearMipmapLinear]]),nf=new Map([[Xd.Nearest,Ie],[Xd.Linear,ye]]),rf=new Map([[Ie,Xd.Nearest],[ye,Xd.Linear]]),af=e=>tf.has(e),of=e=>rf.has(e),sf=e=>$d.has(e),cf=(e,t)=>{switch(e){case`minFilter`:return af(t);case`magFilter`:return of(t);case`wrapS`:case`wrapT`:return sf(t);case`rotation`:case`repeat`:case`offset`:return!0;default:throw Error(`Cannot configure property "${e}" on Sampler`)}},lf=Symbol(`threeTexture`),uf=Symbol(`threeTextures`),df=Symbol(`setProperty`),ff=class extends Ud{get[lf](){return this[Y]?.values().next().value}get[uf](){return this[Y]}constructor(e,t){super(e,new Set(t?[t]:[]))}get name(){return this[lf].name||``}get minFilter(){return tf.get(this[lf].minFilter)}get magFilter(){return rf.get(this[lf].magFilter)}get wrapS(){return $d.get(this[lf].wrapS)}get wrapT(){return $d.get(this[lf].wrapT)}get rotation(){return this[lf].rotation}get scale(){return nh(this[lf].repeat)}get offset(){return nh(this[lf].offset)}setMinFilter(e){this[df](`minFilter`,ef.get(e))}setMagFilter(e){this[df](`magFilter`,nf.get(e))}setWrapS(e){this[df](`wrapS`,Qd.get(e))}setWrapT(e){this[df](`wrapT`,Qd.get(e))}setRotation(e){e??=0,this[df](`rotation`,e)}setScale(e){e??={u:1,v:1},this[df](`repeat`,new ct(e.u,e.v))}setOffset(e){e??={u:0,v:0},this[df](`offset`,new ct(e.u,e.v))}[df](e,t){if(cf(e,t))for(let n of this[uf])n[e]=t,n.needsUpdate=!0;this[Hd]()}},pf=Symbol(`image`),mf=Symbol(`sampler`),hf=Symbol(`threeTexture`),gf=class extends Ud{get[hf](){return this[Y]?.values().next().value}constructor(e,t){super(e,new Set(t?[t]:[])),this[mf]=new ff(e,t),this[pf]=new Yd(e,t)}get name(){return this[hf].name||``}set name(e){for(let t of this[Y])t.name=e}get sampler(){return this[mf]}get source(){return this[pf]}},_f,vf,yf,bf=Symbol(`texture`),xf=Symbol(`transform`),Sf=Symbol(`materials`),Cf=Symbol(`usage`),wf=Symbol(`onUpdate`),Tf=Symbol(`activeVideo`),X;(function(e){e[e.Base=0]=`Base`,e[e.MetallicRoughness=1]=`MetallicRoughness`,e[e.Normal=2]=`Normal`,e[e.Occlusion=3]=`Occlusion`,e[e.Emissive=4]=`Emissive`,e[e.Clearcoat=5]=`Clearcoat`,e[e.ClearcoatRoughness=6]=`ClearcoatRoughness`,e[e.ClearcoatNormal=7]=`ClearcoatNormal`,e[e.SheenColor=8]=`SheenColor`,e[e.SheenRoughness=9]=`SheenRoughness`,e[e.Transmission=10]=`Transmission`,e[e.Thickness=11]=`Thickness`,e[e.Specular=12]=`Specular`,e[e.SpecularColor=13]=`SpecularColor`,e[e.Iridescence=14]=`Iridescence`,e[e.IridescenceThickness=15]=`IridescenceThickness`,e[e.Anisotropy=16]=`Anisotropy`})(X||={});var Ef=class{constructor(e,t,n,r){this[_f]=null,this[vf]={rotation:0,scale:new ct(1,1),offset:new ct(0,0)},this[yf]=!1,n&&(this[xf].rotation=n.rotation,this[xf].scale.copy(n.repeat),this[xf].offset.copy(n.offset),this[bf]=new gf(e,n)),this[wf]=e,this[Sf]=r,this[Cf]=t}get texture(){return this[bf]}setTexture(e){let n=e==null?null:e.source[qd],r=this[bf]?.source[qd];if(r!=null&&r.isVideoTexture?this[Tf]=!1:this[bf]?.source.animation&&this[bf].source.animation.removeEventListener(`enterFrame`,this[wf]),this[bf]=e,n!=null&&n.isVideoTexture){let e=n.image;if(this[Tf]=!0,e.requestVideoFrameCallback!=null){let t=()=>{this[Tf]&&(this[wf](),e.requestVideoFrameCallback(t))};e.requestVideoFrameCallback(t)}else{let e=()=>{this[Tf]&&(this[wf](),requestAnimationFrame(e))};requestAnimationFrame(e)}}else e?.source.animation!=null&&e.source.animation.addEventListener(`enterFrame`,this[wf]);let i=Et;if(this[Sf])for(let e of this[Sf]){switch(this[Cf]){case X.Base:e.map=n;break;case X.MetallicRoughness:i=t,e.metalnessMap=n,e.roughnessMap=n;break;case X.Normal:i=t,e.normalMap=n;break;case X.Occlusion:i=t,e.aoMap=n;break;case X.Emissive:e.emissiveMap=n;break;case X.Clearcoat:e.clearcoatMap=n;break;case X.ClearcoatRoughness:e.clearcoatRoughnessMap=n;break;case X.ClearcoatNormal:e.clearcoatNormalMap=n;break;case X.SheenColor:e.sheenColorMap=n;break;case X.SheenRoughness:e.sheenRoughnessMap=n;break;case X.Transmission:e.transmissionMap=n;break;case X.Thickness:e.thicknessMap=n;break;case X.Specular:e.specularIntensityMap=n;break;case X.SpecularColor:e.specularColorMap=n;break;case X.Iridescence:e.iridescenceMap=n;break;case X.IridescenceThickness:e.iridescenceThicknessMap=n;break;case X.Anisotropy:e.anisotropyMap=n}e.needsUpdate=!0}n&&(n.colorSpace=i,n.rotation=this[xf].rotation,n.repeat=this[xf].scale,n.offset=this[xf].offset),this[wf]()}};_f=bf,vf=xf,yf=Tf;var Df=Symbol(`threeMaterial`),Of=Symbol(`threeMaterials`),kf=Symbol(`baseColorTexture`),Af=Symbol(`metallicRoughnessTexture`),jf=class extends Ud{get[Of](){return this[Y]}get[Df](){return this[Y]?.values().next().value}constructor(e,t){super(e,t);let{map:n,metalnessMap:r}=t.values().next().value;this[kf]=new Ef(e,X.Base,n,t),this[Af]=new Ef(e,X.MetallicRoughness,r,t)}get baseColorFactor(){let e=[0,0,0,this[Df].opacity];return this[Df].color.toArray(e),e}get metallicFactor(){return this[Df].metalness}get roughnessFactor(){return this[Df].roughness}get baseColorTexture(){return this[kf]}get metallicRoughnessTexture(){return this[Af]}setBaseColorFactor(e){let t=new I;e instanceof Array?t.fromArray(e):t.set(e);for(let n of this[Of])n.color.set(t),e instanceof Array&&e.length>3?n.opacity=e[3]:(e=[0,0,0,n.opacity],t.toArray(e));this[Hd]()}setMetallicFactor(e){for(let t of this[Of])t.metalness=e;this[Hd]()}setRoughnessFactor(e){for(let t of this[Of])t.roughness=e;this[Hd]()}},Mf,Nf,Pf=Symbol(`pbrMetallicRoughness`),Ff=Symbol(`normalTexture`),If=Symbol(`occlusionTexture`),Lf=Symbol(`emissiveTexture`),Rf=Symbol(`backingThreeMaterial`),zf=Symbol(`applyAlphaCutoff`),Bf=Symbol(`getAlphaMode`),Vf=Symbol(`lazyLoadGLTFInfo`),Hf=Symbol(`initialize`),Uf=Symbol(`getLoadedMaterial`),Z=Symbol(`ensureMaterialIsLoaded`),Wf=Symbol(`gltfIndex`),Gf=Symbol(`setActive`),Kf=Symbol(`variantIndices`),qf=Symbol(`isActive`),Jf=Symbol(`modelVariants`),Yf=Symbol(`name`),Xf=Symbol(`pbrTextures`),Zf=class extends Ud{get[(Mf=Kf,Nf=Xf,Rf)](){return this[Y].values().next().value}constructor(e,t,n,r,i,a,o=void 0){super(e,i),this[Mf]=new Set,this[Nf]=new Map,this[Wf]=t,this[qf]=n,this[Jf]=r,this[Yf]=a,o==null?this[Hf]():this[Vf]=o}[Hf](){let e=this[Hd],t=this[Y];this[Pf]=new jf(e,t);let{normalMap:n,aoMap:r,emissiveMap:i}=t.values().next().value;this[Ff]=new Ef(e,X.Normal,n,t),this[If]=new Ef(e,X.Occlusion,r,t),this[Lf]=new Ef(e,X.Emissive,i,t);let a=n=>{this[Xf].set(n,new Ef(e,n,null,t))};a(X.Clearcoat),a(X.ClearcoatRoughness),a(X.ClearcoatNormal),a(X.SheenColor),a(X.SheenRoughness),a(X.Transmission),a(X.Thickness),a(X.Specular),a(X.SpecularColor),a(X.Iridescence),a(X.IridescenceThickness),a(X.Anisotropy)}async[Uf](){if(this[Vf]!=null){let e=await this[Vf].doLazyLoad();return this[Hf](),this[Vf]=void 0,this.ensureLoaded=async()=>{},e}return null}colorFromRgb(e){let t=new I;return e instanceof Array?t.fromArray(e):t.set(e),t}[Z](){if(this[Vf]!=null)throw Error(`Material "${this.name}" has not been loaded, call 'await
    myMaterial.ensureLoaded()' before using an unloaded material.`)}async ensureLoaded(){await this[Uf]()}get isLoaded(){return this[Vf]==null}get isActive(){return this[qf]}[Gf](e){this[qf]=e}get name(){return this[Yf]||``}set name(e){if(this[Yf]=e,this[Y]!=null)for(let t of this[Y])t.name=e}get pbrMetallicRoughness(){return this[Z](),this[Pf]}get normalTexture(){return this[Z](),this[Ff]}get occlusionTexture(){return this[Z](),this[If]}get emissiveTexture(){return this[Z](),this[Lf]}get emissiveFactor(){return this[Z](),this[Rf].emissive.toArray()}get index(){return this[Wf]}hasVariant(e){let t=this[Jf].get(e);return t!=null&&this[Kf].has(t.index)}setEmissiveFactor(e){this[Z]();let t=this.colorFromRgb(e);for(let e of this[Y])e.emissive.set(t);this[Hd]()}[Bf](){return this[Rf].transparent?`BLEND`:this[Rf].alphaTest>0?`MASK`:`OPAQUE`}[zf](){this[Z]();for(let e of this[Y])this[Bf]()===`MASK`?e.alphaTest??=.5:e.alphaTest=void 0,e.needsUpdate=!0}setAlphaCutoff(e){this[Z]();for(let t of this[Y])t.alphaTest=e,t.needsUpdate=!0;this[zf](),this[Hd]()}getAlphaCutoff(){return this[Z](),this[Rf].alphaTest}setDoubleSided(e){this[Z]();for(let t of this[Y])t.side=e?2:0,t.needsUpdate=!0;this[Hd]()}getDoubleSided(){return this[Z](),this[Rf].side==2}setAlphaMode(e){this[Z]();let t=(e,t)=>{e.transparent=t,e.depthWrite=!t};for(let n of this[Y])t(n,e===`BLEND`),n.alphaTest=e===`MASK`?.5:void 0,n.needsUpdate=!0;this[Hd]()}getAlphaMode(){return this[Z](),this[Bf]()}get emissiveStrength(){return this[Z](),this[Rf].emissiveIntensity}setEmissiveStrength(e){this[Z]();for(let t of this[Y])t.emissiveIntensity=e;this[Hd]()}get clearcoatFactor(){return this[Z](),this[Rf].clearcoat}get clearcoatRoughnessFactor(){return this[Z](),this[Rf].clearcoatRoughness}get clearcoatTexture(){return this[Z](),this[Xf].get(X.Clearcoat)}get clearcoatRoughnessTexture(){return this[Z](),this[Xf].get(X.ClearcoatRoughness)}get clearcoatNormalTexture(){return this[Z](),this[Xf].get(X.ClearcoatNormal)}get clearcoatNormalScale(){return this[Z](),this[Rf].clearcoatNormalScale.x}setClearcoatFactor(e){this[Z]();for(let t of this[Y])t.clearcoat=e;this[Hd]()}setClearcoatRoughnessFactor(e){this[Z]();for(let t of this[Y])t.clearcoatRoughness=e;this[Hd]()}setClearcoatNormalScale(e){this[Z]();for(let t of this[Y])t.clearcoatNormalScale=new ct(e,e);this[Hd]()}get ior(){return this[Z](),this[Rf].ior}setIor(e){this[Z]();for(let t of this[Y])t.ior=e;this[Hd]()}get sheenColorFactor(){return this[Z](),this[Rf].sheenColor.toArray()}get sheenColorTexture(){return this[Z](),this[Xf].get(X.SheenColor)}get sheenRoughnessFactor(){return this[Z](),this[Rf].sheenRoughness}get sheenRoughnessTexture(){return this[Z](),this[Xf].get(X.SheenRoughness)}setSheenColorFactor(e){this[Z]();let t=this.colorFromRgb(e);for(let e of this[Y])e.sheenColor.set(t),e.sheen=1;this[Hd]()}setSheenRoughnessFactor(e){this[Z]();for(let t of this[Y])t.sheenRoughness=e,t.sheen=1;this[Hd]()}get transmissionFactor(){return this[Z](),this[Rf].transmission}get transmissionTexture(){return this[Z](),this[Xf].get(X.Transmission)}setTransmissionFactor(e){this[Z]();for(let t of this[Y])t.transmission=e;this[Hd]()}get thicknessFactor(){return this[Z](),this[Rf].thickness}get thicknessTexture(){return this[Z](),this[Xf].get(X.Thickness)}get attenuationDistance(){return this[Z](),this[Rf].attenuationDistance}get attenuationColor(){return this[Z](),this[Rf].attenuationColor.toArray()}setThicknessFactor(e){this[Z]();for(let t of this[Y])t.thickness=e;this[Hd]()}setAttenuationDistance(e){this[Z]();for(let t of this[Y])t.attenuationDistance=e;this[Hd]()}setAttenuationColor(e){this[Z]();let t=this.colorFromRgb(e);for(let e of this[Y])e.attenuationColor.set(t);this[Hd]()}get specularFactor(){return this[Z](),this[Rf].specularIntensity}get specularTexture(){return this[Z](),this[Xf].get(X.Specular)}get specularColorFactor(){return this[Z](),this[Rf].specularColor.toArray()}get specularColorTexture(){return this[Z](),this[Xf].get(X.SheenColor)}setSpecularFactor(e){this[Z]();for(let t of this[Y])t.specularIntensity=e;this[Hd]()}setSpecularColorFactor(e){this[Z]();let t=this.colorFromRgb(e);for(let e of this[Y])e.specularColor.set(t);this[Hd]()}get iridescenceFactor(){return this[Z](),this[Rf].iridescence}get iridescenceTexture(){return this[Z](),this[Xf].get(X.Iridescence)}get iridescenceIor(){return this[Z](),this[Rf].iridescenceIOR}get iridescenceThicknessMinimum(){return this[Z](),this[Rf].iridescenceThicknessRange[0]}get iridescenceThicknessMaximum(){return this[Z](),this[Rf].iridescenceThicknessRange[1]}get iridescenceThicknessTexture(){return this[Z](),this[Xf].get(X.IridescenceThickness)}setIridescenceFactor(e){this[Z]();for(let t of this[Y])t.iridescence=e;this[Hd]()}setIridescenceIor(e){this[Z]();for(let t of this[Y])t.iridescenceIOR=e;this[Hd]()}setIridescenceThicknessMinimum(e){this[Z]();for(let t of this[Y])t.iridescenceThicknessRange[0]=e;this[Hd]()}setIridescenceThicknessMaximum(e){this[Z]();for(let t of this[Y])t.iridescenceThicknessRange[1]=e;this[Hd]()}get anisotropyStrength(){return this[Z](),this[Rf].anisotropy}get anisotropyRotation(){return this[Z](),this[Rf].anisotropyRotation}get anisotropyTexture(){return this[Z](),this[Xf].get(X.Anisotropy)}setAnisotropyStrength(e){this[Z]();for(let t of this[Y])t.anisotropy=e;this[Hd]()}setAnisotropyRotation(e){this[Z]();for(let t of this[Y])t.anisotropyRotation=e;this[Hd]()}},Qf=class{constructor(e){this.name=``,this.children=[],this.name=e}},$f=class extends Qf{constructor(e,t,n,r){super(e.name),this.materials=new Map,this.variantToMaterialMap=new Map,this.initialMaterialIdx=0,this.activeMaterialIdx=0,this.mesh=e;let{gltf:i,threeGLTF:a,threeObjectMap:o}=r;this.parser=a.parser,this.modelVariants=n,this.mesh.userData.variantData=n;let s=o.get(e.material);s.materials==null?console.error(`Primitive (${e.name}) missing initial material reference.`):this.initialMaterialIdx=this.activeMaterialIdx=s.materials;let c=e.userData.associations||{};if(c.meshes==null){console.error(`Mesh is missing primitive index association`);return}let l=((i.meshes||[])[c.meshes].primitives||[])[c.primitives];if(l==null)console.error(`Mesh primitive definition is missing.`);else{if(l.material!=null)this.materials.set(l.material,t[l.material]);else{let e=t.findIndex(e=>e.name===`Default`);e>=0?this.materials.set(e,t[e]):console.warn(`gltfPrimitive has no material!`)}if(l.extensions&&l.extensions.KHR_materials_variants){let e=l.extensions.KHR_materials_variants,r=a.parser.json.extensions.KHR_materials_variants.variants;for(let i of e.mappings){let e=t[i.material];this.materials.set(i.material,e);for(let t of i.variants){let{name:i}=r[t];this.variantToMaterialMap.set(t,e),e[Kf].add(t),n.has(i)||n.set(i,{name:i,index:t})}}}}}async setActiveMaterial(e){let t=this.materials.get(e);if(e!==this.activeMaterialIdx){let n=t[Y],r=await t[Uf]();r==null?this.mesh.material=n.values().next().value:this.mesh.material=r,this.parser.assignFinalMaterial(this.mesh),n.add(this.mesh.material),this.activeMaterialIdx=e}return this.mesh.material}getActiveMaterial(){return this.materials.get(this.activeMaterialIdx)}getMaterial(e){return this.materials.get(e)}async enableVariant(e){if(e==null)return this.setActiveMaterial(this.initialMaterialIdx);if(this.variantToMaterialMap!=null&&this.modelVariants.has(e)){let t=this.modelVariants.get(e);return this.enableVariantHelper(t.index)}return null}async enableVariantHelper(e){if(this.variantToMaterialMap!=null&&e!=null){let t=this.variantToMaterialMap.get(e);if(t!=null)return this.setActiveMaterial(t.index)}return null}async instantiateVariants(){if(this.variantToMaterialMap!=null)for(let e of this.variantToMaterialMap.keys()){let t=this.mesh.userData.variantMaterials.get(e);if(t.material!=null)continue;let n=await this.enableVariantHelper(e);n!=null&&(t.material=n)}}get variantInfo(){return this.variantToMaterialMap}addVariant(e,t){if(!this.ensureVariantIsUnused(t))return!1;this.modelVariants.has(t)||this.modelVariants.set(t,{name:t,index:this.modelVariants.size});let n=this.modelVariants.get(t).index;return e[Kf].add(n),this.variantToMaterialMap.set(n,e),this.materials.set(e.index,e),this.updateVariantUserData(n,e),!0}deleteVariant(e){this.variantInfo.has(e)&&(this.variantInfo.delete(e),this.mesh.userData.variantMaterials?.delete(e))}updateVariantUserData(e,t){t[Kf].add(e),this.mesh.userData.variantData=this.modelVariants,this.mesh.userData.variantMaterials=this.mesh.userData.variantMaterials||new Map,this.mesh.userData.variantMaterials.set(e,{material:t[Y].values().next().value,gltfMaterialIndex:t.index})}ensureVariantIsUnused(e){let t=this.modelVariants.get(e);return t!=null&&this.variantInfo.has(t.index)?(console.warn(`Primitive cannot add variant '${e}' for this material, it already exists.`),!1):!0}},ep,tp,np,rp,ip,ap,op=Symbol(`materials`),sp=Symbol(`hierarchy`),cp=Symbol(`roots`),lp=Symbol(`primitives`),up=Symbol(`prepareVariantsForExport`),dp=Symbol(`switchVariant`),fp=Symbol(`materialFromPoint`),pp=Symbol(`nodeFromPoint`),mp=Symbol(`nodeFromIndex`),hp=Symbol(`variantData`),gp=Symbol(`availableVariants`),_p=Symbol(`modelOnUpdate`),vp=Symbol(`cloneMaterial`),yp=class{constructor(e,t,n,r){this.gltf=e,this.gltfElementMap=t,this.mapKey=n,this.doLazyLoad=r}},bp=class{constructor(e,t=()=>{}){this[ep]=[],this[tp]=[],this[np]=[],this[rp]=[],this[ip]=()=>{},this[ap]=new Map,this[_p]=t;let{gltf:n,threeGLTF:r,gltfElementMap:i}=e;for(let[e,a]of n.materials.entries()){let o=i.get(a);if(o!=null)this[op].push(new Zf(t,e,!0,this[hp],o,a.name));else{let o=(n.materials||[])[e],s=new Set;i.set(o,s),this[op].push(new Zf(t,e,!1,this[hp],s,a.name,new yp(n,i,o,async()=>{let t=await r.parser.getDependency(`material`,e);return s.add(t),t})))}}let a=new Map,o=[];for(let e of r.scene.children)o.push(e);for(;o.length>0;){let t=o.pop(),n=null;t instanceof U?(n=new $f(t,this.materials,this[hp],e),this[lp].push(n)):n=new Qf(t.name);let r=a.get(t);r==null?this[cp].push(n):r.children.push(n),this[sp].push(n);for(let e of t.children)o.push(e),a.set(t,n)}}get materials(){return this[op]}[(ep=op,tp=sp,np=cp,rp=lp,ip=_p,ap=hp,gp)](){let e=Array.from(this[hp].values());return e.sort((e,t)=>e.index-t.index),e.map(e=>e.name)}getMaterialByName(e){let t=this[op].filter(t=>t.name===e);return t.length>0?t[0]:null}[mp](e,t){return this[sp].find(n=>{if(n instanceof $f){let{meshes:r,primitives:i}=n.mesh.userData.associations;if(r==e&&i==t)return!0}return!1})??null}[pp](e){return this[sp].find(t=>t instanceof $f&&t.mesh===e.object)||null}[fp](e){let t=this[pp](e);return t?t.getActiveMaterial():null}async[dp](e){for(let t of this[lp])await t.enableVariant(e);for(let e of this.materials)e[Gf](!1);for(let e of this[lp])this.materials[e.getActiveMaterial().index][Gf](!0)}async[up](){let e=[];for(let t of this[lp])e.push(t.instantiateVariants());await Promise.all(e)}[vp](e,t){let n=this.materials[e];n.isLoaded||console.error(`Cloning an unloaded material,
           call 'material.ensureLoaded() before cloning the material.`);let r=n[Y],i=new Set;for(let[e,n]of r.entries()){let a=n.clone();a.name=t+(r.size>1?`_inst`+e:``),i.add(a)}let a=new Zf(this[_p],this[op].length,!1,this[hp],i,t);return this[op].push(a),a}createMaterialInstanceForVariant(e,t,n,r=!0){let i=null;for(let r of this[lp]){let a=this[hp].get(n);a!=null&&r.variantInfo.has(a.index)||r.getMaterial(e)!=null&&(this.hasVariant(n)||this.createVariant(n),i??=this[vp](e,t),r.addVariant(i,n))}if(r&&i!=null){i[Gf](!0),this.materials[e][Gf](!1);for(let e of this[lp])e.enableVariant(n)}return i}createVariant(e){this[hp].has(e)?console.warn(`Variant '${e}'' already exists`):this[hp].set(e,{name:e,index:this[hp].size})}hasVariant(e){return this[hp].has(e)}setMaterialToVariant(e,t){if(this[gp]().find(e=>e===t)==null)console.warn(`Can't add material to '${t}', the variant does not exist.'`);else if(e<0||e>=this.materials.length)console.error(`setMaterialToVariant(): materialIndex is out of bounds.`);else for(let n of this[lp]){let r=n.getMaterial(e);r!=null&&n.addVariant(r,t)}}updateVariantName(e,t){let n=this[hp].get(e);n!=null&&(n.name=t,this[hp].set(t,n),this[hp].delete(e))}deleteVariant(e){let t=this[hp].get(e);if(t!=null){for(let n of this.materials)n.hasVariant(e)&&n[Kf].delete(t.index);for(let e of this[lp])e.deleteVariant(t.index);this[hp].delete(e)}}},xp=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Sp=Symbol(`currentGLTF`),Cp=Symbol(`originalGltfJson`),wp=Symbol(`model`),Tp=Symbol(`extraModels`),Ep=Symbol(`getOnUpdateMethod`),Dp=Symbol(`buildTexture`),Op=e=>{var t,n,r,i;class a extends e{constructor(){super(...arguments),this[t]=void 0,this[n]=[],this[r]=null,this[i]=null,this.variantName=null,this.orientation=`0 0 0`,this.scale=`1 1 1`}get model(){return this[wp]}get extraModels(){return this[Tp]}get availableVariants(){return this.model?this.model[gp]():[]}get originalGltfJson(){return this[Cp]}[(t=wp,n=Tp,r=Sp,i=Cp,Ep)](){return()=>{this[qm]()}}[Dp](e){return e.colorSpace=Et,e.wrapS=Re,e.wrapT=Re,new gf(this[Ep](),e)}async createTexture(e,t=`image/png`){let{textureUtils:n}=this[$],r=await n.loadImage(e,this.withCredentials,t),i=t===`image/ktx2`?`image/png`:t;return r.userData.mimeType=i,this[Dp](r)}async createLottieTexture(e,t=1){let{textureUtils:n}=this[$],r=await n.loadLottie(e,t,this.withCredentials);return this[Dp](r)}createVideoTexture(e){let t=document.createElement(`video`);t.crossOrigin=this.withCredentials?`use-credentials`:`anonymous`,t.src=e,t.muted=!0,t.playsInline=!0,t.loop=!0,t.play();let n=new ve(t);return this[Dp](n)}createCanvasTexture(){let e=document.createElement(`canvas`),t=new Le(e);return this[Dp](t)}async updated(e){if(super.updated(e),e.has(`variantName`)){let e=this[Zm].beginActivity(`variant-update`);e(.1);let t=this[wp],{variantName:n}=this;t!=null&&(await t[dp](n),this[qm](),this.dispatchEvent(new CustomEvent(`variant-applied`))),e(1)}if(e.has(`orientation`)||e.has(`scale`)){if(!this.loaded)return;let e=this[Q];e.applyTransform(),e.updateBoundingBox(),e.updateShadow(),this[$].arRenderer.onUpdateScene(),this[qm]()}}[Ym](){super[Ym]();let{currentGLTFs:e}=this[Q],t=e.length>0?e[0]:null;if(t!=null){let{correlatedSceneGraph:e}=t;e!=null&&t!==this[Sp]&&(this[wp]=new bp(e,this[Ep]()),this[Cp]=JSON.parse(JSON.stringify(e.gltf))),`variants`in t.userData&&this.requestUpdate(`variantName`)}this[Tp]=[];let n=Array.from(this.querySelectorAll(`extra-model`));for(let t=1;t<e.length;t++){let r=e[t];if(r!=null&&r.correlatedSceneGraph!=null){let e=new bp(r.correlatedSceneGraph,this[Ep]());this[Tp].push(e),n[t-1]&&(n[t-1].model=e)}}this[Sp]=t}async exportScene(e){let t=this[Q];return new Promise(async(n,r)=>{let i={binary:!0,onlyVisible:!0,maxTextureSize:1/0,includeCustomExtensions:!1,forceIndices:!1};Object.assign(i,e),i.animations=t.animations,i.truncateDrawRange=!0;let a=t.shadow,o=!1;a!=null&&(o=a.visible,a.visible=!1),await this[wp][up]();let s=new es().register(e=>new Vs(e));s.setTextureUtils({decompress:(e,t)=>Rs(e,t??1/0,void 0)});let c;if(t.models.length>1){c=new kt;for(let e of t.models)c.add(e)}else c=t.models[0];s.parse(c,e=>{if(t.models.length>1)for(let e of t.models)t.target.add(e);else t.target.add(t.models[0]);return n(new Blob([i.binary?e:JSON.stringify(e)],{type:i.binary?`application/octet-stream`:`application/json`}))},()=>r(`glTF export failed`),i),a!=null&&(a.visible=o)})}materialFromPoint(e,t){let n=this[Q],r=n.getNDC(e,t),i=n.hitFromPoint(r);if(i==null||i.face==null)return null;let a=this[wp];if(a!=null){let e=a[fp](i);if(e!=null)return e}for(let e of this[Tp]){let t=e[fp](i);if(t!=null)return t}return null}}return xp([W({type:String,attribute:`variant-name`})],a.prototype,`variantName`,void 0),xp([W({type:String,attribute:`orientation`})],a.prototype,`orientation`,void 0),xp([W({type:String,attribute:`scale`})],a.prototype,`scale`,void 0),a},kp=class extends U{constructor(){super(void 0,new z({depthWrite:!1})),this.height=0,this.radius=0,this.resolution=0,this.userData.noHit=!0}get map(){return this.material.map}set map(e){this.material.map=e}isUsable(){return this.height>0&&this.radius>0&&this.geometry!=null&&this.map!=null}updateGeometry(e=this.height,t=this.radius,n=128){(e!=this.height||t!=this.radius||n!=this.resolution)&&(this.height=e,this.radius=t,this.resolution=n,e>0&&t>0&&(this.geometry.dispose(),this.geometry=Ap(e,t,n)))}};function Ap(e,t,n){let r=new i(t,2*n,n);r.scale(1,1,-1);let a=r.getAttribute(`position`),o=new S;for(let t=0;t<a.count;++t)if(o.fromBufferAttribute(a,t),o.y<0){let n=-e*3/2,r=o.y<n?-e/o.y:1-o.y*o.y/(3*n*n);o.multiplyScalar(r),o.toArray(a.array,3*t)}return a.needsUpdate=!0,r}var jp=new S,Mp=new S,Np=new S,Pp=new L,Fp=new M,Ip=new p,Lp=class extends Go{constructor(e){super(document.createElement(`div`)),this.normal=new S(0,1,0),this.initialized=!1,this.referenceCount=1,this.pivotEl=document.createElement(`div`),this.slot=document.createElement(`slot`),this.element.classList.add(`annotation-wrapper`),this.slot.name=e.name,this.element.appendChild(this.pivotEl),this.pivotEl.appendChild(this.slot),this.updatePosition(e.position),this.updateNormal(e.normal),this.surface=e.surface,e.modelIndex!=null&&(this.modelIndex=e.modelIndex)}get facingCamera(){return!this.element.classList.contains(`hide`)}show(){(!this.facingCamera||!this.initialized)&&this.updateVisibility(!0)}hide(){(this.facingCamera||!this.initialized)&&this.updateVisibility(!1)}increment(){this.referenceCount++}decrement(){return this.referenceCount>0&&--this.referenceCount,this.referenceCount===0}updatePosition(e){if(e==null)return;let t=Zs(e)[0].terms;for(let e=0;e<3;++e)this.position.setComponent(e,cc(t[e]).number);this.updateMatrixWorld()}updateNormal(e){if(e==null)return;let t=Zs(e)[0].terms;for(let e=0;e<3;++e)this.normal.setComponent(e,t[e].number)}updateSurface(){let{mesh:e,tri:t,bary:n}=this;if(e==null||t==null||n==null)return;e.getVertexPosition(t.x,jp),e.getVertexPosition(t.y,Mp),e.getVertexPosition(t.z,Np),jp.toArray(Pp.elements,0),Mp.toArray(Pp.elements,3),Np.toArray(Pp.elements,6),this.position.copy(n).applyMatrix3(Pp);let r=this.parent;r.worldToLocal(e.localToWorld(this.position)),Fp.set(jp,Mp,Np),Fp.getNormal(this.normal).transformDirection(e.matrixWorld);let i=r.parent;Ip.setFromAxisAngle(jp.set(0,1,0),-i.rotation.y),this.normal.applyQuaternion(Ip)}orient(e){this.pivotEl.style.transform=`rotate(${e}rad)`}updateVisibility(e){this.element.classList.toggle(`hide`,!e),this.slot.assignedNodes().forEach(t=>{if(t.nodeType!==Node.ELEMENT_NODE)return;let n=t,r=n.dataset.visibilityAttribute;if(r!=null){let t=`data-${r}`;n.toggleAttribute(t,e)}n.dispatchEvent(new CustomEvent(`hotspot-visibility`,{detail:{visible:e}}))}),this.initialized=!0}},Rp={name:`HorizontalBlurShader`,uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform float h;

		varying vec2 vUv;

		void main() {

			vec4 sum = vec4( 0.0 );

			sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;
			sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;
			sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;
			sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
			sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;
			sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;
			sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;
			sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;

			gl_FragColor = sum;

		}`},zp={name:`VerticalBlurShader`,uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform float v;

		varying vec2 vUv;

		void main() {

			vec4 sum = vec4( 0.0 );

			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;
			sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;

			gl_FragColor = sum;

		}`};function Bp(e,t,n){return(1-n)*e+n*t}var Vp=9,Hp=2,Up=.3,Wp=class extends kt{constructor(e,t,n){super(),this.camera=new Oe,this.renderTarget=null,this.renderTargetBlur=null,this.depthMaterial=new H,this.horizontalBlurMaterial=new Ct(Rp),this.verticalBlurMaterial=new Ct(zp),this.intensity=0,this.softness=1,this.boundingBox=new _t,this.size=new S,this.maxDimension=0,this.isAnimated=!1,this.needsUpdate=!1;let{camera:r}=this;r.rotation.x=Math.PI/2,r.left=-.5,r.right=.5,r.bottom=-.5,r.top=.5,this.add(r);let i=new c,a=new z({opacity:1,transparent:!0,side:1});this.floor=new U(i,a),this.floor.userData.noHit=!0,r.add(this.floor),this.blurPlane=new U(i),this.blurPlane.visible=!1,r.add(this.blurPlane),e.target.add(this),this.depthMaterial.onBeforeCompile=function(e){e.fragmentShader=e.fragmentShader.replace(/gl_FragColor\s*=\s*vec4\(\s*vec3\(\s*1\.0\s*-\s*fragCoordZ\s*\),\s*opacity\s*\);/,`gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * opacity );`)},this.depthMaterial.side=2,this.horizontalBlurMaterial.depthTest=!1,this.verticalBlurMaterial.depthTest=!1,this.setScene(e,t,n)}setScene(e,t,n){let{boundingBox:r,size:i,rotation:a,position:o}=this;if(this.isAnimated=e.animationNames.length>0,this.boundingBox.copy(e.boundingBox),this.size.copy(e.size),this.maxDimension=Math.max(i.x,i.y,i.z)*(this.isAnimated?Hp:1),this.boundingBox.getCenter(o),n===`back`){let{min:e,max:t}=r;[e.y,e.z]=[e.z,e.y],[t.y,t.z]=[t.z,t.y],[i.y,i.z]=[i.z,i.y],a.x=Math.PI/2,a.y=Math.PI}else a.x=0,a.y=0;if(this.isAnimated){let e=r.min.y,t=r.max.y;i.y=this.maxDimension,r.expandByVector(i.subScalar(this.maxDimension).multiplyScalar(-.5)),r.min.y=e,r.max.y=t,i.set(this.maxDimension,t-e,this.maxDimension)}n===`bottom`?o.y=r.min.y:o.z=r.min.y,this.setSoftness(t)}setSoftness(e){this.softness=e;let{size:t,camera:n}=this,r=this.isAnimated?Hp:1,i=r*2**(Vp-e*3);this.setMapSize(i);let a=t.y/2,o=t.y*r;n.near=0,n.far=Bp(o,a,e),this.depthMaterial.opacity=1/e,n.updateProjectionMatrix(),this.setIntensity(this.intensity),this.setOffset(0)}setMapSize(e){let{size:t}=this;this.isAnimated&&(e*=Hp);let n=Math.floor(t.x>t.z?e:e*t.x/t.z),r=Math.floor(t.x>t.z?e*t.z/t.x:e),i=10+n,a=10+r;if(this.renderTarget!=null&&(this.renderTarget.width!==i||this.renderTarget.height!==a)&&(this.renderTarget.dispose(),this.renderTarget=null,this.renderTargetBlur.dispose(),this.renderTargetBlur=null),this.renderTarget==null){let e={format:k};this.renderTarget=new N(i,a,e),this.renderTargetBlur=new N(i,a,e),this.floor.material.map=this.renderTarget.texture}let o=t.x*(1+10/n),s=t.z*(1+10/r);this.camera.left=-o/2,this.camera.right=o/2,this.camera.bottom=-s/2,this.camera.top=s/2,this.camera.scale.set(1,1,1),this.floor.scale.set(o,s,1),this.blurPlane.scale.set(o,s,1),this.needsUpdate=!0}setIntensity(e){this.intensity=e,e>0?(this.visible=!0,this.floor.visible=!0,this.floor.material.opacity=e*Bp(Up,1,this.softness*this.softness)):(this.visible=!1,this.floor.visible=!1)}getIntensity(){return this.intensity}setOffset(e){this.floor.position.z=-e+this.gap()}gap(){return .001*this.maxDimension}render(e,t){t.overrideMaterial=this.depthMaterial,this.floor.visible=!1;let n=e.xr.enabled;e.xr.enabled=!1;let r=e.getRenderTarget();e.setRenderTarget(this.renderTarget);let i=e.getClearAlpha();e.setClearAlpha(0);let a=e.state;a!=null&&(a.buffers.color.setMask(!0),a.buffers.depth.setMask(!0)),e.clear();let o=e.autoClear;e.autoClear=!1,e.render(t,this.camera),e.autoClear=o,t.overrideMaterial=null,this.floor.visible=!0,this.blurShadow(e),e.xr.enabled=n,e.setRenderTarget(r),e.setClearAlpha(i)}blurShadow(e){let{camera:t,horizontalBlurMaterial:n,verticalBlurMaterial:r,renderTarget:i,renderTargetBlur:a,blurPlane:o}=this;o.visible=!0,o.material=n,n.uniforms.h.value=1/this.renderTarget.width,n.uniforms.tDiffuse.value=this.renderTarget.texture,e.setRenderTarget(a),e.render(o,t),o.material=r,r.uniforms.v.value=1/this.renderTarget.height,r.uniforms.tDiffuse.value=this.renderTargetBlur.texture,e.setRenderTarget(i),e.render(o,t),o.visible=!1}dispose(){this.renderTarget!=null&&this.renderTarget.dispose(),this.renderTargetBlur!=null&&this.renderTargetBlur.dispose(),this.depthMaterial.dispose(),this.horizontalBlurMaterial.dispose(),this.verticalBlurMaterial.dispose(),this.floor.material.dispose(),this.floor.geometry.dispose(),this.blurPlane.geometry.dispose(),this.removeFromParent()}},Gp=100,Kp=new S,qp=new S,Jp=new S,Yp=new V,Xp=new S,Zp=new ct,Qp=class extends s{constructor({canvas:e,element:t,width:n,height:r}){super(),this.annotationRenderer=new Zo,this.effectRenderer=null,this.schemaElement=document.createElement(`script`),this.width=1,this.height=1,this.aspect=1,this.scaleStep=0,this.renderCount=0,this.externalRenderer=null,this.appendedAnimations=[],this.markedAnimations=[],this.camera=new Dt(45,1,.1,100),this.xrCamera=null,this.url=null,this.extraUrls=[],this.scenePivot=new kt,this.target=new kt,this.animationNames=[],this.boundingBox=new _t,this.boundingSphere=new Ge,this.size=new S,this.idealAspect=0,this.framedFoVDeg=0,this.shadow=null,this.shadowIntensity=0,this.shadowSoftness=1,this.bakedShadows=new Set,this.exposure=1,this.toneMapping=7,this.canScale=!0,this.isDirty=!1,this.goalTarget=new S,this.targetDamperX=new Ks,this.targetDamperY=new Ks,this.targetDamperZ=new Ks,this._currentGLTFs=[],this._models=[],this.boundsAndShadowDirty=!1,this.mixers=[],this.mixerPausedStates=[],this.cancelPendingSourceChange=null,this.animationsByName=new Map,this.currentAnimationActions=[],this.groundedSkybox=new kp,this.name=`ModelScene`,this.element=t,this.canvas=e,this.camera=new Dt(45,1,.1,100),this.camera.name=`MainCamera`,this.add(this.scenePivot),this.scenePivot.name=`Pivot`,this.scenePivot.add(this.target),this.setSize(n,r),this.target.name=`Target`,this.mixers=[];let{domElement:i}=this.annotationRenderer,{style:a}=i;a.display=`none`,a.pointerEvents=`none`,a.position=`absolute`,a.top=`0`,this.element.shadowRoot.querySelector(`.default`).appendChild(i),this.schemaElement.setAttribute(`type`,`application/ld+json`)}get context(){return this.canvas.getContext(`2d`)}getCamera(){return this.xrCamera==null?this.camera:this.xrCamera}queueRender(){this.isDirty=!0}shouldRender(){return this.isDirty}hasRendered(){this.isDirty=!1}forceRescale(){this.scaleStep=-1,this.queueRender()}async setObject(e){this.reset(),this._models=[e],this.target.add(e),await this.setupScene()}async setSource(e,t=[],n=()=>{}){if((!e||e===this.url)&&t.join(`,`)===this.extraUrls.join(`,`)){n(1);return}if(this.reset(),this.url=e,this.extraUrls=t,this.externalRenderer!=null){let e=await this.externalRenderer.load(n);this.boundingSphere.radius=e.framedRadius,this.idealAspect=e.fieldOfViewAspect;return}this.cancelPendingSourceChange!=null&&(this.cancelPendingSourceChange(),this.cancelPendingSourceChange=null);let r=[];try{let i=[];e&&i.push(e),t&&i.push(...t),i.length>0&&(r=await new Promise((e,t)=>{this.cancelPendingSourceChange=()=>t(),(async()=>{try{e(await Promise.all(i.map(e=>this.element[$].loader.load(e,this.element,n))))}catch(e){t(e)}})()}))}catch(e){if(e==null)return;throw e}this.cancelPendingSourceChange=null,this.reset(),this.url=e,this.extraUrls=t,this._currentGLTFs=r;for(let e of r)e==null?(this.mixers.push(new ke(this.target)),this.mixerPausedStates.push(!1),this.currentAnimationActions.push(null)):(this._models.push(e.scene),this.target.add(e.scene),this.mixers.push(new ke(e.scene)),this.mixerPausedStates.push(!1),this.currentAnimationActions.push(null));let i=new Map,a=[],o=[];for(let e of r)for(let t of e.animations||[])i.set(t.name,t),a.push(t.name),o.push(t);this.animations=o,this.animationsByName=i,this.animationNames=a,await this.setupScene()}async setupScene(){this.applyTransform(),this.updateBoundingBox(),await this.updateFraming(),this.updateShadow(),this.setShadowIntensity(this.shadowIntensity),this.setGroundedSkybox()}updateModelTransforms(e,t,n,r){let i=this._models[e];if(i){if(t){let e=t.split(` `).map(e=>e.trim()).filter(e=>e.length>0).map(Number);e.length===3&&!e.some(isNaN)&&i.position.set(e[0],e[1],e[2])}if(r){let e=r.split(` `).map(e=>e.trim()).filter(e=>e.length>0).map(Number);e.length===1&&!isNaN(e[0])?i.scale.setScalar(e[0]):e.length===3&&!e.some(isNaN)&&i.scale.set(e[0],e[1],e[2])}i.updateMatrixWorld(!0),this.boundsAndShadowDirty=!0,this.queueRender()}}updateBoundingBoxAndShadowIfDirty(){this.boundsAndShadowDirty&&(this.boundsAndShadowDirty=!1,this.updateBoundingBox(),this.updateShadow())}reset(){this.url=null,this.renderCount=0,this.queueRender(),this.shadow!=null&&this.shadow.setIntensity(0),this.bakedShadows.clear();let{_models:e}=this;for(let t of e)t?.removeFromParent();this._models=[];let t=this._currentGLTFs;for(let e of t)e?.dispose();this._currentGLTFs=[];for(let e of this.currentAnimationActions)e?.stop();this.currentAnimationActions=[];for(let e of this.mixers)e.stopAllAction(),e.uncacheRoot(this);this.mixers=[],this.mixerPausedStates=[]}dispose(){this.reset(),this.shadow!=null&&(this.shadow.dispose(),this.shadow=null),this.element[Sp]=null,this.element[Cp]=null,this.element[wp]=null}get currentGLTF(){return this._currentGLTFs[0]||null}get currentGLTFs(){return this._currentGLTFs}setSize(e,t){if(this.width!==e||this.height!==t){if(this.width=Math.max(e,1),this.height=Math.max(t,1),this.annotationRenderer.setSize(e,t),this.aspect=this.width/this.height,this.externalRenderer!=null){let n=window.devicePixelRatio;this.externalRenderer.resize(e*n,t*n)}this.queueRender()}}markBakedShadow(e){e.userData.noHit=!0,this.bakedShadows.add(e)}unmarkBakedShadow(e){e.userData.noHit=!1,e.visible=!0,this.bakedShadows.delete(e),this.boundingBox.expandByObject(e)}findBakedShadows(e){let t=new _t;e.traverse(e=>{let n=e;if(!n.material||!n.material.transparent)return;t.setFromObject(n);let r=t.getSize(Xp),i=Math.min(r.x,r.y,r.z);Math.max(r.x,r.y,r.z)<Gp*i||this.markBakedShadow(n)})}checkBakedShadows(){let{min:e,max:t}=this.boundingBox,n=new _t;this.boundingBox.getSize(this.size);for(let r of this.bakedShadows)n.setFromObject(r),!(n.min.y<e.y+this.size.y/Gp&&n.min.x<=e.x&&n.max.x>=t.x&&n.min.z<=e.z&&n.max.z>=t.z)&&(n.min.z<e.z+this.size.z/Gp&&n.min.x<=e.x&&n.max.x>=t.x&&n.min.y<=e.y&&n.max.y>=t.y||this.unmarkBakedShadow(r))}applyTransform(){let{models:e}=this;if(e.length===0)return;let t=Zs(this.element.orientation)[0].terms,n=cc(t[0]).number,r=cc(t[1]).number,i=cc(t[2]).number,a=Zs(this.element.scale)[0].terms;for(let t of e)t.quaternion.setFromEuler(new D(r,i,n,`YXZ`)),t.scale.set(a[0].number,a[1].number,a[2].number)}updateBoundingBox(){let{models:e}=this;if(e.length===0)return;for(let t of e)this.target.remove(t),this.findBakedShadows(t);let t=(e,t)=>e.expandByPoint(t);this.setBakedShadowVisibility(!1);let n=new _t;for(let r of e)n=Qo(r,t,n);if(this.boundingBox=n,this.boundingBox.isEmpty()){this.setBakedShadowVisibility(!0),this.bakedShadows.forEach(e=>this.unmarkBakedShadow(e)),n=new _t;for(let r of e)n=Qo(r,t,n);this.boundingBox=n}this.checkBakedShadows(),this.setBakedShadowVisibility(),this.boundingBox.getSize(this.size);for(let t of e)this.target.add(t)}async updateFraming(){let{models:e}=this;if(e.length===0)return;for(let t of e)this.target.remove(t);this.setBakedShadowVisibility(!1);let{center:t}=this.boundingSphere;this.element.requestUpdate(`cameraTarget`),await this.element.updateComplete,t.copy(this.getTarget());let n=(e,n)=>Math.max(e,t.distanceToSquared(n)),r=0;for(let t of e)r=Math.max(r,Qo(t,n,0));this.boundingSphere.radius=Math.sqrt(r);let i=(e,n)=>{n.sub(t);let r=Math.sqrt(n.x*n.x+n.z*n.z);return Math.max(e,r/(this.idealCameraDistance()-Math.abs(n.y)))},a=0;for(let t of e)a=Math.max(a,Qo(t,i,0));this.idealAspect=a/Math.tan(this.framedFoVDeg/2*Math.PI/180),this.setBakedShadowVisibility();for(let t of e)this.target.add(t)}setBakedShadowVisibility(e=this.shadowIntensity<=0){for(let t of this.bakedShadows)t.visible=e}idealCameraDistance(){let e=this.framedFoVDeg/2*Math.PI/180;return this.boundingSphere.radius/Math.sin(e)}adjustedFoV(e){let t=Math.tan(e/2*Math.PI/180)*Math.max(1,this.idealAspect/this.aspect);return 2*Math.atan(t)*180/Math.PI}getNDC(e,t){if(this.xrCamera!=null)Zp.set(e/window.screen.width,t/window.screen.height);else{let n=this.element.getBoundingClientRect();Zp.set((e-n.x)/this.width,(t-n.y)/this.height)}return Zp.multiplyScalar(2).subScalar(1),Zp.y*=-1,Zp}getSize(){return{width:this.width,height:this.height}}setEnvironmentAndSkybox(e,t){this.element[$].arRenderer.presentedScene!==this&&(this.environment=e,this.setBackground(t),this.queueRender())}setBackground(e){this.groundedSkybox.map=e,this.groundedSkybox.isUsable()?(this.target.add(this.groundedSkybox),this.background=null):(this.target.remove(this.groundedSkybox),this.background=e)}farRadius(){return this.boundingSphere.radius*(this.groundedSkybox.parent==null?1:10)}setGroundedSkybox(){let e=Zs(this.element.skyboxHeight)[0].terms[0],t=cc(e).number,n=10*this.boundingSphere.radius;this.groundedSkybox.updateGeometry(t,n),this.groundedSkybox.position.y=t-(this.shadow?2*this.shadow.gap():0),this.setBackground(this.groundedSkybox.map)}setTarget(e,t,n){this.goalTarget.set(-e,-t,-n)}setTargetDamperDecayTime(e){this.targetDamperX.setDecayTime(e),this.targetDamperY.setDecayTime(e),this.targetDamperZ.setDecayTime(e)}getTarget(){return this.goalTarget.clone().multiplyScalar(-1)}getDynamicTarget(){return this.target.position.clone().multiplyScalar(-1)}jumpToGoal(){this.updateTarget(Ws)}updateTarget(e){let t=this.goalTarget,n=this.target.position;if(t.equals(n))return!1;{let r=this.boundingSphere.radius/10,{x:i,y:a,z:o}=n;return i=this.targetDamperX.update(i,t.x,e,r),a=this.targetDamperY.update(a,t.y,e,r),o=this.targetDamperZ.update(o,t.z,e,r),this.groundedSkybox.position.x=-i,this.groundedSkybox.position.z=-o,this.target.position.set(i,a,o),this.target.updateMatrixWorld(),this.queueRender(),!0}}pointTowards(e,t){let{x:n,z:r}=this.position;this.yaw=Math.atan2(e-n,t-r)}get model(){return this._models[0]||null}get models(){return this._models}set yaw(e){this.scenePivot.rotation.y=e,this.groundedSkybox.rotation.y=-e,this.queueRender()}get yaw(){return this.scenePivot.rotation.y}set animationTime(e){for(let t of this.mixers)t.setTime(e);this.queueShadowRender()}get animationTime(){let e=0;for(let t of this.currentAnimationActions)if(t!=null){let n=t.time,r=Math.max(t._loopCount,0);t.loop===2202&&(r&1)==1&&(n=(t.getClip()?t.getClip().duration:0)-t.time),n>e&&(e=n)}return e}set animationTimeScale(e){for(let t of this.mixers)t.timeScale=e}get animationTimeScale(){return this.mixers.length>0?this.mixers[0].timeScale:1}get duration(){let e=0;for(let t of this.currentAnimationActions)if(t!=null&&t.getClip()){let n=t.getClip().duration;n>e&&(e=n)}return e}get hasActiveAnimation(){return this.currentAnimationActions.some(e=>e!=null)}playAnimation(e=null,t=0,n=Ee,r=1/0,i=null){let a=i??0,o=i==null?this._models.length:i+1;for(let i=a;i<o;i++){let a=this._currentGLTFs[i];if(a==null)continue;let o=a.animations||[];if(o.length===0)continue;let s=null;if(e!=null){for(let t=o.length-1;t>=0;t--)if(o[t].name===e){s=o[t];break}if(s==null){let t=parseInt(e);!isNaN(t)&&t>=0&&t<o.length&&(s=o[t])}}s??=o[0];try{let e=this.currentAnimationActions[i],a=this.mixers[i],o=a.clipAction(s,this._models[i]);this.currentAnimationActions[i]=o,this.element.paused?(a.stopAllAction(),this.mixerPausedStates[i]=!0):(o.paused=!1,this.mixerPausedStates[i]=!1,e!=null&&o!==e?o.crossFadeFrom(e,t,!1):this.animationTimeScale>0&&this.animationTime==this.duration&&(this.animationTime=0)),o.setLoop(n,r),o.enabled=!0,o.clampWhenFinished=!0,o.play()}catch(e){console.error(e)}}}appendAnimation(e=``,t=Ee,n=1/0,r=1,i=1,a=!1,o=!1,s=!0,c=null,l=!1,u=null){if(this.currentGLTF==null||e===this.element.animationName)return;let{animations:d}=this;if(d==null||d.length===0)return;let f=e?this.animationsByName.get(e):null;if(f==null)return;if(typeof n==`string`?isNaN(parseFloat(n))?(n=1/0,console.warn(`Invalid repetitionCount value: ${n}. Using default: Infinity`)):(parseInt(n)<1&&console.warn(`Invalid repetitionCount value: ${n}. Using 1 as minimum.`),n=Math.max(parseInt(n),1)):typeof n==`number`&&n<1?(n=1,console.warn(`Invalid repetitionCount value: ${n}. Using  1 value as minimum.`)):console.warn(`Invalid repetitionCount value: ${n}. Using default: Infinity`),n===1&&t!==2200&&(t=dt),typeof r==`string`){let e=parseFloat(r);isNaN(e)||e<0||e>1?(r=1,console.warn(`Invalid weight value: ${r}. Using default: 1`)):r=e}if(typeof i==`string`){let e=parseFloat(i);isNaN(e)||e<0?(i=1,console.warn(`Invalid timeScale value: ${i}. Using default: 1`)):i=e}if(typeof c==`string`){let e=parseFloat(c);isNaN(e)?(c=null,console.warn(`Invalid time value: ${c}. Using default: 0 or previous time`)):c=e}let{shouldFade:p,duration:m}=this.parseFadeValue(a,!1,1.25),h=1.25,g=!1,_=0;typeof o==`boolean`?(g=o,_=o?h:0):typeof o==`number`?(g=o>0,_=Math.max(o,0),o<0&&console.warn(`Invalid warp value: ${o}. Using default: false`)):typeof o==`string`&&(o.toLowerCase().trim()===`true`?(g=!0,_=h):o.toLowerCase().trim()===`false`?g=!1:isNaN(parseFloat(o))?console.warn(`Invalid warp value: ${o}. Using default: false`):(_=Math.max(parseFloat(o),0),g=_>0,_<=0&&console.warn(`Invalid warp value: ${o}. Using default: false`)));try{l&&this.appendedAnimations.includes(e)&&(this.markedAnimations.map(e=>e.name).includes(e)||this.markedAnimations.push({name:e,loopMode:t,repetitionCount:n}));let a=u??0,o=u==null?this.mixers.length:u+1;for(let e=a;e<o;e++){let a=this.mixers[e],o=a.existingAction(f)||a.clipAction(f,this._models[e]||this),l=o.timeScale;typeof c==`number`&&(o.time=Math.min(Math.max(c,0),f.duration)),p?o.fadeIn(m):r>=0&&(o.weight=Math.min(Math.max(r,0),1)),g?o.warp(s?l:0,i,_):o.timeScale=i,o.isRunning()||(o.time==f.duration&&o.stop(),o.setLoop(t,n),o.paused=!1,o.enabled=!0,o.clampWhenFinished=!0,o.play())}this.appendedAnimations.includes(e)||this.element[Q].appendedAnimations.push(e)}catch(e){console.error(e)}}parseFadeValue(e,t=!0,n=1.5){let r=e=>e.toLowerCase().trim();if(typeof e==`boolean`)return{shouldFade:e,duration:e?n:0};if(typeof e==`number`){let t=Math.max(e,0);return{shouldFade:t>0,duration:t}}if(typeof e==`string`){let t=r(e);if(t===`true`)return{shouldFade:!0,duration:n};if(t===`false`)return{shouldFade:!1,duration:0};let i=parseFloat(t);if(!isNaN(i)){let e=Math.max(i,0);return{shouldFade:e>0,duration:e}}}return console.warn(`Invalid fade value: ${e}. Using default: ${t}`),{shouldFade:t,duration:t?n:0}}detachAnimation(e=``,t=!0,n=null){if(this.currentGLTF==null||e===this.element.animationName)return;let{animations:r}=this;if(r==null||r.length===0)return;let i=e?this.animationsByName.get(e):null;if(i==null)return;let{shouldFade:a,duration:o}=this.parseFadeValue(t,!0,1.5);try{let t=n??0,r=n==null?this.mixers.length:n+1;for(let e=t;e<r;e++){let t=this.mixers[e],n=t.existingAction(i)||t.clipAction(i,this._models[e]||this);a?n.fadeOut(o):n.stop()}this.element[Q].appendedAnimations=this.element[Q].appendedAnimations.filter(t=>t!==e)}catch(e){console.error(e)}}updateAnimationLoop(e=``,t=Ee,n=1/0,r=null){if(this.currentGLTF==null||e===this.element.animationName)return;let{animations:i}=this;if(i==null||i.length===0)return;let a=null;if(e&&(a=this.animationsByName.get(e)),a!=null)try{let e=r??0,i=r==null?this.mixers.length:r+1;for(let r=e;r<i;r++){let e=this.mixers[r],i=e.existingAction(a)||e.clipAction(a,this._models[r]||this);i.stop(),i.setLoop(t,n),i.play()}}catch(e){console.error(e)}}stopAnimation(){this.currentAnimationActions.fill(null);for(let e of this.mixers)e.stopAllAction();this.mixerPausedStates.fill(!0)}isAllAnimationsPaused(){return this.mixerPausedStates.every(e=>e)}pauseAnimation(e=null){let t=e??0,n=e==null?this.mixers.length:e+1;for(let e=t;e<n;e++)this.mixerPausedStates[e]=!0}unpauseAnimation(e=null){let t=e??0,n=e==null?this.mixers.length:e+1;for(let e=t;e<n;e++)this.mixerPausedStates[e]=!1}updateAnimation(e){for(let t=0;t<this.mixers.length;t++)this.mixerPausedStates[t]||this.mixers[t].update(e);this.queueShadowRender()}subscribeMixerEvent(e,t){for(let n of this.mixers)n.addEventListener(e,t)}updateShadow(){let e=this.shadow;if(e!=null){let t=this.element.arPlacement===`wall`?`back`:`bottom`;e.setScene(this,this.shadowSoftness,t),e.needsUpdate=!0}}renderShadow(e){this.updateBoundingBoxAndShadowIfDirty();let t=this.shadow;t!=null&&t.needsUpdate==1&&(t.render(e,this),t.needsUpdate=!1)}queueShadowRender(){this.shadow!=null&&(this.shadow.needsUpdate=!0)}setShadowIntensity(e){if(this.shadowIntensity=e,this.currentGLTF!=null&&(this.setBakedShadowVisibility(),!(e<=0&&this.shadow==null))){if(this.shadow==null){let e=this.element.arPlacement===`wall`?`back`:`bottom`;this.shadow=new Wp(this,this.shadowSoftness,e)}this.shadow.setIntensity(e)}}setShadowSoftness(e){this.shadowSoftness=e,this.shadow?.setSoftness(e)}setShadowOffset(e){this.shadow?.setOffset(e)}getHit(e=this){return Yp.intersectObject(e,!0).find(e=>e.object.visible&&!e.object.userData.noHit)}hitFromController(e,t=this){return Yp.setFromXRController(e),this.getHit(t)}hitFromPoint(e,t=this){return Yp.setFromCamera(e,this.getCamera()),this.getHit(t)}getModelIndexFromHit(e){let t=e.object;for(;t!=null;){let e=this.models.indexOf(t);if(e!==-1)return e;t=t.parent}return 0}positionAndNormalFromPoint(e,t=this){let n=this.hitFromPoint(e,t);if(n==null)return null;let r=n.point,i=n.face==null?Yp.ray.direction.clone().multiplyScalar(-1):n.face.normal.clone().applyNormalMatrix(new L().getNormalMatrix(n.object.matrixWorld)),a=n.uv??null,o=this.getModelIndexFromHit(n),s=this.models[o]||this.target;return{position:r,normal:i,uv:a,modelIndex:o,worldToModel:new Ye().copy(s.matrixWorld).invert()}}surfaceFromPoint(e,t=this){let n=this.hitFromPoint(e,t);if(n==null||n.face==null)return null;let r=this.getModelIndexFromHit(n),i=r===0?this.element.model:this.element.extraModels?.[r-1];if(i==null)return null;let a=i[pp](n);if(a==null)return null;let{meshes:o,primitives:s}=a.mesh.userData.associations,c=new S,l=new S,u=new S,{a:d,b:f,c:p}=n.face,m=n.object;m.getVertexPosition(d,c),m.getVertexPosition(f,l),m.getVertexPosition(p,u);let h=new M(c,l,u),g=new S;h.getBarycoord(m.worldToLocal(n.point),g),h.getBarycoord(m.worldToLocal(n.point),g);let _=`${o} ${s} ${d} ${f} ${p} ${g.x.toFixed(3)} ${g.y.toFixed(3)} ${g.z.toFixed(3)}`;return r===0?_:`${r} ${_}`}updateHotspotAttachment(e){let t=e.modelIndex!=null&&e.modelIndex>0&&this._models[e.modelIndex]?this._models[e.modelIndex]:this.target;e.parent!==t&&(t.add(e),e.updatePosition(e.position.toArray().join(` `)+`m`),e.updateMatrixWorld(!0))}addHotspot(e){this.updateHotspotAttachment(e),this.annotationRenderer.domElement.appendChild(e.element),this.updateSurfaceHotspot(e)}removeHotspot(e){e.parent&&e.parent.remove(e)}forHotspots(e){let t=[...this.target.children];for(let n=0,r=t.length;n<r;n++){let r=t[n];r instanceof Lp&&e(r)}for(let t of this._models)if(t&&t!==this.target){let n=[...t.children];for(let t=0,r=n.length;t<r;t++){let r=n[t];r instanceof Lp&&e(r)}}}updateSurfaceHotspot(e){if(e.surface==null)return;let t=Zs(e.surface)[0].terms;if(t.length!==8&&t.length!==9){console.warn(e.surface+` does not have exactly 8 or 9 numbers. Did you use an outdated string?`);return}let n=t.length===8,r=n?0:t[0].number,i=+!n,a=e.modelIndex??r;e.modelIndex=a,this.updateHotspotAttachment(e);let o=a===0?this.element.model:this.element.extraModels?.[a-1];if(o==null)return;let s=o[mp](t[0+i].number,t[1+i].number);if(s==null){console.warn(e.surface+` does not match a node/primitive in this glTF! Skipping this hotspot.`);return}let c=s.mesh.geometry.attributes.position.count,l=new S(t[2+i].number,t[3+i].number,t[4+i].number);if(l.x>=c||l.y>=c||l.z>=c){console.warn(e.surface+` vertex indices out of range in this glTF! Skipping this hotspot.`);return}let u=new S(t[5+i].number,t[6+i].number,t[7+i].number);e.mesh=s.mesh,e.tri=l,e.bary=u,e.updateSurface()}animateSurfaceHotspots(){this.element.paused||this.forHotspots(e=>{e.updateSurface()})}updateHotspotsVisibility(e){this.forHotspots(t=>{Kp.copy(e),qp.setFromMatrixPosition(t.matrixWorld),Kp.sub(qp),Jp.copy(t.normal).transformDirection(this.target.matrixWorld),Kp.dot(Jp)<0?t.hide():t.show()})}orientHotspots(e){this.forHotspots(t=>{t.orient(e)})}setHotspotsVisibility(e){this.forHotspots(t=>{t.visible=e})}updateSchema(e){let{schemaElement:t,element:n}=this,{alt:r,poster:i,iosSrc:a}=n;if(e!=null){let n=[{"@type":`MediaObject`,contentUrl:e,encodingFormat:e.split(`.`).pop()?.toLowerCase()===`gltf`?`model/gltf+json`:`model/gltf-binary`}];a&&n.push({"@type":`MediaObject`,contentUrl:a,encodingFormat:`model/vnd.usdz+zip`}),t.textContent=JSON.stringify({"@context":`http://schema.org/`,"@type":`3DModel`,image:i??void 0,name:r??void 0,encoding:n}),document.head.appendChild(t)}else t.parentElement!=null&&t.parentElement.removeChild(t)}},$p=class extends EventTarget{constructor(){super(...arguments),this.ongoingActivities=new Set,this.totalProgress=0}get ongoingActivityCount(){return this.ongoingActivities.size}beginActivity(e){let t={progress:0,completed:!1};return this.ongoingActivities.add(t),this.ongoingActivityCount===1&&this.announceTotalProgress(t,0,e),n=>{let r;return r=Math.max(Do(n,0,1),t.progress),r!==t.progress&&this.announceTotalProgress(t,r,e),t.progress}}announceTotalProgress(e,t,n){let r=0,i=0;t==1&&(e.completed=!0);for(let e of this.ongoingActivities){let{progress:t}=e;r+=1-t,e.completed&&i++}let a=e.progress;e.progress=t,this.totalProgress+=(t-a)*(1-this.totalProgress)/r;let o=i===this.ongoingActivityCount?1:this.totalProgress;this.dispatchEvent(new CustomEvent(`progress`,{detail:{totalProgress:o,reason:n}})),i===this.ongoingActivityCount&&(this.totalProgress=0,this.ongoingActivities.clear())}},em=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},tm,nm,rm,im,am,om,sm,cm,lm,um,dm,fm,pm,mm,hm,gm=10,_m=50,vm=0,ym=300,bm=150,xm=document.createElement(`canvas`),Sm=Symbol(`fallbackResizeHandler`),Cm=Symbol(`defaultAriaLabel`),wm=Symbol(`resizeObserver`),Tm=Symbol(`clearModelTimeout`),Em=Symbol(`onContextLost`),Dm=Symbol(`loaded`),Om=Symbol(`status`),km=Symbol(`onFocus`),Am=Symbol(`onBlur`),jm=Symbol(`onSlotChange`),Mm=Symbol(`onExtraModelChanged`),Nm=Symbol(`updateSize`),Pm=Symbol(`intersectionObserver`),Fm=Symbol(`isElementInViewport`),Im=Symbol(`announceModelVisibility`),Lm=Symbol(`ariaLabel`),Rm=Symbol(`altDefaulted`),zm=Symbol(`statusElement`),Bm=Symbol(`updateStatus`),Vm=Symbol(`loadedTime`),Hm=Symbol(`updateSource`),Um=Symbol(`markLoaded`),Wm=Symbol(`container`),Gm=Symbol(`input`),Km=Symbol(`canvas`),Q=Symbol(`scene`),qm=Symbol(`needsRender`),Jm=Symbol(`tick`),Ym=Symbol(`onModelLoad`),Xm=Symbol(`onResize`),$=Symbol(`renderer`),Zm=Symbol(`progressTracker`),Qm=Symbol(`getLoaded`),$m=Symbol(`getModelIsVisible`),eh=Symbol(`shouldAttemptPreload`),th=e=>({x:e.x,y:e.y,z:e.z,toString(){return`${this.x}m ${this.y}m ${this.z}m`}}),nh=e=>({u:e.x,v:e.y,toString(){return`${this.u} ${this.v}`}}),rh=class extends $t{static get is(){return`model-viewer`}static set modelCacheSize(e){lt[mt].evictionThreshold=e}static get modelCacheSize(){return lt[mt].evictionThreshold}static set minimumRenderScale(e){e>1&&console.warn(`<model-viewer> minimumRenderScale has been clamped to a maximum value of 1.`),e<=0&&console.warn(`<model-viewer> minimumRenderScale has been clamped to a minimum value of 0.25.`),Vd.singleton.minScale=e}static get minimumRenderScale(){return Vd.singleton.minScale}get loaded(){return this[Qm]()}get[(tm=Fm,nm=Dm,rm=Vm,im=Om,am=Tm,om=jm,sm=Mm,cm=Sm,lm=Im,um=wm,dm=Pm,fm=Zm,$)](){return Vd.singleton}get modelIsVisible(){return this[$m]()}constructor(){super(),this.alt=null,this.src=null,this.withCredentials=!1,this.generateSchema=!1,this[tm]=!1,this[nm]=!1,this[rm]=0,this[im]=``,this[am]=null,this[om]=()=>{if(!this[Q])return;let e=Array.from(this.querySelectorAll(`extra-model`)),t=e.map(e=>e.src).filter(e=>e!=null),n=this[Q].extraUrls||[];(t.join(`,`)!==n.join(`,`)||e.length!==n.length)&&this[Hm]()},this[sm]=e=>{let t=e,n=t.target,r=Array.from(this.querySelectorAll(`extra-model`)).indexOf(n);if(console.log(`[onExtraModelChanged] childIndex: ${r} srcChanged: ${t.detail.srcChanged} offset: ${t.detail.offset}`),r===-1)return;let i=this.src?r+1:r;t.detail.srcChanged?(this[Dm]=!1,this[Hm]()):this[Q]&&this[Q].updateModelTransforms(i,t.detail.offset,t.detail.orientation,t.detail.scale)},this[cm]=Eo(()=>{let e=this.getBoundingClientRect();this[Nm](e)},_m),this[lm]=Eo(e=>{let t=this.modelIsVisible;t!==e&&this.dispatchEvent(new CustomEvent(`model-visibility`,{detail:{visible:t}}))},vm),this[um]=null,this[dm]=null,this[fm]=new $p,this[pm]=()=>{this[zm].textContent=this[Om]},this[mm]=()=>{this[zm].textContent=``},this[hm]=e=>{this.dispatchEvent(new CustomEvent(`error`,{detail:{type:`webglcontextlost`,sourceError:e.sourceEvent}}))},this.attachShadow({mode:`open`});let e=this.shadowRoot;Wo(e),this[Wm]=e.querySelector(`.container`),this[Gm]=e.querySelector(`.userInput`),this[Km]=e.querySelector(`canvas`),this[zm]=e.querySelector(`#status`),this[Cm]=this[Gm].getAttribute(`aria-label`);let t,n;if(this.isConnected){let e=this.getBoundingClientRect();t=e.width,n=e.height}else t=ym,n=bm;this[Q]=new Qp({canvas:this[Km],element:this,width:t,height:n}),Promise.resolve().then(()=>{this[Nm](this.getBoundingClientRect())}),uo&&(this[wm]=new ResizeObserver(e=>{if(!this[$].isPresenting)for(let t of e)t.target===this&&this[Nm](t.contentRect)})),fo?this[Pm]=new IntersectionObserver(e=>{for(let t of e)if(t.target===this){let e=this.modelIsVisible;this[Fm]=t.isIntersecting,this[Im](e),console.log(`IntersectionObserver fired! isIntersecting: ${t.isIntersecting}`),this[Fm]&&!this.loaded&&this[Hm]()}},{root:null,rootMargin:`0px`,threshold:1e-5}):this[Fm]=!0}connectedCallback(){super.connectedCallback&&super.connectedCallback(),uo?this[wm].observe(this):self.addEventListener(`resize`,this[Sm]),fo&&this[Pm].observe(this),this.addEventListener(`focus`,this[km]),this.addEventListener(`blur`,this[Am]),this.addEventListener(`extra-model-changed`,this[Mm]);let e=this.shadowRoot.querySelector(`.slot.default slot`);e&&e.addEventListener(`slotchange`,this[jm]);let t=this[$];t.addEventListener(`contextlost`,this[Em]),t.registerScene(this[Q]),this[Tm]!=null&&(self.clearTimeout(this[Tm]),this[Tm]=null,this.requestUpdate(`src`,null))}disconnectedCallback(){super.disconnectedCallback&&super.disconnectedCallback(),uo?this[wm].unobserve(this):self.removeEventListener(`resize`,this[Sm]),fo&&this[Pm].unobserve(this),this.removeEventListener(`focus`,this[km]),this.removeEventListener(`blur`,this[Am]),this.removeEventListener(`extra-model-changed`,this[Mm]);let e=this.shadowRoot.querySelector(`.slot.default slot`);e&&e.removeEventListener(`slotchange`,this[jm]);let t=this[$];t.removeEventListener(`contextlost`,this[Em]),t.unregisterScene(this[Q]),this[Tm]=self.setTimeout(()=>{this[Q].dispose(),this[Tm]=null},gm)}updated(e){if(super.updated(e),e.has(`src`)){let e=Array.from(this.querySelectorAll(`extra-model`)),t=e.map(e=>e.src).filter(e=>e!=null).join(`,`)===(this[Q].extraUrls||[]).join(`,`);this.src==null&&e.length===0?(this[Dm]=!1,this[Vm]=0,this[Q].reset()):(this.src!==this[Q].url||!t)&&(this[Dm]=!1,this[Vm]=0,this[Hm]())}if(e.has(`alt`)&&this[Gm].setAttribute(`aria-label`,this[Lm]),e.has(`generateSchema`)){if(this.generateSchema){let e=Array.from(this.querySelectorAll(`extra-model`)).map(e=>e.src).filter(e=>e!=null),t=this.src||e[0]||null;this[Q].updateSchema(t)}else this[Q].updateSchema(null)}}toDataURL(e,t){return this[$].displayCanvas(this[Q]).toDataURL(e,t)}async toBlob(e){let t=e?e.mimeType:void 0,n=e?e.qualityArgument:void 0,r=e?e.idealAspect:void 0,{width:i,height:a,idealAspect:o,aspect:s}=this[Q],{dpr:c,scaleFactor:l}=this[$],u=i*l*c,d=a*l*c,f=0,p=0;if(r===!0){if(o>s){let e=d;d=Math.round(u/o),p=(e-d)/2}else{let e=u;u=Math.round(d*o),f=(e-u)/2}}xm.width=u,xm.height=d;try{return new Promise(async(e,r)=>{xm.getContext(`2d`).drawImage(this[$].displayCanvas(this[Q]),f,p,u,d,0,0,u,d),xm.toBlob(t=>{if(!t)return r(Error(`Unable to retrieve canvas blob`));e(t)},t,n)})}finally{this[Nm]({width:i,height:a})}}registerEffectComposer(e){e.setRenderer(this[$].threeRenderer),e.setMainCamera(this[Q].getCamera()),e.setMainScene(this[Q]),this[Q].effectRenderer=e}unregisterEffectComposer(){this[Q].effectRenderer=null}registerRenderer(e){this[Q].externalRenderer=e}unregisterRenderer(){this[Q].externalRenderer=null}get[Lm](){return this[Rm]}get[Rm](){return this.alt==null||this.alt===`null`?this[Cm]:this.alt}[Qm](){return this[Dm]}[$m](){return this.loaded&&this[Fm]}[eh](){let e=Array.from(this.querySelectorAll(`extra-model`));return!!(this.src||e.length>0)&&this[Fm]}[Nm]({width:e,height:t}){e!==0&&t!==0&&(this[Wm].style.width=`${e}px`,this[Wm].style.height=`${t}px`,this[Xm]({width:e,height:t}))}[Jm](e,t){var n;(n=this[Q].effectRenderer)==null||n.beforeRender(e,t)}[Um](){this[Dm]||(this[Dm]=!0,this[Vm]=performance.now())}[qm](){this[Q].queueRender()}[Ym](){}[Bm](e){this[Om]=e;let t=this.getRootNode();t!=null&&t.activeElement===this&&this[zm].textContent!=e&&(this[zm].textContent=e)}[(pm=km,mm=Am,Xm)](e){this[Q].setSize(e.width,e.height)}async[(hm=Em,Hm)](){let e=this[Q],t=Array.from(this.querySelectorAll(`extra-model`)).map(e=>e.src).filter(e=>e!=null),n=t.join(`,`)===(e.extraUrls||[]).join(`,`);if(console.log(`[$updateSource] called! \nsrc: ${this.src}\nextraUrls: ${t.join(`,`)}\nloaded: ${this.loaded}`),this.loaded||!this[eh]()||this.src===e.url&&n){console.log(`[$updateSource] BAILING OUT EARLY!`);return}let r=this.src,i=r||t[0]||null;this.generateSchema&&e.updateSchema(i),this[Bm](`Loading`),e.stopAnimation();let a=this[Zm].beginActivity(`model-load`);try{let n=e.setSource(r,t,e=>a(Do(e,0,1)*.95)),o=this[Ro]();await Promise.all([n,o]),Array.from(this.querySelectorAll(`extra-model`)).forEach((e,t)=>{let n=this.src?t+1:t;this[Q].updateModelTransforms(n,e.offset,e.orientation,e.scale)}),this[Um](),this[Ym](),this.updateComplete.then(()=>{this.dispatchEvent(new CustomEvent(`before-render`))}),await new Promise(e=>{let t=setTimeout(()=>{console.warn(`rAF timed out in updateSource`),e()},500);requestAnimationFrame(()=>{requestAnimationFrame(()=>{clearTimeout(t),e()})})}),this.dispatchEvent(new CustomEvent(`load`,{detail:{url:i}}))}catch(e){this.dispatchEvent(new CustomEvent(`error`,{detail:{type:`loadfailure`,sourceError:e}}))}finally{a(1)}}};em([W({type:String})],rh.prototype,`alt`,void 0),em([W({type:String})],rh.prototype,`src`,void 0),em([W({type:Boolean,attribute:`with-credentials`})],rh.prototype,`withCredentials`,void 0),em([W({type:Boolean,attribute:`generate-schema`})],rh.prototype,`generateSchema`,void 0);var ih=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},ah=1e3,oh=Symbol(`changeAnimation`),sh=Symbol(`appendAnimation`),ch=Symbol(`detachAnimation`),lh=Symbol(`paused`),uh={repetitions:1/0,pingpong:!1},dh={pingpong:!1,repetitions:null,weight:1,timeScale:1,fade:!1,warp:!1,relativeWarp:!0,time:null},fh={fade:!0},ph=e=>{var t;class n extends e{constructor(...e){super(e),this.autoplay=!1,this.animationName=void 0,this.animationCrossfadeDuration=300,this[t]=!0,this[Q].subscribeMixerEvent(`loop`,e=>{let t=e.action._loopCount,n=e.action._clip.name,r=e.action._clip.uuid,i=this[Q].markedAnimations.find(e=>e.name===n);if(i){this[Q].updateAnimationLoop(i.name,i.loopMode,i.repetitionCount);let e=this[Q].markedAnimations.filter(e=>e.name!==n);this[Q].markedAnimations=e}this.dispatchEvent(new CustomEvent(`loop`,{detail:{count:t,name:n,uuid:r}}))}),this[Q].subscribeMixerEvent(`finished`,e=>{if(!this[Q].appendedAnimations.includes(e.action._clip.name))this[lh]=!0;else{let t=this[Q].appendedAnimations.filter(t=>t!==e.action._clip.name);this[Q].appendedAnimations=t}this.dispatchEvent(new CustomEvent(`finished`))})}get availableAnimations(){return this.loaded?this[Q].animationNames:[]}get duration(){return this[Q].duration}get paused(){return this[Q].isAllAnimationsPaused()}get currentTime(){return this[Q].animationTime}get appendedAnimations(){return this[Q].appendedAnimations}set currentTime(e){this[Q].animationTime=e,this[qm]()}get timeScale(){return this[Q].animationTimeScale}set timeScale(e){this[Q].animationTimeScale=e}pause(e){if(e?.modelIndex==null&&this.paused)return;let t=e?.modelIndex??null;this[Q].pauseAnimation(t),this.dispatchEvent(new CustomEvent(`pause`))}play(e){if(this.availableAnimations.length>0){let t=e?.modelIndex??null;this[Q].unpauseAnimation(t),this[oh](e),this.dispatchEvent(new CustomEvent(`play`))}}appendAnimation(e,t){this.availableAnimations.length>0&&(this[lh]=!1,this[Q].unpauseAnimation(t?.modelIndex??null),this[sh](e,t),this.dispatchEvent(new CustomEvent(`append-animation`)))}detachAnimation(e,t){this.availableAnimations.length>0&&(this[lh]=!1,this[Q].unpauseAnimation(t?.modelIndex??null),this[ch](e,t),this.dispatchEvent(new CustomEvent(`detach-animation`)))}[(t=lh,Ym)](){super[Ym](),this[Q].pauseAnimation(),this.animationName!=null&&this[oh](),this.autoplay&&this.play()}[Jm](e,t){super[Jm](e,t),!(this.paused||!this[$m]()&&!this[$].isPresenting)&&(this[Q].updateAnimation(t/ah),this[qm]())}updated(e){super.updated(e),e.has(`autoplay`)&&this.autoplay&&this.play(),e.has(`animationName`)&&this[oh]()}[oh](e=uh){let t=e.repetitions??1/0,n=e.pingpong?Ve:t===1?dt:Ee;this[Q].playAnimation(this.animationName,this.animationCrossfadeDuration/ah,n,t,e.modelIndex),this[lh]&&(this[Q].updateAnimation(0),this[qm]())}[sh](e=``,t={}){let n=Object.assign(Object.assign({},dh),t),r=n.repetitions??1/0,i=n.pingpong?Ve:r===1?dt:Ee,a=!!t.repetitions||`pingpong`in t;this[Q].appendAnimation(e||this.animationName,i,r,n.weight,n.timeScale,n.fade,n.warp,n.relativeWarp,n.time,a,n.modelIndex),this[lh]&&(this[Q].updateAnimation(0),this[qm]())}[ch](e=``,t={}){let n=Object.assign(Object.assign({},fh),t);this[Q].detachAnimation(e||this.animationName,n.fade,n.modelIndex),this[lh]&&(this[Q].updateAnimation(0),this[qm]())}}return ih([W({type:Boolean})],n.prototype,`autoplay`,void 0),ih([W({type:String,attribute:`animation-name`})],n.prototype,`animationName`,void 0),ih([W({type:Number,attribute:`animation-crossfade-duration`})],n.prototype,`animationCrossfadeDuration`,void 0),n},mh=Symbol(`hotspotMap`),hh=Symbol(`mutationCallback`),gh=Symbol(`observer`),_h=Symbol(`addHotspot`),vh=Symbol(`removeHotspot`),yh=e=>{var t,n,r;class i extends e{constructor(){super(...arguments),this[t]=new Map,this[n]=e=>{e.forEach(e=>{(!(e instanceof MutationRecord)||e.type===`childList`)&&(e.addedNodes.forEach(e=>{this[_h](e)}),e.removedNodes.forEach(e=>{this[vh](e)}),this[qm]())})},this[r]=new MutationObserver(this[hh])}connectedCallback(){super.connectedCallback();for(let e=0;e<this.children.length;++e)this[_h](this.children[e]);let{ShadyDOM:e}=self;e==null?this[gh].observe(this,{childList:!0}):this[gh]=e.observeChildren(this,this[hh])}disconnectedCallback(){super.disconnectedCallback();let{ShadyDOM:e}=self;e==null?this[gh].disconnect():e.unobserveChildren(this[gh])}[(t=mh,n=hh,r=gh,Ym)](){super[Ym]();let e=this[Q];e.forHotspots(t=>{e.updateHotspotAttachment(t),e.updateSurfaceHotspot(t)})}[Jm](e,t){super[Jm](e,t);let n=this[Q],{annotationRenderer:r}=n,i=n.getCamera();n.shouldRender()&&(n.animateSurfaceHotspots(),n.updateHotspotsVisibility(i.position),r.domElement.style.display=``,r.render(n,i))}updateHotspot(e){let t=this[mh].get(e.name);t!=null&&(t.updatePosition(e.position),t.updateNormal(e.normal),t.surface=e.surface,e.modelIndex!==void 0&&e.modelIndex!==null&&(t.modelIndex=e.modelIndex),this[Q].updateSurfaceHotspot(t),this[qm]())}queryHotspot(e){let t=this[mh].get(e);if(t==null)return null;let n=th(t.position),r=th(t.normal),i=t.facingCamera,a=this[Q],o=a.getCamera(),s=new S;s.setFromMatrixPosition(t.matrixWorld),s.project(o);let c=a.width/2,l=a.height/2;s.x=s.x*c+c,s.y=-(s.y*l)+l;let u=th(new S(s.x,s.y,s.z));return!Number.isFinite(u.x)||!Number.isFinite(u.y)?null:{position:n,normal:r,canvasPosition:u,facingCamera:i}}positionAndNormalFromPoint(e,t){let n=this[Q],r=n.getNDC(e,t),i=n.positionAndNormalFromPoint(r);if(i==null)return null;let a=i.worldToModel,o=th(i.position.applyMatrix4(a)),s=th(i.normal.transformDirection(a)),c=null;return i.uv!=null&&(c=nh(i.uv)),{position:o,normal:s,uv:c,modelIndex:i.modelIndex}}surfaceFromPoint(e,t){let n=this[Q],r=n.getNDC(e,t);return n.surfaceFromPoint(r)}[_h](e){if(!(e instanceof HTMLElement&&e.slot.indexOf(`hotspot`)===0))return;let t=this[mh].get(e.slot);if(t!=null){t.increment();let n=e.dataset.visibilityAttribute;if(n!=null){let r=`data-${n}`;e.toggleAttribute(r,t.facingCamera)}e.dispatchEvent(new CustomEvent(`hotspot-visibility`,{detail:{visible:t.facingCamera}}))}else t=new Lp({name:e.slot,position:e.dataset.position,normal:e.dataset.normal,surface:e.dataset.surface,modelIndex:e.dataset.modelIndex==null?null:parseInt(e.dataset.modelIndex)}),this[mh].set(e.slot,t),this[Q].addHotspot(t);this[Q].queueRender()}[vh](e){if(!(e instanceof HTMLElement))return;let t=this[mh].get(e.slot);t&&(t.decrement()&&(this[Q].removeHotspot(t),this[mh].delete(e.slot)),this[Q].queueRender())}}return i},bh=Uint8Array,xh=Uint16Array,Sh=Int32Array,Ch=new bh([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),wh=new bh([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),Th=new bh([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Eh=function(e,t){for(var n=new xh(31),r=0;r<31;++r)n[r]=t+=1<<e[r-1];for(var i=new Sh(n[30]),r=1;r<30;++r)for(var a=n[r];a<n[r+1];++a)i[a]=a-n[r]<<5|r;return{b:n,r:i}},Dh=Eh(Ch,2),Oh=Dh.b,kh=Dh.r;Oh[28]=258,kh[258]=28;var Ah=Eh(wh,0);Ah.b;for(var jh=Ah.r,Mh=new xh(32768),Nh=0;Nh<32768;++Nh){var Ph=(Nh&43690)>>1|(Nh&21845)<<1;Ph=(Ph&52428)>>2|(Ph&13107)<<2,Ph=(Ph&61680)>>4|(Ph&3855)<<4,Mh[Nh]=((Ph&65280)>>8|(Ph&255)<<8)>>1}for(var Fh=(function(e,t,n){for(var r=e.length,i=0,a=new xh(t);i<r;++i)e[i]&&++a[e[i]-1];var o=new xh(t);for(i=1;i<t;++i)o[i]=o[i-1]+a[i-1]<<1;var s;if(n){s=new xh(1<<t);var c=15-t;for(i=0;i<r;++i)if(e[i])for(var l=i<<4|e[i],u=t-e[i],d=o[e[i]-1]++<<u,f=d|(1<<u)-1;d<=f;++d)s[Mh[d]>>c]=l}else for(s=new xh(r),i=0;i<r;++i)e[i]&&(s[i]=Mh[o[e[i]-1]++]>>15-e[i]);return s}),Ih=new bh(288),Nh=0;Nh<144;++Nh)Ih[Nh]=8;for(var Nh=144;Nh<256;++Nh)Ih[Nh]=9;for(var Nh=256;Nh<280;++Nh)Ih[Nh]=7;for(var Nh=280;Nh<288;++Nh)Ih[Nh]=8;for(var Lh=new bh(32),Nh=0;Nh<32;++Nh)Lh[Nh]=5;var Rh=Fh(Ih,9,0),zh=Fh(Lh,5,0),Bh=function(e){return(e+7)/8|0},Vh=function(e,t,n){return(t==null||t<0)&&(t=0),(n==null||n>e.length)&&(n=e.length),new bh(e.subarray(t,n))},Hh=[`unexpected EOF`,`invalid block type`,`invalid length/literal`,`invalid distance`,`stream finished`,`no stream handler`,,`no callback`,`invalid UTF-8 data`,`extra field too long`,`date not in range 1980-2099`,`filename too long`,`stream finishing`,`invalid zip data`],Uh=function(e,t,n){var r=Error(t||Hh[e]);if(r.code=e,Error.captureStackTrace&&Error.captureStackTrace(r,Uh),!n)throw r;return r},Wh=function(e,t,n){n<<=t&7;var r=t/8|0;e[r]|=n,e[r+1]|=n>>8},Gh=function(e,t,n){n<<=t&7;var r=t/8|0;e[r]|=n,e[r+1]|=n>>8,e[r+2]|=n>>16},Kh=function(e,t){for(var n=[],r=0;r<e.length;++r)e[r]&&n.push({s:r,f:e[r]});var i=n.length,a=n.slice();if(!i)return{t:$h,l:0};if(i==1){var o=new bh(n[0].s+1);return o[n[0].s]=1,{t:o,l:1}}n.sort(function(e,t){return e.f-t.f}),n.push({s:-1,f:25001});var s=n[0],c=n[1],l=0,u=1,d=2;for(n[0]={s:-1,f:s.f+c.f,l:s,r:c};u!=i-1;)s=n[n[l].f<n[d].f?l++:d++],c=n[l!=u&&n[l].f<n[d].f?l++:d++],n[u++]={s:-1,f:s.f+c.f,l:s,r:c};for(var f=a[0].s,r=1;r<i;++r)a[r].s>f&&(f=a[r].s);var p=new xh(f+1),m=qh(n[u-1],p,0);if(m>t){var r=0,h=0,g=m-t,_=1<<g;for(a.sort(function(e,t){return p[t.s]-p[e.s]||e.f-t.f});r<i;++r){var v=a[r].s;if(p[v]>t)h+=_-(1<<m-p[v]),p[v]=t;else break}for(h>>=g;h>0;){var y=a[r].s;p[y]<t?h-=1<<t-p[y]++-1:++r}for(;r>=0&&h;--r){var b=a[r].s;p[b]==t&&(--p[b],++h)}m=t}return{t:new bh(p),l:m}},qh=function(e,t,n){return e.s==-1?Math.max(qh(e.l,t,n+1),qh(e.r,t,n+1)):t[e.s]=n},Jh=function(e){for(var t=e.length;t&&!e[--t];);for(var n=new xh(++t),r=0,i=e[0],a=1,o=function(e){n[r++]=e},s=1;s<=t;++s)if(e[s]==i&&s!=t)++a;else{if(!i&&a>2){for(;a>138;a-=138)o(32754);a>2&&(o(a>10?a-11<<5|28690:a-3<<5|12305),a=0)}else if(a>3){for(o(i),--a;a>6;a-=6)o(8304);a>2&&(o(a-3<<5|8208),a=0)}for(;a--;)o(i);a=1,i=e[s]}return{c:n.subarray(0,r),n:t}},Yh=function(e,t){for(var n=0,r=0;r<t.length;++r)n+=e[r]*t[r];return n},Xh=function(e,t,n){var r=n.length,i=Bh(t+2);e[i]=r&255,e[i+1]=r>>8,e[i+2]=e[i]^255,e[i+3]=e[i+1]^255;for(var a=0;a<r;++a)e[i+a+4]=n[a];return(i+4+r)*8},Zh=function(e,t,n,r,i,a,o,s,c,l,u){Wh(t,u++,n),++i[256];for(var d=Kh(i,15),f=d.t,p=d.l,m=Kh(a,15),h=m.t,g=m.l,_=Jh(f),v=_.c,y=_.n,b=Jh(h),x=b.c,S=b.n,C=new xh(19),w=0;w<v.length;++w)++C[v[w]&31];for(var w=0;w<x.length;++w)++C[x[w]&31];for(var T=Kh(C,7),E=T.t,D=T.l,O=19;O>4&&!E[Th[O-1]];--O);var k=l+5<<3,ee=Yh(i,Ih)+Yh(a,Lh)+o,A=Yh(i,f)+Yh(a,h)+o+14+3*O+Yh(C,E)+2*C[16]+3*C[17]+7*C[18];if(c>=0&&k<=ee&&k<=A)return Xh(t,u,e.subarray(c,c+l));var te,j,ne,re;if(Wh(t,u,1+(A<ee)),u+=2,A<ee){te=Fh(f,p,0),j=f,ne=Fh(h,g,0),re=h;var ie=Fh(E,D,0);Wh(t,u,y-257),Wh(t,u+5,S-1),Wh(t,u+10,O-4),u+=14;for(var w=0;w<O;++w)Wh(t,u+3*w,E[Th[w]]);u+=3*O;for(var M=[v,x],ae=0;ae<2;++ae)for(var N=M[ae],w=0;w<N.length;++w){var oe=N[w]&31;Wh(t,u,ie[oe]),u+=E[oe],oe>15&&(Wh(t,u,N[w]>>5&127),u+=N[w]>>12)}}else te=Rh,j=Ih,ne=zh,re=Lh;for(var w=0;w<s;++w){var P=r[w];if(P>255){var oe=P>>18&31;Gh(t,u,te[oe+257]),u+=j[oe+257],oe>7&&(Wh(t,u,P>>23&31),u+=Ch[oe]);var se=P&31;Gh(t,u,ne[se]),u+=re[se],se>3&&(Gh(t,u,P>>5&8191),u+=wh[se])}else Gh(t,u,te[P]),u+=j[P]}return Gh(t,u,te[256]),u+j[256]},Qh=new Sh([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),$h=new bh(0),eg=function(e,t,n,r,i,a){var o=a.z||e.length,s=new bh(r+o+5*(1+Math.ceil(o/7e3))+i),c=s.subarray(r,s.length-i),l=a.l,u=(a.r||0)&7;if(t){u&&(c[0]=a.r>>3);for(var d=Qh[t-1],f=d>>13,p=d&8191,m=(1<<n)-1,h=a.p||new xh(32768),g=a.h||new xh(m+1),_=Math.ceil(n/3),v=2*_,y=function(t){return(e[t]^e[t+1]<<_^e[t+2]<<v)&m},b=new Sh(25e3),x=new xh(288),S=new xh(32),C=0,w=0,T=a.i||0,E=0,D=a.w||0,O=0;T+2<o;++T){var k=y(T),ee=T&32767,A=g[k];if(h[ee]=A,g[k]=ee,D<=T){var te=o-T;if((C>7e3||E>24576)&&(te>423||!l)){u=Zh(e,c,0,b,x,S,w,E,O,T-O,u),E=C=w=0,O=T;for(var j=0;j<286;++j)x[j]=0;for(var j=0;j<30;++j)S[j]=0}var ne=2,re=0,ie=p,M=ee-A&32767;if(te>2&&k==y(T-M))for(var ae=Math.min(f,te)-1,N=Math.min(32767,T),oe=Math.min(258,te);M<=N&&--ie&&ee!=A;){if(e[T+ne]==e[T+ne-M]){for(var P=0;P<oe&&e[T+P]==e[T+P-M];++P);if(P>ne){if(ne=P,re=M,P>ae)break;for(var se=Math.min(M,P-2),F=0,j=0;j<se;++j){var ce=T-M+j&32767,le=ce-h[ce]&32767;le>F&&(F=le,A=ce)}}}ee=A,A=h[ee],M+=ee-A&32767}if(re){b[E++]=268435456|kh[ne]<<18|jh[re];var ue=kh[ne]&31,de=jh[re]&31;w+=Ch[ue]+wh[de],++x[257+ue],++S[de],D=T+ne,++C}else b[E++]=e[T],++x[e[T]]}}for(T=Math.max(T,D);T<o;++T)b[E++]=e[T],++x[e[T]];u=Zh(e,c,l,b,x,S,w,E,O,T-O,u),l||(a.r=u&7|c[u/8|0]<<3,u-=7,a.h=g,a.p=h,a.i=T,a.w=D)}else{for(var T=a.w||0;T<o+l;T+=65535){var fe=T+65535;fe>=o&&(c[u/8|0]=l,fe=o),u=Xh(c,u+1,e.subarray(T,fe))}a.i=o}return Vh(s,0,r+Bh(u)+i)},tg=(function(){for(var e=new Int32Array(256),t=0;t<256;++t){for(var n=t,r=9;--r;)n=(n&1&&-306674912)^n>>>1;e[t]=n}return e})(),ng=function(){var e=-1;return{p:function(t){for(var n=e,r=0;r<t.length;++r)n=tg[n&255^t[r]]^n>>>8;e=n},d:function(){return~e}}},rg=function(e,t,n,r,i){if(!i&&(i={l:1},t.dictionary)){var a=t.dictionary.subarray(-32768),o=new bh(a.length+e.length);o.set(a),o.set(e,a.length),e=o,i.w=a.length}return eg(e,t.level==null?6:t.level,t.mem==null?i.l?Math.ceil(Math.max(8,Math.min(13,Math.log(e.length)))*1.5):20:12+t.mem,n,r,i)},ig=function(e,t){var n={};for(var r in e)n[r]=e[r];for(var r in t)n[r]=t[r];return n},ag=function(e,t,n){for(;n;++t)e[t]=n,n>>>=8};function og(e,t){return rg(e,t||{},0,0)}var sg=function(e,t,n,r){for(var i in e){var a=e[i],o=t+i,s=r;Array.isArray(a)&&(s=ig(r,a[1]),a=a[0]),a instanceof bh?n[o]=[a,s]:(n[o+=`/`]=[new bh(0),s],sg(a,o,n,r))}},cg=typeof TextEncoder<`u`&&new TextEncoder,lg=typeof TextDecoder<`u`&&new TextDecoder;try{lg.decode($h,{stream:!0})}catch{}function ug(e,t){if(t){for(var n=new bh(e.length),r=0;r<e.length;++r)n[r]=e.charCodeAt(r);return n}if(cg)return cg.encode(e);for(var i=e.length,a=new bh(e.length+(e.length>>1)),o=0,s=function(e){a[o++]=e},r=0;r<i;++r){if(o+5>a.length){var c=new bh(o+8+(i-r<<1));c.set(a),a=c}var l=e.charCodeAt(r);l<128||t?s(l):l<2048?(s(192|l>>6),s(128|l&63)):l>55295&&l<57344?(l=65536+(l&1047552)|e.charCodeAt(++r)&1023,s(240|l>>18),s(128|l>>12&63),s(128|l>>6&63),s(128|l&63)):(s(224|l>>12),s(128|l>>6&63),s(128|l&63))}return Vh(a,0,o)}var dg=function(e){var t=0;if(e)for(var n in e){var r=e[n].length;r>65535&&Uh(9),t+=r+4}return t},fg=function(e,t,n,r,i,a,o,s){var c=r.length,l=n.extra,u=s&&s.length,d=dg(l);ag(e,t,o==null?67324752:33639248),t+=4,o!=null&&(e[t++]=20,e[t++]=n.os),e[t]=20,t+=2,e[t++]=n.flag<<1|(a<0&&8),e[t++]=i&&8,e[t++]=n.compression&255,e[t++]=n.compression>>8;var f=new Date(n.mtime==null?Date.now():n.mtime),p=f.getFullYear()-1980;if((p<0||p>119)&&Uh(10),ag(e,t,p<<25|f.getMonth()+1<<21|f.getDate()<<16|f.getHours()<<11|f.getMinutes()<<5|f.getSeconds()>>1),t+=4,a!=-1&&(ag(e,t,n.crc),ag(e,t+4,a<0?-a-2:a),ag(e,t+8,n.size)),ag(e,t+12,c),ag(e,t+14,d),t+=16,o!=null&&(ag(e,t,u),ag(e,t+6,n.attrs),ag(e,t+10,o),t+=14),e.set(r,t),t+=c,d)for(var m in l){var h=l[m],g=h.length;ag(e,t,+m),ag(e,t+2,g),e.set(h,t+4),t+=4+g}return u&&(e.set(s,t),t+=u),t},pg=function(e,t,n,r,i){ag(e,t,101010256),ag(e,t+8,n),ag(e,t+10,n),ag(e,t+12,r),ag(e,t+16,i)};function mg(e,t){t||={};var n={},r=[];sg(e,``,n,t);var i=0,a=0;for(var o in n){var s=n[o],c=s[0],l=s[1],u=l.level==0?0:8,d=ug(o),f=d.length,p=l.comment,m=p&&ug(p),h=m&&m.length,g=dg(l.extra);f>65535&&Uh(11);var _=u?og(c,l):c,v=_.length,y=ng();y.p(c),r.push(ig(l,{size:c.length,crc:y.d(),c:_,f:d,m,u:f!=o.length||m&&p.length!=h,o:i,compression:u})),i+=30+f+g+v,a+=76+2*(f+g)+(h||0)+v}for(var b=new bh(a+22),x=i,S=a-i,C=0;C<r.length;++C){var d=r[C];fg(b,d.o,d,d.f,d.u,d.c.length);var w=30+d.f.length+dg(d.extra);b.set(d.c,d.o+w),fg(b,i,d,d.f,d.u,d.c.length,d.o,d.m),i+=16+w+(d.m?d.m.length:0)}return pg(b,i,r.length,S,x),b}var hg=class{constructor(e,t=``,n=[],r=[]){this.name=e,this.type=t,this.metadata=n,this.properties=r,this.children=[]}addMetadata(e,t){this.metadata.push({key:e,value:t})}addProperty(e,t=[]){this.properties.push({property:e,metadata:t})}addChild(e){this.children.push(e)}toString(e=0){let t=`	`.repeat(e),n=this.metadata.map(e=>{let n=e.key,r=e.value;if(Array.isArray(r)){let e=[];return e.push(`${n} = {`),r.forEach(n=>{e.push(`${t}\t\t${n}`)}),e.push(`${t}\t}`),e.join(`
`)}return`${n} = ${r}`}),r=n.length?` (\n${n.map(e=>`${t}\t${e}`).join(`
`)}\n${t})`:``,i=this.properties.map(e=>{let n=e.property,r=e.metadata.length?` (\n${e.metadata.map(e=>`${t}\t\t${e}`).join(`
`)}\n${t}\t)`:``;return`${t}\t${n}${r}`}),a=this.children.map(t=>t.toString(e+1)),o=[];if(i.length>0&&o.push(...i),a.length>0){i.length>0&&o.push(``);for(let e=0;e<a.length;e++)o.push(a[e]),e<a.length-1&&o.push(``)}let s=o.join(`
`);return`${t}def ${this.type?this.type+` `:``}"${this.name}"${r}\n${t}{\n${s}\n${t}}`}},gg=class{constructor(){this.textureUtils=null}setTextureUtils(e){this.textureUtils=e}parse(e,t,n,r){this.parseAsync(e,r).then(t).catch(n)}async parseAsync(e,t={}){t=Object.assign({ar:{anchoring:{type:`plane`},planeAnchoring:{alignment:`horizontal`}},includeAnchoringProperties:!0,onlyVisible:!0,quickLookCompatible:!1,maxTextureSize:1024},t);let n=new Set,r={},i=`model.usda`;r[i]=null;let a=new hg(`Root`,`Xform`),o=new hg(`Scenes`,`Scope`);o.addMetadata(`kind`,`"sceneLibrary"`),a.addChild(o);let s=`Scene`,c=new hg(s,`Xform`);c.addMetadata(`customData`,[`bool preliminary_collidesWithEnvironment = 0`,`string sceneName = "${s}"`]),c.addMetadata(`sceneName`,`"${s}"`),t.includeAnchoringProperties&&(c.addProperty(`token preliminary:anchoring:type = "${t.ar.anchoring.type}"`),c.addProperty(`token preliminary:planeAnchoring:alignment = "${t.ar.planeAnchoring.alignment}"`)),o.addChild(c);let l,u={},d={};xg(e,c,u,n,r,t);let f=Mg(u,d,t.quickLookCompatible);l=bg()+`
`+a.toString()+`

`+f.toString(),r[i]=ug(l),l=null;for(let e in d){let n=d[e];if(n.isCompressedTexture===!0){if(this.textureUtils===null)throw Error(`THREE.USDZExporter: setTextureUtils() must be called to process compressed textures.`);n=await this.textureUtils.decompress(n)}let i=vg(n.image,n.flipY,t.maxTextureSize),a=await new Promise(e=>i.toBlob(e,`image/png`,1));r[`textures/Texture_${e}.png`]=new Uint8Array(await a.arrayBuffer())}let p=0;for(let e in r){let t=r[e],n=34+e.length;p+=n;let i=p&63;if(i!==4){let n=64-i;r[e]=[t,{extra:{12345:new Uint8Array(n)}}]}p=t.length}return mg(r,{level:0})}};function _g(e,t){let n=e.name;return n=n.replace(/[^A-Za-z0-9_]/g,``),/^[0-9]/.test(n)&&(n=`_`+n),n===``&&(n=e.isCamera?`Camera`:`Object`),t.has(n)&&(n=n+`_`+e.id),t.add(n),n}function vg(e,t,n){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof OffscreenCanvas<`u`&&e instanceof OffscreenCanvas||typeof ImageBitmap<`u`&&e instanceof ImageBitmap){let r=n/Math.max(e.width,e.height),i=document.createElement(`canvas`);i.width=e.width*Math.min(1,r),i.height=e.height*Math.min(1,r);let a=i.getContext(`2d`);return t===!0&&(a.translate(0,i.height),a.scale(1,-1)),a.drawImage(e,0,0,i.width,i.height),i}throw Error(`THREE.USDZExporter: No valid image data found. Unable to process texture.`)}var yg=7;function bg(){return`#usda 1.0
(
	customLayerData = {
		string creator = "Three.js USDZExporter"
	}
	defaultPrim = "Root"
	metersPerUnit = 1
	upAxis = "Y"
)
`}function xg(e,t,n,r,i,a){for(let o=0,s=e.children.length;o<s;o++){let s=e.children[o];if(s.visible===!1&&a.onlyVisible===!0)continue;let c;if(s.isMesh){let e=s.geometry,t=s.material;if(t.isMeshStandardMaterial){let a=`geometries/Geometry_`+e.id+`.usda`;if(!(a in i)){let t=Eg(e);i[a]=ug(bg()+`
`+t.toString())}t.uuid in n||(n[t.uuid]=t),c=Cg(s,e,n[t.uuid],r)}else console.warn(`THREE.USDZExporter: Unsupported material type (USDZ only supports MeshStandardMaterial)`,s)}else c=s.isCamera?Lg(s,r):Sg(s,r);c&&(t.addChild(c),xg(s,c,n,r,i,a))}}function Sg(e,t){let n=_g(e,t);e.matrix.determinant()<0&&console.warn(`THREE.USDZExporter: USDZ does not support negative scales`,e);let r=new hg(n,`Xform`);if(e.pivot!==null){let t=e.position,n=e.quaternion,i=e.scale,a=e.pivot;r.addProperty(`float3 xformOp:translate = (${t.x.toPrecision(yg)}, ${t.y.toPrecision(yg)}, ${t.z.toPrecision(yg)})`),r.addProperty(`float3 xformOp:translate:pivot = (${a.x.toPrecision(yg)}, ${a.y.toPrecision(yg)}, ${a.z.toPrecision(yg)})`),r.addProperty(`quatf xformOp:orient = (${n.w.toPrecision(yg)}, ${n.x.toPrecision(yg)}, ${n.y.toPrecision(yg)}, ${n.z.toPrecision(yg)})`),r.addProperty(`float3 xformOp:scale = (${i.x.toPrecision(yg)}, ${i.y.toPrecision(yg)}, ${i.z.toPrecision(yg)})`),r.addProperty(`uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:translate:pivot", "xformOp:orient", "xformOp:scale", "!invert!xformOp:translate:pivot"]`)}else{let t=wg(e.matrix);r.addProperty(`matrix4d xformOp:transform = ${t}`),r.addProperty(`uniform token[] xformOpOrder = ["xformOp:transform"]`)}return r}function Cg(e,t,n,r){let i=Sg(e,r);return i.addMetadata(`prepend references`,`@./geometries/Geometry_${t.id}.usda@</Geometry>`),i.addMetadata(`prepend apiSchemas`,`["MaterialBindingAPI"]`),i.addProperty(`rel material:binding = </Materials/Material_${n.id}>`),i}function wg(e){let t=e.elements;return`( ${Tg(t,0)}, ${Tg(t,4)}, ${Tg(t,8)}, ${Tg(t,12)} )`}function Tg(e,t){return`(${e[t+0]}, ${e[t+1]}, ${e[t+2]}, ${e[t+3]})`}function Eg(e){let t=new hg(`Geometry`),n=Dg(e);return t.addChild(n),t}function Dg(e){let t=e.attributes,n=t.position.count,r=new hg(`Geometry`,`Mesh`);r.addProperty(`int[] faceVertexCounts = [${Og(e)}]`),r.addProperty(`int[] faceVertexIndices = [${kg(e)}]`),r.addProperty(`normal3f[] normals = [${Ag(t.normal,n)}]`,[`interpolation = "vertex"`]),r.addProperty(`point3f[] points = [${Ag(t.position,n)}]`);for(let e=0;e<4;e++){let n=e>0?e:``,i=t[`uv`+n];i!==void 0&&r.addProperty(`texCoord2f[] primvars:st${n} = [${jg(i)}]`,[`interpolation = "vertex"`])}let i=t.color;return i!==void 0&&r.addProperty(`color3f[] primvars:displayColor = [${Ag(i,n)}]`,[`interpolation = "vertex"`]),r.addProperty(`uniform token subdivisionScheme = "none"`),r}function Og(e){let t=e.index===null?e.attributes.position.count:e.index.count;return Array(t/3).fill(3).join(`, `)}function kg(e){let t=e.index,n=[];if(t!==null)for(let e=0;e<t.count;e++)n.push(t.getX(e));else{let t=e.attributes.position.count;for(let e=0;e<t;e++)n.push(e)}return n.join(`, `)}function Ag(e,t){if(e===void 0)return console.warn(`USDZExporter: Normals missing.`),Array(t).fill(`(0, 0, 0)`).join(`, `);let n=[];for(let t=0;t<e.count;t++){let r=e.getX(t),i=e.getY(t),a=e.getZ(t);n.push(`(${r.toPrecision(yg)}, ${i.toPrecision(yg)}, ${a.toPrecision(yg)})`)}return n.join(`, `)}function jg(e){let t=[];for(let n=0;n<e.count;n++){let r=e.getX(n),i=e.getY(n);t.push(`(${r.toPrecision(yg)}, ${1-i.toPrecision(yg)})`)}return t.join(`, `)}function Mg(e,t,n=!1){let r=new hg(`Materials`);for(let i in e){let a=e[i];r.addChild(Ng(a,t,n))}return r}function Ng(e,t,n=!1){let r=new hg(`Material_${e.id}`,`Material`);function i(r,i,a){let o=r.source.id+`_`+r.flipY;t[o]=r;let s=r.channel>0?`st`+r.channel:`st`,c={1e3:`repeat`,1001:`clamp`,1002:`mirror`},l=r.repeat.clone(),u=r.offset.clone(),d=r.rotation,f=Math.sin(d),p=Math.cos(d);u.y=1-u.y-l.y,n?(u.x/=l.x,u.y/=l.y,u.x+=f/l.x,u.y+=p-1):(u.x+=f*l.x,u.y+=(1-p)*l.y);let m=new hg(`PrimvarReader_${i}`,`Shader`);m.addProperty(`uniform token info:id = "UsdPrimvarReader_float2"`),m.addProperty(`float2 inputs:fallback = (0.0, 0.0)`),m.addProperty(`string inputs:varname = "${s}"`),m.addProperty(`float2 outputs:result`);let h=new hg(`Transform2d_${i}`,`Shader`);h.addProperty(`uniform token info:id = "UsdTransform2d"`),h.addProperty(`float2 inputs:in.connect = </Materials/Material_${e.id}/PrimvarReader_${i}.outputs:result>`),h.addProperty(`float inputs:rotation = ${(180/Math.PI*d).toFixed(yg)}`),h.addProperty(`float2 inputs:scale = ${Ig(l)}`),h.addProperty(`float2 inputs:translation = ${Ig(u)}`),h.addProperty(`float2 outputs:result`);let g=new hg(`Texture_${r.id}_${i}`,`Shader`);return g.addProperty(`uniform token info:id = "UsdUVTexture"`),g.addProperty(`asset inputs:file = @textures/Texture_${o}.png@`),g.addProperty(`float2 inputs:st.connect = </Materials/Material_${e.id}/Transform2d_${i}.outputs:result>`),a!==void 0&&g.addProperty(`float4 inputs:scale = ${Fg(a)}`),i===`normal`&&(g.addProperty(`float4 inputs:scale = (2, 2, 2, 1)`),g.addProperty(`float4 inputs:bias = (-1, -1, -1, 0)`)),g.addProperty(`token inputs:sourceColorSpace = "${r.colorSpace===``?`raw`:`sRGB`}"`),g.addProperty(`token inputs:wrapS = "${c[r.wrapS]}"`),g.addProperty(`token inputs:wrapT = "${c[r.wrapT]}"`),g.addProperty(`float outputs:r`),g.addProperty(`float outputs:g`),g.addProperty(`float outputs:b`),g.addProperty(`float3 outputs:rgb`),(e.transparent||e.alphaTest>0)&&g.addProperty(`float outputs:a`),[m,h,g]}e.side===2&&console.warn(`THREE.USDZExporter: USDZ does not support double sided materials`,e);let a=new hg(`PreviewSurface`,`Shader`);if(a.addProperty(`uniform token info:id = "UsdPreviewSurface"`),e.map===null?a.addProperty(`color3f inputs:diffuseColor = ${Pg(e.color)}`):(a.addProperty(`color3f inputs:diffuseColor.connect = </Materials/Material_${e.id}/Texture_${e.map.id}_diffuse.outputs:rgb>`),e.transparent?a.addProperty(`float inputs:opacity.connect = </Materials/Material_${e.id}/Texture_${e.map.id}_diffuse.outputs:a>`):e.alphaTest>0&&(a.addProperty(`float inputs:opacity.connect = </Materials/Material_${e.id}/Texture_${e.map.id}_diffuse.outputs:a>`),a.addProperty(`float inputs:opacityThreshold = ${e.alphaTest}`)),i(e.map,`diffuse`,e.color).forEach(e=>r.addChild(e))),e.emissiveMap!==null){a.addProperty(`color3f inputs:emissiveColor.connect = </Materials/Material_${e.id}/Texture_${e.emissiveMap.id}_emissive.outputs:rgb>`);let t=new I(e.emissive.r*e.emissiveIntensity,e.emissive.g*e.emissiveIntensity,e.emissive.b*e.emissiveIntensity);i(e.emissiveMap,`emissive`,t).forEach(e=>r.addChild(e))}else e.emissive.getHex()>0&&a.addProperty(`color3f inputs:emissiveColor = ${Pg(e.emissive)}`);if(e.normalMap!==null&&(a.addProperty(`normal3f inputs:normal.connect = </Materials/Material_${e.id}/Texture_${e.normalMap.id}_normal.outputs:rgb>`),i(e.normalMap,`normal`).forEach(e=>r.addChild(e))),e.aoMap!==null){a.addProperty(`float inputs:occlusion.connect = </Materials/Material_${e.id}/Texture_${e.aoMap.id}_occlusion.outputs:r>`);let t=new I(e.aoMapIntensity,e.aoMapIntensity,e.aoMapIntensity);i(e.aoMap,`occlusion`,t).forEach(e=>r.addChild(e))}if(e.roughnessMap!==null){a.addProperty(`float inputs:roughness.connect = </Materials/Material_${e.id}/Texture_${e.roughnessMap.id}_roughness.outputs:g>`);let t=new I(e.roughness,e.roughness,e.roughness);i(e.roughnessMap,`roughness`,t).forEach(e=>r.addChild(e))}else a.addProperty(`float inputs:roughness = ${e.roughness}`);if(e.metalnessMap!==null){a.addProperty(`float inputs:metallic.connect = </Materials/Material_${e.id}/Texture_${e.metalnessMap.id}_metallic.outputs:b>`);let t=new I(e.metalness,e.metalness,e.metalness);i(e.metalnessMap,`metallic`,t).forEach(e=>r.addChild(e))}else a.addProperty(`float inputs:metallic = ${e.metalness}`);if(e.alphaMap===null?a.addProperty(`float inputs:opacity = ${e.opacity}`):(a.addProperty(`float inputs:opacity.connect = </Materials/Material_${e.id}/Texture_${e.alphaMap.id}_opacity.outputs:r>`),a.addProperty(`float inputs:opacityThreshold = 0.0001`),i(e.alphaMap,`opacity`).forEach(e=>r.addChild(e))),e.isMeshPhysicalMaterial){if(e.clearcoatMap!==null){a.addProperty(`float inputs:clearcoat.connect = </Materials/Material_${e.id}/Texture_${e.clearcoatMap.id}_clearcoat.outputs:r>`);let t=new I(e.clearcoat,e.clearcoat,e.clearcoat);i(e.clearcoatMap,`clearcoat`,t).forEach(e=>r.addChild(e))}else a.addProperty(`float inputs:clearcoat = ${e.clearcoat}`);if(e.clearcoatRoughnessMap!==null){a.addProperty(`float inputs:clearcoatRoughness.connect = </Materials/Material_${e.id}/Texture_${e.clearcoatRoughnessMap.id}_clearcoatRoughness.outputs:g>`);let t=new I(e.clearcoatRoughness,e.clearcoatRoughness,e.clearcoatRoughness);i(e.clearcoatRoughnessMap,`clearcoatRoughness`,t).forEach(e=>r.addChild(e))}else a.addProperty(`float inputs:clearcoatRoughness = ${e.clearcoatRoughness}`);a.addProperty(`float inputs:ior = ${e.ior}`)}return a.addProperty(`int inputs:useSpecularWorkflow = 0`),a.addProperty(`token outputs:surface`),r.addChild(a),r.addProperty(`token outputs:surface.connect = </Materials/Material_${e.id}/PreviewSurface.outputs:surface>`),r}function Pg(e){return`(${e.r}, ${e.g}, ${e.b})`}function Fg(e){return`(${e.r}, ${e.g}, ${e.b}, 1.0)`}function Ig(e){return`(${e.x}, ${e.y})`}function Lg(e,t){let n=_g(e,t),r=wg(e.matrix);e.matrix.determinant()<0&&console.warn(`THREE.USDZExporter: USDZ does not support negative scales`,e);let i=new hg(n,`Camera`);i.addProperty(`matrix4d xformOp:transform = ${r}`),i.addProperty(`uniform token[] xformOpOrder = ["xformOp:transform"]`);let a=e.isOrthographicCamera?`orthographic`:`perspective`;i.addProperty(`token projection = "${a}"`);let o=`(${e.near.toPrecision(yg)}, ${e.far.toPrecision(yg)})`;i.addProperty(`float2 clippingRange = ${o}`);let s;s=e.isOrthographicCamera?((Math.abs(e.left)+Math.abs(e.right))*10).toPrecision(yg):e.getFilmWidth().toPrecision(yg),i.addProperty(`float horizontalAperture = ${s}`);let c;if(c=e.isOrthographicCamera?((Math.abs(e.top)+Math.abs(e.bottom))*10).toPrecision(yg):e.getFilmHeight().toPrecision(yg),i.addProperty(`float verticalAperture = ${c}`),e.isPerspectiveCamera){let t=e.getFocalLength().toPrecision(yg);i.addProperty(`float focalLength = ${t}`);let n=e.focus.toPrecision(yg);i.addProperty(`float focusDistance = ${n}`)}return i}var Rg=e=>t=>{try{let n=Zs(t),r=(n.length?n[0].terms:[]).filter(e=>e&&e.type===`ident`).map(e=>e.value).filter(t=>e.indexOf(t)>-1);return new Set(r)}catch{}return new Set},zg=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},Bg=!1,Vg=!1,Hg=`#model-viewer-no-ar-fallback`,Ug=Rg([`quick-look`,`scene-viewer`,`webxr`,`none`]),Wg=`webxr scene-viewer quick-look`,Gg={QUICK_LOOK:`quick-look`,SCENE_VIEWER:`scene-viewer`,WEBXR:`webxr`,NONE:`none`},Kg=Symbol(`arButtonContainer`),qg=Symbol(`enterARWithWebXR`),Jg=Symbol(`openSceneViewer`),Yg=Symbol(`openIOSARQuickLook`),Xg=Symbol(`canActivateAR`),Zg=Symbol(`arMode`),Qg=Symbol(`arModes`),$g=Symbol(`arAnchor`),e_=Symbol(`preload`),t_=Symbol(`onARButtonContainerClick`),n_=Symbol(`onARStatus`),r_=Symbol(`onARTracking`),i_=Symbol(`onARTap`),a_=Symbol(`selectARMode`),o_=Symbol(`triggerLoad`),s_=e=>{var t,n,r,i,a,o,s,c,l,u;class d extends e{constructor(){super(...arguments),this.ar=!1,this.arScale=`auto`,this.arUsdzMaxTextureSize=`auto`,this.arPlacement=`floor`,this.arModes=Wg,this.iosSrc=null,this.xrEnvironment=!1,this[t]=!1,this[n]=this.shadowRoot.querySelector(`.ar-button`),this[r]=document.createElement(`a`),this[i]=new Set,this[a]=Gg.NONE,this[o]=!1,this[s]=e=>{e.preventDefault(),this.activateAR()},this[c]=({status:e})=>{(e===Pu.NOT_PRESENTING||this[$].arRenderer.presentedScene===this[Q])&&(this.setAttribute(`ar-status`,e),this.dispatchEvent(new CustomEvent(`ar-status`,{detail:{status:e}})),e===Pu.NOT_PRESENTING?this.removeAttribute(`ar-tracking`):e===Pu.SESSION_STARTED&&this.setAttribute(`ar-tracking`,Fu.TRACKING))},this[l]=({status:e})=>{this.setAttribute(`ar-tracking`,e),this.dispatchEvent(new CustomEvent(`ar-tracking`,{detail:{status:e}}))},this[u]=e=>{e.data==`_apple_ar_quicklook_button_tapped`&&this.dispatchEvent(new CustomEvent(`quick-look-button-tapped`))}}get canActivateAR(){return this[Zg]!==Gg.NONE}connectedCallback(){super.connectedCallback(),this[$].arRenderer!=null&&(this[$].arRenderer.addEventListener(`status`,this[n_]),this.setAttribute(`ar-status`,Pu.NOT_PRESENTING),this[$].arRenderer.addEventListener(`tracking`,this[r_])),this[$g].addEventListener(`message`,this[i_])}disconnectedCallback(){super.disconnectedCallback(),this[$].arRenderer!=null&&(this[$].arRenderer.removeEventListener(`status`,this[n_]),this[$].arRenderer.removeEventListener(`tracking`,this[r_])),this[$g].removeEventListener(`message`,this[i_])}update(e){super.update(e),e.has(`arScale`)&&(this[Q].canScale=this.arScale!==`fixed`),e.has(`arPlacement`)&&(this[Q].updateShadow(),this[qm]()),e.has(`arModes`)&&(this[Qg]=Ug(this.arModes)),(e.has(`ar`)||e.has(`arModes`)||e.has(`src`)||e.has(`iosSrc`)||e.has(`arUsdzMaxTextureSize`))&&this[a_]()}async activateAR(){switch(this[Zg]){case Gg.QUICK_LOOK:await this[Yg]();break;case Gg.WEBXR:await this[qg]();break;case Gg.SCENE_VIEWER:await this[Jg]();break;default:console.warn(`No AR Mode can be activated. This is probably due to missing configuration or device capabilities`)}}async[(t=Xg,n=Kg,r=$g,i=Qg,a=Zg,o=e_,s=t_,c=n_,l=r_,u=i_,a_)](){let e=Gg.NONE;if(this.ar){if(this.src!=null)for(let t of this[Qg]){if(t===`webxr`&&po&&!Bg&&await this[$].arRenderer.supportsPresentation()){e=Gg.WEBXR;break}if(t===`scene-viewer`&&!Vg&&(bo||navigator.userAgentData&&navigator.userAgentData.getHighEntropyValues&&(await navigator.userAgentData.getHighEntropyValues([`formFactor`])).formFactor?.includes(`XR`))){e=Gg.SCENE_VIEWER;break}if(t===`quick-look`&&xo&&!yo&&(!vo||this.iosSrc!=null)){e=Gg.QUICK_LOOK;break}}e===Gg.NONE&&this.iosSrc!=null&&xo&&!yo&&(e=Gg.QUICK_LOOK)}if(e!==Gg.NONE)this[Kg].classList.add(`enabled`),this[Kg].addEventListener(`click`,this[t_]);else if(this[Kg].classList.contains(`enabled`)){this[Kg].removeEventListener(`click`,this[t_]),this[Kg].classList.remove(`enabled`);let e=Pu.FAILED;this.setAttribute(`ar-status`,e),this.dispatchEvent(new CustomEvent(`ar-status`,{detail:{status:e}}))}this[Zg]=e}async[qg](){console.log(`Attempting to present in AR with WebXR...`),await this[o_]();try{this[Kg].removeEventListener(`click`,this[t_]);let{arRenderer:e}=this[$];e.placeOnWall=this.arPlacement===`wall`,await e.present(this[Q],this.xrEnvironment)}catch(e){console.warn(`Error while trying to present in AR with WebXR`),console.error(e),await this[$].arRenderer.stopPresenting(),Bg=!0,console.warn(`Falling back to next ar-mode`),await this[a_](),this.activateAR()}finally{this[a_]()}}async[o_](){this.loaded||(this[e_]=!0,this[Hm](),await Ao(this,`load`),this[e_]=!1)}[eh](){return super[eh]()||this[e_]}async[Jg](){let e=self.location.toString(),t=new URL(e),n=Array.from(this.querySelectorAll(`extra-model`)).map(e=>e.src).filter(e=>e!=null),r=this.src||n[0]||null;if(!r){console.warn(`No src or extra-model provided for Scene Viewer fallback.`);return}let i=new URL(r,e);i.hash&&=``;let a=new URLSearchParams(i.search);if(t.hash=Hg,a.set(`mode`,`ar_preferred`),a.has(`disable_occlusion`)||a.set(`disable_occlusion`,`true`),this.arScale===`fixed`&&a.set(`resizable`,`false`),this.arPlacement===`wall`&&a.set(`enable_vertical_placement`,`true`),a.has(`sound`)){let t=new URL(a.get(`sound`),e);a.set(`sound`,t.toString())}if(a.has(`link`)){let t=new URL(a.get(`link`),e);a.set(`link`,t.toString())}let o=`intent://arvr.google.com/scene-viewer/1.2?${a.toString()+`&file=`+encodeURIComponent(i.toString())}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(t.toString())};end;`;self.addEventListener(`hashchange`,()=>{self.location.hash===Hg&&(Vg=!0,self.history.back(),console.warn(`Error while trying to present in AR with Scene Viewer`),console.warn(`Falling back to next ar-mode`),this[a_]())},{once:!0}),this[$g].setAttribute(`href`,o),console.log(`Attempting to present in AR with Scene Viewer...`),this[$g].click()}async[Yg](){let e=!this.iosSrc;this[Kg].classList.remove(`enabled`);let t=e?await this.prepareUSDZ():this.iosSrc,n=new URL(t,self.location.toString());if(e){let e=self.location.toString(),t=new URL(e),r=Array.from(this.querySelectorAll(`extra-model`)).map(e=>e.src).filter(e=>e!=null),i=this.src||r[0]||null;if(i){let e=new URL(i,t);e.hash&&(n.hash=e.hash)}}this.arScale===`fixed`&&(n.hash&&(n.hash+=`&`),n.hash+=`allowsContentScaling=0`);let r=this[$g];r.setAttribute(`rel`,`ar`);let i=document.createElement(`img`);r.appendChild(i),r.setAttribute(`href`,n.toString()),e&&r.setAttribute(`download`,`model.usdz`),r.style.display=`none`,r.isConnected||this.shadowRoot.appendChild(r),console.log(`Attempting to present in AR with Quick Look...`),r.click(),r.removeChild(i),e&&URL.revokeObjectURL(t),this[Kg].classList.add(`enabled`)}async prepareUSDZ(){let e=this[Zm].beginActivity(`usdz-conversion`);await this[o_]();let{models:t,shadow:n,target:r}=this[Q];if(t.length===0||t[0]==null)return``;let i=!1;n!=null&&(i=n.visible,n.visible=!1),e(.2);let a=new gg,o=new kt;o.position.copy(r.position);for(let e of t)r.remove(e),o.add(e);o.updateWorldMatrix(!1,!0);let s=await a.parseAsync(o,{maxTextureSize:isNaN(this.arUsdzMaxTextureSize)?1/0:Math.max(parseInt(this.arUsdzMaxTextureSize),16)});for(let e of t)o.remove(e),r.add(e);let c=new Blob([s],{type:`model/vnd.usdz+zip`}),l=URL.createObjectURL(c);return e(1),n!=null&&(n.visible=i),l}}return zg([W({type:Boolean,attribute:`ar`})],d.prototype,`ar`,void 0),zg([W({type:String,attribute:`ar-scale`})],d.prototype,`arScale`,void 0),zg([W({type:String,attribute:`ar-usdz-max-texture-size`})],d.prototype,`arUsdzMaxTextureSize`,void 0),zg([W({type:String,attribute:`ar-placement`})],d.prototype,`arPlacement`,void 0),zg([W({type:String,attribute:`ar-modes`})],d.prototype,`arModes`,void 0),zg([W({type:String,attribute:`ios-src`})],d.prototype,`iosSrc`,void 0),zg([W({type:Boolean,attribute:`xr-environment`})],d.prototype,`xrEnvironment`,void 0),d},c_=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},l_=`https://www.gstatic.com/draco/versioned/decoders/1.5.6/`,u_=`https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/`,d_=`https://cdn.jsdelivr.net/npm/three@0.149.0/examples/jsm/loaders/LottieLoader.js`,f_={AUTO:`auto`,MANUAL:`manual`},p_={AUTO:`auto`,LAZY:`lazy`,EAGER:`eager`},m_=Symbol(`defaultProgressBarElement`),h_=Symbol(`posterContainerElement`),g_=Symbol(`defaultPosterElement`),__=Symbol(`shouldDismissPoster`),v_=Symbol(`hidePoster`),y_=Symbol(`modelIsRevealed`),b_=Symbol(`updateProgressBar`),x_=Symbol(`ariaLabelCallToAction`),S_=Symbol(`onProgress`),C_=e=>{var t,n,r,i,a,o,s,c;class l extends e{static set dracoDecoderLocation(e){lt.setDRACODecoderLocation(e)}static get dracoDecoderLocation(){return lt.getDRACODecoderLocation()}static set ktx2TranscoderLocation(e){lt.setKTX2TranscoderLocation(e)}static get ktx2TranscoderLocation(){return lt.getKTX2TranscoderLocation()}static set meshoptDecoderLocation(e){lt.setMeshoptDecoderLocation(e)}static get meshoptDecoderLocation(){return lt.getMeshoptDecoderLocation()}static set lottieLoaderLocation(e){Vd.singleton.textureUtils.lottieLoaderUrl=e}static get lottieLoaderLocation(){return Vd.singleton.textureUtils.lottieLoaderUrl}static mapURLs(e){Vd.singleton.loader[$e].manager.setURLModifier(e)}dismissPoster(){this.loaded?this[v_]():(this[__]=!0,this[Hm]())}showPoster(){let e=this[h_];if(e.classList.contains(`show`))return;e.classList.add(`show`),this[Gm].classList.remove(`show`);let t=this[g_];t.removeAttribute(`tabindex`),t.removeAttribute(`aria-hidden`);let n=this.modelIsVisible;this[y_]=!1,this[Im](n)}getDimensions(){return this[Q].updateBoundingBoxAndShadowIfDirty(),th(this[Q].size)}getBoundingBoxCenter(){return this[Q].updateBoundingBoxAndShadowIfDirty(),th(this[Q].boundingBox.getCenter(new S))}constructor(...e){super(...e),this.poster=null,this.reveal=f_.AUTO,this.loading=p_.AUTO,this[t]=!1,this[n]=!1,this[r]=this.shadowRoot.querySelector(`.slot.poster`),this[i]=this.shadowRoot.querySelector(`#default-poster`),this[a]=this.shadowRoot.querySelector(`#default-progress-bar > .bar`),this[o]=this[g_].getAttribute(`aria-label`),this[s]=To(e=>{let t=this[m_].parentNode;requestAnimationFrame(()=>{this[m_].style.transform=`scaleX(${e})`,e===0&&(t.removeChild(this[m_]),t.appendChild(this[m_])),this[m_].classList.toggle(`hide`,e===1)})},100),this[c]=e=>{let t=e.detail.totalProgress,n=e.detail.reason;t===1&&(this[b_].flush(),this.loaded&&(this[__]||this.reveal===f_.AUTO)&&this[v_]()),this[b_](t),this.dispatchEvent(new CustomEvent(`progress`,{detail:{totalProgress:t,reason:n}}))};let l=self.ModelViewerElement||{},u=l.dracoDecoderLocation||l_;lt.setDRACODecoderLocation(u);let d=l.ktx2TranscoderLocation||u_;lt.setKTX2TranscoderLocation(d),l.meshoptDecoderLocation&&lt.setMeshoptDecoderLocation(l.meshoptDecoderLocation);let f=l.lottieLoaderLocation||d_;Vd.singleton.textureUtils!=null&&(Vd.singleton.textureUtils.lottieLoaderUrl=f)}connectedCallback(){super.connectedCallback(),this.loaded||this.showPoster(),this[Zm].addEventListener(`progress`,this[S_])}disconnectedCallback(){super.disconnectedCallback(),this[Zm].removeEventListener(`progress`,this[S_])}async updated(e){super.updated(e),e.has(`poster`)&&this.poster!=null&&(this[g_].style.backgroundImage=`url(${this.poster})`),e.has(`alt`)&&this[g_].setAttribute(`aria-label`,this[Rm]),(e.has(`reveal`)||e.has(`loading`))&&this[Hm]()}[(t=y_,n=__,r=h_,i=g_,a=m_,o=x_,s=b_,c=S_,eh)](){let e=Array.from(this.querySelectorAll(`extra-model`));return!!(this.src||e.length>0)&&(this[__]||this.loading===p_.EAGER||this.reveal===f_.AUTO&&this[Fm])}[v_](){this[__]=!1;let e=this[h_];if(!e.classList.contains(`show`))return;e.classList.remove(`show`),this[Gm].classList.add(`show`);let t=this.modelIsVisible;this[y_]=!0,this[Im](t);let n=this.getRootNode();n&&n.activeElement===this&&this[Gm].focus();let r=this[g_];r.setAttribute(`aria-hidden`,`true`),r.tabIndex=-1,this.dispatchEvent(new CustomEvent(`poster-dismissed`))}[$m](){return super[$m]()&&this[y_]}}return c_([W({type:String})],l.prototype,`poster`,void 0),c_([W({type:String})],l.prototype,`reveal`,void 0),c_([W({type:String})],l.prototype,`loading`,void 0),l},w_=function(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a},T_=Math.PI/32,E_=3e3,D_={basis:[oc(Xs(T_,`rad`))],keywords:{auto:[null]}},O_=Symbol(`autoRotateStartTime`),k_=Symbol(`radiansPerSecond`),A_=Symbol(`syncRotationRate`),j_=Symbol(`onCameraChange`),M_=yh(Op((e=>{var t,n,r;class i extends e{constructor(){super(...arguments),this.autoRotate=!1,this.autoRotateDelay=E_,this.rotationPerSecond=`auto`,this[t]=performance.now(),this[n]=0,this[r]=e=>{this.autoRotate&&e.detail.source===`user-interaction`&&(this[O_]=performance.now())}}connectedCallback(){super.connectedCallback(),this.addEventListener(`camera-change`,this[j_]),this[O_]=performance.now()}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener(`camera-change`,this[j_]),this[O_]=performance.now()}updated(e){super.updated(e),e.has(`autoRotate`)&&(this[O_]=performance.now())}[(t=O_,n=k_,A_)](e){this[k_]=e[0]}[Jm](e,t){if(super[Jm](e,t),!this.autoRotate||!this[$m]()||this[$].isPresenting)return;let n=Math.min(t,e-this[O_]-this.autoRotateDelay);n>0&&(this[Q].yaw=this.turntableRotation+this[k_]*n*.001)}get turntableRotation(){return this[Q].yaw}resetTurntableRotation(e=0){this[Q].yaw=e}}return r=j_,w_([W({type:Boolean,attribute:`auto-rotate`})],i.prototype,`autoRotate`,void 0),w_([W({type:Number,attribute:`auto-rotate-delay`})],i.prototype,`autoRotateDelay`,void 0),w_([Kc({intrinsics:D_,updateHandler:A_}),W({type:String,attribute:`rotation-per-second`})],i.prototype,`rotationPerSecond`,void 0),i})(Bo(Zl(s_(C_(ph(rh))))))));customElements.define(`model-viewer`,M_);export{Le as CanvasTexture,m as FileLoader,gt as Loader,M_ as ModelViewerElement,Ie as NearestFilter};