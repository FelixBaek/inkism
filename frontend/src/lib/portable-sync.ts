import { t } from '../i18n';
import { api, rpc } from '../api';
import type { Note, ContentFormat } from '../types';
import { sha256, stripFrontmatter, restorePortableLinks, validatePortableManifest, type PortableManifest, type PortableEntry } from './portable-library';
export type FolderChange = { key:string; kind:'create'|'update'|'rename'|'delete'; path:string; previousPath?:string; title:string; tags?:string[]; notebook_id?:string|null; entry?:PortableEntry; current?:Note; content:string; assets:string[]; details:string[] };
export type FolderPlan = { manifest:PortableManifest; changes:FolderChange[]; conflicts:string[]; unchanged:number; ignored:number; assets:Map<string,File>; files:Map<string,File> };
const LIMIT=64*1024*1024;
const hashText=(text:string)=>sha256(new TextEncoder().encode(text));
const decode=async(file:File)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
const extension=(path:string):ContentFormat|undefined=>({md:'markdown',html:'html',txt:'text'} as const)[path.split('.').pop() as 'md'];
const safePath=(path:string)=>!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(x=>!x||x==='.'||x==='..')&&!/[\u0000-\u001f]/.test(path);
const rx=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,String.raw`\$&`);
export { stripFrontmatter };
const fileFormat=(entry:PortableEntry)=>entry.file_format??entry.format;
const fromMarkdown=async(markdown:string,format:ContentFormat)=>{
 if(format==='markdown')return markdown;
 const html=(await import('./markdown')).markdownToHTML(markdown);
 return format==='text'?html.text:html.content;
};
const refs=(source:string,path:string)=>new RegExp(String.raw`(^|[="'\s(<])\.\./${rx(path)}(?=[?"'\s<>\)\]#]|$)`,'gm');
export async function collectFolderFiles(files:File[]):Promise<Map<string,File>> {
 if(files.length>4096||files.reduce((n,f)=>n+f.size,0)>LIMIT)throw new Error(t('외부 편집 폴더는 64 MiB 이하만 지원합니다.'));
 const result=new Map<string,File>();for(const f of files){const p=f.webkitRelativePath?f.webkitRelativePath.slice(f.webkitRelativePath.indexOf('/')+1):f.name;if(!safePath(p)||result.has(p))throw new Error(t('중복되거나 안전하지 않은 파일 경로입니다.'));result.set(p,f);}return result;
}
export async function planFolderChanges(files:File[],get:typeof api.get=api.get):Promise<FolderPlan> {
 const byPath=await collectFolderFiles(files), descriptor=byPath.get('.inkism-portable.json');
 if(!descriptor||descriptor.size>8*1024*1024)throw new Error(t('ZIP을 푼 폴더 전체를 선택해 주세요. .inkism-portable.json이 필요합니다.'));
 const manifest=validatePortableManifest(JSON.parse(await descriptor.text()));
 const plan:FolderPlan={manifest,changes:[],conflicts:[],unchanged:0,ignored:0,assets:new Map(),files:byPath};
 const changedAssets=new Set<string>();
 for(const [path,file] of byPath)if(path.startsWith('attachments/')){if(path.split('/').length!==2)throw new Error(t('첨부파일은 attachments 폴더 바로 아래에 두세요.'));plan.assets.set(path,file);const base=manifest.attachments.find(a=>a.path===path);if(file.size!==base?.size||await sha256(new Uint8Array(await file.arrayBuffer()))!==base.sha256)changedAssets.add(path);}
 if(plan.assets.size>512)throw new Error(t('첨부파일은 512개까지 지원합니다.'));
 const candidates=new Map<string,{file:File;hash:string}>();
 for(const [path,file] of byPath)if(path.startsWith('notes/')&&path.split('/').length===2&&extension(path)&&!manifest.notes.some(e=>e.path===path))candidates.set(path,{file,hash:await sha256(new Uint8Array(await file.arrayBuffer()))});
 if(candidates.size+manifest.notes.length>2048)throw new Error(t('문서는 2,048개까지 지원합니다.'));
 const used=new Set<string>();
 for(const entry of manifest.notes){
  let path=entry.path,file=byPath.get(path),kind:FolderChange['kind']='update';
  const details:string[]=[];
  if(!file){const matches=[...candidates].filter(([p,f])=>!used.has(p)&&extension(p)===fileFormat(entry)&&f.hash===entry.portable_sha256);if(matches.length===1&&manifest.notes.filter(n=>!byPath.has(n.path)&&fileFormat(n)===fileFormat(entry)&&n.portable_sha256===entry.portable_sha256).length>1){plan.conflicts.push(`${entry.path}: ${t('같은 내용의 원본이 여러 개여서 이름 변경을 판단할 수 없습니다.')}`);continue;}if(matches.length===1){[path,{file}]=matches[0];used.add(path);kind='rename';details.push(t('파일 이름 변경'));}else if(matches.length>1){plan.conflicts.push(`${entry.path}: ${t('같은 내용의 새 파일이 여러 개여서 이름 변경을 판단할 수 없습니다.')}`);continue;}else kind='delete';}
  try{
   const portable=file?await decode(file):'',metadata=entry.metadata as {title?:string;tags?:string[];notebook_id?:string|null},baseline=(entry as PortableEntry&{baseline_metadata?:typeof metadata}).baseline_metadata;
   const metadataChanged=baseline!==undefined&&JSON.stringify([metadata.title,metadata.tags??[],metadata.notebook_id??null])!==JSON.stringify([baseline.title,baseline.tags??[],baseline.notebook_id??null]);
   const assets=[...changedAssets].filter(p=>refs(portable,p).test(portable));
   const missing=manifest.attachments.filter(a=>refs(portable,a.path).test(portable)&&!plan.assets.has(a.path));if(missing.length)throw new Error(t('참조하는 첨부파일이 없습니다.'));
   const bodyChanged=file&&await hashText(portable)!==entry.portable_sha256;
   if(kind==='update'&&!bodyChanged&&!metadataChanged&&!assets.length){plan.unchanged++;continue;}
   const current=await get(entry.id);
   if(current.revision!==entry.revision||(current.content_format||'html')!==entry.format||current.readonly||current.trashed||(current as Note&{locked?:boolean}).locked||await hashText(current.content)!==entry.source_sha256)throw new Error(t('앱의 노트가 변경되었거나 편집할 수 없습니다.'));
   if(restorePortableLinks(current.content,manifest)!==current.content)throw new Error(t('원문에 내보낸 파일과 같은 상대 경로가 있어 자동으로 반영할 수 없습니다.'));
   if(metadataChanged){if(typeof metadata.title!=='string'||!Array.isArray(metadata.tags)||metadata.tags.some(t=>typeof t!=='string')||!(metadata.notebook_id===null||typeof metadata.notebook_id==='string'))throw new Error(t('제목·태그·폴더 메타데이터가 올바르지 않습니다.'));details.push(t('제목·태그·폴더'));}
   if(bodyChanged)details.push(t('본문'));if(assets.length)details.push(t('첨부파일 새 사본'));
   const keptTitle=metadataChanged?metadata.title!:current.title;
   plan.changes.push({key:entry.id,kind,path,previousPath:kind==='rename'?entry.path:undefined,title:kind==='rename'?path.slice(6).replace(/\.[^.]+$/,''):keptTitle,tags:metadataChanged?metadata.tags:current.tags,notebook_id:metadataChanged?metadata.notebook_id:current.notebook_id,entry,current,content:path.endsWith('.md')?stripFrontmatter(portable):portable,assets,details});
  }catch(e){plan.conflicts.push(`${path}: ${e instanceof Error?e.message:'확인 실패'}`);}
 }
 for(const [path,{file}] of candidates){if(used.has(path))continue;try{const content=await decode(file);for(const match of content.matchAll(/\.\.\/attachments\/[^\s"'<>)\]?#]+/g)){if(!plan.assets.has(match[0].slice(3)))throw new Error(t('참조하는 첨부파일이 없습니다.'));}const assets=[...plan.assets.keys()].filter(p=>refs(content,p).test(content)&&changedAssets.has(p));plan.changes.push({key:'portable-'+(await hashText(JSON.stringify(manifest.notes.map(n=>[n.id,n.source_sha256]).sort((a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0))+'\n'+path)).slice(0,48),kind:'create',path,title:path.slice(6).replace(/\.[^.]+$/,''),content,assets,details:[t('새 노트')]});}catch(e){plan.conflicts.push(`${path}: ${e instanceof Error?e.message:'확인 실패'}`);}}
 plan.ignored=[...changedAssets].filter(path=>!plan.changes.some(c=>c.assets.includes(path))).length+[...byPath.keys()].filter(p=>!['.inkism-portable.json','README.txt','INDEX.md'].includes(p)&&!p.startsWith('attachments/')&&!manifest.notes.some(e=>e.path===p)&&!candidates.has(p)).length;
 return plan;
}
export type FolderApplyResult={saved:number;errors:string[];applied:Map<string,Note|{id:string;revision:number}>};
type FolderDeps={save:typeof api.save;patch:(id:string,revision:number,sourceHash:string)=>Promise<{id:string;revision:number}>;upload:typeof api.uploadAttachment;fromMarkdown?:typeof fromMarkdown};
const folderDeps:FolderDeps={save:api.save,patch:(id:string,revision:number,sourceHash:string)=>rpc<{id:string;revision:number}>('patch',{id,revision,changes:{trashed:true},require_editable:true,expected_source_sha256:sourceHash}),upload:api.uploadAttachment};
const noteReference=(path:string)=>new RegExp(String.raw`(^|[="'\s(<[])(?:\./)?${rx(path.slice(6))}(?=[#?|"'\s<>)\]]|$)`,'m');
/** Dependency order: a change comes after the new notes it links to; cycles fail. */
function orderChanges(plan:FolderPlan,selectedChanges:FolderChange[]){
 const dependencies=new Map(selectedChanges.map(c=>[c.key,plan.changes.filter(other=>other.kind==='create'&&other.key!==c.key&&noteReference(other.path).test(c.content)).map(other=>other.key)]));
 const ordered:FolderChange[]=[],visited=new Set<string>(),visiting=new Set<string>(),failed=new Set<string>();
 const visit=(c:FolderChange):boolean=>{if(visiting.has(c.key)){failed.add(c.key);return false;}if(visited.has(c.key))return !failed.has(c.key);visiting.add(c.key);for(const key of dependencies.get(c.key)??[]){const target=selectedChanges.find(x=>x.key===key);if(!target||!visit(target))failed.add(c.key);}visiting.delete(c.key);visited.add(c.key);ordered.push(c);return !failed.has(c.key);};
 selectedChanges.forEach(visit);
 return {dependencies,ordered,failed};
}
type ApplyContext={plan:FolderPlan;selected:Set<string>;deps:FolderDeps;uploaded:Map<string,string>;links:PortableManifest};
/** Writes one change; attachments upload once and are shared between notes. */
async function applyChange(c:FolderChange,{plan,selected,deps,uploaded,links}:ApplyContext){
 if(c.kind==='delete')return deps.patch(c.key,c.current!.revision,c.entry!.source_sha256);
 let content=c.content;
 for(const match of content.matchAll(/\.\.\/attachments\/[^\s"'<>)\]?#]+/g)){if(!plan.assets.has(match[0].slice(3)))throw new Error(t('참조하는 첨부파일이 없습니다.'));}
 if(plan.changes.some(x=>x.kind==='create'&&!selected.has(x.key)&&noteReference(x.path).test(content)))throw new Error(t('참조하는 새 노트도 함께 선택해 주세요.'));
 for(const path of c.assets){
  let id=uploaded.get(path);
  if(!id){const file=plan.assets.get(path);if(!file)throw new Error(t('첨부파일이 없습니다.'));id=(await deps.upload(file,new AbortController().signal)).id;uploaded.set(path,id);} // NOSONAR: each upload is reused by later notes
  content=content.replace(refs(content,path),(_all,prefix)=>`${prefix}/api/attachments/${id}`);
 }
 content=restorePortableLinks(content,links);
 // HTML/text notes exported as Markdown are converted back to their own format.
 if(c.entry&&fileFormat(c.entry)!==c.entry.format)content=await (deps.fromMarkdown??fromMarkdown)(content,c.entry.format);
 return deps.save({id:c.key,title:c.title,content,content_format:c.entry?.format??extension(c.path)!,tags:c.tags??[],notebook_id:c.notebook_id??null,...(c.current?{revision:c.current.revision,require_existing:true,expected_source_sha256:c.entry!.source_sha256}:{require_absent:true})});
}
/** Immutable attachment copies and guarded individual writes: no destructive file writes. */
export async function applyFolderChanges(plan:FolderPlan,selected:Set<string>,deps:FolderDeps=folderDeps):Promise<FolderApplyResult>{
 const result:FolderApplyResult={saved:0,errors:[],applied:new Map()};
 const selectedChanges=plan.changes.filter(c=>selected.has(c.key));
 const {dependencies,ordered,failed}=orderChanges(plan,selectedChanges);
 // Include renamed and newly created targets so links keep note IDs.
 const links={...plan.manifest,notes:[...plan.manifest.notes,...plan.changes.filter(c=>c.kind==='rename').map(c=>({...c.entry!,path:c.path})),...selectedChanges.filter(c=>c.kind==='create').map(c=>({id:c.key,path:c.path,format:extension(c.path)!,revision:1,source_sha256:'',portable_sha256:'',metadata:{title:c.title}}))]};
 const context:ApplyContext={plan,selected,deps,uploaded:new Map(),links};
 for(const c of ordered){
  try{
   if(failed.has(c.key)||(dependencies.get(c.key)??[]).some(key=>failed.has(key)))throw new Error(t('참조하는 새 노트 반영에 실패했습니다. 순환 링크는 파일에서 잠시 제거하고 노트를 반영한 뒤 다시 추가해 주세요.'));
   result.applied.set(c.key,await applyChange(c,context)); // NOSONAR: dependency order requires one write at a time
   result.saved++;
  }catch(e){failed.add(c.key);result.errors.push(`${c.title||c.path}: ${e instanceof Error?e.message:'저장 실패'}`);}
 }
 return result;
}
/** Directory handles stay only in memory. Reconnect after closing settings/restarting. */
export interface FolderHandle {name:string;values:()=>AsyncIterable<FolderHandle|FileHandle>;kind:'directory';queryPermission?:(options:{mode:'read'})=>Promise<string>}
interface FileHandle {name:string;kind:'file';getFile:()=>Promise<File>}
export async function readFolderHandle(root:FolderHandle):Promise<File[]>{const files:File[]=[];let bytes=0;async function visit(dir:FolderHandle,prefix:string,depth:number){if(depth>3)throw new Error(t('외부 편집 폴더 구조가 너무 깊습니다.'));for await(const item of dir.values()){if(!prefix&&item.name==='.inkism-write-journal.json')continue;const path=prefix+item.name;if(item.kind==='directory'){await visit(item,path+'/',depth+1);}else{const file=await item.getFile();bytes+=file.size;if(files.length>=4096||bytes>LIMIT)throw new Error(t('외부 편집 폴더는 64 MiB 이하만 지원합니다.'));Object.defineProperty(file,'webkitRelativePath',{value:root.name+'/'+path});files.push(file);}}}await visit(root,'',0);return files;}

export interface WritableFolderHandle extends FolderHandle {
 getDirectoryHandle:(name:string,options?:{create?:boolean})=>Promise<WritableFolderHandle>;
 removeEntry:(name:string)=>Promise<void>;
 getFileHandle:(name:string,options?:{create?:boolean})=>Promise<{getFile:()=>Promise<File>;createWritable:()=>Promise<{write:(data:string|Blob)=>Promise<void>;close:()=>Promise<void>;abort?:()=>Promise<void>}>}>;
 queryPermission?:(options:{mode:'read'|'readwrite'})=>Promise<string>;
 requestPermission?:(options:{mode:'read'|'readwrite'})=>Promise<string>;
}

/** Stored ZIP exported by our bounded, hash-verified backend. No third-party
 * archive paths are accepted and every managed payload is checked below. */
/** HTML/text notes are converted with the editor's lossless Markdown converter;
 * a note it cannot preserve keeps its exact source file. */
export async function fetchPortableZip():Promise<{response:Response;locked:number}> {
 const post=async(body:unknown)=>{
  const response=await fetch('/api/portable/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||t('폴더 내보내기에 실패했습니다.'));
  return response;
 };
 const {notes}=await (await post({sources:true})).json() as {notes:{id:string;revision:number;format:ContentFormat;content:string}[]};
 const markdown:Record<string,{revision:number;markdown:string}>={};
 if(notes.length){const m=await import('./markdown');for(const n of notes){try{markdown[n.id]={revision:n.revision,markdown:n.format==='text'?m.textToMarkdown(n.content):m.htmlToMarkdown(n.content)};}catch{/* exact source file */}}}
 const response=await post({markdown});
 return {response,locked:Number(response.headers.get('x-inkism-locked-skipped'))||0};
}
async function exportSnapshot():Promise<Map<string,Blob>> {
 const {response}=await fetchPortableZip();
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>LIMIT)throw new Error(t('내보내기 용량이 너무 큽니다.'));
 const view=new DataView(bytes.buffer),files=new Map<string,Blob>();let pos=0;
 while(pos+30<=bytes.length&&view.getUint32(pos,true)===0x04034b50){
  const flags=view.getUint16(pos+6,true),method=view.getUint16(pos+8,true),size=view.getUint32(pos+18,true),plain=view.getUint32(pos+22,true),nameSize=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true);
  const start=pos+30+nameSize+extra,end=start+size,name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(pos+30,pos+30+nameSize));
  if(flags&9||method!==0||size!==plain||end>bytes.length||!safePath(name)||files.has(name))throw new Error(t('외부 편집 압축파일이 올바르지 않습니다.'));
  files.set(name,new Blob([bytes.slice(start,end)]));pos=end;
 }
 const descriptor=files.get('.inkism-portable.json');if(!descriptor)throw new Error(t('외부 편집 목록 파일이 없습니다.'));
 const manifest=validatePortableManifest(JSON.parse(await descriptor.text()));
 for(const entry of [...manifest.notes.map(n=>({path:n.path,sha256:n.portable_sha256})),...manifest.attachments]){const file=files.get(entry.path);if(!file||await sha256(new Uint8Array(await file.arrayBuffer()))!==entry.sha256)throw new Error(t('내보낸 파일 검증에 실패했습니다.'));}
 return files;
}
const JOURNAL='.inkism-write-journal.json';
type WriteRecord={path:string;before:string|null;after:string|null;data:string|null};
type WriteJournal={version:1;records:WriteRecord[]};
const queues=new WeakMap<object,Promise<unknown>>();
async function fileAt(root:WritableFolderHandle,path:string):Promise<File|null>{try{const parts=path.split('/');let dir=root;for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);return await (await dir.getFileHandle(parts.at(-1)!)).getFile();}catch(e){if((e as Error).name==='NotFoundError')return null;throw e;}}
async function put(root:WritableFolderHandle,path:string,data:Blob|string){const parts=path.split('/');let dir=root;for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name,{create:true});const stream=await(await dir.getFileHandle(parts.at(-1)!,{create:true})).createWritable();try{await stream.write(data);await stream.close();}catch(e){await stream.abort?.();throw e;}}
async function remove(root:WritableFolderHandle,path:string){const parts=path.split('/');let dir=root;for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);await dir.removeEntry(parts.at(-1)!);}
const digestFile=async(file:Blob|null)=>file?sha256(new Uint8Array(await file.arrayBuffer())):null;
const encode=async(blob:Blob)=>{const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCodePoint(...bytes.subarray(i,i+8192));return btoa(text);};
const decodeBlob=(data:string)=>new Blob([Uint8Array.from(atob(data),c=>c.codePointAt(0)!)]);
async function resume(root:WritableFolderHandle,journal:WriteJournal){
 if(journal.version!==1||!Array.isArray(journal.records)||journal.records.length>4096)throw new Error(t('폴더 쓰기 복구 기록이 올바르지 않습니다.'));
 for(const row of journal.records){if(!safePath(row.path)||!(/^(notes|attachments)\/[^/]+$/.test(row.path)||['.inkism-portable.json','INDEX.md','README.txt'].includes(row.path))||row.path===JOURNAL||!(row.before===null||/^[a-f0-9]{64}$/.test(row.before))||!(row.after===null||/^[a-f0-9]{64}$/.test(row.after)))throw new Error(t('폴더 쓰기 복구 기록이 올바르지 않습니다.'));if(row.after!==await digestFile(row.data===null?null:decodeBlob(row.data)))throw new Error(t('폴더 쓰기 복구 기록이 손상되었습니다.'));}
 // Check the whole batch before touching a file, then repeat immediately before each write.
 for(const row of journal.records){const hash=await digestFile(await fileAt(root,row.path));if(hash!==row.before&&hash!==row.after)throw new Error(t('중단된 폴더 쓰기와 외부 변경이 충돌합니다: ')+row.path);}
 for(const row of journal.records){const hash=await digestFile(await fileAt(root,row.path));if(hash===row.after)continue;if(hash!==row.before)throw new Error(t('폴더 쓰기와 외부 변경이 충돌합니다: ')+row.path);if(row.data===null){if(hash!==null)await remove(root,row.path);}else await put(root,row.path,decodeBlob(row.data));}
 await root.removeEntry(JOURNAL);
}
/** Per-handle queue serializes preview/apply writers; a persistent redo journal
 * safely resumes partial writes. Manifest is always committed last. */
export function writeDatabaseSnapshot(root:WritableFolderHandle, accepted?:Map<string,File>):Promise<{written:number;conflicts:string[]}> {
 const previous=queues.get(root)??Promise.resolve();const next=previous.catch(()=>{}).then(()=>writeSnapshot(root,accepted));queues.set(root,next);return next;
}
async function writeSnapshot(root:WritableFolderHandle,accepted?:Map<string,File>):Promise<{written:number;conflicts:string[]}>{
 if(root.queryPermission&&await root.queryPermission({mode:'readwrite'})!=='granted')throw new Error(t('외부 편집 폴더의 쓰기 권한이 필요합니다.'));
 const interrupted=await fileAt(root,JOURNAL);if(interrupted){if(interrupted.size>128*1024*1024)throw new Error(t('폴더 쓰기 복구 기록이 너무 큽니다.'));await resume(root,JSON.parse(await interrupted.text()));}
 const files=await collectFolderFiles(await readFolderHandle(root)),descriptor=files.get('.inkism-portable.json');
 const old=descriptor?validatePortableManifest(JSON.parse(await descriptor.text())):null;
 const expected=new Map<string,string>();if(old){for(const n of old.notes)expected.set(n.path,n.portable_sha256);for(const a of old.attachments)expected.set(a.path,a.sha256);
  // Metadata edits must be imported first, just like body edits.
  for(const n of old.notes){const base=(n as PortableEntry&{baseline_metadata?:unknown}).baseline_metadata;const meta=n.metadata as {title?:string;tags?:string[];notebook_id?:string|null};if(!accepted&&base&&JSON.stringify([(base as typeof meta).title,(base as typeof meta).tags??[],(base as typeof meta).notebook_id??null])!==JSON.stringify([meta.title,meta.tags??[],meta.notebook_id??null]))throw new Error(t('폴더에 쓰기 전에 외부 메타데이터 변경을 반영해 주세요.'));}
 }
 if(accepted){for(const path of expected.keys())if(!accepted.has(path))expected.delete(path);for(const [path,file] of accepted)if(path.startsWith('notes/')||path.startsWith('attachments/'))expected.set(path,(await digestFile(file))!);}
 for(const [path,hash] of expected)if(await digestFile(files.get(path)??null)!==hash)throw new Error(t('외부 파일이 변경되어 자동 저장을 중단했습니다.')+' '+path);
 const desired=await exportSnapshot();const records:WriteRecord[]=[];
 for(const [path,file] of desired){const current=files.get(path)??null,after=await digestFile(file),before=await digestFile(current);if(before===after)continue;
  if(current&&!expected.has(path)&&!['.inkism-portable.json','INDEX.md','README.txt'].includes(path))throw new Error(t('기존 외부 파일을 덮어쓸 수 없습니다: ')+path);
  records.push({path,before,after,data:await encode(file)});
 }
 for(const [path] of expected)if(!desired.has(path))records.push({path,before:await digestFile(files.get(path)??null),after:null,data:null});
 records.sort((a,b)=>Number(a.path==='.inkism-portable.json')-Number(b.path==='.inkism-portable.json'));
 if(records.length){const journal:WriteJournal={version:1,records};await put(root,JOURNAL,JSON.stringify(journal));await resume(root,journal);}
 return {written:records.length,conflicts:[]};
}
