import { advanceSourceHistory } from "../lib/source-history-cache";
import { advanceRichHistory } from "../lib/rich-history-cache";
import { inspectRichHTML } from "../lib/rich-document";
import { usePref } from "../lib/pref";
import { RichEditor } from "./RichEditor";
import { TagInput } from "./TagInput";
import { tagChipStyle, tagColor } from "./LibraryStyle";
import { X } from "../icons";
import { withReadonly } from "../lib/readonly-permission";
import { errorText } from "../lib/text";
import { persistHistory, loadHistories } from "../lib/persistent-history";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, rpc } from "../api";
import { useStore } from "../store";
import type { Note } from "../types";
import type { Location } from "../lib/editor-location";
import { EditorPane } from "./EditorPane";
import { SourceEditor } from "./SourceEditor";
import { registerAuxiliaryFlush } from "../lib/workspace";
import { DraftJournal } from "../lib/draft-journal";
import { deriveSplices } from "../lib/splice-client";
import "./SplitWorkspace.css";
import { t } from "../i18n";
import { TAB_DRAG_TYPE } from "./NoteTabs";
type SourceNote = Note & { content_format?: "text" | "html" | "markdown"; readonlyRevision?: number };
type Tab = { id: string; title: string };
/** Updates the tab's title in place, or appends it. */
function withTab(tabs: Tab[], tab: Tab): Tab[] {
  if (!tabs.some((t) => t.id === tab.id)) return [...tabs, tab];
  return tabs.map((t) => (t.id === tab.id ? tab : t));
}
type PaneInit = { id: string | null; tabs?: Tab[]; locations?: Record<string, Location> };
type PaneState = { id: string | null; ids: string[]; locations: Record<string, Location> };
type PaneHandle = { open: (id: string | null) => Promise<void>; showing: () => string | null };
type Rect = { x: number; y: number; w: number; h: number };
const rectStyle = (r: Rect): React.CSSProperties => ({ left: r.x + "%", top: r.y + "%", width: r.w + "%", height: r.h + "%" });

/** Each split pane owns its draft/revision; conflicts never overwrite another pane. */
function SplitPane({
  paneKey,
  initial,
  rect,
  save,
  onEmpty,
  taken,
  register,
}: Readonly<{
  paneKey: string;
  initial: PaneInit;
  rect: Rect;
  save: (key: string, state: PaneState) => Promise<void>;
  onEmpty: (key: string) => void;
  taken: (id: string, key: string) => boolean;
  register: (key: string, handle: PaneHandle | null) => void;
}>) {
  const s = useStore();
  const section = useRef<HTMLElement>(null);
  // 오른쪽 창 편집 방식 (Figma 05: 서식). 원문은 언제든 고를 수 있다.
  const [splitMode, setSplitMode] = usePref<"rich" | "source">("inkism.split.mode", (raw) =>
    raw === "source" ? "source" : "rich",
  );
  const [tagDraft, setTagDraft] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [generation, setGeneration] = useState(0),
    [note, setNote] = useState<SourceNote | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]),
    [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const draft = useRef<SourceNote | null>(null),
    dirty = useRef(false),
    version = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(),
    positionTimer = useRef<ReturnType<typeof setTimeout>>();
  const operation = useRef(false),
    tabsRef = useRef<Tab[]>([]),
    positions = useRef<Record<string, Location>>({});
  const baseline = useRef<Note | null>(null),
    journal = useRef<DraftJournal>();
  journal.current ??= new DraftJournal(
    rpc,
    async (before, after) => (await deriveSplices({ content: before, text: "" }, { content: after, text: "" })).content,
    5000,
    "split",
  );
  const journalEnabled = useRef(false);
  journalEnabled.current = Boolean(s.info?.draft_journal);
  const journalTimer = useRef<ReturnType<typeof setTimeout>>(),
    composition = useRef<EventTarget | null>(null);
  const journalMounted = useRef(true);
  const checkpoint = (payload: SourceNote) =>
    journal.current!.stage({ ...payload, isNew: false, textDirty: true }, baseline.current);
  const scheduleCheckpoint = (delay = 250) => {
    if (!journalMounted.current || !journalEnabled.current || journalTimer.current) return;
    journalTimer.current = setTimeout(() => {
      journalTimer.current = undefined;
      if (composition.current instanceof Node && !composition.current.isConnected) composition.current = null;
      if (!journalMounted.current || composition.current) return;
      window.dispatchEvent(new Event("inkism-flush-editor"));
      if (!dirty.current || !draft.current) return;
      void journal.current!.persist(checkpoint(draft.current)).catch((e) => {
        if (journalMounted.current && dirty.current) {
          report(e);
          scheduleCheckpointRef.current(1000);
        }
      });
    }, delay);
  };
  const scheduleCheckpointRef = useRef(scheduleCheckpoint);
  scheduleCheckpointRef.current = scheduleCheckpoint;
  useEffect(() => {
    journalMounted.current = true;
    if (journal.current?.stopped)
      journal.current = new DraftJournal(
        rpc,
        async (before, after) =>
          (await deriveSplices({ content: before, text: "" }, { content: after, text: "" })).content,
        5000,
        "split",
      );
    const edit = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.editorId === draft.current?.id + ":split")
        scheduleCheckpointRef.current();
    };
    const start = (event: CompositionEvent) => {
      if (event.target instanceof Node && section.current?.contains(event.target))
        composition.current = event.target;
    };
    const end = (event: CompositionEvent) => {
      if (event.target === composition.current) {
        composition.current = null;
        scheduleCheckpointRef.current();
      }
    };
    window.addEventListener("inkism-editor-dirty", edit);
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    return () => {
      journalMounted.current = false;
      journal.current?.stop();
      clearTimeout(journalTimer.current);
      journalTimer.current = undefined;
      window.removeEventListener("inkism-editor-dirty", edit);
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
    };
  }, []);
  const report = (e: unknown) => setError(errorText(e));
  const writeLayout = (id: string | null, nextTabs = tabsRef.current) => {
    const ids = nextTabs.map((t) => t.id);
    const locations = Object.fromEntries(Object.entries(positions.current).filter(([key]) => ids.includes(key)));
    return save(paneKey, { id, ids, locations });
  };
  /** Adopts a finished save when the pane still shows that note; keeps newer typing dirty. */
  const adoptSaved = async (saved: SourceNote, payload: SourceNote, snapshotVersion: number) => {
    if (draft.current?.id !== saved.id) return;
    draft.current = { ...withReadonly(draft.current, saved), revision: saved.revision };
    const position = positions.current[saved.id];
    if (position?.revision === payload.revision) position.revision = saved.revision;
    advanceSourceHistory(saved.id + ":split", payload.revision, saved.revision);
    advanceRichHistory(saved.id + ":split", payload.revision, saved.revision);
    if (version.current !== snapshotVersion) return;
    await persistHistory(saved.id, saved.revision);
    if (version.current !== snapshotVersion) return;
    dirty.current = false;
    draft.current = {
      ...saved,
      readonly: draft.current.readonly,
      readonlyRevision: draft.current.readonlyRevision,
    };
    setNote(draft.current);
  };
  const flush = async () => {
    window.dispatchEvent(new Event("inkism-flush-editor"));
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (!dirty.current || !draft.current) return;
    const payload = { ...draft.current },
      snapshotVersion = version.current;
    const work = (async () => {
      let retained: ReturnType<DraftJournal["stage"]> | undefined;
      if (journalEnabled.current && !composition.current) {
        try {
          retained = checkpoint(payload);
          await journal.current!.persist(retained);
        } catch (e) {
          report(e);
        }
      }
      if (!journalMounted.current) return;
      const saved = await api.save({
        id: payload.id,
        title: payload.title,
        content: payload.content,
        content_format: payload.content_format ?? "html",
        notebook_id: payload.notebook_id,
        tags: payload.tags,
        revision: payload.revision,
      });
      baseline.current = saved;
      await adoptSaved(saved, payload, snapshotVersion);
      if (retained) {
        try {
          await journal.current!.clear(retained);
        } catch {
          /* Startup deduplicates already-saved snapshots. */
        }
      }
      setError(null);
      s.refreshList();
    })();
    saving.current = work;
    try {
      await work;
    } catch (e) {
      report(e);
      if (dirty.current) scheduleCheckpointRef.current();
      throw e;
    } finally {
      saving.current = null;
    }
    if (dirty.current) await flush();
  };
  const flushAll = async () => {
    await flush();
    clearTimeout(positionTimer.current);
    await writeLayout(draft.current?.id ?? null);
  };
  const flushRef = useRef(flushAll);
  flushRef.current = flushAll;
  useEffect(() => registerAuxiliaryFlush(() => flushRef.current()), []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(initial)
      .then(async (saved) => {
        await loadHistories();
        const n = saved.id ? await api.get(saved.id) : null;
        if (cancelled) return;
        positions.current = saved.locations ?? {};
        tabsRef.current = saved.tabs ?? (n ? [{ id: n.id, title: n.title }] : []);
        draft.current = n;
        baseline.current = n;
        setNote(n);
        setTabs(tabsRef.current);
        setReady(true);
        if (!n) onEmpty(paneKey);
      })
      .catch(report);
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      clearTimeout(positionTimer.current);
    };
  }, [loadAttempt]);
  useEffect(() => {
    let stopped = false,
      busy = false;
    const check = async () => {
      const snapshot = draft.current;
      if (busy || !snapshot || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const { summary } = await api.documentInfo(snapshot.id);
        const opened = draft.current;
        if (stopped || opened?.id !== snapshot.id || withReadonly(opened, summary) === opened) return;
        if (composition.current instanceof Node && composition.current.isConnected) return;
        window.dispatchEvent(new Event("inkism-flush-editor"));
        const current = draft.current;
        if (stopped || current?.id !== summary.id) return;
        const next = withReadonly(current, summary);
        if (next === current) return;
        draft.current = next;
        setNote((prev) =>
          prev?.id === next.id ? { ...prev, readonly: next.readonly, readonlyRevision: next.readonlyRevision } : prev,
        );
      } catch {
        /* A later sync check retries; unsaved split text remains intact. */
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
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const open = async (id: string | null, remaining = tabsRef.current) => {
    if (operation.current) return;
    // One note per split pane: two panes would share its draft journal and history.
    if (id && taken(id, paneKey)) return report(new Error(t("이 노트는 다른 분할 창에 이미 열려 있습니다.")));
    operation.current = true;
    setBusy(true);
    try {
      await flush();
      const n = id ? await api.get(id) : null;
      const next = n ? withTab(remaining, { id: n.id, title: n.title }) : remaining;
      await writeLayout(id, next);
      tabsRef.current = next;
      setTabs(next);
      draft.current = n;
      baseline.current = n;
      dirty.current = false;
      version.current++;
      setNote(n);
      setGeneration((v) => v + 1);
      setError(null);
      if (!n) onEmpty(paneKey);
    } catch (e) {
      report(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    register(paneKey, { open: (id) => openRef.current(id), showing: () => draft.current?.id ?? null });
    return () => register(paneKey, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey]);
  const [stripDrop, setStripDrop] = useState(false);
  useEffect(() => {
    const end = () => setStripDrop(false);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
  // 끌어 놓은 탭은 기본 편집기 초안을 먼저 저장한 뒤 이 창에서 연다.
  const openDropped = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData(TAB_DRAG_TYPE);
    if (id) void s.flushNow().then((ok) => (ok ? openRef.current(id) : undefined));
  };
  const closeTab = async (id: string) => {
    const index = tabsRef.current.findIndex((t) => t.id === id),
      remaining = tabsRef.current.filter((t) => t.id !== id);
    const next =
      draft.current?.id === id
        ? (remaining[index]?.id ?? remaining[index - 1]?.id ?? null)
        : (draft.current?.id ?? null);
    await open(next, remaining);
  };
  const recover = async () => {
    if (operation.current || !draft.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const d = { ...draft.current };
      const recovered = {
        id: crypto.randomUUID(),
        title: d.title + " (분할 복구 사본)",
        content: d.content,
        content_format: d.content_format ?? "html",
        notebook_id: d.notebook_id,
        tags: d.tags,
      };
      const n = await api.save(recovered),
        next = [...tabsRef.current, { id: n.id, title: n.title }];
      if (journalEnabled.current) void journal.current!.discard(d.id).catch(report);
      await writeLayout(n.id, next);
      tabsRef.current = next;
      setTabs(next);
      draft.current = n;
      baseline.current = n;
      dirty.current = false;
      setNote(n);
      setGeneration((v) => v + 1);
      setError(null);
      s.refreshList();
    } catch (e) {
      report(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  /** 본문·제목·태그 변경은 모두 같은 분할 초안(draft)과 같은 저장(flush) 경로로 간다. */
  const edit = (content: string) => editPatch({ content });
  const editPatch = (patch: Partial<Pick<SourceNote, "content" | "title" | "tags">>, id = draft.current?.id) => {
    if (!draft.current || draft.current.readonly || draft.current.id !== id) return;
    draft.current = { ...draft.current, ...patch };
    if (patch.title !== undefined || patch.tags !== undefined) setNote(draft.current);
    dirty.current = true;
    version.current++;
    scheduleCheckpointRef.current();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current().catch(report), 700);
  };
  // 서식 편집은 HTML 노트이고 원문이 서식 편집기로 그대로 왕복할 때만(왼쪽 편집기와 같은 기준).
  const mountedContent = note && draft.current?.id === note.id ? draft.current.content : note?.content ?? "";
  const inspection = useMemo(
    () => (note && (note.content_format ?? "html") === "html" ? inspectRichHTML(mountedContent) : null),
    // 편집기를 새로 여는 순간(노트·세대·방식)에만 다시 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note?.id, generation, splitMode],
  );
  const richCapable = Boolean(inspection?.editable);
  const showRich = splitMode === "rich" && richCapable;
  const richInitial = showRich ? inspection!.content : null;
  const switchMode = (mode: "rich" | "source") => {
    if (mode === splitMode) return;
    // 서식 편집기에 남은 입력을 초안으로 먼저 넘긴 뒤 다른 편집기를 연다.
    window.dispatchEvent(new Event("inkism-flush-editor"));
    setSplitMode(mode);
  };
  return (
    <>
      {note && (
        <section
          ref={section}
          className="split-secondary"
          style={rectStyle(rect)}
          aria-label={t("분할 편집기")}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              e.stopPropagation();
              void flushRef.current().catch(report);
            }
          }}
        >
          <div
            className={"split-tabs" + (stripDrop ? " is-drop-target" : "")}
            role="tablist"
            aria-label={t("분할 노트 탭")}
            // 위쪽 탭 줄의 탭을 여기 놓으면 분할 창으로 옮긴다(위쪽 탭은 NoteTabs가 닫는다).
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE) || busy) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setStripDrop(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setStripDrop(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
              event.preventDefault();
              setStripDrop(false);
              openDropped(event);
            }}
          >
            {tabs.map((tab) => (
              <div key={tab.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === note.id}
                  disabled={busy}
                  onClick={() => void open(tab.id)}
                >
                  {tab.title || t("제목 없음")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("분할 탭 닫기: {title}", { title: tab.title })}
                  onClick={() => void closeTab(tab.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="split-controls">
            <fieldset className="mode-toggle plain-fieldset" aria-label={t("분할 편집 모드")} disabled={busy}>
              <button
                type="button"
                className={`mode-btn${showRich ? " is-active" : ""}`}
                aria-label={t("분할 서식 편집")}
                aria-pressed={showRich}
                disabled={!richCapable}
                title={richCapable ? undefined : t("이 노트는 원문으로만 편집합니다.")}
                onClick={() => switchMode("rich")}
              >
                {t("서식")}
              </button>
              <button
                type="button"
                className={`mode-btn${showRich ? "" : " is-active"}`}
                aria-label={t("분할 원문 편집")}
                aria-pressed={!showRich}
                onClick={() => switchMode("source")}
              >
                {t("원문")}
              </button>
            </fieldset>
            <select
              aria-label={t("분할 노트")}
              value={note.id}
              disabled={busy}
              onChange={(e) => void open(e.target.value)}
            >
              {[note, ...(s.pageData?.items ?? []).filter((n) => n.id !== note.id)].map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title || t("제목 없음")}
                </option>
              ))}
            </select>
            <span>{t("{format} 원문", { format: note.content_format ?? "html" })}</span>
            <button type="button" className="btn btn-secondary" onClick={() => void flushRef.current().catch(report)}>
              {t("분할 저장")}
            </button>
            <button
              type="button"
              className="btn btn-secondary split-pane-close"
              disabled={!ready || busy}
              aria-label={t("분할 창 닫기")}
              title={t("분할 창 닫기")}
              onClick={() => void open(null)}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <h2 className="split-title">
            <input
              aria-label={t("분할 노트 제목")}
              value={note.title}
              placeholder={t("제목 없는 노트")}
              readOnly={Boolean(note.readonly)}
              onChange={(e) => editPatch({ title: e.target.value }, note.id)}
            />
          </h2>
          <div className="split-tags tag-editor" aria-label={t("분할 노트 태그")}>
            {note.tags.map((tag) => (
              <span key={tag} className="tag-chip" style={tagChipStyle(tagColor(s.tags, tag))}>
                <span className="tag-chip-label" title={tag}>
                  #{tag}
                </span>
                {!note.readonly && (
                  <button
                    type="button"
                    className="tag-remove"
                    aria-label={t("태그 삭제: {tag}", { tag })}
                    onClick={() => editPatch({ tags: note.tags.filter((x) => x !== tag) }, note.id)}
                  >
                    <X size={11} aria-hidden />
                  </button>
                )}
              </span>
            ))}
            {!note.readonly && (
              <TagInput
                value={tagDraft}
                onChange={setTagDraft}
                current={note.tags}
                placeholder={note.tags.length === 0 ? t("태그 추가 (Enter)") : t("태그 더 추가")}
                onCommit={(text = tagDraft) => {
                  const tag = text.trim().replace(/^#/, "");
                  if (tag && !note.tags.includes(tag) && note.tags.length < 100) editPatch({ tags: [...note.tags, tag] }, note.id);
                  setTagDraft("");
                }}
                onRemoveLast={() => editPatch({ tags: note.tags.slice(0, -1) }, note.id)}
              />
            )}
          </div>
          {error && (
            <div role="alert">
              {error}
              <p>{t("초안은 그대로 유지됩니다.")}</p>
              <button type="button" onClick={() => void flushRef.current().catch(report)}>
                {t("다시 저장")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(t("분할 초안을 버리고 저장된 버전을 다시 열까요?"))) return;
                  if (journalEnabled.current) void journal.current!.discard(note.id).catch(report);
                  dirty.current = false;
                  void open(note.id);
                }}
              >
                {t("저장된 버전 다시 열기")}
              </button>
              <button type="button" disabled={busy} onClick={() => void recover()}>
                {t("초안을 새 노트로 보관")}
              </button>
            </div>
          )}
          {showRich && richInitial !== null ? (
            <div className="split-rich">
              <RichEditor
                key={note.id + ":rich:" + generation}
                initialContent={richInitial}
                readOnly={Boolean(note.readonly)}
                noteIdentity={{ id: note.id + ":split", revision: note.revision }}
                onChange={(content) => {
                  if (draft.current?.id === note.id) edit(content);
                }}
              />
            </div>
          ) : (
          <SourceEditor
            key={note.id + ":source:" + generation}
            id={note.id + ":split"}
            revision={note.revision}
            language={note.content_format ?? "html"}
            initialContent={draft.current?.id === note.id ? draft.current.content : note.content}
            readOnly={Boolean(note.readonly)}
            initialLocation={
              positions.current[note.id]?.revision === note.revision ? positions.current[note.id] : undefined
            }
            onLocation={(location) => {
              const d = draft.current;
              if (d?.id !== note.id) return;
              positions.current[note.id] = {
                revision: d.revision,
                kind: d.content_format === "markdown" ? "markdown" : "source",
                offset: 0,
                ...location,
              };
              clearTimeout(positionTimer.current);
              positionTimer.current = setTimeout(() => void flushRef.current().catch(report), 600);
            }}
            onChange={(content) => {
              if (draft.current?.id === note.id) edit(content);
            }}
          />
          )}
        </section>
      )}
      {!note && (
        <section ref={section} className="split-secondary" style={rectStyle(rect)} aria-label={t("분할 편집기")}>
          {error && (
            <div role="alert">
              {error}
              <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>
                {t("분할 상태 다시 불러오기")}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** Layout tree: a leaf is a pane key ("main" is the store-driven editor); a split holds two children. */
type PaneNode = string | { dir: "row" | "column"; ratio: number; a: PaneNode; b: PaneNode };
type Side = "left" | "right" | "top" | "bottom";
const MAX_PANES = 8;
const leafKeys = (node: PaneNode): string[] => (typeof node === "string" ? [node] : [...leafKeys(node.a), ...leafKeys(node.b)]);
function placeLeaves(node: PaneNode, rect: Rect, path = ""): { leaves: { key: string; rect: Rect }[]; dividers: { path: string; dir: "row" | "column"; rect: Rect; parent: Rect; ratio: number }[] } {
  if (typeof node === "string") return { leaves: [{ key: node, rect }], dividers: [] };
  const row = node.dir === "row";
  const first = row ? { ...rect, w: rect.w * node.ratio } : { ...rect, h: rect.h * node.ratio };
  const second = row
    ? { ...rect, x: rect.x + first.w, w: rect.w - first.w }
    : { ...rect, y: rect.y + first.h, h: rect.h - first.h };
  const a = placeLeaves(node.a, first, path + "a"),
    b = placeLeaves(node.b, second, path + "b");
  const line = row ? { ...rect, x: second.x, w: 0 } : { ...rect, y: second.y, h: 0 };
  return {
    leaves: [...a.leaves, ...b.leaves],
    dividers: [{ path, dir: node.dir, rect: line, parent: rect, ratio: node.ratio }, ...a.dividers, ...b.dividers],
  };
}
function splitLeaf(node: PaneNode, target: string, side: Side, key: string): PaneNode {
  if (typeof node !== "string") return { ...node, a: splitLeaf(node.a, target, side, key), b: splitLeaf(node.b, target, side, key) };
  if (node !== target) return node;
  const before = side === "left" || side === "top";
  return { dir: side === "left" || side === "right" ? "row" : "column", ratio: 0.5, a: before ? key : node, b: before ? node : key };
}
function removeLeaf(node: PaneNode, key: string): PaneNode | null {
  if (typeof node === "string") return node === key ? null : node;
  const a = removeLeaf(node.a, key),
    b = removeLeaf(node.b, key);
  return a === null ? b : b === null ? a : { ...node, a, b };
}
function setRatio(node: PaneNode, path: string, ratio: number): PaneNode {
  if (typeof node === "string") return node;
  if (!path) return { ...node, ratio };
  return path[0] === "a" ? { ...node, a: setRatio(node.a, path.slice(1), ratio) } : { ...node, b: setRatio(node.b, path.slice(1), ratio) };
}
/** Reads the saved tree whose leaves are 0 (main) and 1.. (split panes in order); null when it does not fit. */
function readTree(raw: unknown, keys: string[], depth = 0): PaneNode | null {
  if (typeof raw === "number") return raw === 0 ? "main" : (keys[raw - 1] ?? null);
  if (depth > MAX_PANES || !raw || typeof raw !== "object") return null;
  const n = raw as { dir?: unknown; ratio?: unknown; a?: unknown; b?: unknown };
  const a = readTree(n.a, keys, depth + 1),
    b = readTree(n.b, keys, depth + 1);
  if ((n.dir !== "row" && n.dir !== "column") || typeof n.ratio !== "number" || !a || !b) return null;
  return { dir: n.dir, ratio: Math.min(0.85, Math.max(0.15, n.ratio)), a, b };
}
type SavedSplit = { id: string | null; tabs: Tab[]; locations: Record<string, Location>; panes?: PaneInit[]; tree?: unknown };

/** The main editor plus up to seven split panes, laid out by a tree of row/column splits. */
export function SplitWorkspace({
  inspectorOpen,
  openInspector,
  closeInspector,
}: Readonly<{
  inspectorOpen: boolean;
  openInspector: () => void;
  closeInspector: () => void;
}>) {
  const s = useStore();
  const [tree, setTree] = useState<PaneNode>("main");
  const treeRef = useRef<PaneNode>("main");
  const [initials, setInitials] = useState<Record<string, PaneInit>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [drop, setDrop] = useState<{ key: string; side: Side; rect: Rect } | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const handles = useRef<Record<string, PaneHandle>>({});
  const committed = useRef<Record<string, PaneState>>({});
  const writes = useRef<Promise<void>>(Promise.resolve());
  const report = (e: unknown) => setError(errorText(e));
  /** Serializes every pane into one split_set; the first split pane keeps the original top-level fields. */
  const persist = (change: (states: Record<string, PaneState>) => Record<string, PaneState>) => {
    const next = writes.current
      .catch(() => {})
      .then(async () => {
        const states = change(committed.current);
        const keys = leafKeys(treeRef.current).filter((k) => k !== "main");
        const index = new Map(keys.map((k, i) => [k, i + 1] as const)).set("main", 0);
        const json = (n: PaneNode): unknown =>
          typeof n === "string" ? index.get(n) : { dir: n.dir, ratio: n.ratio, a: json(n.a), b: json(n.b) };
        const [first = { id: null, ids: [], locations: {} }, ...rest] = keys.map(
          (k) => states[k] ?? { id: null, ids: [], locations: {} },
        );
        await rpc("split_set", structuredClone({ ...first, mode: "source", panes: rest, tree: keys.length ? json(treeRef.current) : null }));
        committed.current = states;
      });
    writes.current = next;
    return next;
  };
  const changeTree = (next: PaneNode) => {
    treeRef.current = next;
    setTree(next);
  };
  useEffect(() => {
    let cancelled = false;
    void rpc<SavedSplit>("split_get")
      .then((saved) => {
        if (cancelled) return;
        const all: PaneInit[] = [{ id: saved.id, tabs: saved.tabs, locations: saved.locations }, ...(saved.panes ?? [])];
        const keys: string[] = all.map(() => crypto.randomUUID());
        const live = keys.filter((_, i) => all[i].id);
        // Panes without an open note were closed; drop them from the saved tree too.
        let next = readTree(saved.tree, keys);
        for (const key of next ? leafKeys(next) : []) if (key !== "main" && !live.includes(key)) next = next && removeLeaf(next, key);
        if (!next || !leafKeys(next).includes("main") || leafKeys(next).length !== live.length + 1)
          next = live.reduce<PaneNode>((node, key) => ({ dir: "row", ratio: 0.5, a: node, b: key }), "main");
        committed.current = Object.fromEntries(
          keys.map((k, i) => [k, { id: all[i].id, ids: (all[i].tabs ?? []).map((t) => t.id), locations: all[i].locations ?? {} }]),
        );
        setInitials(Object.fromEntries(keys.map((k, i) => [k, all[i]])));
        changeTree(next);
        setReady(true);
        setError(null);
      })
      .catch(report);
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);
  const taken = (id: string, key: string) => Object.entries(handles.current).some(([k, h]) => k !== key && h.showing() === id);
  const addPane = (target: string, side: Side, id: string) => {
    if (leafKeys(treeRef.current).length >= MAX_PANES || taken(id, "")) return;
    const key = crypto.randomUUID();
    setInitials((all) => ({ ...all, [key]: { id } }));
    changeTree(splitLeaf(treeRef.current, target, side, key));
    void persist((states) => ({ ...states, [key]: { id, ids: [id], locations: {} } })).catch(report);
  };
  const addRef = useRef(addPane);
  addRef.current = addPane;
  const removePane = (key: string) => {
    changeTree(removeLeaf(treeRef.current, key) ?? "main");
    void persist(({ [key]: _closed, ...rest }) => rest).catch(report);
  };
  // detail이 있으면 그 노트(끌어 놓은 탭)를, 없으면 지금 노트를 첫 분할 창에 연다(없으면 오른쪽에 만든다).
  useEffect(() => {
    const show = (event: Event) => {
      const id = (event as CustomEvent<string | undefined>).detail ?? s.note?.id;
      if (!id) return;
      void s.flushNow().then((ok) => {
        if (!ok) return;
        const first = leafKeys(treeRef.current).find((k) => k !== "main");
        if (first) void handles.current[first]?.open(id);
        else addRef.current("main", "right", id);
      });
    };
    window.addEventListener("inkism-open-split", show);
    return () => window.removeEventListener("inkism-open-split", show);
  }, [s.note?.id]);
  useEffect(() => {
    const end = () => setDrop(null);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
  const { leaves, dividers } = useMemo(() => placeLeaves(tree, { x: 0, y: 0, w: 100, h: 100 }), [tree]);
  const tabDrag = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(TAB_DRAG_TYPE) &&
    !(event.target instanceof Element && event.target.closest(".split-tabs"));
  // 탭을 어느 창의 가장자리 쪽에 끌어 놓느냐(왼·오·위·아래 중 가까운 쪽)로 나눌 방향을 정한다.
  const dropTarget = (event: React.DragEvent) => {
    if (!ready || leaves.length >= MAX_PANES) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * 100,
      py = ((event.clientY - box.top) / box.height) * 100;
    const leaf = leaves.find(({ rect: r }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (!leaf) return null;
    const r = leaf.rect,
      fx = (px - r.x) / r.w,
      fy = (py - r.y) / r.h;
    const distance: Record<Side, number> = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
    const side = (Object.keys(distance) as Side[]).reduce((a, b) => (distance[b] < distance[a] ? b : a));
    const half = {
      left: { ...r, w: r.w / 2 },
      right: { ...r, x: r.x + r.w / 2, w: r.w / 2 },
      top: { ...r, h: r.h / 2 },
      bottom: { ...r, y: r.y + r.h / 2, h: r.h / 2 },
    }[side];
    return { key: leaf.key, side, rect: half };
  };
  const resize = (event: React.PointerEvent, divider: (typeof dividers)[number]) => {
    const box = workspace.current!.getBoundingClientRect();
    const row = divider.dir === "row",
      p = divider.parent;
    const start = row ? box.left + (box.width * p.x) / 100 : box.top + (box.height * p.y) / 100;
    const size = row ? (box.width * p.w) / 100 : (box.height * p.h) / 100;
    const move = (e: PointerEvent) => {
      const ratio = Math.min(0.85, Math.max(0.15, ((row ? e.clientX : e.clientY) - start) / size));
      changeTree(setRatio(treeRef.current, divider.path, ratio));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void persist((states) => states).catch(report);
    };
    event.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const nudge = (event: React.KeyboardEvent, divider: (typeof dividers)[number]) => {
    const step = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    changeTree(setRatio(treeRef.current, divider.path, Math.min(0.85, Math.max(0.15, divider.ratio + step))));
    void persist((states) => states).catch(report);
  };
  const split = leaves.length > 1;
  return (
    <div
      ref={workspace}
      className={"split-workspace" + (split ? " is-split" : "")}
      // 편집기가 탭 끌기를 글 끌어 넣기로 받지 않도록 캡처 단계에서 가로챈다.
      onDragOverCapture={(event) => {
        if (!tabDrag(event)) return;
        event.stopPropagation();
        const target = dropTarget(event);
        setDrop((prev) => (prev && target && prev.key === target.key && prev.side === target.side ? prev : target));
        if (!target) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
      onDropCapture={(event) => {
        if (!tabDrag(event)) return;
        event.stopPropagation();
        event.preventDefault();
        setDrop(null);
        const target = dropTarget(event),
          id = event.dataTransfer.getData(TAB_DRAG_TYPE);
        if (target && id) void s.flushNow().then((ok) => ok && addRef.current(target.key, target.side, id));
      }}
    >
      {drop && (
        <div className="split-drop-zone" style={rectStyle(drop.rect)} aria-hidden="true">
          <span>{t("여기에 놓아 분할로 열기")}</span>
        </div>
      )}
      {leaves.map(({ key, rect }) =>
        key === "main" ? (
          <div key="main" className="split-primary" style={rectStyle(rect)}>
            {split && (
              <div className="split-controls split-top-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!ready}
                  onClick={() => {
                    for (const handle of Object.values(handles.current)) void handle.open(null);
                  }}
                >
                  {t("분할 닫기")}
                </button>
              </div>
            )}
            {error && (
              <div role="alert">
                {error}
                {!ready && (
                  <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>
                    {t("분할 상태 다시 불러오기")}
                  </button>
                )}
              </div>
            )}
            <EditorPane inspectorOpen={inspectorOpen} openInspector={openInspector} closeInspector={closeInspector} />
          </div>
        ) : (
          <SplitPane
            key={key}
            paneKey={key}
            initial={initials[key] ?? { id: null }}
            rect={rect}
            save={(k, state) => persist((states) => ({ ...states, [k]: state }))}
            onEmpty={removePane}
            taken={taken}
            register={(k, handle) => {
              if (handle) handles.current[k] = handle;
              else delete handles.current[k];
            }}
          />
        ),
      )}
      {dividers.map((divider) => (
        <div
          key={divider.path || "root"}
          role="separator"
          tabIndex={0}
          aria-orientation={divider.dir === "row" ? "vertical" : "horizontal"}
          aria-label={t("분할 창 크기 조절")}
          aria-valuenow={Math.round(divider.ratio * 100)}
          aria-valuemin={15}
          aria-valuemax={85}
          className={"split-divider is-" + divider.dir}
          style={rectStyle(divider.rect)}
          onPointerDown={(event) => resize(event, divider)}
          onKeyDown={(event) => nudge(event, divider)}
        />
      ))}
    </div>
  );
}
