import {api,RpcError,type SemanticHit,type SemanticStatus} from '../api';
import {aiConfig,embedTexts,embeddingsReady} from './ai-provider';
/** Background semantic indexing: the engine picks eligible notes (never locked or trashed) and chunks them; this only embeds and stores. */
export type SemanticIndexState=SemanticStatus&{running:boolean;error:string};
let state:SemanticIndexState={running:false,indexed:0,pending:0,error:''};
const listeners=new Set<(s:SemanticIndexState)=>void>();
let active:AbortController|null=null,retryAt=0;
const KICK='inkism-semantic-kick',RETRY_MS=5*60_000,POLL_MS=30_000,MAX_ROUNDS=2500;

function update(next:Partial<SemanticIndexState>){state={...state,...next};for(const f of listeners)f(state);}
export function onSemanticIndex(f:(s:SemanticIndexState)=>void){listeners.add(f);f(state);return()=>{listeners.delete(f);};}
export const kickSemanticIndex=()=>window.dispatchEvent(new Event(KICK));
export function stopSemanticIndex(){active?.abort();active=null;}

/** One small batch; returns how many notes it handled. A note edited meanwhile is simply offered again. */
async function indexBatch(model:string,signal:AbortSignal):Promise<number>{
 const {items}=await api.semanticPending(model,4);
 for(const note of items){
  if(signal.aborted)return 0;
  const vectors=note.chunks.length?await embedTexts(note.chunks.map(c=>c.text),signal):[]; // NOSONAR: one note at a time keeps cancelling prompt
  try{await api.semanticPut(note.id,note.revision,model,vectors);}
  catch(e){if(!(e instanceof RpcError&&(e.isConflict||e.code==='not_found')))throw e;}
 }
 return items.length;
}

export async function runSemanticIndex(force=false):Promise<void>{
 if(active||!embeddingsReady()||(!force&&Date.now()<retryAt))return;
 const controller=new AbortController(),model=aiConfig().embedModel!.trim();
 active=controller;
 update({running:true,error:''});
 try{
  for(let round=0;round<MAX_ROUNDS&&embeddingsReady()&&await indexBatch(model,controller.signal)>0;round++)update(await api.semanticStatus(model)); // NOSONAR: batches run in order
  update(await api.semanticStatus(model));
  retryAt=0;
 }catch(e){
  if(!controller.signal.aborted){retryAt=Date.now()+RETRY_MS;update({error:e instanceof Error?e.message:String(e)});}
 }finally{
  if(active===controller)active=null;
  update({running:false});
 }
}

/** Runs on start, on kicks (settings saved, rebuild) and on a slow poll that picks up saves. */
export function startSemanticIndexer(){
 const poll=()=>void runSemanticIndex(),kick=()=>void runSemanticIndex(true);
 window.addEventListener(KICK,kick);
 const timer=setInterval(poll,POLL_MS);
 poll();
 return()=>{clearInterval(timer);window.removeEventListener(KICK,kick);stopSemanticIndex();};
}

export async function rebuildSemanticIndex(){stopSemanticIndex();await api.semanticReset();await runSemanticIndex(true);}

/** Semantic matches for a question; empty when not configured or on any failure so answering falls back to keywords. */
export async function semanticHits(question:string,signal?:AbortSignal,limit=20):Promise<SemanticHit[]>{
 if(!embeddingsReady())return [];
 try{
  const [vector]=await embedTexts([question],signal);
  return (await api.semanticSearch(aiConfig().embedModel!.trim(),vector,limit,signal)).items;
 }catch{return [];}
}
