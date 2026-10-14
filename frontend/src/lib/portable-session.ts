import {t} from '../i18n';
import {applyFolderChanges,planFolderChanges,readFolderHandle,writeDatabaseSnapshot,type FolderPlan,type WritableFolderHandle} from './portable-sync';
type Session={folder:WritableFolderHandle|null;watch:boolean;autoWrite:boolean;autoImport:boolean;busy:boolean;plan:FolderPlan|null;error:string;lastChecked:number};
let state:Session={folder:null,watch:false,autoWrite:false,autoImport:false,busy:false,plan:null,error:'',lastChecked:0};
let callbacks:{beforeAction:()=>Promise<boolean>;onApplied?:()=>Promise<void>|void}={beforeAction:()=>Promise.resolve(true)};
const listeners=new Set<()=>void>();let timer:ReturnType<typeof setInterval>|undefined;
function update(patch:Partial<Session>){state={...state,...patch};listeners.forEach(fn=>fn());}
export const getPortableSession=()=>state;
export const subscribePortableSession=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function setPortableCallbacks(next:typeof callbacks){callbacks=next;}
export function configurePortableSession(patch:Partial<Pick<Session,'folder'|'watch'|'autoWrite'|'autoImport'>>){
 if(state.busy)return;
 update({...patch,error:'',...(patch.folder!==undefined&&patch.folder!==state.folder?{plan:null,lastChecked:0}:{})});
 if(timer)clearInterval(timer);timer=undefined;
 if(state.folder&&(state.watch||state.autoWrite||state.autoImport))timer=setInterval(()=>{void tick();},5000);
}
export function disconnectPortableSession(){if(state.busy)return;configurePortableSession({folder:null,watch:false,autoWrite:false,autoImport:false});update({plan:null,lastChecked:0});}
/** One application-session mutex shared by the persistent watcher and UI actions. */
export async function runPortableSession<T>(action:()=>Promise<T>):Promise<T>{
 if(state.busy)throw new Error(t('폴더 작업이 진행 중입니다.'));
 update({busy:true});try{return await action();}finally{update({busy:false});}
}
async function tick(){
 if(state.busy||!state.folder)return;const folder=state.folder;
 try{await runPortableSession(async()=>{
  if(!(await callbacks.beforeAction()))throw new Error(t('작성 중인 노트를 먼저 저장해 주세요.'));
  if(folder.queryPermission&&await folder.queryPermission({mode:state.autoWrite||state.autoImport?'readwrite':'read'})!=='granted')throw new Error(t('폴더 접근 권한을 다시 확인해 주세요.'));
  const plan=await planFolderChanges(await readFolderHandle(folder));update({plan,lastChecked:Date.now(),error:''});
  if(plan.conflicts.length){update({autoImport:false,autoWrite:false,error:t('충돌한 노트는 건너뜁니다. 앱과 파일 내용을 비교한 뒤 새로 내보내 주세요.')});return;}
  if(state.autoImport&&plan.changes.length){
   const result=await applyFolderChanges(plan,new Set(plan.changes.map(c=>c.key)));
   if(result.errors.length)throw new Error(result.errors.join('\n'));
   await writeDatabaseSnapshot(folder,plan.files);update({plan:null});await callbacks.onApplied?.();
  }else if(state.autoWrite&&!plan.changes.length){await writeDatabaseSnapshot(folder);}
 });}catch(e){update({watch:false,autoWrite:false,autoImport:false,error:e instanceof Error?e.message:t('처리하지 못했습니다.')});if(timer)clearInterval(timer);timer=undefined;}
}
// Browser/app shutdown releases the only in-memory handle; no permissions are
// retained across launches. Closing the settings UI only removes its listener.
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{if(timer)clearInterval(timer);timer=undefined;});

if(typeof window!=='undefined')window.addEventListener('pageshow',()=>{configurePortableSession({});});
