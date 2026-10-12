export const WAVEFORM_MAX_BYTES=25*1024*1024;
export const WAVEFORM_MAX_SECONDS=300;
export const waveformDurationAllowed=(seconds:number)=>Number.isFinite(seconds)&&seconds>0&&seconds<=WAVEFORM_MAX_SECONDS;
/** Optional waveform analysis must never trust Content-Length as its only limit. */
export async function readWaveformBytes(response:Response,signal:AbortSignal,maxBytes=WAVEFORM_MAX_BYTES):Promise<ArrayBuffer|null>{
 if(!response.ok||signal.aborted||Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel().catch(()=>{});return null;}
 const reader=response.body?.getReader();if(!reader)return null;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){if(signal.aborted)return null;const item=await reader.read();if(signal.aborted)return null;if(item.done)break;size+=item.value.byteLength;if(size>maxBytes)return null;chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
 }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
