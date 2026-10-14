import {requestTagChange,type TagChangeResult} from "./lib/tag-change";
import { persistHistory } from "./lib/persistent-history";
import { editLocked, withReadonly } from "./lib/readonly-permission";
import { errorText } from "./lib/text";
import { flushEditors, hasPendingEditorInput, type EditorFlushOptions } from "./lib/editor-flush";
import { advanceRichHistory, forgetRichHistory } from "./lib/rich-history-cache";
import { advanceSourceHistory, forgetSourceHistory } from "./lib/source-history-cache";
import { advanceWindowHistory, forgetWindowHistory, needsPagedWindowHistory } from "./lib/window-history-cache";
import { advanceLocation, forgetLocation, preferredLocationMode, rememberLocation } from "./lib/editor-location";
import { applyHtmlEdits } from "./lib/paged-body";
import { PagedEditQueue, type EditBatch } from "./lib/paged-edit-queue";
import type { BodySplice } from "./lib/body-splice";
import { flushWorkspaceForClose } from "./lib/workspace";
import { windowBodySplice } from "./lib/body-splice";
import { closeAfterSave } from "./platform";
/**
 * 애플리케이션 상태 저장소.
 * - 직렬화된 자동 저장(동시 저장 없음, 실패 시 dirty 유지)
 * - 낙관적 revision 충돌 처리
 * - 목록 키셋 페이지네이션(50개/페이지, 렌더 상한 유지)
 * - 검색/조회 응답 순서 방어(seq 가드)
 * - 대용량 문서: 원문 모드 기본, 리치 모드 전환은 명시적 확인
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, rpc, RpcError, normalizeBacklinks, type ListParams } from "./api";
import {
  type AppInfo,
  type BacklinkItem,
  type Defaults,
  type Draft,
  type Note,
  type Notebook,
  type NotebookCover,
  type Stats,
  type Summary,
  type TagCount,
  type View,
  isLargeDocument,
  LARGE_BYTES,
  LARGE_LINES,
} from "./types";
import { deriveSplices } from "./lib/splice-client";
import { deriveTextInWorker } from "./lib/plaintext-client";
import { DraftJournal } from "./lib/draft-journal";
import { readSort } from "./lib/list-sort";
import { t } from "./i18n";
import { defaultEditor, type EditorCompatibility } from "./lib/editor-settings";

export const PAGE_SIZE = 50;
const AUTOSAVE_MS = 800;

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
export type EditorMode = "text" | "html" | "markdown";

export interface DialogConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** 세 번째 버튼(취소와 확인 사이). 누르면 choose()가 "extra"를 돌려준다. */
  extraLabel?: string;
}
export interface DialogPromptOptions extends DialogConfirmOptions {
  label: string;
  initial?: string;
  withColor?: boolean;
  initialColor?: string;
  /** 폴더 표지 사진 고르기(Unsplash·파일). 결과의 cover: 없음 = null. */
  withCover?: boolean;
  initialCover?: NotebookCover | null;
  placeholder?: string;
  /** 폴더 설명 입력란. 결과의 description: 빈 값 = "". */
  withDescription?: boolean;
  initialDescription?: string;
  /** 빈 값 제출 허용(예: 링크 제거). */
  allowEmpty?: boolean;
}
export type PromptResult = { value: string; color: string; cover?: NotebookCover | null; description?: string };
export type DialogState =
  | { kind: "confirm"; options: DialogConfirmOptions; resolve: (v: boolean | "extra") => void }
  | {
      kind: "prompt";
      options: DialogPromptOptions;
      resolve: (v: PromptResult | null) => void;
    }
  | { kind: "history"; noteId: string; historyId?: string }
  | { kind: "imported"; count: number }
  | { kind: "error"; title: string; message: string };

interface PageData {
  items: Summary[];
  nextCursor: string | null;
}

export interface StoreValue {
  // 메타
  info: AppInfo | null;
  connError: string | null;
  retryConnection: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  // 내비게이션
  view: View;
  setView: (v: View) => void;
  notebooks: Notebook[];
  tags: TagCount[];
  performTagChange: (action:(currentId?:string,currentRevision?:number)=>Promise<TagChangeResult>)=>Promise<TagChangeResult>;
  renameTag: (name: string) => Promise<void>;
  removeTag: (name: string) => Promise<void>;
  setTagColor: (name: string, color: string | null) => Promise<void>;
  styleNotebook: (nb: Notebook, change: { color?: string | null; icon?: string | null }) => Promise<void>;
  stats: Stats | null;
  addNotebook: (parent?: Notebook) => Promise<void>;
  renameNotebook: (nb: Notebook) => Promise<void>;
  removeNotebook: (nb: Pick<Notebook, "id" | "name">, confirmed?: boolean) => Promise<void>;
  defaults: Defaults;
  toggleDefaultNotebook: (nb: Notebook) => void;
  toggleDefaultTag: (name: string) => void;
  // 목록
  searchInput: string;
  setSearchInput: (s: string) => void;
  search: string;
  page: number;
  pageData: PageData | null;
  listLoading: boolean;
  listError: string | null;
  goToPage: (n: number) => void;
  refreshList: () => void;
  selectedId: string | null;
  selectNote: (id: string | null) => Promise<void>;
  reloadCurrentNote: (expectedId: string) => Promise<boolean>;
  selectionVersion: () => number;
  newNote: (title?: string, timestampTitle?: boolean) => void;
  // 편집
  note: Note | null;
  draft: Draft | null;
  readDraft: () => Draft | null;
  editorGeneration: number;
  draftLoading: boolean;
  saveState: SaveState;
  saveError: string | null;
  conflictServer: Note | null;
  mode: EditorMode;
  setMode: (m: EditorMode) => Promise<void>;
  convertEditorCompatibility: () => Promise<void>;
  editorConverting: boolean;
  makeRichCopy: () => Promise<void>;
  setEditorError: (message: string | null) => void;
  largeDoc: boolean;
  windowedEditor: boolean;
  changePaged: (edit: BodySplice) => void;
  stageWholeBody: (
    expected: Draft,
    revision: number,
    version: number | undefined,
    content: string,
    before?: string,
    kind?: "replace" | "cut",
  ) => void;
  wholeBodyUndo: { undone: boolean; kind?: "replace" | "cut" } | null;
  toggleWholeBodyUndo: () => void;
  updateDraft: (
    patch: Partial<Pick<Draft, "title" | "content" | "text" | "textDirty" | "windowEdit" | "notebook_id" | "tags">>,
  ) => void;
  flushNow: (opts?: EditorFlushOptions) => Promise<boolean>;
  retrySave: () => void;
  keepLocalVersion: () => void;
  useServerVersion: () => void;
  // 작업
  patchNote: (changes: Record<string, unknown>) => Promise<void>;
  /** Patch any note (list menus). Flushes the open draft first; non-selected notes need their revision. */
  patchNoteById: (id: string, changes: Record<string, unknown>, revision?: number) => Promise<boolean>;
  setReminder: (id: string, at: number | null, revision?: number, repeat?: number | null) => Promise<boolean>;
  ensurePersisted: () => Promise<boolean>;
  openHistory: (historyId?: string) => void;
  trashSelected: () => Promise<void>;
  restoreSelected: () => Promise<void>;
  deleteSelectedForever: () => Promise<void>;
  quickRestore: (id: string) => Promise<void>;
  /** confirmed=true: 호출한 쪽이 이미 확인을 받았다(여러 노트 한꺼번에 삭제). */
  quickDelete: (id: string, confirmed?: boolean) => Promise<void>;
  /** 지운 노트 비우기: 지운 노트·폴더를 모두 영구 삭제(확인 대화상자). */
  emptyTrash: () => Promise<void>;
  restoreVersion: (historyId: string) => Promise<void>;
  // 색인/역링크
  indexPending: number | null;
  indexSupported: boolean;
  backlinks: BacklinkItem[] | null;
  backlinksOpen: boolean;
  backlinksCursor: string|null;
  backlinksBusy: boolean;
  backlinksError: string;
  loadMoreBacklinks: () => Promise<void>;
  toggleBacklinks: () => void;
  refreshMeta: () => Promise<void>;
  // 백업
  exportBackup: () => Promise<void>;
  importBackup: (file?: File) => Promise<void>;
  importing: boolean;
  // 대화상자
  dialog: DialogState | null;
  confirm: (o: DialogConfirmOptions) => Promise<boolean>;
  /** 버튼 셋 확인 창: 확인 = true, extraLabel 버튼 = "extra", 취소 = null. */
  choose: (o: DialogConfirmOptions & { extraLabel: string }) => Promise<true | "extra" | null>;
  prompt: (o: DialogPromptOptions) => Promise<PromptResult | null>;
  showError: (title: string, message: string) => Promise<void>;
  showImported: (count: number) => void;
  closeDialog: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error("StoreProvider가 필요합니다");
  return v;
}

function viewToParams(view: View, search: string): ListParams {
  const base: ListParams = { view: "all" };
  switch (view.type) {
    case "all":
      base.view = "all";
      break;
    case "favorites":
      base.view = "favorites";
      break;
    case "archive":
      base.view = "archive";
      break;
    case "trash":
      base.view = "trash";
      break;
    case "notebook":
      base.view = "all";
      base.notebook_id = view.id;
      break;
    case "tag":
      base.view = "all";
      base.tag = view.name;
      break;
  }
  if (search.trim()) base.query = search.trim();
  return base;
}

export function viewTitle(view: View): string {
  switch (view.type) {
    case "all":
      return t("전체 노트");
    case "favorites":
      return t("즐겨찾기");
    case "archive":
      return t("보관함");
    case "trash":
      return t("지운 노트");
    case "notebook":
      return t("폴더"); // 사이드바에서 실제 이름을 전달받아 대체
    case "tag":
      return `#${view.name}`;
  }
}

/** Which editor path opens this note: lazy windows only for notes without an explicit source view. */
function openPlan(id: string, appInfo: AppInfo, windowedEditor: boolean, lazyEditor: boolean) {
  const useWindowed = Boolean(windowedEditor || appInfo.windowed_editor || appInfo.lazy_editor);
  const useLazy = lazyEditor || appInfo.lazy_editor;
  const preferred = preferredLocationMode(id);
  const lazyWindow = Boolean(useWindowed && useLazy && preferred !== "html" && preferred !== "markdown");
  return { useWindowed, lazyWindow, preferred };
}
/** Loads the note; large lazy HTML opens as a paged summary without its body. Null when superseded. */
async function loadNoteBody(
  id: string,
  lazyWindow: boolean,
  stale: () => boolean,
): Promise<{ n: Note; paged?: PagedEditQueue } | null> {
  if (!lazyWindow) return { n: await api.get(id) };
  let opening = await api.documentInfo(id);
  const deadline = Date.now() + 60000;
  while ((opening.summary.content_format ?? "html") === "html" && !opening.ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (stale()) return null;
    opening = await api.documentInfo(id);
  }
  if ((opening.summary.content_format ?? "html") !== "html") return { n: await api.get(id) };
  if (!opening.ready) throw new Error(t("문서를 준비 중입니다. 잠시 후 다시 열어 주세요."));
  if (
    opening.total_bytes! > LARGE_BYTES ||
    opening.total_blocks! > LARGE_LINES ||
    needsPagedWindowHistory(id, opening.revision)
  )
    return {
      n: { ...opening.summary, content: "", text: "" },
      paged: new PagedEditQueue(opening.revision, opening.total_bytes!),
    };
  return { n: await api.get(id) };
}

/** A new note inherits the tag being viewed, otherwise the default tag. */
function newNoteTags(view: View, defaults: Defaults | null): string[] {
  if (view.type === "tag") return [view.name];
  return defaults?.tag ? [defaults.tag] : [];
}
const LOCATION_KIND = { text: "rich", markdown: "markdown", html: "source" } as const;

type SavedBody = Note & { textPending?: boolean; windowEdit?: NonNullable<Draft["windowEdit"]> };
type BodyFormat = NonNullable<Draft["content_format"]>;
type NoteMetadata = Pick<Draft, "title" | "notebook_id" | "tags">;
interface SaveResult {
  saved: Note;
  textStats: Draft["textStats"];
  /** The paged queue gained edits while this batch was in flight. */
  pagedDirty: boolean;
}

/** Same note, revision and format as the last save: only then can a splice or metadata patch apply. */
function sameBase(baseline: SavedBody | null, payload: Draft, format: BodyFormat): baseline is SavedBody {
  return (
    baseline?.id === payload.id &&
    baseline.revision === payload.revision &&
    (baseline.content_format ?? "html") === format
  );
}
function changedMetadata(baseline: SavedBody, payload: Draft): Partial<NoteMetadata> {
  return {
    ...(baseline.title !== payload.title ? { title: payload.title } : {}),
    ...(baseline.notebook_id !== payload.notebook_id ? { notebook_id: payload.notebook_id } : {}),
    ...(JSON.stringify(baseline.tags) !== JSON.stringify(payload.tags) ? { tags: payload.tags } : {}),
  };
}
/** Large windowed HTML bodies derive their plain text in the engine instead of the client. */
function textPlan(payload: Draft, baseline: SavedBody | null, format: BodyFormat, windowedEditor: boolean) {
  const rustText = Boolean(
    format === "html" &&
    baseline &&
    isLargeDocument(payload.content) &&
    windowedEditor &&
    (payload.windowEdit || preferredLocationMode(payload.id) === "text"),
  );
  return { rustText, text: payload.paged ? "" : payload.content, textPending: Boolean(payload.paged || rustText) };
}
async function sendPagedSave(
  payload: Draft,
  batch: EditBatch,
  metadata: NoteMetadata,
  metadataChanges: Partial<NoteMetadata>,
  format: BodyFormat,
): Promise<SaveResult> {
  const paged = payload.paged!;
  let response: Summary & { text_stats?: { words: number; chars: number } };
  if (batch.edits.length) response = await api.spliceHTMLBatch(payload.id, batch.revision, batch.edits, metadata);
  else if (Object.keys(metadataChanges).length) response = await api.patch(payload.id, metadataChanges, batch.revision);
  else {
    // No changes still require a server revision check, not a local acknowledgement.
    response = (await api.documentInfo(payload.id, batch.revision)).summary;
  }
  paged.acknowledge(batch, response.revision);
  const pagedDirty = paged.dirty;
  const textStats = "text_stats" in response ? (response.text_stats as Draft["textStats"]) : payload.textStats;
  return { saved: { ...response, content: "", text: "", content_format: format }, textStats, pagedDirty };
}
/** Sends the smallest save the baseline allows: paged batch, metadata patch, splice or whole body. */
async function sendSave(
  payload: Draft,
  baseline: SavedBody | null,
  format: BodyFormat,
  pagedBatch: EditBatch | undefined,
  rustText: boolean,
  text: string,
): Promise<SaveResult> {
  const metadata = { title: payload.title, notebook_id: payload.notebook_id, tags: payload.tags };
  const based = sameBase(baseline, payload, format);
  const canSplice =
    based &&
    baseline.title === payload.title &&
    baseline.notebook_id === payload.notebook_id &&
    JSON.stringify(baseline.tags) === JSON.stringify(payload.tags);
  const metadataChanges = based ? changedMetadata(baseline, payload) : metadata;
  if (payload.paged) return sendPagedSave(payload, pagedBatch!, metadata, metadataChanges, format);
  const unchanged = { textStats: payload.textStats, pagedDirty: false };
  if (based && baseline.content === payload.content && !canSplice) {
    return {
      ...unchanged,
      saved: { ...baseline, ...(await api.patch(payload.id, metadataChanges, payload.revision)) },
    };
  }
  if (rustText && baseline) {
    const splice =
      windowBodySplice(baseline, payload.windowEdit) ??
      (await deriveSplices({ content: baseline.content, text: "" }, { content: payload.content, text: "" })).content;
    const response = await api.spliceHTML(payload.id, payload.revision, splice, canSplice ? undefined : metadata);
    return {
      saved: { ...response, content: payload.content, text, content_format: format },
      textStats: response.text_stats,
      pagedDirty: false,
    };
  }
  if (canSplice) {
    const changes = await deriveSplices(
      { content: baseline.content, text: "" },
      { content: payload.content, text: "" },
    );
    const saved: Note = {
      ...(await api.spliceSource(payload.id, payload.revision, format, changes.content)),
      content: payload.content,
      text,
      content_format: format,
    };
    return { ...unchanged, saved };
  }
  const saved = await api.save(
    {
      id: payload.id,
      title: payload.title,
      timestamp_title: payload.isNew && payload.timestampTitle === payload.title,
      content: payload.content,
      content_format: format,
      notebook_id: payload.notebook_id,
      tags: payload.tags,
      revision: payload.revision,
    },
    { keepalive: false },
  );
  return { ...unchanged, saved };
}

export function StoreProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  // ---------- 메타 ----------
  const [info, setInfo] = useState<AppInfo | null>(null);
  const editorFlags = new URLSearchParams(location.search);
  const windowedEditor = Boolean(info?.windowed_editor || info?.lazy_editor || editorFlags.get("virtual") === "1");
  const lazyEditor = windowedEditor && Boolean(info?.lazy_editor || editorFlags.get("lazy") === "1");
  const [connError, setConnError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const t = document.documentElement.dataset.theme;
    return t === "dark" ? "dark" : "light";
  });

  // ---------- 목록 상태 ----------
  const [view, setView] = useState<View>({ type: "all" });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  // 원본처럼 폴더/태그 밖의 새 노트에 쓴다. 이미 만든 초안은 바꾸지 않는다.
  const [defaults, setDefaults] = useState<Defaults>({ notebook_id: null, tag: null });
  const defaultsRef = useRef<Defaults | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const pageCache = useRef(new Map<number, PageData>());
  const cursorsRef = useRef<(string | undefined)[]>([undefined]); // cursorsRef[n] = 페이지 n+1 커서
  const listSeq = useRef(0);
  const [listVersion, setListVersion] = useState(0); // refreshList 트리거

  // ---------- 편집 상태 ----------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [wholeBodyUndo, setWholeBodyUndo] = useState<{
    id: string;
    before: string;
    after: string;
    undone: boolean;
    kind: "replace" | "cut";
  } | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictServer, setConflictServer] = useState<Note | null>(null);
  const editorErrorRef = useRef<string | null>(null);
  // An editor whose input cannot be converted keeps the note dirty and blocks
  // save/navigation (flushNow) until the input is fixed or explicitly discarded.
  const setEditorError = useCallback((message: string | null) => {
    const had = editorErrorRef.current;
    editorErrorRef.current = message;
    if (message) {
      dirtyRef.current = true;
      setSaveError(message);
      setSaveState("error");
    } else if (had) {
      setSaveError(null);
      setSaveState((s) => (s === "error" ? "dirty" : s));
      scheduleSave();
    }
  }, []);
  const modeSwitchPending = useRef(false);
  const [modeOverride, setModeOverride] = useState<EditorMode | null>(null);
  const [editorConverting, setEditorConverting] = useState(false);

  const draftRef = useRef<Draft | null>(null);
  const savedBodyRef = useRef<(Note & { textPending?: boolean; windowEdit?: NonNullable<Draft["windowEdit"]> }) | null>(
    null,
  );
  const persistedRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const draftsCache = useRef(new Map<string, Draft>()); // 저장 실패 편집 보존
  const getSeq = useRef(0);
  const selectionRequest = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const journal = useRef<DraftJournal>();
  journal.current ??= new DraftJournal(
    rpc,
    async (before, after) => (await deriveSplices({ content: before, text: "" }, { content: after, text: "" })).content,
  );
  const journalEnabled = useRef(false);
  journalEnabled.current = Boolean(info?.draft_journal);
  const journalTimer = useRef<number | null>(null);
  const journalComposition = useRef<EventTarget | null>(null);
  const journalMounted = useRef(true);

  // ---------- 색인/역링크 ----------
  const [indexPending, setIndexPending] = useState<number | null>(null);
  const indexSupportedRef = useRef(true);
  const indexTimer = useRef<number | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkItem[] | null>(null);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [backlinksCursor,setBacklinksCursor]=useState<string|null>(null),[backlinksBusy,setBacklinksBusy]=useState(false),[backlinksError,setBacklinksError]=useState("");
  const backlinksRequest=useRef<AbortController|null>(null),backlinksGeneration=useRef(0);

  // ---------- 백업/기타 ----------
  const [importing, setImporting] = useState(false);

  // ---------- 대화상자 ----------
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogResolve = useRef<((v: unknown) => void) | null>(null);

  const confirm = useCallback((o: DialogConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      dialogResolve.current = resolve as (v: unknown) => void;
      setDialog({ kind: "confirm", options: o, resolve: resolve as (v: boolean | "extra") => void });
    });
  }, []);

  const choose = useCallback((o: DialogConfirmOptions & { extraLabel: string }) => {
    return new Promise<true | "extra" | null>((resolve) => {
      dialogResolve.current = resolve as (v: unknown) => void;
      setDialog({ kind: "confirm", options: o, resolve: resolve as (v: boolean | "extra") => void });
    });
  }, []);

  const prompt = useCallback((o: DialogPromptOptions) => {
    return new Promise<PromptResult | null>((resolve) => {
      dialogResolve.current = resolve as (v: unknown) => void;
      setDialog({ kind: "prompt", options: o, resolve });
    });
  }, []);

  const showError = useCallback((title: string, message: string) => {
    return new Promise<void>((resolve) => {
      dialogResolve.current = resolve as (v: unknown) => void;
      setDialog({ kind: "error", title, message });
    });
  }, []);

  const showImported = useCallback((count: number) => {
    setDialog({ kind: "imported", count });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    const r = dialogResolve.current;
    dialogResolve.current = null;
    if (r) r(null);
  }, []);

  // ---------- 테마 ----------
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("inkism-theme", theme);
    } catch {
      /* 비영속 환경 무시 */
    }
  }, [theme]);

  // ---------- 메타 로드 ----------
  const refreshMeta = useCallback(async () => {
    const results = await Promise.allSettled([api.notebooks(), api.tags(), api.stats(), api.defaults()]);
    if (results[0].status === "fulfilled") setNotebooks(results[0].value);
    if (results[0].status === "fulfilled" && results[3].status === "fulfilled") {
      const { notebook_id, tag } = results[3].value;
      const next = {
        notebook_id: notebook_id && results[0].value.some((nb) => nb.id === notebook_id) ? notebook_id : null,
        tag,
      };
      defaultsRef.current = next;
      setDefaults(next);
    } else if (results[3].status === "rejected") defaultsRef.current ??= { notebook_id: null, tag: null };
    if (results[1].status === "fulfilled") setTags(results[1].value);
    if (results[2].status === "fulfilled") setStats(results[2].value);
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const i = await api.info();
      setInfo(i);
      setConnError(null);
    } catch (e) {
      setConnError(e instanceof Error ? e.message : t("엔진에 연결할 수 없습니다"));
    }
  }, []);

  useEffect(() => {
    void loadInfo();
    void refreshMeta();
  }, [loadInfo, refreshMeta]);

  // ---------- 검색 디바운스 ----------
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // 검색어/뷰 변경 → 1페이지로
  useEffect(() => {
    pageCache.current.clear();
    cursorsRef.current = [undefined];
    listSeq.current++;
    setPage(1);
  }, [view, search]);

  // ---------- 목록 로드 (키셋 페이지네이션 + 순서 방어) ----------
  const loadPage = useCallback(
    async (n: number) => {
      const seq = ++listSeq.current;
      const cached = pageCache.current.get(n);
      const sort = readSort(view);
      const params: ListParams = {
        ...viewToParams(view, search),
        sort_by: sort.sortBy,
        sort_direction: sort.sortDirection,
      };
      if (cached) {
        setPageData(cached);
        setListError(null);
        setListLoading(false);
        return;
      }
      setListLoading(true);
      try {
        const cursor = cursorsRef.current[n - 1];
        const res = await api.list({ ...params, cursor, limit: PAGE_SIZE });
        if (seq !== listSeq.current) return; // 오래된 응답 폐기
        const data: PageData = { items: res.items, nextCursor: res.next_cursor };
        pageCache.current.set(n, data);
        for (const key of pageCache.current.keys()) if (Math.abs(key - n) > 1) pageCache.current.delete(key);
        cursorsRef.current[n] = res.next_cursor ?? undefined;
        cursorsRef.current.length = n + 1;
        setPageData(data);
        setListError(null);
      } catch (e) {
        if (seq !== listSeq.current) return;
        setListError(e instanceof Error ? e.message : t("목록을 불러올 수 없습니다"));
        setPageData((prev) => prev);
      } finally {
        if (seq === listSeq.current) setListLoading(false);
      }
    },
    [view, search],
  );

  useEffect(() => {
    void loadPage(page);
  }, [loadPage, page, listVersion]);

  const invalidateList = useCallback(() => {
    pageCache.current.clear();
    cursorsRef.current = [undefined];
    setListVersion((v) => v + 1);
  }, []);

  const refreshList = useCallback(() => {
    invalidateList();
    setPage(1);
  }, [invalidateList]);

  // 원격 변경은 목록에 반영하되 현재 편집 중인 draft는 덮지 않는다.
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let lastSync = 0;
    const check = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const status = await rpc<{ last_sync: number }>("sync_status");
        if (!stopped) window.dispatchEvent(new Event("inkism-sync-check"));
        if (!stopped && status.last_sync > lastSync) {
          lastSync = status.last_sync;
          if (page === 1) refreshList();
          void refreshMeta();
        }
      } catch {
        /* 연결 오류는 기존 연결 상태 UI에서 표시한다. */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void check(), 5000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refreshList, refreshMeta, page]);

  useEffect(() => {
    let stopped = false,
      busy = false;
    const check = async () => {
      const snapshot = draftRef.current;
      if (busy || !snapshot || snapshot.isNew || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const { summary } = await api.documentInfo(snapshot.id);
        const opened = draftRef.current;
        if (stopped || opened?.id !== snapshot.id || withReadonly(opened, summary) === opened) return;
        // Finish provisional paste/IME before freezing its owning editor.
        if (journalComposition.current instanceof Node && journalComposition.current.isConnected) return;
        if (!(await flushEditors())) return;
        if (journalComposition.current instanceof Node && journalComposition.current.isConnected) return;
        window.dispatchEvent(new Event("inkism-flush-editor"));
        const current = draftRef.current;
        if (stopped || current?.id !== summary.id) return;
        const next = withReadonly(current, summary);
        if (next === current) return;
        draftRef.current = next;
        setDraft(next);
        if (draftsCache.current.has(next.id)) draftsCache.current.set(next.id, next);
        setNote((prev) =>
          prev?.id === next.id
            ? { ...prev, readonly: summary.readonly ?? prev.readonly, trashed: summary.trashed ?? prev.trashed }
            : prev,
        );
      } catch {
        /* Retry after the next sync check; never replace a dirty body. */
      } finally {
        busy = false;
      }
    };
    window.addEventListener("inkism-sync-check", check);
    return () => {
      stopped = true;
      window.removeEventListener("inkism-sync-check", check);
    };
  }, []);

  // 현재 페이지 데이터만 다시 읽기 (정렬은 유지될 수 없으므로 안전하게 1페이지로)
  const bumpList = useCallback(() => {
    invalidateList();
    setPage(1);
  }, [invalidateList]);

  const goToPage = useCallback((n: number) => {
    if (n < 1) return;
    setPage(n);
  }, []);

  const retryConnection = useCallback(() => {
    void loadInfo();
    void refreshMeta();
    invalidateList();
    setListVersion((v) => v + 1);
  }, [loadInfo, refreshMeta, invalidateList]);

  // ---------- 저장 큐 (직렬화) ----------
  const startIndexPoll = useCallback(() => {
    if (!indexSupportedRef.current) return;
    if (indexTimer.current !== null) window.clearTimeout(indexTimer.current);
    const poll = async () => {
      indexTimer.current = null;
      try {
        const d = await api.indexStatus();
        const remain = d.pending ?? d.pending_jobs ?? d.jobs ?? d.remaining ?? 0;
        setIndexPending(typeof remain === "number" ? remain : 0);
        if (remain > 0) {
          indexTimer.current = window.setTimeout(poll, 1200);
        }
      } catch {
        // 엔진이 index_status를 아직 제공하지 않으면 기능을 끈다 (오류로 취급하지 않음)
        indexSupportedRef.current = false;
        setIndexPending(null);
      }
    };
    indexTimer.current = window.setTimeout(poll, 500);
  }, []);

  const scheduleJournal = useCallback((delay = 250) => {
    if (!journalMounted.current || !journalEnabled.current || journalTimer.current !== null) return;
    // A fixed checkpoint deadline also runs during continuous typing, unlike
    // the normal idle autosave. Composition stays in its existing editor queue.
    journalTimer.current = window.setTimeout(() => {
      journalTimer.current = null;
      void (async () => {
        if (journalComposition.current instanceof Node && !journalComposition.current.isConnected)
          journalComposition.current = null;
        if (!journalMounted.current || !dirtyRef.current || !journalEnabled.current || journalComposition.current)
          return;
        if (!(await flushEditors())) return;
        if (!journalMounted.current || journalComposition.current) return;
        window.dispatchEvent(new Event("inkism-flush-editor"));
        const current = draftRef.current;
        if (!current || !dirtyRef.current) return;
        const checkpoint = journal.current!.stage(current, savedBodyRef.current);
        await journal.current!.persist(checkpoint);
      })().catch((error) => {
        if (journalMounted.current && dirtyRef.current) {
          setSaveError(t("자동 복구 보관 실패: {error}", { error: errorText(error) }));
          setSaveState("error");
          scheduleJournal(1000);
        }
      });
    }, delay);
  }, []);
  useEffect(() => {
    journalMounted.current = true;
    if (journal.current?.stopped)
      journal.current = new DraftJournal(
        rpc,
        async (before, after) =>
          (await deriveSplices({ content: before, text: "" }, { content: after, text: "" })).content,
      );
    const start = (event: CompositionEvent) => {
      journalComposition.current = event.target;
    };
    const end = (event: CompositionEvent) => {
      if (journalComposition.current === event.target) {
        journalComposition.current = null;
        scheduleJournal();
      }
    };
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    return () => {
      journalMounted.current = false;
      journal.current?.stop();
      if (journalTimer.current !== null) window.clearTimeout(journalTimer.current);
      journalTimer.current = null;
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
      journalComposition.current = null;
    };
  }, [scheduleJournal]);

  /** Stages a recovery copy before saving; a full journal never blocks the save itself. */
  const stageJournal = async (payload: Draft) => {
    if (!journalEnabled.current || journalComposition.current) return undefined;
    let checkpoint: ReturnType<DraftJournal["stage"]> | undefined;
    try {
      checkpoint = journal.current!.stage(payload, savedBodyRef.current);
      await journal.current!.persist(checkpoint);
    } catch (error) {
      // A full journal must not prevent a normal note save from succeeding.
      setSaveError(t("자동 복구 보관 실패: {error}", { error: errorText(error) }));
    }
    return checkpoint;
  };
  const clearJournal = async (checkpoint: ReturnType<DraftJournal["stage"]> | undefined) => {
    if (!checkpoint) return;
    try {
      await journal.current!.clear(checkpoint);
    } catch {
      /* Startup compares the saved body before making a recovery copy. */
    }
  };
  /** Moves the open draft onto the saved revision; derived text only when the body is unchanged since. */
  const adoptSavedDraft = (
    payload: Draft,
    saved: Note,
    pagedVersion: number | undefined,
    derived: Pick<Draft, "text" | "textDirty" | "textStats">,
  ) => {
    if (draftRef.current?.id !== payload.id) return;
    draftRef.current = withReadonly(draftRef.current, saved);
    draftRef.current.revision = saved.revision;
    draftRef.current.isNew = false;
    if (payload.timestampTitle && draftRef.current.title === payload.title) draftRef.current.title = saved.title;
    draftRef.current.timestampTitle = undefined;
    if (
      draftRef.current.content === payload.content &&
      (!payload.paged || (!payload.paged.dirty && payload.paged.version === pagedVersion))
    ) {
      draftRef.current.text = derived.text;
      draftRef.current.textDirty = derived.textDirty;
      draftRef.current.textStats = derived.textStats;
    }
  };
  /** 실패: dirty를 복원하고 편집을 메모리 캐시에 보존한다. 저장 상태를 지우지 않는다. */
  const handleSaveFailure = async (e: unknown, payload: Draft, pagedBatch: EditBatch | undefined) => {
    if (payload.paged?.saving && pagedBatch) payload.paged.failed(pagedBatch);
    dirtyRef.current = true;
    draftsCache.current.set(payload.id, draftRef.current?.id === payload.id ? { ...draftRef.current } : payload);
    if (!(e instanceof RpcError && e.isConflict)) {
      setSaveState("error");
      setSaveError(errorText(e));
      return;
    }
    setSaveState("conflict");
    try {
      const server = await api.get(payload.id);
      setConflictServer(server);
      // Keep input typed during the request before applying the new permission.
      window.dispatchEvent(new Event("inkism-flush-editor"));
      const current = draftRef.current;
      if (current?.id === server.id && server.revision >= current.revision) {
        const retained = withReadonly(current, server);
        draftRef.current = retained;
        setDraft(retained);
        draftsCache.current.set(server.id, retained);
      }
    } catch {
      setConflictServer(null);
    }
  };

  const doSave = useCallback(
    async (opts: EditorFlushOptions = {}) => {
      if (!opts.editorOperation && !(await flushEditors())) return;
      window.dispatchEvent(new Event("inkism-flush-editor"));
      const d = draftRef.current;
      if (editorErrorRef.current) return;
      if (!d || !dirtyRef.current) return;
      if (savingRef.current) {
        pendingSaveRef.current = true;
        return;
      }
      savingRef.current = true;
      // 스냅샷을 저장하고 dirty를 내린다. 대기 중 새 편집이 들어오면 dirty가 다시 올라간다.
      const payload: Draft = { ...d };
      const pagedVersion = payload.paged?.version;
      dirtyRef.current = false;
      setSaveState("saving");
      setSaveError(null);
      let pagedBatch: EditBatch | undefined;
      let checkpoint: ReturnType<DraftJournal["stage"]> | undefined;
      try {
        checkpoint = await stageJournal(payload);
        if (!journalMounted.current) return;
        const baseline = savedBodyRef.current;
        const format = payload.content_format ?? "html";
        const { rustText, text, textPending } = textPlan(payload, baseline, format, windowedEditor);
        pagedBatch = payload.paged?.begin();
        const { saved, textStats, pagedDirty } = await sendSave(payload, baseline, format, pagedBatch, rustText, text);
        if (pagedDirty) {
          dirtyRef.current = true;
          pendingSaveRef.current = true;
        }
        advanceLocation(payload.id, payload.revision, saved.revision);
        advanceWindowHistory(payload.id, payload.revision, saved.revision);
        advanceSourceHistory(payload.id, payload.revision, saved.revision);
        advanceRichHistory(payload.id, payload.revision, saved.revision);
        savedBodyRef.current = { ...saved, textPending, windowEdit: payload.windowEdit };
        draftsCache.current.delete(payload.id);
        persistedRef.current = true;
        adoptSavedDraft(payload, saved, pagedVersion, { text, textDirty: textPending, textStats });
        if (!dirtyRef.current) {
          await persistHistory(payload.id, saved.revision);
          setNote(saved);
          setSaveState("saved");
          setConflictServer(null);
        } else {
          setSaveState("dirty");
        }
        setDraft((prev) => {
          // Permission-only receipts can leave React's snapshot behind the ref.
          // Publish the current draft after history persistence, never the late response.
          const current = draftRef.current;
          return prev?.id === saved.id && current?.id === saved.id ? { ...current } : prev;
        });
        await clearJournal(checkpoint);
        startIndexPoll();
        bumpList();
        void refreshMeta();
      } catch (e) {
        await handleSaveFailure(e, payload, pagedBatch);
      } finally {
        savingRef.current = false;
        if (dirtyRef.current) scheduleJournal();
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          void doSave();
        }
      }
    },
    [startIndexPoll, refreshMeta, bumpList, windowedEditor, scheduleJournal],
  );

  const scheduleSave = useCallback(() => {
    scheduleJournal();
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      void doSave();
    }, AUTOSAVE_MS);
  }, [doSave, scheduleJournal]);

  /** 즉시 저장 대기. 선택 전환/새 노트/Ctrl+S/언로드 전에 호출. */
  const flushNow = useCallback(
    async (opts: EditorFlushOptions = {}) => {
      if (!opts.editorOperation && !(await flushEditors())) return false;
      window.dispatchEvent(new Event("inkism-flush-editor"));
      if (editorErrorRef.current) return false;
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
      if (savingRef.current) {
        // 진행 중 저장이 끝날 때까지 대기 → 이후 대기 중이던 저장 실행
        while (savingRef.current) {
          await new Promise((r) => setTimeout(r, 25));
        }
      }
      if (dirtyRef.current) {
        if (opts.unload) {
          void doSave(opts);
        } else {
          await doSave(opts);
        }
      }
      while (savingRef.current) await new Promise((r) => setTimeout(r, 25));
      return !dirtyRef.current;
    },
    [doSave],
  );

  const updateDraft = useCallback(
    (
      patch: Partial<Pick<Draft, "title" | "content" | "text" | "textDirty" | "windowEdit" | "notebook_id" | "tags">>,
    ) => {
      const d = draftRef.current;
      if (!d) return;
      if (
        d.readonly &&
        ["title", "content", "text", "textDirty", "windowEdit"].some((key) => Object.hasOwn(patch, key))
      )
        throw new Error(t("읽기 전용 노트의 제목과 본문은 편집할 수 없습니다."));
      if (d.paged && patch.content !== undefined) throw new Error(t("부분 문서는 구간 저장을 사용해야 합니다."));
      const next: Draft = { ...d, ...patch };
      if (patch.content !== undefined && patch.content !== d.content) setWholeBodyUndo(null);
      if (d.paged && patch.textDirty) next.textStats = undefined;
      if (patch.content !== undefined) {
        next.textStats = undefined;
        next.windowEdit = patch.windowEdit;
      }
      draftRef.current = next;
      setDraft(next);
      dirtyRef.current = true;
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
      draftsCache.current.set(next.id, next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const changePaged = useCallback(
    (edit: BodySplice) => {
      const d = draftRef.current;
      if (!d?.paged) return;
      if (d.readonly) throw new Error(t("읽기 전용 노트의 본문은 편집할 수 없습니다."));
      setWholeBodyUndo(null);
      d.paged.append(edit);
      updateDraft({ textDirty: true });
    },
    [updateDraft],
  );

  const stageWholeBody = useCallback(
    (
      expected: Draft,
      revision: number,
      version: number | undefined,
      content: string,
      before?: string,
      kind: "replace" | "cut" = "replace",
    ) => {
      window.dispatchEvent(new Event("inkism-flush-editor"));
      const current = draftRef.current;
      if (current !== expected || current.revision !== revision || current.paged?.version !== version)
        throw new Error(
          kind === "cut"
            ? t("복사하는 동안 문서가 변경되어 잘라내기를 취소했습니다.")
            : t("편집 내용이 변경되어 전체 바꾸기를 취소했습니다."),
        );
      if (current.readonly) throw new Error(t("읽기 전용 노트의 본문은 편집할 수 없습니다."));
      forgetLocation(current.id);
      forgetWindowHistory(current.id);
      forgetSourceHistory(current.id);
      forgetRichHistory(current.id);
      const next: Draft = {
        ...current,
        content,
        text: "",
        textDirty: true,
        textStats: undefined,
        paged: undefined,
        windowEdit: undefined,
      };
      if (before !== undefined) setWholeBodyUndo({ id: current.id, before, after: content, undone: false, kind });
      draftRef.current = next;
      setDraft(next);
      savedBodyRef.current = null;
      draftsCache.current.set(next.id, next);
      dirtyRef.current = true;
      setSaveState("dirty");
      setSaveError(null);
      setEditorGeneration((value) => value + 1);
      scheduleSave();
    },
    [scheduleSave],
  );

  const toggleWholeBodyUndo = useCallback(() => {
    window.dispatchEvent(new Event("inkism-flush-editor"));
    const current = draftRef.current,
      h = wholeBodyUndo;
    if (!current || !h || savingRef.current) return;
    if (current.id !== h.id || current.paged || current.content !== (h.undone ? h.before : h.after)) {
      setWholeBodyUndo(null);
      return;
    }
    stageWholeBody(current, current.revision, undefined, h.undone ? h.after : h.before);
    setWholeBodyUndo({ ...h, undone: !h.undone });
  }, [wholeBodyUndo, stageWholeBody]);
  useEffect(() => {
    setWholeBodyUndo(null);
  }, [selectedId]);

  // ---------- 노트 선택 ----------
  const applyDraftFromNote = useCallback((n: Note, paged?: PagedEditQueue) => {
    setEditorGeneration((value) => value + 1);
    savedBodyRef.current = n;
    persistedRef.current = true;
    const d: Draft = {
      id: n.id,
      title: n.title,
      content: n.content,
      content_format: n.content_format ?? "html",
      readonly: editLocked(n),
      readonlyRevision: n.revision,
      text: n.text,
      notebook_id: n.notebook_id,
      tags: [...n.tags],
      revision: n.revision,
      isNew: false,
      textDirty: Boolean(paged),
      paged,
    };
    draftRef.current = d;
    setDraft(d);
    dirtyRef.current = false;
    setSaveState("idle");
    setSaveError(null);
    setConflictServer(null);
  }, []);

  /** Shows a freshly loaded note, preferring local edits kept after a failed save. */
  const showLoadedNote = (id: string, n: Note, paged: PagedEditQueue | undefined, textByDefault: boolean) => {
    setNote(n);
    // 저장 실패로 보존해 둔 로컬 편집이 있으면 서버 내용 대신 그것을 복원한다.
    const cached = draftsCache.current.get(id);
    if (cached) {
      draftRef.current = withReadonly({ ...cached }, n);
      setDraft(draftRef.current);
      savedBodyRef.current = n;
      dirtyRef.current = true;
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
      scheduleSave();
    } else {
      applyDraftFromNote(n, paged);
    }
    if (textByDefault && (n.content_format ?? "html") === "html" && (paged || isLargeDocument(n.content)))
      setModeOverride("text");
  };
  const showLoadError = (e: unknown) => {
    setNote(null);
    setSaveError(e instanceof Error ? e.message : t("노트를 불러올 수 없습니다"));
    setSaveState("error");
  };

  const selectNote = useCallback(
    async (id: string | null) => {
      const request = ++selectionRequest.current;
      if (selectedIdRef.current === id && id !== null) return;
      if (!(await flushNow())) return;
      if (request !== selectionRequest.current) return;
      getSeq.current++;
      const seq = getSeq.current;
      selectedIdRef.current = id;
      setSelectedId(id);
      setNote(null);
      setDraft(null);
      draftRef.current = null;
      savedBodyRef.current = null;
      setModeOverride(null);
      setBacklinks(null);
      setIndexPending(null);
      if (id === null) return;
      setDraftLoading(true);
      const stale = () => seq !== getSeq.current;
      try {
        const appInfo = info ?? (await api.info());
        const { useWindowed, lazyWindow, preferred } = openPlan(id, appInfo, windowedEditor, lazyEditor);
        const loaded = await loadNoteBody(id, lazyWindow, stale);
        if (!loaded || stale() || selectedIdRef.current !== id) return; // 이미 다른 노트로 이동함
        showLoadedNote(id, loaded.n, loaded.paged, useWindowed && !preferred);
      } catch (e) {
        if (!stale()) showLoadError(e);
      } finally {
        if (seq === getSeq.current) setDraftLoading(false);
      }
    },
    [flushNow, applyDraftFromNote, scheduleSave, info, windowedEditor, lazyEditor],
  );

  /** Reload an externally saved source without dropping input made while fetching. */
  const reloadCurrentNote = useCallback(async (expectedId: string) => {
    if (selectedIdRef.current !== expectedId) return true;
    const request = ++selectionRequest.current;
    // Pending edits against the previous revision must save or remain as a conflict.
    if (!(await flushNow())) return false;
    if (request !== selectionRequest.current || selectedIdRef.current !== expectedId) return false;
    const baseline = draftRef.current;
    if (!baseline || dirtyRef.current || hasPendingEditorInput()) return false;
    const seq = ++getSeq.current;
    const stale = () => seq !== getSeq.current || request !== selectionRequest.current || selectedIdRef.current !== expectedId;
    const appInfo = info ?? (await api.info());
    if (stale()) return false;
    const { useWindowed, lazyWindow, preferred } = openPlan(expectedId, appInfo, windowedEditor, lazyEditor);
    const loaded = await loadNoteBody(expectedId, lazyWindow, stale);
    // Do not clear the old editor before fetching. Any input, queued input, save,
    // navigation or draft replacement during the request invalidates this reload.
    if (!loaded || stale() || draftRef.current !== baseline || dirtyRef.current || hasPendingEditorInput()) return false;
    showLoadedNote(expectedId, loaded.n, loaded.paged, useWindowed && !preferred);
    return true;
  }, [flushNow, info, windowedEditor, lazyEditor, applyDraftFromNote, scheduleSave]);

  const newNote = useCallback(async (title = "", timestampTitle = false) => {
    const request = ++selectionRequest.current;
    if (!(await flushNow())) return;
    // 시작 직후에도 기본값을 놓치지 않게 초안을 만들기 전에만 기다린다.
    if (!defaultsRef.current) await refreshMeta();
    if (request !== selectionRequest.current) return;
    getSeq.current++;
    const id = crypto.randomUUID();
    const d: Draft = {
      id,
      title,
      timestampTitle: timestampTitle ? title : undefined,
      content: "",
      content_format: defaultEditor(),
      text: "",
      notebook_id: view.type === "notebook" ? view.id : (defaultsRef.current?.notebook_id ?? null),
      tags: newNoteTags(view, defaultsRef.current),
      revision: 0,
      isNew: true,
      textDirty: false,
    };
    selectedIdRef.current = id;
    setSelectedId(id);
    setNote(null);
    draftRef.current = d;
    savedBodyRef.current = null;
    setDraft(d);
    persistedRef.current = false;
    dirtyRef.current = Boolean(title);
    setSaveState(title ? "dirty" : "idle");
    setSaveError(null);
    setConflictServer(null);
    setModeOverride("text");
    setBacklinks(null);
    setDraftLoading(false);
    if (title) scheduleSave();
  }, [flushNow, view, refreshMeta, scheduleSave]);

  const changeDefaults = useCallback(
    async (changes: Partial<Defaults>) => {
      try {
        await api.setDefaults(changes);
      } catch (e) {
        void showError(t("기본값 변경 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
      await refreshMeta();
    },
    [refreshMeta, showError],
  );

  // 새 노트를 편집하지 않고 떠나면 흔적을 남기지 않는다.
  useEffect(() => {
    if (draft?.isNew && !dirtyRef.current) {
      // 그대로 둔다: 첫 편집 시 저장된다.
    }
  }, [draft]);

  // ---------- 모드 ----------
  const largeDoc = draft ? Boolean(draft.paged) || isLargeDocument(draft.content) : false;
  const mode: EditorMode =
    modeOverride ??
    ((draft?.content_format ?? "html") === "html"
      ? (preferredLocationMode(draft?.id ?? "") ?? "text")
      : draft?.content_format === "markdown"
        ? (preferredLocationMode(draft.id) ?? (defaultEditor() === "markdown" ? "text" : "markdown"))
        : (draft?.content_format ?? "html"));
  const setMode = useCallback(
    async (target: EditorMode) => {
      if (modeSwitchPending.current) return;
      const current = draftRef.current;
      if (!current || mode === target) return;
      modeSwitchPending.current = true;
      let ownsSave = false;
      const readSource = async (snapshot: Draft) => {
        if (!snapshot.paged) return snapshot;
        // A source view needs the complete saved body. Never replace input or
        // metadata that arrived while this explicit read was in flight.
        const version = snapshot.paged.version,
          request = selectionRequest.current;
        const n = await api.get(snapshot.id);
        window.dispatchEvent(new Event("inkism-flush-editor"));
        const latest = draftRef.current;
        if (request !== selectionRequest.current || latest?.id !== snapshot.id)
          throw new Error(t("노트가 변경되어 모드 전환을 중단했습니다."));
        if (latest !== snapshot || latest.paged?.version !== version || dirtyRef.current)
          throw new Error(t("편집 중인 내용을 유지했습니다. 모드 전환을 다시 시도해 주세요."));
        if (n.revision !== snapshot.revision) throw new Error(t("문서가 변경되었습니다. 다시 열어 주세요."));
        setNote(n);
        applyDraftFromNote(n);
        return draftRef.current!;
      };
      /** A lazy HTML note whose history needs the paged window reopens through it before TEXT. */
      const openPagedText = async (d: Draft): Promise<Draft> => {
        if (
          !lazyEditor ||
          d.paged ||
          d.isNew ||
          (d.content_format ?? "html") !== "html" ||
          !needsPagedWindowHistory(d.id, d.revision)
        )
          return d;
        const snapshot = d,
          request = selectionRequest.current;
        let opening = await api.documentInfo(d.id);
        const deadline = Date.now() + 60000;
        while (!opening.ready && Date.now() < deadline) {
          if (draftRef.current !== snapshot || dirtyRef.current || request !== selectionRequest.current)
            throw new Error(t("편집 중인 내용을 유지했습니다. 모드 전환을 다시 시도해 주세요."));
          await new Promise((resolve) => setTimeout(resolve, 100));
          opening = await api.documentInfo(d.id);
        }
        if (
          draftRef.current !== snapshot ||
          dirtyRef.current ||
          request !== selectionRequest.current ||
          opening.revision !== snapshot.revision
        )
          throw new Error(t("문서가 변경되어 모드 전환을 중단했습니다."));
        if (!opening.ready) throw new Error(t("문서를 준비 중입니다. 잠시 후 다시 시도해 주세요."));
        const pagedNote = { ...opening.summary, content: "", text: "" };
        setNote(pagedNote);
        applyDraftFromNote(pagedNote, new PagedEditQueue(opening.revision, opening.total_bytes!));
        return draftRef.current!;
      };
      /** Switches between views of the same source; never converts or reinterprets it. */
      const showView = async (source: Draft) => {
        const d = target === "text" ? await openPagedText(source) : await readSource(source);
        // TEXT is the visual view of an HTML document, not a plain-text format.
        // Viewing never calls convert_content or silently reinterprets source.
        if (target === "text" && d.isNew && !d.content && !d.title && d.content_format !== "markdown") {
          const next = { ...d, content_format: "html" as const };
          draftRef.current = next;
          setDraft(next);
        }
        setModeOverride(target);
        rememberLocation(d.id, { revision: d.revision, kind: LOCATION_KIND[target], offset: 0 });
      };
      /** Asks, then changes the stored source format; edits typed meanwhile stay dirty. */
      const convertFormat = async (source: Draft) => {
        if (source.isNew && !source.content && !source.title) {
          const next = { ...source, content_format: target };
          draftRef.current = next;
          setDraft(next);
          setModeOverride(target);
          return;
        }
        const revision = source.revision;
        if (source.readonly) throw new Error(t("읽기 전용 노트의 원문 형식은 변경할 수 없습니다."));
        const label = { text: t("텍스트"), html: "HTML", markdown: "MARKDOWN" }[target];
        if (
          !(await confirm({
            title: t("원문 형식 변경"),
            message: t(
              "원문을 그대로 보관하고 {label} 형식으로 지정합니다. 미리보기와 내보내기의 해석만 달라집니다. 원래 형식과 내용은 버전 기록에 보관됩니다.",
              { label },
            ),
            confirmLabel: t("형식 변경"),
            cancelLabel: t("취소"),
          }))
        )
          return;
        if (draftRef.current?.id !== source.id || draftRef.current.revision !== revision) return;
        const d = await readSource(source);
        savingRef.current = true;
        ownsSave = true;
        setSaveState("saving");
        const saved = await api.convertContent(d.id, revision, target);
        window.dispatchEvent(new Event("inkism-flush-editor"));
        if (draftRef.current?.id !== d.id) return;
        const newer = { ...draftRef.current };
        const changed =
          newer.content !== d.content ||
          newer.title !== d.title ||
          newer.notebook_id !== d.notebook_id ||
          JSON.stringify(newer.tags) !== JSON.stringify(d.tags);
        forgetSourceHistory(d.id);
        forgetRichHistory(d.id);
        forgetWindowHistory(d.id);
        forgetLocation(d.id);
        setNote(saved);
        applyDraftFromNote(saved);
        setModeOverride(target);
        if (changed) {
          const retained = { ...newer, revision: saved.revision, content_format: saved.content_format ?? target };
          draftRef.current = retained;
          setDraft(retained);
          dirtyRef.current = true;
          setSaveState("dirty");
        }
        bumpList();
      };
      try {
        if (!(await flushNow())) return;
        const d = draftRef.current;
        if (d?.id !== current.id) return;
        // 서식 노트(HTML)의 MARKDOWN은 같은 내용을 Markdown으로 보여 주고 고치는 '보기'다.
        // 원문 형식은 HTML 그대로 두고(변환·확인 대화상자 없음), Markdown 편집은 HTML로 바꿔 저장한다.
        const markdownView = target === "markdown" && (d.content_format ?? "html") === "html";
        if (target === "text" || markdownView || (d.content_format ?? "html") === target) await showView(d);
        else await convertFormat(d);
      } catch (e) {
        await showError(t("원문 형식 변경 실패"), errorText(e));
      } finally {
        modeSwitchPending.current = false;
        if (ownsSave) {
          savingRef.current = false;
          pendingSaveRef.current = false;
          if (dirtyRef.current) scheduleSave();
        }
      }
    },
    [mode, flushNow, confirm, showError, applyDraftFromNote, bumpList, scheduleSave, lazyEditor],
  );

  const convertEditorCompatibility = useCallback(async () => {
    if (modeSwitchPending.current) return;
    modeSwitchPending.current = true;
    let ownsSave=false;
    try {
      if (!(await flushNow())) return;
      setEditorConverting(true);
      let d = draftRef.current;
      if (!d) return;
      if (d.readonly) throw new Error(t("읽기 전용 노트의 원문 형식은 변경할 수 없습니다."));
      const target: EditorCompatibility = d.content_format === "markdown" ? "html" : "markdown";
      if (d.isNew && !d.content && !d.title) {
        const next = { ...d, content_format: target };
        draftRef.current = next; setDraft(next); setModeOverride("text");
        setEditorGeneration(value=>value+1);
        return;
      }
      if (d.paged) {
        const before=d,source=await api.get(d.id);
        window.dispatchEvent(new Event("inkism-flush-editor"));
        if(draftRef.current!==before||dirtyRef.current||source.revision!==before.revision)
          throw new Error(t("편집 중인 내용을 유지했습니다. 모드 전환을 다시 시도해 주세요."));
        applyDraftFromNote(source);d=draftRef.current!;
      }
      const snapshot=d;
      const {compatibleHTMLMarkdown,compatibleMarkdownHTML}=await import("./lib/markdown-compatible");
      if(draftRef.current!==snapshot||dirtyRef.current)
        throw new Error(t("편집 중인 내용을 유지했습니다. 모드 전환을 다시 시도해 주세요."));
      const content=target==="markdown"
        ? snapshot.content_format==="text"
          ? (await import("./lib/markdown")).sourceToMarkdown(snapshot.content,"text")
          : compatibleHTMLMarkdown(snapshot.content)
        : compatibleMarkdownHTML(snapshot.content);
      if(target==="markdown")compatibleMarkdownHTML(content);
      if(draftRef.current!==snapshot||dirtyRef.current)
        throw new Error(t("편집 중인 내용을 유지했습니다. 모드 전환을 다시 시도해 주세요."));
      savingRef.current=true;ownsSave=true;setSaveState("saving");
      const saved=await api.convertContent(snapshot.id,snapshot.revision,target,content);
      if(draftRef.current?.id!==snapshot.id)return;
      forgetSourceHistory(saved.id);forgetRichHistory(saved.id);forgetWindowHistory(saved.id);forgetLocation(saved.id);
      setNote(saved);applyDraftFromNote(saved);setModeOverride("text");bumpList();
    } catch(e) {if(ownsSave)setSaveState(dirtyRef.current?"dirty":"idle");await showError(t("에디터 변환 실패"),errorText(e));}
    finally {
      setEditorConverting(false);modeSwitchPending.current=false;
      if(ownsSave){savingRef.current=false;pendingSaveRef.current=false;if(dirtyRef.current)scheduleSave();}
    }
  },[flushNow,applyDraftFromNote,showError,bumpList,scheduleSave]);

  const makeRichCopy = useCallback(async () => {
    if (modeSwitchPending.current) return;
    modeSwitchPending.current = true;
    try {
      if (!(await flushNow())) return;
      const d = draftRef.current;
      if (!d || d.isNew) return;
      const snapshot = { ...d, tags: [...d.tags] },
        request = selectionRequest.current;
      const unchanged = () => {
        window.dispatchEvent(new Event("inkism-flush-editor"));
        const current = draftRef.current;
        return (
          request === selectionRequest.current &&
          current?.id === snapshot.id &&
          current.revision === snapshot.revision &&
          current.content === snapshot.content &&
          current.title === snapshot.title &&
          current.notebook_id === snapshot.notebook_id &&
          JSON.stringify(current.tags) === JSON.stringify(snapshot.tags)
        );
      };
      if (
        !(await confirm({
          title: t("서식 편집 사본 만들기"),
          message: t(
            "원래 노트의 내용과 형식은 유지합니다. 지원하는 서식으로 별도 HTML 사본을 만듭니다. 원문의 일부 태그·주석·표기는 사본에서 정규화될 수 있습니다.",
          ),
          confirmLabel: t("사본 만들기"),
          cancelLabel: t("취소"),
        }))
      )
        return;
      if (!unchanged()) throw new Error(t("노트가 변경되어 사본 만들기를 중단했습니다. 다시 시도해 주세요."));
      const rendered = await api.documentRender(snapshot.id, snapshot.revision);
      const { canonicalRichHTML } = await import("./lib/rich-document");
      const content = canonicalRichHTML(rendered.html);
      if (!unchanged()) throw new Error(t("노트가 변경되어 사본 만들기를 중단했습니다. 다시 시도해 주세요."));
      const copied = await api.save({
        id: crypto.randomUUID(),
        title: Array.from(snapshot.title).slice(0, 1980).join("") + " (서식 편집 사본)",
        content,
        content_format: "html",
        notebook_id: snapshot.notebook_id,
        tags: snapshot.tags,
      });
      bumpList();
      void refreshMeta();
      if (!unchanged()) {
        await showError(
          t("사본 저장됨"),
          t(
            "사본은 저장했습니다. 작업 중 원래 노트가 바뀌어 편집 화면을 유지합니다. 노트 목록에서 사본을 열 수 있습니다.",
          ),
        );
        return;
      }
      await selectNote(copied.id);
      if (draftRef.current?.id === copied.id) {
        setModeOverride("text");
        rememberLocation(copied.id, { revision: copied.revision, kind: "rich", offset: 0 });
      }
    } catch (error) {
      await showError(t("서식 사본 만들기 실패"), error instanceof Error ? error.message : String(error));
    } finally {
      modeSwitchPending.current = false;
    }
  }, [flushNow, confirm, showError, bumpList, refreshMeta, selectNote]);

  useEffect(() => {
    const dirty = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.editorId && event.detail.editorId !== draftRef.current?.id)
        return;
      dirtyRef.current = true;
      setSaveState("dirty");
      scheduleSave();
    };
    const pending = (event: Event) => {
      if (hasPendingEditorInput()) {
        setSaveState("dirty");
        if (!(event instanceof CustomEvent) || event.detail?.autosave !== false) scheduleSave();
      } else if (dirtyRef.current) scheduleSave();
      else if (!savingRef.current) setSaveState("saved");
    };
    window.addEventListener("inkism-editor-dirty", dirty);
    window.addEventListener("inkism-editor-pending", pending);
    return () => {
      window.removeEventListener("inkism-editor-dirty", dirty);
      window.removeEventListener("inkism-editor-pending", pending);
    };
  }, [scheduleSave]);

  // ---------- 언로드 전 저장 ----------
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current || hasPendingEditorInput()) {
        void flushNow({ unload: true });
        e.preventDefault();
      }
    };
    const pagehide = () => {
      if (dirtyRef.current || hasPendingEditorInput()) void flushNow({ unload: true });
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", pagehide);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [flushNow]);

  useEffect(() => {
    const handler = () => {
      void (async () => {
        if (!(await flushNow())) return;
        try {
          await flushWorkspaceForClose();
          await closeAfterSave();
        } catch (e) {
          setSaveError(errorText(e));
          setSaveState("error");
        }
      })();
    };
    window.addEventListener("native-close-request", handler);
    const background = () => {
      if (document.visibilityState === "hidden") void flushNow();
    };
    document.addEventListener("visibilitychange", background);
    return () => {
      window.removeEventListener("native-close-request", handler);
      document.removeEventListener("visibilitychange", background);
    };
  }, [flushNow]);

  // ---------- 노트 작업 ----------
  const patchSelected = useCallback(
    async (changes: Record<string, unknown>, targetId?: string, targetRevision?: number) => {
      const id = targetId ?? selectedIdRef.current;
      if (!id) return;
      try {
        const revision = draftRef.current?.id === id ? draftRef.current.revision : targetRevision;
        const updated = await api.patch(id, changes, revision);
        window.dispatchEvent(new Event("inkism-flush-editor"));
        if (revision !== undefined) {
          advanceLocation(id, revision, updated.revision);
          advanceWindowHistory(id, revision, updated.revision);
          advanceSourceHistory(id, revision, updated.revision);
          advanceRichHistory(id, revision, updated.revision);
          if (!dirtyRef.current) await persistHistory(id, updated.revision);
        }
        setNote((prev) => (prev?.id === id ? { ...prev, ...updated } : prev));
        const baseline = savedBodyRef.current;
        if (baseline?.id === id && baseline.revision === revision) savedBodyRef.current = { ...baseline, ...updated };
        if (draftRef.current?.id === id) {
          draftRef.current.paged?.metadataRevision(revision!, updated.revision);
          draftRef.current = { ...withReadonly(draftRef.current, updated), revision: updated.revision };
          // Menu edits of membership/tags must not be reverted by the next draft save.
          if ("tags" in changes || "notebook_ids" in changes || "notebook_id" in changes)
            draftRef.current = { ...draftRef.current, tags: updated.tags, notebook_id: updated.notebook_id };
          setDraft(draftRef.current);
        }
        bumpList();
        void refreshMeta();
        return updated;
      } catch (e) {
        await showError(t("작업 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
        return undefined;
      }
    },
    [bumpList, refreshMeta, showError],
  );

  const patchNote = useCallback(
    async (changes: Record<string, unknown>) => {
      if (!(await flushNow())) return;
      await patchSelected(changes);
    },
    [patchSelected, flushNow],
  );

  const patchNoteById = useCallback(
    async (id: string, changes: Record<string, unknown>, revision?: number) => {
      if (!(await flushNow())) return false;
      return Boolean(await patchSelected(changes, id, revision));
    },
    [patchSelected, flushNow],
  );

  const setReminder = useCallback(
    async (id: string, at: number | null, revision?: number, repeat?: number | null): Promise<boolean> => {
      if (at !== null && (!Number.isFinite(at) || at <= Date.now())) return false;
      if (!(await flushNow())) return false;
      if (savingRef.current) return false;
      if (selectedIdRef.current === id ? !persistedRef.current : revision === undefined) return false;
      savingRef.current = true;
      setSaveState("saving");
      try {
        const changes: Record<string, unknown> = { reminder_at: at };
        if (repeat !== undefined) changes.reminder_repeat_hours = repeat;
        if (at === null) changes.reminder_repeat_hours = null;
        const updated = await patchSelected(changes, id, revision);
        if (updated) window.dispatchEvent(new Event("inkism-reminders-changed"));
        return !!updated;
      } finally {
        savingRef.current = false;
        pendingSaveRef.current = false;
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        if (dirtyRef.current) scheduleSave();
      }
    },
    [flushNow, patchSelected, scheduleSave],
  );

  /** 메뉴 작업 전 저장 보장. 아직 한 번도 저장되지 않았으면 false. */
  const ensurePersisted = useCallback(async (): Promise<boolean> => {
    if (!(await flushNow())) return false;
    return persistedRef.current;
  }, [flushNow]);

  const openHistory = useCallback((historyId?: string) => {
    const id = selectedIdRef.current;
    if (id) setDialog({ kind: "history", noteId: id, historyId });
  }, []);

  const trashSelected = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    if (!(await flushNow())) return;
    await patchSelected({ trashed: true });
  }, [flushNow, patchSelected]);

  const restoreSelected = useCallback(async () => {
    await patchSelected({ trashed: false, archived: false });
  }, [patchSelected]);

  const deleteSelectedForever = useCallback(async () => {
    const id = selectedIdRef.current;
    const target = note;
    if (!id || !target) return;
    const ok = await confirm({
      title: t("영구 삭제"),
      message: t('"{title}" 노트를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.', {
        title: target.title || t("제목 없음"),
      }),
      confirmLabel: t("영구 삭제"),
      danger: true,
    });
    if (!ok) return;
    try {
      if (!(await flushNow())) return;
      await api.delete(id);
      forgetWindowHistory(id);
      forgetSourceHistory(id);
      forgetRichHistory(id);
      window.dispatchEvent(new CustomEvent("inkism-note-deleted", { detail: id }));
      selectedIdRef.current = null;
      setSelectedId(null);
      setNote(null);
      setDraft(null);
      draftRef.current = null;
      bumpList();
      void refreshMeta();
    } catch (e) {
      await showError(t("삭제 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
    }
  }, [note, confirm, flushNow, bumpList, refreshMeta, showError]);

  const quickRestore = useCallback(
    async (id: string) => {
      try {
        await api.patch(id, { trashed: false, archived: false });
        bumpList();
        void refreshMeta();
      } catch (e) {
        await showError(t("복원 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
    },
    [bumpList, refreshMeta, showError],
  );

  const quickDelete = useCallback(
    async (id: string, confirmed = false) => {
      const ok = confirmed || await confirm({
        title: t("영구 삭제"),
        message: t("이 노트를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다."),
        confirmLabel: t("영구 삭제"),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.delete(id);
        forgetWindowHistory(id);
        forgetSourceHistory(id);
        forgetRichHistory(id);
        window.dispatchEvent(new CustomEvent("inkism-note-deleted", { detail: id }));
        if (selectedIdRef.current === id) {
          selectedIdRef.current = null;
          setSelectedId(null);
          setNote(null);
          setDraft(null);
          draftRef.current = null;
        }
        bumpList();
        void refreshMeta();
      } catch (e) {
        await showError(t("삭제 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
    },
    [confirm, bumpList, refreshMeta, showError],
  );

  // ---------- 버전 기록 ----------

  const restoreVersion = useCallback(
    async (historyId: string) => {
      const id = selectedIdRef.current;
      if (!id) return;
      const ok = await confirm({
        title: t("버전 복원"),
        message: t("이 버전으로 노트를 복원할까요? 복원 전 현재 내용이 저장됩니다."),
        confirmLabel: t("복원"),
      });
      if (!ok) return;
      if (!(await flushNow())) return;
      const baseline=draftRef.current;
      if(baseline?.id!==id)return;
      const expected={title:baseline.title,content:baseline.content,revision:baseline.revision,pagedVersion:baseline.paged?.version};
      savingRef.current=true;
      try {
        const restored = await api.restore(id, historyId, expected.revision);
        if (selectedIdRef.current === id && draftRef.current?.id===id) {
          const live=draftRef.current;
          if(live.title!==expected.title||live.content!==expected.content||live.paged?.version!==expected.pagedVersion){
            dirtyRef.current=true;setSaveState("dirty");bumpList();
            await showError(t("버전 복원"),t("버전은 복원되었습니다. 응답을 기다리는 동안 입력한 내용은 보존했으니 저장 충돌을 먼저 해결하세요."));
            return;
          }
          setNote(restored);
          forgetWindowHistory(restored.id);
          forgetSourceHistory(restored.id);
          forgetRichHistory(restored.id);
          applyDraftFromNote(restored);
          setModeOverride(null);
        }
        bumpList();
      } catch (e) {
        await showError(t("복원 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      } finally {
        savingRef.current=false;pendingSaveRef.current=false;
        if(dirtyRef.current)scheduleSave();
      }
    },
    [confirm, flushNow, applyDraftFromNote, bumpList, showError, scheduleSave],
  );

  // ---------- 충돌 해결 ----------
  const keepLocalVersion = useCallback(async () => {
    const server = conflictServer;
    const d = draftRef.current;
    if (!server || !d) return;
    forgetWindowHistory(d.id);
    forgetSourceHistory(d.id);
    forgetRichHistory(d.id);
    if (d.paged) {
      window.dispatchEvent(new Event("inkism-flush-editor"));
      const queue = d.paged;
      if (queue.saving) return;
      const version = queue.version;
      const snapshot = queue.snapshot();
      try {
        const base = await api.revisionBody(d.id, snapshot.revision);
        const content = applyHtmlEdits(base.content, snapshot.edits);
        const text = await deriveTextInWorker(content);
        const current = draftRef.current;
        // A delayed reply must not replace new input, another note or a server selection.
        if (
          current?.id !== d.id ||
          current.paged !== queue ||
          queue.version !== version ||
          queue.revision !== snapshot.revision
        )
          return;
        const restored: Draft = {
          ...current,
          content,
          text,
          textDirty: false,
          paged: undefined,
          windowEdit: undefined,
          textStats: undefined,
          revision: server.revision,
        };
        savedBodyRef.current = null;
        draftRef.current = restored;
        setDraft(restored);
        draftsCache.current.set(d.id, restored);
        dirtyRef.current = true;
        setConflictServer(null);
        setSaveState("dirty");
        void doSave();
      } catch (error) {
        if (draftRef.current?.paged === queue)
          setSaveError(error instanceof Error ? error.message : t("내 편집을 복원하지 못했습니다."));
      }
      return;
    }
    draftRef.current = { ...d, revision: server.revision };
    setDraft((prev) => (prev ? { ...prev, revision: server.revision } : prev));
    setConflictServer(null);
    setSaveState("dirty");
    void doSave();
  }, [conflictServer, doSave]);

  const useServerVersion = useCallback(() => {
    const server = conflictServer;
    if (!server) return;
    if (journalEnabled.current)
      void journal.current!.discard(server.id).catch((error) => {
        setSaveError(t("자동 복구 보관 정리 실패: {error}", { error: errorText(error) }));
      });
    forgetWindowHistory(server.id);
    forgetSourceHistory(server.id);
    forgetRichHistory(server.id);
    setNote(server);
    applyDraftFromNote(server);
    draftsCache.current.delete(server.id);
    setConflictServer(null);
    setSaveState("saved");
    bumpList();
  }, [conflictServer, applyDraftFromNote, bumpList]);

  const retrySave = useCallback(() => {
    setSaveState("dirty");
    setSaveError(null);
    void doSave();
  }, [doSave]);

  /** Save state after a metadata operation that held the save lock. */
  const settledSaveState = (): SaveState => {
    if (dirtyRef.current) return "dirty";
    return draftRef.current && !draftRef.current.isNew ? "saved" : "idle";
  };
  /** Applies a server metadata change (tags, notebook) to the open draft and its revision chain. */
  const adoptMetadataSummary = async (d: Draft, summary: Summary, revision: number, patch: Partial<Draft>) => {
    d.paged?.metadataRevision(revision, summary.revision);
    draftRef.current = { ...d, ...patch, revision: summary.revision };
    setDraft(draftRef.current);
    const baseline = savedBodyRef.current;
    if (baseline?.id === summary.id && baseline.revision === revision)
      savedBodyRef.current = { ...baseline, ...summary };
    setNote((prev) => (prev?.id === summary.id ? { ...prev, ...summary } : prev));
    advanceLocation(summary.id, revision, summary.revision);
    advanceWindowHistory(summary.id, revision, summary.revision);
    advanceSourceHistory(summary.id, revision, summary.revision);
    advanceRichHistory(summary.id, revision, summary.revision);
    if (!dirtyRef.current) await persistHistory(summary.id, summary.revision);
  };

  const performTagChange = useCallback(async(action:(currentId?:string,currentRevision?:number)=>Promise<TagChangeResult>)=>{
    if(!await flushNow())throw new Error(t("먼저 노트를 저장해 주세요."));
    const baseline=draftRef.current,revision=baseline?.revision;
    savingRef.current=true;setSaveState('saving');
    try{
      const response=await action(baseline?.isNew?undefined:baseline?.id,baseline?.isNew?undefined:revision);
      const summary=response.current,d=draftRef.current;
      if(summary&&d?.id===summary.id&&d.revision===revision){
        const tagsChanged=JSON.stringify(d.tags)!==JSON.stringify(baseline?.tags);
        if(tagsChanged)throw new Error(t("변경은 저장했습니다. 현재 편집 내용을 보존하기 위해 노트를 다시 불러오지 않았습니다."));
        await adoptMetadataSummary(d,summary,revision!,{tags:summary.tags});
      }
      bumpList();void refreshMeta();startIndexPoll();return response;
    }finally{savingRef.current=false;pendingSaveRef.current=false;setSaveState(settledSaveState());if(dirtyRef.current)scheduleSave();}
  },[flushNow,bumpList,refreshMeta,startIndexPoll,scheduleSave]);
  const renameTag = useCallback(
    async (name: string) => {
      const result = await prompt({
        title: t("태그 이름 변경"),
        message: t("모든 노트의 태그 이름을 바꿉니다. 같은 이름의 태그가 있으면 합칩니다."),
        label: t("태그 이름"),
        initial: name,
        confirmLabel: t("변경"),
      });
      const replacement = result?.value.trim();
      if (replacement && replacement !== name) requestTagChange({name,replacement});
    },
    [prompt],
  );
  const removeTag = useCallback((name:string)=>{requestTagChange({name,replacement:null});return Promise.resolve();},[]);
  const setTagColor = useCallback(
    async (name: string, color: string | null) => {
      try {
        await api.setTagColor(name, color);
        await refreshMeta();
      } catch (e) {
        await showError(t("색 변경 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
    },
    [refreshMeta, showError],
  );

  // ---------- 폴더 관리 ----------
  const addNotebook = useCallback(
    async (parent?: Notebook) => {
      const r = await prompt({
        title: parent ? t("하위 폴더 만들기") : t("새 폴더"),
        message: parent
          ? t('"{name}" 안에 만들 폴더 이름을 입력하세요.', { name: parent.name })
          : t("폴더 이름을 입력하세요."),
        label: t("폴더 이름"),
        withColor: true,
        withDescription: true,
        confirmLabel: t("만들기"),
      });
      if (!r?.value.trim()) return;
      try {
        await api.saveNotebook({
          name: r.value.trim(),
          color: r.color,
          description: r.description?.trim() || null,
          parent_id: parent?.id ?? null,
        });
        await refreshMeta();
      } catch (e) {
        await showError(t("폴더 만들기 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
    },
    [prompt, refreshMeta, showError],
  );

  const renameNotebook = useCallback(
    async (nb: Notebook) => {
      const r = await prompt({
        title: t("폴더 이름 변경"),
        message: t("새 이름을 입력하세요."),
        label: t("폴더 이름"),
        initial: nb.name,
        withColor: true,
        initialColor: nb.color,
        withCover: true,
        initialCover: nb.cover ?? null,
        withDescription: true,
        initialDescription: nb.description ?? "",
        confirmLabel: t("저장"),
      });
      if (!r?.value.trim()) return;
      try {
        await api.saveNotebook({
          id: nb.id,
          name: r.value.trim(),
          color: r.color,
          cover: r.cover,
          description: r.description?.trim() || null,
        });
        await refreshMeta();
      } catch (e) {
        await showError(t("이름 변경 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
    },
    [prompt, refreshMeta, showError],
  );

  const styleNotebook = useCallback(
    async (nb: Notebook, change: { color?: string | null; icon?: string | null }) => {
      try {
        // save_notebook은 빠진 color를 지우고 나머지 칸(상위·설명·표지)은 그대로 둔다.
        if ("color" in change) await api.saveNotebook({ id: nb.id, name: nb.name, color: change.color ?? undefined });
        if ("icon" in change) await api.setNotebookIcon(nb.id, change.icon ?? null);
        await refreshMeta();
      } catch (e) {
        await showError(t("폴더 변경 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      }
    },
    [refreshMeta, showError],
  );

  const removeNotebook = useCallback(
    async (nb: Pick<Notebook, "id" | "name">, confirmed = false) => {
      const ok =
        confirmed ||
        (await confirm({
          title: t("폴더 삭제"),
          message: t('"{name}" 폴더를 삭제할까요? 노트는 삭제되지 않습니다.', { name: nb.name }),
          confirmLabel: t("삭제"),
          danger: true,
        }));
      if (!ok || !(await flushNow())) return;
      const current = draftRef.current,
        revision = current?.revision;
      savingRef.current = true;
      setSaveState("saving");
      try {
        const response = await api.deleteNotebook(
          nb.id,
          current?.isNew ? undefined : current?.id,
          current?.isNew ? undefined : revision,
        );
        const summary = response.current,
          d = draftRef.current;
        if (summary && d?.id === summary.id) {
          await adoptMetadataSummary(d, summary, revision!, {
            notebook_id: d.notebook_id === nb.id ? null : d.notebook_id,
          });
        } else if (d?.isNew && d.notebook_id === nb.id) {
          draftRef.current = { ...d, notebook_id: null };
          setDraft(draftRef.current);
        }
        bumpList();
        startIndexPoll();
        if (view.type === "notebook" && view.id === nb.id) {
          setView({ type: "all" });
        }
        await refreshMeta();
      } catch (e) {
        void showError(t("폴더 삭제 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      } finally {
        savingRef.current = false;
        pendingSaveRef.current = false;
        setSaveState(settledSaveState());
        if (dirtyRef.current) scheduleSave();
      }
    },
    [confirm, view, refreshMeta, showError, flushNow, bumpList, startIndexPoll, scheduleSave],
  );

  const emptyTrash = useCallback(async () => {
    const ok = await confirm({
      title: t("지운 노트 모두 비우기"),
      message: t("지운 노트와 폴더를 모두 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다."),
      confirmLabel: t("지운 노트 모두 비우기"),
      danger: true,
    });
    if (!ok) return;
    try {
      // ponytail: 노트마다 delete 한 번(기존 영구 삭제와 같은 경로). 수천 개면 엔진 일괄 op로 바꾼다.
      for (
        let page = await api.list({ view: "trash", limit: 100 });
        page.items.length;
        page = await api.list({ view: "trash", limit: 100 })
      ) {
        for (const { id } of page.items) {
          await api.delete(id);
          forgetWindowHistory(id);
          forgetSourceHistory(id);
          forgetRichHistory(id);
          window.dispatchEvent(new CustomEvent("inkism-note-deleted", { detail: id }));
          if (selectedIdRef.current === id) {
            selectedIdRef.current = null;
            setSelectedId(null);
            setNote(null);
            setDraft(null);
            draftRef.current = null;
          }
        }
      }
      // 지운 폴더(엔진 schema 13): 하위의 지운 폴더는 delete_notebook이 함께 지운다.
      for (const nb of await rpc<{ id: string; name: string }[]>("trashed_notebooks")) await removeNotebook(nb, true);
    } catch (e) {
      await showError(t("지운 노트 비우기 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
    } finally {
      bumpList();
      void refreshMeta();
    }
  }, [confirm, removeNotebook, bumpList, refreshMeta, showError]);

  // ---------- 뷰 전환 (진행 중 편집 먼저 저장) ----------
  const switchView = useCallback(
    (v: View) => {
      void (async () => {
        if (!(await flushNow())) return;
        setView(v);
      })();
    },
    [flushNow],
  );

  // ---------- 역링크 ----------
  useEffect(()=>{
    backlinksRequest.current?.abort();const controller=new AbortController();backlinksRequest.current=controller;
    const generation=++backlinksGeneration.current;setBacklinks(null);setBacklinksCursor(null);setBacklinksError("");setBacklinksBusy(Boolean(selectedId));
    if(selectedId)void api.backlinks(selectedId,undefined,controller.signal).then(d=>{
      if(generation!==backlinksGeneration.current||controller.signal.aborted)return;
      setBacklinks(normalizeBacklinks(d));setBacklinksCursor(Array.isArray(d)?null:d.next_cursor??null);
    }).catch(error=>{if(!controller.signal.aborted){setBacklinks([]);setBacklinksError(String(error));}}).finally(()=>{if(generation===backlinksGeneration.current)setBacklinksBusy(false);});
    return()=>{controller.abort();backlinksRequest.current?.abort();};
  },[selectedId,saveState]);
  const loadMoreBacklinks=async()=>{
    if(!selectedId||!backlinksCursor||backlinksBusy)return;
    const generation=backlinksGeneration.current,controller=new AbortController();backlinksRequest.current?.abort();backlinksRequest.current=controller;setBacklinksBusy(true);setBacklinksError("");
    try{const d=await api.backlinks(selectedId,backlinksCursor,controller.signal);if(generation!==backlinksGeneration.current||controller.signal.aborted)return;
      setBacklinks(previous=>{const ids=new Set(previous?.map(n=>n.id));return [...(previous??[]),...normalizeBacklinks(d).filter(n=>!ids.has(n.id))];});setBacklinksCursor(Array.isArray(d)?null:d.next_cursor??null);
    }catch(error){if(!controller.signal.aborted)setBacklinksError(String(error));}finally{if(generation===backlinksGeneration.current)setBacklinksBusy(false);}
  };

  const toggleBacklinks = useCallback(() => setBacklinksOpen((o) => !o), []);

  // ---------- 백업 ----------
  const exportBackup = useCallback(async () => {
    try {
      if (!(await flushNow())) return;
      // Native download streams to disk; do not buffer attachment archives in JS.
      const a = document.createElement("a");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      a.href = api.exportUrl;
      a.download = `inkism-backup-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      await showError(t("백업 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
    }
  }, [showError, flushNow]);

  const importBackup = useCallback(
    async (file?: File) => {
      if (!(await flushNow())) return;
      setImporting(true);
      try {
        let imported = 0;
        if (file) imported = await api.importFile(file);
        showImported(imported);
        refreshList();
        await refreshMeta();
      } catch (e) {
        await showError(t("가져오기 실패"), e instanceof Error ? e.message : t("알 수 없는 오류"));
      } finally {
        setImporting(false);
      }
    },
    [showImported, refreshList, refreshMeta, showError, flushNow],
  );

  // ---------- 전역 단축키 ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        e.key === "Process" ||
        e.defaultPrevented ||
        (e.target as Element)?.closest?.("[role=dialog]")
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void flushNow();
      } else if (key === "n") {
        e.preventDefault();
        void newNote();
      } else if ((key === "f" || key === "h") && !e.shiftKey && draftRef.current) {
        e.preventDefault();
        window.dispatchEvent(new Event("inkism-find-in-note"));
      } else if (key === "f") {
        window.dispatchEvent(new Event("inkism-open-search"));
        const el = document.getElementById("note-search") as HTMLInputElement | null;
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flushNow, newNote]);

  const undoBody = wholeBodyUndo?.undone ? wholeBodyUndo.before : wholeBodyUndo?.after;
  const value: StoreValue = {
    info,
    connError,
    retryConnection,
    theme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    view,
    setView: switchView,
    notebooks,
    tags,
    performTagChange,
    renameTag,
    removeTag,
    setTagColor,
    styleNotebook,
    stats,
    addNotebook,
    renameNotebook,
    removeNotebook,
    defaults,
    toggleDefaultNotebook: (nb: Notebook) =>
      void changeDefaults({ notebook_id: defaults.notebook_id === nb.id ? null : nb.id }),
    toggleDefaultTag: (name: string) => void changeDefaults({ tag: defaults.tag === name ? null : name }),
    searchInput,
    setSearchInput,
    search,
    page,
    pageData,
    listLoading,
    listError,
    goToPage,
    refreshList,
    selectedId,
    selectNote,
    reloadCurrentNote,
    selectionVersion: () => selectionRequest.current,
    newNote: (title?: string, timestampTitle?: boolean) => void newNote(title, timestampTitle),
    note,
    draft,
    readDraft: () => draftRef.current,
    editorGeneration,
    draftLoading,
    saveState,
    saveError,
    conflictServer,
    mode,
    setMode,
    convertEditorCompatibility,
    editorConverting,
    makeRichCopy,
    setEditorError,
    largeDoc,
    windowedEditor,
    updateDraft,
    changePaged,
    stageWholeBody,
    wholeBodyUndo:
      wholeBodyUndo && draft?.id === wholeBodyUndo.id && !draft.paged && draft.content === undoBody
        ? wholeBodyUndo
        : null,
    toggleWholeBodyUndo,
    flushNow,
    retrySave,
    keepLocalVersion,
    useServerVersion,
    patchNote,
    patchNoteById,
    setReminder,
    ensurePersisted,
    openHistory,
    trashSelected,
    restoreSelected,
    deleteSelectedForever,
    quickRestore,
    quickDelete,
    emptyTrash,
    restoreVersion,
    indexPending,
    indexSupported: indexSupportedRef.current,
    backlinks,
    backlinksOpen,
    backlinksCursor,backlinksBusy,backlinksError,loadMoreBacklinks,
    toggleBacklinks,
    refreshMeta,
    exportBackup,
    importBackup,
    importing,
    dialog,
    confirm,
    choose,
    prompt,
    showError,
    showImported,
    closeDialog,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
