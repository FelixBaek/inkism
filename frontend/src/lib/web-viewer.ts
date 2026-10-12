/** Reject app origins and literal local addresses; this is not a DNS public-IP check. */
export function webViewerUrl(value:string):string {
 const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!host.includes('.')||host.endsWith('.localhost')||host.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.startsWith('['))throw new Error('공개 웹사이트 주소를 입력해 주세요.');
 return url.href;
}
type ViewerWindow=Window&{__inkismNativeWebViewer?:boolean;__TAURI__?:{core:{invoke:(command:string,args:object)=>Promise<string>}}};
export function nativeWebViewer(){return !!(window as ViewerWindow).__inkismNativeWebViewer;}
export async function controlWebViewer(action:string,url?:string){
 const host=window as ViewerWindow;if(!host.__inkismNativeWebViewer||!host.__TAURI__?.core?.invoke)throw new Error('이 환경에서는 별도 웹 창을 사용할 수 없습니다.');
 return host.__TAURI__.core.invoke('web_viewer',{action,url:url??null});
}
/** Outer CSP pins the inner frame to its public origin, including redirects. */
export function webViewerFrame(value:string):string {
 const url=webViewerUrl(value),origin=new URL(url).origin;
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src ${escape(origin)}; base-uri 'none'; form-action 'none'"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}iframe{display:block}</style><iframe title="Website" sandbox="" referrerpolicy="no-referrer" src="${escape(url)}"></iframe>`;
}
