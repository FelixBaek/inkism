import type {Page} from 'playwright-core';
// The status bar's save indicator mirrors the store's SaveState in
// data-save-state (idle|dirty|saving|saved|error|conflict). Its visible copy is
// a localized date/time, so tests wait on the attribute, never on the text.
type Settled={state:string;text:string};
const read=(page:Page)=>page.evaluate(()=>{const el=document.querySelector('.status-save');return {state:el?.getAttribute('data-save-state')??'missing',text:el?.textContent??''};});
/** Wait for the indicator to settle in `want`. An error/conflict that stays put
 * for `grace` ms (not a stale one about to be replaced by a retry) is a real
 * save failure and fails fast with its visible reason instead of timing out. */
export async function waitSaveState(page:Page,want:'saved'|'error'|'conflict'='saved',options:{timeout?:number;grace?:number}={}):Promise<Settled>{
 const timeout=options.timeout??30000,grace=options.grace??2000;
 await page.evaluate(()=>{(window as any).__inkismSaveFailedSince=undefined;});
 let settled:Settled;
 try{
  settled=await (await page.waitForFunction(({want,grace})=>{
   const el=document.querySelector('.status-save'),state=el?.getAttribute('data-save-state'),w=window as any;
   if(state===want)return {state,text:el?.textContent??''};
   if(state==='error'||state==='conflict'){
    w.__inkismSaveFailedSince??=performance.now();
    if(performance.now()-w.__inkismSaveFailedSince>=grace)return {state,text:el?.textContent??''};
   }else w.__inkismSaveFailedSince=undefined;
   return null;
  },{want,grace},{timeout})).jsonValue() as Settled;
 }catch(error){
  const now=await read(page).catch(()=>({state:'unreadable',text:''}));
  throw new Error(`save indicator never reached "${want}" within ${timeout} ms; still data-save-state=${now.state} (${now.text})`,{cause:error});
 }
 if(settled.state!==want)throw new Error(`save failed instead of reaching "${want}": data-save-state=${settled.state} (${settled.text})`);
 return settled;
}
export const waitSaved=(page:Page,options:{timeout?:number;grace?:number}={})=>waitSaveState(page,'saved',options);
/** Body-saving RPC ops; a settled "saved" indicator only counts after one of these finished. */
const SAVE_OPS=new Set(['save','document_splice','document_splice_html','document_splice_source','vault_save']);
/** saved() resolves only after a body-save RPC finished since the previous saved()
 * (or since tracking began) and the indicator then settles in "saved". A "saved"
 * left over from an earlier save cannot satisfy it, so a save that never starts
 * times out naming that cause rather than racing ahead to stale storage. */
export function trackSaves(page:Page){
 let finished=0,consumed=0;
 const done=(request:any)=>{if(!request.url().endsWith('/api/rpc')){return;}try{if(SAVE_OPS.has(request.postDataJSON()?.op))finished++;}catch{}};
 page.on('requestfinished',done);page.on('requestfailed',done);
 return {
  get count(){return finished;},
  async saved(options:{timeout?:number;grace?:number}={}){
   const timeout=options.timeout??30000;
   for(const deadline=Date.now()+timeout;finished===consumed;await new Promise(resolve=>setTimeout(resolve,25)))
    if(Date.now()>deadline){const now=await read(page).catch(()=>({state:'unreadable',text:''}));throw new Error(`no save RPC finished within ${timeout} ms; data-save-state=${now.state} (${now.text})`);}
   consumed=finished;return waitSaved(page,options);
  },
  /** Nothing new to store: the indicator settles in "saved" and no body-save RPC finished since the last check. */
  async unchanged(options:{timeout?:number;grace?:number}={}){
   const settled=await waitSaved(page,options);
   if(finished!==consumed)throw new Error(`expected no new save, but ${finished-consumed} body-save RPC(s) finished`);
   return settled;
  },
  /** Input that may already have been flushed by an earlier save: only a settled
   * "saved" indicator is required; callers must verify the stored body. */
  async settled(options:{timeout?:number;grace?:number}={}){
   const settled=await waitSaved(page,options);consumed=finished;return settled;
  },
 };
}
