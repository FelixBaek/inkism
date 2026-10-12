import type {Page} from 'playwright-core';
/** Await async predicates in Node: waitForFunction treats their Promise as truthy. */
export async function waitForAsync<Arg>(page:Page,predicate:(arg:Arg)=>unknown|Promise<unknown>,arg:Arg,options:{timeout?:number;interval?:number}={}):Promise<void>{
 const timeout=options.timeout??30000;let timer:ReturnType<typeof setTimeout>|undefined;
 const timeoutError=new Error(`Async browser condition remained false after ${timeout} ms`);
 const expired=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(timeoutError),timeout);});
 try{for(;;){const result=await Promise.race([page.evaluate(predicate,arg),expired]);if(result)return;await Promise.race([new Promise(resolve=>setTimeout(resolve,options.interval??50)),expired]);}}
 finally{clearTimeout(timer);}
}
