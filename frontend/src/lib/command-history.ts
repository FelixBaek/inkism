import {readPref,writePref} from './pref';
export const COMMAND_HISTORY_CHANGED='inkism-command-history-changed';
const KEY='inkism.command-history.v1';
export type CommandHistory={favorites:string[];usage:Record<string,{count:number;at:number}>};
export function parseCommandHistory(raw:string|null):CommandHistory {
 const result:CommandHistory={favorites:[],usage:Object.create(null)};
 try{const value=JSON.parse(raw||'{}');if(!value||typeof value!=='object')return result;
  if(Array.isArray(value.favorites))result.favorites=[...new Set(value.favorites.filter((id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=512))].slice(0,64) as string[];
  if(value.usage&&typeof value.usage==='object')for(const [id,entry] of Object.entries(value.usage).slice(0,128)){
   const item=entry as {count:number;at:number};if(id.length<=512&&item&&Number.isSafeInteger(item.count)&&item.count>0&&Number.isFinite(item.at)&&item.at>=0)result.usage[id]={count:Math.min(item.count,1000000),at:item.at};
  }
 }catch{/* Corrupt preferences must not prevent commands from running. */}return result;
}
let volatile:CommandHistory|undefined;
export function commandHistory(){return volatile??parseCommandHistory(readPref(KEY));}
function save(value:CommandHistory){volatile=value;writePref(KEY,JSON.stringify(value));window.dispatchEvent(new Event(COMMAND_HISTORY_CHANGED));}
export function recordCommand(id:string){if(!id||id.length>512||id==='app.commands')return;const current=commandHistory();const usage={...current.usage,[id]:{count:Math.min((current.usage[id]?.count??0)+1,1000000),at:Date.now()}};
 save({...current,usage:Object.fromEntries(Object.entries(usage).sort((a,b)=>b[1].at-a[1].at).slice(0,128))});}
export function toggleCommandFavorite(id:string){const current=commandHistory();if(!id||id.length>512)return;save({...current,favorites:current.favorites.includes(id)?current.favorites.filter(x=>x!==id):[id,...current.favorites].slice(0,64)});}
export function clearCommandHistory(){save({...commandHistory(),usage:Object.create(null)});}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){volatile=undefined;window.dispatchEvent(new Event(COMMAND_HISTORY_CHANGED));}});
