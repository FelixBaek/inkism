import {setTimeout as pause} from 'node:timers/promises';

/** Poll the resolved boolean. Browser waitForFunction treats an async
 * callback's Promise as truthy before the RPC result arrives. */
export async function waitForPredicate(predicate,message,timeout=30000) {
 const deadline=Date.now()+timeout;
 do {
  if(await predicate())return;
  await pause(100);
 }while(Date.now()<deadline);
 throw new Error(message);
}
