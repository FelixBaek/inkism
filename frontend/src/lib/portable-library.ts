import { t } from "../i18n";
import { api } from "../api";
import type { ContentFormat, Note } from "../types";
export interface PortableEntry { id: string; path: string; revision: number; format: ContentFormat; file_format?: ContentFormat | null; source_sha256: string; portable_sha256: string; metadata: { title?: string } }
export interface PortableManifest { version: 1; notes: PortableEntry[]; attachments: { id: string; path: string; sha256: string; size: number }[] }
export interface PortableChange { entry: PortableEntry; current: Note; content: string }
export interface PortablePlan { changes: PortableChange[]; unchanged: number; conflicts: string[]; ignored: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const LIMIT = 64 * 1024 * 1024;
export async function sha256(bytes: Uint8Array): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2,"0")).join(""); }
const hashText = (text: string) => sha256(new TextEncoder().encode(text));
export function validatePortableManifest(raw: unknown): PortableManifest {
  const m = raw as PortableManifest;
  if (m?.version !== 1 || !Array.isArray(m.notes) || m.notes.length > 2048 || !Array.isArray(m.attachments) || m.attachments.length > 512) throw new Error(t("지원하지 않는 외부 편집 폴더입니다."));
  const seen = new Set<string>(); const paths = new Set<string>();
  for (const n of m.notes) {
    const extension = ({markdown:"md",html:"html",text:"txt"} as const)[n?.file_format ?? n?.format];
    if (!n || ![undefined,null,"markdown"].includes(n.file_format) || typeof n.id!=="string" || !/^[A-Za-z0-9_-]{1,64}$/.test(n.id) || !extension || typeof n.path !== "string" || !new RegExp(`^notes/[^/\\\\\u0000-\u001f]+\\.${extension}$`).test(n.path) || !Number.isSafeInteger(n.revision) || n.revision < 1 || !HASH.test(n.source_sha256) || !HASH.test(n.portable_sha256) || seen.has(n.id) || paths.has(n.path)) throw new Error(t("문서 목록이 올바르지 않습니다."));
    seen.add(n.id); paths.add(n.path);
  }
  seen.clear();
  for (const a of m.attachments) {
    if (!a || !UUID.test(a.id) || !new RegExp(String.raw`^attachments/${a.id}(?:\.[a-zA-Z0-9]{1,12})?$`).test(a.path) || !HASH.test(a.sha256) || !Number.isSafeInteger(a.size) || a.size < 0 || a.size > LIMIT || seen.has(a.id)) throw new Error(t("첨부파일 목록이 올바르지 않습니다."));
    seen.add(a.id);
  }
  return m;
}
function escaped(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g,String.raw`\$&`); }
export function restorePortableLinks(source: string, manifest: PortableManifest): string {
  let result = source;
  for (const a of manifest.attachments) result = result.replace(new RegExp(String.raw`(^|[="'\s(<])\.\./${escaped(a.path)}(?=[?"'\s<>\)\]#]|$)`,"gm"), (_all, prefix) => `${prefix}/api/attachments/${a.id}`);
  result = result.replace(/(^|[="'\s(<[])inkism:\/\/note\/([A-Za-z0-9_-]+)(?=[#?|"'\s<>)\]]|$)/gm, (_all, prefix, id) => `${prefix}note://${id}`);
  for (const n of manifest.notes) result = result.replace(new RegExp(String.raw`(^|[="'\s(<\[])(?:\./)?${escaped(n.path.slice(6))}(?=[#?|"'\s<>\)\]]|$)`,"gm"), (_all, prefix) => `${prefix}note://${n.id}`);
  return result;
}
/** All files and current revisions are checked before the UI enables Apply. */
/** Exported .md files start with an informational YAML block; it is never part of the note body. */
export const stripFrontmatter=(text:string)=>text.replace(/^---\r?\nid: "[^\n]*\n(?:[^\n]*\n)*?---\r?\n/,'');

export async function planPortableImport(files: File[], get: (id: string) => Promise<Note> = api.get): Promise<PortablePlan> {
  if (files.length > 4096 || files.reduce((n,f) => n+f.size,0) > LIMIT) throw new Error(t("외부 편집 폴더는 64 MiB 이하만 지원합니다."));
  const byPath = new Map<string, File>();
  for (const file of files) { const path = file.webkitRelativePath || file.name; const relative = file.webkitRelativePath ? path.slice(path.indexOf("/")+1) : path; if (byPath.has(relative)) throw new Error(t("중복 파일 경로가 있습니다.")); byPath.set(relative,file); }
  const descriptor = byPath.get(".inkism-portable.json");
  if (!descriptor || descriptor.size > 8*1024*1024) throw new Error(t("ZIP을 푼 폴더 전체를 선택해 주세요. .inkism-portable.json이 필요합니다."));
  const manifest = validatePortableManifest(JSON.parse(await descriptor.text()));
  for (const a of manifest.attachments) { const file = byPath.get(a.path); if (file?.size !== a.size || await sha256(new Uint8Array(await file.arrayBuffer())) !== a.sha256) throw new Error(t("첨부파일이 변경되었거나 없습니다. 원본 첨부파일을 유지해 주세요.")); }
  const plan: PortablePlan = { changes:[], unchanged:0, conflicts:[], ignored:[...byPath.keys()].filter(path => ![".inkism-portable.json", "README.txt", "INDEX.md"].includes(path) && !manifest.notes.some(n => n.path === path) && !manifest.attachments.some(a => a.path === path)).length };
  for (const entry of manifest.notes) {
    const file = byPath.get(entry.path);
    if (!file) { plan.conflicts.push(`${entry.metadata?.title || entry.id}: ${t("파일이 없습니다.")}`); continue; }
    // File.text() strips BOM; decode explicitly so exact original Markdown survives.
    const portable = new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
    if (await hashText(portable) === entry.portable_sha256) { plan.unchanged++; continue; }
    try {
      const current = await get(entry.id);
      if (current.revision !== entry.revision || (current.content_format || "html") !== entry.format || current.readonly || current.trashed || (current as Note & {locked?:boolean}).locked || await hashText(current.content) !== entry.source_sha256) throw new Error(t("앱의 노트가 변경되었거나 편집할 수 없습니다."));
      // Existing relative paths can look exactly like generated links. Refuse
      // this ambiguous reverse mapping rather than silently rewrite old text.
      if (restorePortableLinks(current.content,manifest) !== current.content) throw new Error(t("원문에 내보낸 파일과 같은 상대 경로가 있어 자동으로 반영할 수 없습니다. 파일 내용을 직접 비교해 주세요."));
      plan.changes.push({entry,current,content:restorePortableLinks(stripFrontmatter(portable),manifest)});
    } catch (error) { plan.conflicts.push(`${entry.metadata?.title || entry.id}: ${error instanceof Error ? error.message : t("확인 실패")}`); }
  }
  return plan;
}
export async function applyPortablePlan(plan: PortablePlan, save: typeof api.save = api.save): Promise<{saved: number; errors: string[]}> {
  const result = {saved:0,errors:[] as string[]};
  for (const change of plan.changes) {
    try { await save({id:change.entry.id,title:change.current.title,content:change.content,content_format:change.entry.format,revision:change.current.revision,require_existing:true,expected_source_sha256:change.entry.source_sha256}); result.saved++; }
    catch (error) { result.errors.push(`${change.current.title || change.entry.id}: ${error instanceof Error ? error.message : t("저장 실패")}`); }
  }
  return result;
}
