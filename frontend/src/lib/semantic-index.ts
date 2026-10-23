import {t} from '../i18n';
import {api,RpcError,type SemanticHit,type SemanticStatus} from '../api';
import {aiConfig,aiConfigVersion,onAIConfigChange,embedTexts,embeddingsReady,embeddingsUrl,type AiConfig} from './ai-provider';
/** Background semantic indexing: the engine picks eligible notes (never locked or trashed) and chunks them; this only embeds and stores. */
export type SemanticIndexState=SemanticStatus&{running:boolean;error:string};
let state:SemanticIndexState={running:false,indexed:0,pending:0,error:''};
const listeners=new Set<(s:SemanticIndexState)=>void>();
let active:AbortController|null=null,retryAt=0;
let running:Promise<void>|null=null;
let rebuilding:Promise<void>|null=null;
let dimensionsCache:{version:number;dimensions:number}|null=null;
const KICK='inkism-semantic-kick',RETRY_MS=5*60_000,POLL_MS=30_000,MAX_ROUNDS=2500;

function update(next:Partial<SemanticIndexState>){state={...state,...next};for(const f of listeners)f(state);}
export function onSemanticIndex(f:(s:SemanticIndexState)=>void){listeners.add(f);f(state);return()=>{listeners.delete(f);};}
export const kickSemanticIndex=()=>window.dispatchEvent(new Event(KICK));
export function stopSemanticIndex(){active?.abort();return running??Promise.resolve();}

/** Opaque engine namespace: old model-only indexes are deliberately not reused. */
export async function semanticSpace(config:AiConfig,dimensions:number):Promise<string>{
 if(!Number.isInteger(dimensions)||dimensions<1||dimensions>4096)throw new Error('Invalid embedding dimensions');
 const bytes=new TextEncoder().encode(JSON.stringify([embeddingsUrl(config.endpoint),config.embedModel!.trim(),dimensions]));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return 'semantic-v1:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function assertCurrent(signal:AbortSignal|undefined,version:number){
 signal?.throwIfAborted();
 if(version!==aiConfigVersion())throw new DOMException('AI settings changed','AbortError');
}

/** One small batch, one page of chunks per note; returns how many notes it handled. A note edited meanwhile is simply offered again from its first page. */
async function indexBatch(model:string,dimensions:number,config:AiConfig,version:number,signal:AbortSignal):Promise<number>{
 assertCurrent(signal,version);
 const {items}=await api.semanticPending(model,4);
 assertCurrent(signal,version);
 for(const note of items){
  assertCurrent(signal,version);
  const vectors=note.chunks.length?await embedTexts(note.chunks.map(c=>c.text),signal,config):[]; // NOSONAR: one note at a time keeps cancelling prompt
  assertCurrent(signal,version);
  if(vectors.some(vector=>vector.length!==dimensions)){dimensionsCache=null;throw new Error(t('임베딩 차원이 바뀌었습니다. 의미 색인을 다시 만들어 주세요.'));}
  try{await api.semanticPut(note.id,note.revision,model,note.offset,vectors);} // NOSONAR: stored right after its own embedding
  catch(e){if(!(e instanceof RpcError&&(e.isConflict||e.code==='not_found')))throw e;}
  assertCurrent(signal,version);
 }
 return items.length;
}

export function runSemanticIndex(force=false):Promise<void>{
 return rebuilding??beginIndex(force);
}

function beginIndex(force:boolean):Promise<void>{
 if(active||!embeddingsReady()||(!force&&Date.now()<retryAt))return running??Promise.resolve();
 const controller=new AbortController(),config={...aiConfig()},version=aiConfigVersion();
 active=controller;
 update({running:true,indexed:0,pending:0,error:''});
 running=index(config,version,controller);
 return running;
}

async function index(config:AiConfig,version:number,controller:AbortController){
 try{
  // A harmless fixed probe also detects changed dimensions behind the same model name.
  if(dimensionsCache?.version!==version){
   const [probe]=await embedTexts(['Inkism semantic index'],controller.signal,config);
   assertCurrent(controller.signal,version);
   dimensionsCache={version,dimensions:probe.length};
  }
  const dimensions=dimensionsCache.dimensions,model=await semanticSpace(config,dimensions);
  assertCurrent(controller.signal,version);
  const status=async()=>{const value=await api.semanticStatus(model);assertCurrent(controller.signal,version);update(value);};
  for(let round=0;round<MAX_ROUNDS&&embeddingsReady()&&await indexBatch(model,dimensions,config,version,controller.signal)>0;round++)await status(); // NOSONAR: batches run in order
  assertCurrent(controller.signal,version);
  await status();
  retryAt=0;
 }catch(e){
  if(!controller.signal.aborted&&version===aiConfigVersion()){retryAt=Date.now()+RETRY_MS;update({error:e instanceof Error?e.message:String(e)});}
 }finally{
  if(active===controller){active=null;running=null;}
  update({running:false});
 }
}

/** Runs on start, on kicks (settings saved, rebuild) and on a slow poll that picks up saves. */
export function startSemanticIndexer(){
 let alive=true;
 const poll=()=>void runSemanticIndex(),kick=()=>void runSemanticIndex(true);
 const unsubscribe=onAIConfigChange(()=>{void stopSemanticIndex().then(()=>{if(!alive)return;retryAt=0;update({indexed:0,pending:0,error:''});return runSemanticIndex(true);});});
 window.addEventListener(KICK,kick);
 const timer=setInterval(poll,POLL_MS);
 poll();
 return()=>{alive=false;unsubscribe();clearInterval(timer);window.removeEventListener(KICK,kick);stopSemanticIndex();};
}

export function rebuildSemanticIndex():Promise<void>{
 if(rebuilding)return rebuilding;
 rebuilding=(async()=>{await stopSemanticIndex();dimensionsCache=null;await api.semanticReset();await beginIndex(true);})().finally(()=>{rebuilding=null;});
 return rebuilding;
}

/** Semantic matches for a question; empty when not configured or on any failure so answering falls back to keywords. */
export async function semanticHits(question:string,signal?:AbortSignal,limit=20):Promise<SemanticHit[]>{
 if(!embeddingsReady())return [];
 try{
  const config={...aiConfig()},version=aiConfigVersion();
  const [vector]=await embedTexts([question],signal,config);
  assertCurrent(signal,version);
  if(dimensionsCache?.version===version&&dimensionsCache.dimensions!==vector.length){
   dimensionsCache={version,dimensions:vector.length};
   void stopSemanticIndex().then(()=>runSemanticIndex(true));
  }
  const model=await semanticSpace(config,vector.length);
  assertCurrent(signal,version);
  const result=await api.semanticSearch(model,vector,limit,signal);
  assertCurrent(signal,version);
  return result.items;
 }catch{return [];}
}
