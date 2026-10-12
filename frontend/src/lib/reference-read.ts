/** Preview panes share four body-reader slots; cancelled queued panes never start I/O. */
let active=0;const queue:(()=>void)[]=[];
export function referenceRead<T>(read:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const run=()=>{if(signal.aborted){reject(new DOMException('Aborted','AbortError'));pump();return;}active++;read().then(resolve,reject).finally(()=>{active--;pump();});};queue.push(run);pump();});
}
function pump(){while(active<4&&queue.length)queue.shift()!();}
