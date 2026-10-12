import { advanceSourceHistory } from "../lib/source-history-cache";
import { withReadonly } from "../lib/readonly-permission";
import { errorText } from "../lib/text";
import { persistHistory, loadHistories } from "../lib/persistent-history";
import React, { useEffect, useRef, useState } from "react";
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
type SourceNote = Note & { content_format?: "text" | "html" | "markdown"; readonlyRevision?: number };
type Tab = { id: string; title: string };
/** Updates the tab's title in place, or appends it. */
function withTab(tabs: Tab[], tab: Tab): Tab[] {
  if (!tabs.some((t) => t.id === tab.id)) return [...tabs, tab];
  return tabs.map((t) => (t.id === tab.id ? tab : t));
}
type Layout = { id: string | null; tabs: Tab[]; locations: Record<string, Location> };

/** The second pane owns its draft/revision; conflicts never overwrite the other pane. */
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
  const saving = useRef<Promise<void> | null>(null),
    layoutWrites = useRef<Promise<void>>(Promise.resolve());
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
      if (event.target instanceof Element && event.target.closest(".split-secondary"))
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
    const payload = structuredClone({ id, ids, locations, mode: "source" });
    const next = layoutWrites.current
      .catch(() => {})
      .then(() => rpc("split_set", payload))
      .then(() => {});
    layoutWrites.current = next;
    return next;
  };
  /** Adopts a finished save when the pane still shows that note; keeps newer typing dirty. */
  const adoptSaved = async (saved: SourceNote, payload: SourceNote, snapshotVersion: number) => {
    if (draft.current?.id !== saved.id) return;
    draft.current = { ...withReadonly(draft.current, saved), revision: saved.revision };
    const position = positions.current[saved.id];
    if (position?.revision === payload.revision) position.revision = saved.revision;
    advanceSourceHistory(saved.id + ":split", payload.revision, saved.revision);
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
    void rpc<Layout>("split_get")
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
    } catch (e) {
      report(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const openRef=useRef(open);openRef.current=open;
  useEffect(()=>{const show=()=>{if(s.note)void s.flushNow().then(ok=>{if(ok)void openRef.current(s.note!.id);});};window.addEventListener('inkism-open-split',show);return()=>window.removeEventListener('inkism-open-split',show);},[s.note?.id]);
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
  const edit = (content: string) => {
    if (!draft.current || draft.current.readonly) return;
    draft.current = { ...draft.current, content };
    dirty.current = true;
    version.current++;
    scheduleCheckpointRef.current();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current().catch(report), 700);
  };
  return (
    <div className={"split-workspace" + (note ? " is-split" : "")}>
      <div className="split-primary">
        {note && (
          <div className="split-controls split-top-row">

            {note && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!ready || busy}
                onClick={() => void open(null)}
              >
                {t("분할 닫기")}
              </button>
            )}
          </div>
        )}
        <EditorPane inspectorOpen={inspectorOpen} openInspector={openInspector} closeInspector={closeInspector} />
      </div>
      {note && (
        <section
          className="split-secondary"
          aria-label={t("분할 편집기")}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              e.stopPropagation();
              void flushRef.current().catch(report);
            }
          }}
        >
          <div className="split-tabs" role="tablist" aria-label={t("분할 노트 탭")}>
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
          </div>
          <h2>{note.title}</h2>
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
          <SourceEditor
            key={note.id + ":source:" + generation}
            id={note.id + ":split"}
            revision={note.revision}
            language={note.content_format ?? "html"}
            initialContent={note.content}
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
        </section>
      )}
      {!note && error && (
        <div role="alert">
          {error}
          {!ready && (
            <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>
              {t("분할 상태 다시 불러오기")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
