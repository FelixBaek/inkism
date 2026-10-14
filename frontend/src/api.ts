import { t } from "./i18n";
import { backendErrorCode, backendErrorDetail, localizeBackendError } from "./lib/error-messages";
/** 데스크톱 브리지: POST /api/rpc ({op,...args}) → {ok:true,data}|{ok:false,error} */
import type {
  AppInfo,
  DocumentBlockPage,
  DocumentSegmentPage,
  DocumentInfo,
  DocumentFindResult,
  BacklinkItem,
  Defaults,
  HistoryEntry,
  ListResult,
  Note,
  Notebook,
  NotebookCover,
  UnsplashPhoto,
  Stats,
  Summary,
  TagCount,
} from "./types";

export class RpcError extends Error {
  public readonly code: string | undefined;
  public readonly rawMessage: string;
  constructor(
    public op: string,
    message: string,
    public readonly status?: number,
  ) {
    super(localizeBackendError(message));
    this.rawMessage = message;
    this.code = backendErrorCode(message);
    this.name = "RpcError";
  }
  /** Keep conflict handling independent of the selected display language. */
  get isConflict(): boolean {
    return this.code === "conflict" || /revision|conflict/i.test(this.rawMessage);
  }
}

export type RpcDiagnostic = "body_read_budget" | "duplicate_block_id";
/** Decisions use the raw protocol diagnostic, never translated display text. */
export function hasRpcDiagnostic(error: unknown, diagnostic: RpcDiagnostic): error is RpcError {
  if (!(error instanceof RpcError) || error.code !== "invalid" || (error.status !== undefined && error.status !== 400)) return false;
  const detail = backendErrorDetail(error.rawMessage);
  return diagnostic === "body_read_budget" ? detail === "note body exceeds read budget" :
    /^duplicate block ID .+: rename the duplicate block ID before merging$/.test(detail);
}

interface RpcEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function rpc<T>(
  op: string,
  args: object = {},
  opts: { keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, ...args }),
      keepalive: opts.keepalive,
      signal: opts.signal,
    });
  } catch (e) {
    throw new RpcError(op, t("네트워크 오류: 엔진에 연결할 수 없습니다"));
  }
  let body: RpcEnvelope<T> | null = null;
  try {
    body = (await res.json()) as RpcEnvelope<T>;
  } catch {
    throw new RpcError(op, t("응답을 해석할 수 없습니다 (HTTP {status})", { status: res.status }), res.status);
  }
  if (!res.ok || body?.ok !== true) {
    throw new RpcError(op, body?.error || t("RPC 실패 (HTTP {status})", { status: res.status }), res.status);
  }
  return body.data as T;
}

/** 셸 전용 JSON 경로(/api/...): {ok,data}|{ok:false,error}. */
async function shellJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    body === undefined
      ? undefined
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  let env: RpcEnvelope<T> | null = null;
  try {
    env = await res.json();
  } catch {
    /* 셸 없음 */
  }
  if (!res.ok || !env?.ok) throw new Error(localizeBackendError(env?.error || `HTTP ${res.status}`));
  return env.data as T;
}

export interface ListParams {
  view: string;
  notebook_id?: string;
  tag?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  sort_by?: "created_at" | "updated_at" | "edited_at" | "title";
  sort_direction?: "asc" | "desc";
  /** 일일 노트(id `daily-…`)만. */
  daily?: boolean;
}

let uploadAccess: Promise<{ url: string; token: string }> | undefined;
async function postFile(path: string, form: FormData, signal?: AbortSignal) {
  if ((window as Window & { __INKISM_MOBILE__?: boolean }).__INKISM_MOBILE__) {
    // Reserve multipart framing space and reject before Request.arrayBuffer
    // duplicates a large attachment in the mobile IPC bridge.
    let bytes = 0;
    for (const value of form.values()) bytes += typeof value === "string" ? new Blob([value]).size : value.size;
    if (bytes > 63 * 1024 * 1024) throw new Error(t("모바일 파일 전송은 63MB까지 지원합니다."));
  }
  uploadAccess ??= fetch("/api/upload-access")
    .then(async (response) => {
      if (!response.ok) throw new Error(t("파일 전송 연결을 열지 못했습니다."));
      const access = await response.json();
      if (access.url === "" && access.token === "") return access;
      if (
        typeof access.url !== "string" ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(access.url) ||
        typeof access.token !== "string" ||
        !/^[a-f0-9]{64}$/.test(access.token)
      ) {
        throw new Error(t("파일 전송 연결을 확인하지 못했습니다."));
      }
      return access;
    })
    .catch((error) => {
      uploadAccess = undefined;
      throw error;
    });
  const access = await uploadAccess;
  return fetch(access.url + path, {
    method: "POST",
    body: form,
    signal,
    credentials: "omit",
    headers: access.token ? { Authorization: "Bearer " + access.token } : undefined,
  });
}

export type SemanticPending = { id: string; revision: number; title: string; offset: number; total: number; chunks: { ordinal: number; start: number; end: number; text: string }[] };
export type SemanticHit = { note: Summary; start: number; end: number; score: number; snippet: string };
export type SemanticStatus = { indexed: number; pending: number };

export const api = {
  semanticPending: (model: string, limit: number) => rpc<{ items: SemanticPending[] }>("semantic_pending", { model, limit }),
  semanticPut: (note_id: string, revision: number, model: string, offset: number, vectors: number[][]) => rpc<{ stored: number; done: boolean }>("semantic_put", { note_id, revision, model, offset, vectors }),
  semanticSearch: (model: string, vector: number[], limit: number, signal?: AbortSignal) => rpc<{ items: SemanticHit[] }>("semantic_search", { model, vector, limit }, { signal }),
  semanticStatus: (model: string) => rpc<SemanticStatus>("semantic_status", { model }),
  semanticReset: () => rpc<object>("semantic_reset"),
  dueReminders: (now = Date.now()) => rpc<Summary[]>("due_reminders", { now, limit: 50 }),

  list: (params: ListParams) => rpc<ListResult>("list", params),

  documentFind: (
    id: string,
    revision: number,
    query: string,
    options: { offset?: number; limit?: number; case_sensitive?: boolean } = {},
  ) => rpc<DocumentFindResult>("document_find", { id, revision, query, ...options }),

  documentBlocks: (
    id: string,
    options: {
      revision?: number;
      offset?: number;
      limit?: number;
      include_summary?: boolean;
      bounded?: boolean;
      max_block_bytes?: number;
    } = {},
  ) => rpc<DocumentBlockPage>("document_blocks", { id, bounded: true, ...options }),

  documentSegments: (
    id: string,
    revision: number,
    ordinal: number,
    options: { offset?: number; limit?: number } = {},
  ) => rpc<DocumentSegmentPage>("document_segments", { id, revision, ordinal, ...options }),

  documentBlockWindow: (id: string, revision: number, ordinal: number, offset: number) =>
    rpc<{
      ready: boolean;
      revision: number;
      ordinal: number;
      block_byte_offset: number;
      offset: number;
      source: string | null;
      total_bytes: number;
      next_offset: number | null;
    }>("document_block_window", { id, revision, ordinal, offset, limit: 65536 }),

  documentLocate: (id: string, revision: number, byte_offset: number, bias: "before" | "after" = "after") =>
    rpc<{
      ready: boolean;
      supported?: boolean;
      revision: number;
      byte_offset: number;
      ordinal: number;
      offset: number;
      total_segments: number;
      total_blocks: number;
      block_bytes: number;
    }>("document_locate", { id, revision, byte_offset, bias }),

  randomNote: (args: Record<string,unknown> = {}) => rpc<{id:string|null}>("random_note",args),
  notePreview: (id: string) => rpc<{id:string;title:string;preview:string;revision:number}>("note_preview", {id}),
  get: (id: string, options?: {max_body_bytes: number}) => rpc<Note>("get", { id, ...options }),

  save: (
    note: {
      id: string;
      title: string;
      content: string;
      text?: string;
      content_format?: import("./types").ContentFormat;
      notebook_id?: string | null;
      tags?: string[];
      revision?: number;
      readonly?: boolean;
      require_existing?: boolean;
      require_absent?: boolean;
      timestamp_title?: boolean;
      expected_source_sha256?: string;
    },
    opts: { keepalive?: boolean } = {},
  ) => rpc<Note>("save", { note }, opts),

  convertContent: (id: string, revision: number, content_format: import("./types").ContentFormat, content?: string) =>
    rpc<Note>("convert_content", { id, revision, content_format, ...(content === undefined ? {} : {content}) }),
  documentRender: (id: string, revision: number) =>
    rpc<{ id: string; revision: number; content_format: import("./types").ContentFormat; html: string }>(
      "document_render",
      { id, revision },
    ),

  spliceSource: (
    id: string,
    revision: number,
    content_format: import("./types").ContentFormat,
    content: import("./lib/body-splice").BodySplice,
  ) => rpc<Summary>("document_splice_source", { id, revision, content_format, content }),

  documentInfo: (id: string, revision?: number) => rpc<DocumentInfo>("document_info", { id, revision }),

  spliceHTML: (
    id: string,
    revision: number,
    content: import("./lib/body-splice").BodySplice,
    metadata?: { title: string; notebook_id: string | null; tags: string[] },
  ) =>
    rpc<Summary & { text_stats: { words: number; chars: number } }>("document_splice_html", {
      id,
      revision,
      content,
      metadata,
    }),

  spliceHTMLBatch: (
    id: string,
    revision: number,
    edits: readonly Readonly<import("./lib/body-splice").BodySplice>[],
    metadata?: { title: string; notebook_id: string | null; tags: string[] },
  ) =>
    rpc<Summary & { text_stats: { words: number; chars: number } }>("document_splice_html", {
      id,
      revision,
      edits,
      metadata,
    }),

  splice: (id: string, revision: number, changes: import("./lib/splice-client").BodyChanges) =>
    rpc<Summary>("document_splice", { id, revision, ...changes }),

  patch: (id: string, changes: Record<string, unknown>, revision?: number) =>
    rpc<Summary>("patch", { id, changes, revision, summary_only: true }),

  delete: (id: string) => rpc<{ deleted: boolean }>("delete", { id }),

  notebooks: () => rpc<Notebook[]>("notebooks"),
  notebookCounts: () => rpc<Record<string, number>>("notebook_counts"),

  saveNotebook: (nb: {
    id?: string;
    name: string;
    color?: string;
    parent_id?: string | null;
    description?: string | null;
    cover?: NotebookCover | null;
  }) => rpc<Notebook>("save_notebook", nb),

  defaults: () => rpc<Defaults>("defaults_get"),
  setDefaults: (changes: Partial<Defaults>) => rpc<Defaults>("defaults_set", changes),
  setTagColor: (name: string, color: string | null) => rpc<unknown>("tag_color_set", { name, color }),
  setNotebookIcon: (id: string, icon: string | null) => rpc<unknown>("notebook_icon_set", { id, icon }),
  deleteNotebook: (id: string, current_id?: string, current_revision?: number) =>
    rpc<{ deleted: boolean; current: Summary | null }>("delete_notebook", { id, current_id, current_revision }),

  changeTag: (name: string, replacement: string | null, current_id?: string, current_revision?: number) =>
    rpc<{ updated: number; current: Summary | null }>("change_tag", {
      name,
      replacement,
      current_id,
      current_revision,
    }),

  tags: () => rpc<TagCount[]>("tags"),

  stats: () => rpc<Stats>("stats"),
  /** 지운 노트 자동 삭제 기간(일). null = 안 함(기본). 보관한 노트는 지우지 않는다. */
  trashRetention: () => rpc<{ days: TrashDays }>("trash_retention_get"),
  setTrashRetention: (days: TrashDays) => rpc<{ days: TrashDays }>("trash_retention_set", { days }),
  trashTimes: (ids: string[]) => rpc<{ times: Record<string, number>; days: TrashDays }>("trash_times", { ids }),
  trashPurge: () => rpc<{ deleted: string[]; more: boolean }>("trash_purge"),

  revisionBody: (id: string, revision: number) =>
    rpc<{ revision: number; content: string }>("revision_body", { id, revision }),

  historyBody: (id:string,history_id:string)=>rpc<{title:string;content:string;content_format:import("./types").ContentFormat}>("history_body",{id,history_id}),
  historyChanges: (id:string,limit=5)=>rpc<{items:{id:string;added:number|null;removed:number|null}[]}>("history_changes",{id,limit}),
  nameCurrentVersion: (id:string,revision:number,label:string)=>rpc<{id:string}>("history_name_current",{id,revision,label}),
  renameVersion: (id:string,revision:number,history_id:string,expected_label:string,label:string)=>rpc<{id:string}>("history_rename",{id,revision,history_id,expected_label,label}),
  deleteNamedVersion: (id:string,revision:number,history_id:string,expected_label:string)=>rpc<{id:string}>("history_delete_named",{id,revision,history_id,expected_label}),
  history: (id: string) => rpc<HistoryEntry[]>("history", { id }),
  /** 일반 노트 아래 암호화된 채로 남은 금고형 버전의 이름·시각. 본문·암호문은 오지 않는다. */
  sealedHistory: (id: string) =>
    rpc<{ id: string; label: string; title: string; created_at: number }[]>("history_sealed", { id }),

  restore: (id: string, historyId: string, revision?:number) => rpc<Note>("restore", { id, history_id: historyId, revision }),

  uploadAttachment: async (
    file: File,
    signal: AbortSignal,
  ): Promise<{ id: string; name: string; size: number; media_type: string }> => {
    if (file.size > 1024 ** 3) throw new Error(t("파일은 1GB 이하로 첨부해 주세요."));
    const form = new FormData();
    form.append("file", file);
    form.append("size", String(file.size));
    const response = await postFile("/api/attachments", form, signal);
    const result = await response.json();
    if (!response.ok || !result.ok || !result.data) throw new Error(localizeBackendError(result.error || t("파일 업로드에 실패했습니다.")));
    const asset = result.data;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(asset.id) ||
      typeof asset.name !== "string" ||
      typeof asset.media_type !== "string" ||
      asset.size !== file.size
    )
      throw new Error(t("첨부파일 응답을 확인하지 못했습니다."));
    return asset;
  },

  /** Unsplash 표지 검색. 키는 데스크톱 셸만 갖고, 화면은 설정 여부만 안다. */
  unsplash: {
    status: () => shellJSON<{ configured: boolean }>("/api/unsplash/key"),
    setKey: (key: string | null) => shellJSON<{ configured: boolean }>("/api/unsplash/key", { key }),
    search: (q: string, page: number) =>
      shellJSON<{ items: UnsplashPhoto[]; total_pages: number }>(
        `/api/unsplash/search?q=${encodeURIComponent(q)}&page=${page}`,
      ),
    use: (id: string) => shellJSON<unknown>("/api/unsplash/use", { id }),
  },

  exportUrl: "/api/backup",

  importFile: async (file: File): Promise<number> => {
    const form = new FormData();
    form.append("file", file);
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
    const res = await postFile(isZip ? "/api/restore" : "/api/import", form);
    let body: { ok?: boolean; data?: { imported?: number }; imported?: number; error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      /* 빈 응답 허용 */
    }
    if (!res.ok || !body || body.ok === false) {
      throw new Error(localizeBackendError(body?.error || t("가져오기 실패 (HTTP {status})", { status: res.status })));
    }
    return body.data?.imported ?? body.imported ?? 0;
  },

  info: async (): Promise<AppInfo> => {
    const res = await fetch("/api/info");
    if (!res.ok) throw new Error(`/api/info HTTP ${res.status}`);
    return (await res.json()) as AppInfo;
  },

  /** 엔진의 색인 지연 상태. 미구현 엔진이면 RpcError → 호출부가 기능을 조용히 끈다. */
  indexStatus: () =>
    rpc<{ pending?: number; pending_jobs?: number; jobs?: number; remaining?: number }>("index_status"),

  /** 역링크 (프로토콜 v1에 명시되지 않아 엔진이 지원하지 않으면 비활성화) */
  backlinks: (id: string, cursor?:string, signal?:AbortSignal) => rpc<{ items?: BacklinkItem[]; next_cursor?:string|null } | BacklinkItem[]>("backlinks", { id, limit:50, ...(cursor?{cursor}:{}) },{signal}),
  workspaceTools: {
    get: () => rpc<{ canvas: { value: unknown; updated_at: number }; bookmarks: { value: unknown; updated_at: number } }>("workspace_tools_get"),
    set: (args: { canvas?: unknown; bookmarks?: unknown; expected_updated_at?: Record<string, number> }) => rpc<{ canvas: { value: unknown; updated_at: number }; bookmarks: { value: unknown; updated_at: number } }>("workspace_tools_set", args),
  },
};

export function normalizeBacklinks(data: unknown): BacklinkItem[] {
  const d = data as { items?: BacklinkItem[] } | BacklinkItem[];
  if (Array.isArray(d)) return d.filter((x) => x && typeof x.id === "string");
  if (d && Array.isArray(d.items)) return d.items.filter((x) => x && typeof x.id === "string");
  return [];
}

export function summaryOf(note: Note): Summary {
  const { content: _c, text: _t, ...rest } = note;
  return { ...rest, preview: note.text.slice(0, 180) };
}
export type TrashDays = 7 | 30 | 90 | null;
