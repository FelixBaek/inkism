import { readBacklinkLocation, type BacklinkLocation } from "../lib/backlink-location";
import { navigateNoteAnchor } from "../lib/note-anchor";
import { knowledge } from "../lib/knowledge";
import type { Note } from "../types";
import React, { useEffect, useRef, useState } from "react";
import { X, Pin, Star, Archive, PencilOff, FileText } from "../icons";
import { KNOWLEDGE_EVENT, PropertyEditor } from "./KnowledgeTools";
import { NoteConnections } from "./NoteConnections";
import { api } from "../api";
import { useStore } from "../store";
import { lang, t } from "../i18n";
import type { HistoryEntry } from "../types";
import "./NoteInspector.css";

type DragState = { x: number; width: number; current: number };
type Store = ReturnType<typeof useStore>;

const timestamp = (value?: number) => (value ? new Date(value).toLocaleString(lang) : t("저장 후 표시"));
const shortTime = (value: number) =>
  new Date(value).toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Esc closes the panel; in overlay mode Tab cycles inside it. */
function handleInspectorKeys(event: React.KeyboardEvent<HTMLElement>, overlay: boolean, onClose: () => void) {
  if ((event.target as Element).closest("dialog")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
  if (event.key !== "Tab" || !overlay) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),a[href],select:not(:disabled),[tabindex="0"]',
    ),
  );
  const first = buttons[0],
    last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function keyboardWidth(key: string, width: number) {
  if (key === "Home") return 220;
  if (key === "End") return 480;
  return width + (key === "ArrowLeft" ? 20 : -20);
}

function InspectorResize({
  width,
  drag,
  setWidth,
  rememberWidth,
  onClose,
}: Readonly<{
  width: number;
  drag: React.MutableRefObject<DragState | null>;
  setWidth: (value: number) => void;
  rememberWidth: (value: number) => void;
  onClose: () => void;
}>) {
  return (
    <hr
      className="inspector-resize plain-hr"
      aria-label={t("속성 패널 너비 조절")}
      aria-orientation="vertical"
      aria-valuemin={160}
      aria-valuemax={480}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const actual = event.currentTarget.parentElement!.getBoundingClientRect().width;
        drag.current = { x: event.clientX, width: actual, current: actual };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.current = Math.max(160, Math.min(480, start.width + start.x - event.clientX));
        setWidth(start.current);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (start.current < 220) {
          setWidth(start.width);
          onClose();
        } else rememberWidth(start.current);
      }}
      onPointerCancel={() => {
        if (drag.current) {
          setWidth(drag.current.width);
          drag.current = null;
        }
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = keyboardWidth(event.key, width);
        if (next < 220) onClose();
        else rememberWidth(Math.min(480, next));
      }}
    />
  );
}

export function BacklinkList({ s }: Readonly<{ s: Store }>) {
  const [contexts, setContexts] = useState<Record<string, BacklinkLocation | undefined>>({}),
    [error, setError] = useState("");
  const cache = useRef<{ target: string; items: Record<string, BacklinkLocation | undefined> }>({
    target: "",
    items: {},
  });
  const selected = useRef(s.note?.id),
    pending = useRef<Promise<void>>(Promise.resolve());
  selected.current = s.note?.id;
  useEffect(() => {
    const controller = new AbortController(),
      target = s.note?.id;
    if (!target) return;
    if (cache.current.target !== target || !s.backlinks) {
      cache.current = { target, items: {} };
      setContexts({});
      setError("");
    }
    const items = (s.backlinks ?? []).filter((n) => !cache.current.items[n.id]);
    pending.current = (async () => {
      const metadata = await knowledge.get(target).catch(() => null);
      if (controller.signal.aborted) return;
      const names = [s.note?.title ?? "", ...(metadata?.aliases ?? [])];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, items.length) }, async () => {
          while (!controller.signal.aborted) {
            const item = items[next++];
            if (!item) return;
            try {
              const location = await readBacklinkLocation(item.id, target, names, controller.signal);
              if (controller.signal.aborted) return;
              cache.current.items[item.id] = location;
              setContexts({ ...cache.current.items });
            } catch {
              /* Locked/deleted/oversized notes retain their indexed preview without reading a full body. */
            }
          }
        }),
      );
    })();
    return () => controller.abort();
  }, [s.note?.id, s.note?.title, s.backlinks]);
  const open = async (id: string) => {
    const target = s.note?.id;
    setError("");
    try {
      if (!(await s.flushNow()) || selected.current !== target) return;
      await pending.current;
      if (selected.current !== target) return;
      const location = cache.current.items[id];
      if (!location) throw new Error(t("연결 위치를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요."));
      const note =
        location.anchor.byteOffset === undefined
          ? await api.get(id, { max_body_bytes: 2 * 1024 * 1024 })
          : await api.documentInfo(id, location.revision).then((info) => ({ ...info.summary, content: "", text: "" }));
      if (selected.current !== target) return;
      if (("locked" in note && note.locked) || note.trashed || note.revision !== location.revision)
        throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
      await s.selectNote(id);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (location.anchor.byteOffset !== undefined) {
        const deadline = Date.now() + 10000;
        while (document.querySelector(".windowed-editor") && !document.querySelector(".windowed-editor .ProseMirror")) {
          if (Date.now() > deadline) throw new Error(t("문서를 준비 중입니다. 잠시 후 다시 열어 주세요."));
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      const draft = s.readDraft();
      const locatedNote =
        note.content_format === "markdown" && draft?.id === id && draft.revision === note.revision
          ? { ...note, content: draft.content, text: draft.text }
          : note;
      await navigateNoteAnchor(locatedNote, location.anchor);
    } catch (e) {
      setError(e instanceof Error ? t(e.message) : String(e));
    }
  };
  if (s.backlinks === null) return <p className="inspector-hint">{t("연결 정보를 확인하는 중…")}</p>;
  return (
    <>
      {(error || s.backlinksError) && <p role="alert">{error || s.backlinksError}</p>}
      {!s.backlinks.length && <p className="inspector-hint">{t("이 노트를 가리키는 노트가 없습니다.")}</p>}
      <ul className="inspector-list">
        {s.backlinks.map((note) => (
          <li key={note.id}>
            <button
              type="button"
              aria-label={t("역링크 노트 열기: {title}", { title: note.title || t("제목 없음") })}
              onClick={() => void open(note.id)}
            >
              <FileText size={16} aria-hidden />
              <span>{note.title || t("제목 없음")}</span>
            </button>
            <p className="inspector-hint" aria-label={t("역링크 문맥")}>
              {contexts[note.id]?.context ?? note.preview}
            </p>
          </li>
        ))}
      </ul>
      {s.backlinksCursor && (
        <button className="btn" disabled={s.backlinksBusy} onClick={() => void s.loadMoreBacklinks()}>
          {s.backlinksBusy ? t("불러오는 중…") : t("역링크 더 불러오기")}
        </button>
      )}
    </>
  );
}

function historyLabel(entry: HistoryEntry, change: {added: number | null; removed: number | null} | undefined) {
  if (entry.label) return t("보관: {name}", {name: entry.label});
  if (change?.added != null) return t("{added}개 추가 / {removed}개 삭제", {added: change.added, removed: change.removed!});
  return entry.title || t("제목 없음");
}

function HistoryBody({
  s,
  persisted,
  historyError,
  history,
  working,
  retry,
  restore,
}: Readonly<{
  s: Store;
  persisted: boolean;
  historyError: string;
  history: HistoryEntry[] | null;
  working: boolean;
  retry: () => void;
  restore: (historyId: string) => Promise<void>;
}>) {
  const [picked, setPicked] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [changes, setChanges] = useState<Record<string, { added: number | null; removed: number | null }>>({});
  const noteId = s.note?.id;
  useEffect(() => {
    if (!noteId || !history?.length) return;
    let live = true;
    void api
      .historyChanges(noteId, 5)
      .then((result) => {
        if (live) setChanges(Object.fromEntries(result.items.map((item) => [item.id, item])));
      })
      .catch(() => {}); // Older engines without the op keep showing titles.
    return () => {
      live = false;
    };
  }, [noteId, history]);
  // Same copy the history dialog makes: the old body as a new note beside the current one.
  const saveCopy = async (entry: HistoryEntry) => {
    const note = s.note;
    if (!note || copying) return;
    setCopying(true);
    try {
      if (!(await s.flushNow())) return;
      const old = await api.historyBody(note.id, entry.id);
      const copy = await api.save({
        id: crypto.randomUUID(),
        title: (entry.title || "제목 없음") + " (이전 버전 사본)",
        content: old.content,
        content_format: old.content_format ?? entry.content_format ?? "html",
        notebook_id: note.notebook_id ?? null,
        tags: note.tags ?? [],
      });
      s.refreshList();
      await s.selectNote(copy.id);
    } catch (e) {
      await s.showError(t("사본으로 저장"), e instanceof Error ? e.message : t("사본을 저장하지 못했습니다"));
    } finally {
      setCopying(false);
    }
  };
  if (!persisted) return <p className="inspector-hint">{t("노트를 저장하면 기록이 표시됩니다.")}</p>;
  if (historyError)
    return (
      <div role="alert">
        <p className="inspector-hint">{historyError}</p>
        <button className="btn btn-ghost" type="button" onClick={retry}>
          {t("기록 다시 불러오기")}
        </button>
      </div>
    );
  if (history === null)
    return (
      <p className="inspector-hint">
        <output>{t("기록을 불러오는 중…")}</output>
      </p>
    );
  if (history.length === 0) return <p className="inspector-hint">{t("아직 저장된 버전이 없습니다.")}</p>;
  const entries = history.slice(0, 5);
  const selected = entries.find((entry) => entry.id === picked) ?? entries[0];
  const time = timestamp(selected.created_at);
  return (
    <>
      <ul className="inspector-history-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button type="button" aria-pressed={entry.id === selected.id} onClick={() => setPicked(entry.id)}>
              <time dateTime={new Date(entry.created_at).toISOString()} title={timestamp(entry.created_at)}>
                {shortTime(entry.created_at)}
              </time>
              <span title={entry.title}>
                {historyLabel(entry, changes[entry.id])}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="inspector-actions">
        <button
          type="button"
          className="btn"
          aria-label={t("버전 비교: {time}", { time })}
          onClick={() => s.openHistory(selected.id)}
        >
          {t("비교")}
        </button>
        <button type="button" className="btn" disabled={copying} onClick={() => void saveCopy(selected)}>
          {t("사본으로 저장")}
        </button>
      </div>
      <button
        type="button"
        className="btn btn-primary inspector-wide"
        disabled={working}
        aria-label={t("버전 복원: {time}", { time })}
        onClick={() => void restore(selected.id)}
      >
        {t("이 버전으로 복원")}
      </button>
    </>
  );
}

/** Remounts the editor when another surface saves properties, so stale aliases are never written back. */
function InspectorProperties() {
  const [generation, setGeneration] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // This panel's own save keeps focus inside it; skip that one so its "saved" notice stays.
    const reload = () => {
      if (!root.current?.contains(document.activeElement)) setGeneration((value) => value + 1);
    };
    window.addEventListener("inkism-knowledge-changed", reload);
    return () => window.removeEventListener("inkism-knowledge-changed", reload);
  }, []);
  return (
    <div ref={root} className="inspector-properties">
      <PropertyEditor key={generation} />
    </div>
  );
}

export function NoteInspector({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const s = useStore();
  const id = s.draft?.id,
    revision = s.draft?.revision;
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("inkism.inspector.width"));
      return Number.isFinite(saved) && saved >= 220 && saved <= 480 ? saved : 300;
    } catch {
      return 300;
    }
  });
  const drag = useRef<DragState | null>(null);
  const rememberWidth = (value: number) => {
    setWidth(value);
    try {
      localStorage.setItem("inkism.inspector.width", String(value));
    } catch {}
  };
  useEffect(() => {
    if (!open && drag.current) {
      setWidth(drag.current.width);
      drag.current = null;
    }
  }, [open]);
  const [overlay, setOverlay] = useState(() => matchMedia("(max-width:1279px)").matches);
  useEffect(() => {
    if (!open) return;
    const media = matchMedia("(max-width:1279px)"),
      workspace = closeRef.current?.closest(".editor-workspace");
    const update = () =>
      setOverlay(media.matches || Boolean(workspace && workspace.getBoundingClientRect().width < 760));
    const observer = new ResizeObserver(update);
    if (workspace) observer.observe(workspace);
    media.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !id || s.draft?.isNew) {
      setHistory(null);
      return;
    }
    let active = true;
    setHistory(null);
    setHistoryError("");
    void api
      .history(id)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch(() => {
        if (active) setHistoryError(t("버전 기록을 불러오지 못했습니다."));
      });
    return () => {
      active = false;
    };
  }, [open, id, revision, attempt, s.draft?.isNew]);
  useEffect(() => {
    if (open && overlay) closeRef.current?.focus({ preventScroll: true });
  }, [open, overlay]);
  if (!open) return null;
  const persisted = Boolean(s.note && s.draft && !s.draft.isNew);
  const change = async (patch: { pinned?: boolean; favorite?: boolean; archived?: boolean; readonly?: boolean }) => {
    if (busy.current || !persisted) return;
    busy.current = true;
    setWorking(true);
    try {
      if (await s.ensurePersisted()) await s.patchNote(patch);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };
  const restore = async (historyId: string) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      await s.restoreVersion(historyId);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };
  return (
    <>
      {overlay && (
        <button type="button" className="inspector-scrim" aria-label={t("노트 속성 배경 닫기")} onClick={onClose} />
      )}
      <aside
        id="note-inspector"
        style={{ width, flexBasis: width }}
        className={`note-inspector${overlay ? " is-overlay" : ""}`}
        role={overlay ? "dialog" : "complementary"}
        aria-modal={overlay ? true : undefined}
        aria-labelledby="note-inspector-title"
        onKeyDown={(event) => handleInspectorKeys(event, overlay, onClose)}
      >
        <InspectorResize
          width={width}
          drag={drag}
          setWidth={setWidth}
          rememberWidth={rememberWidth}
          onClose={onClose}
        />
        <header>
          <h2 id="note-inspector-title">{t("노트 정보")}</h2>
          <button type="button" className="icon-btn" ref={closeRef} aria-label={t("노트 속성 닫기")} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {!s.draft ? (
          <p className="inspector-hint">{t("노트를 선택해 주세요.")}</p>
        ) : (
          <div className="inspector-scroll">
            <p className="inspector-note-title" title={s.draft.title}>
              {s.draft.title || t("제목 없는 노트")}
            </p>
            <section aria-labelledby="inspector-properties">
              <h3 id="inspector-properties">{t("속성")}</h3>
              <label className="inspector-toggle">
                <span>
                  <Pin size={15} aria-hidden />
                  {t("위로 고정")}
                </span>
                <input
                  type="checkbox"
                  checked={s.note?.pinned ?? false}
                  disabled={!persisted || working || s.note?.trashed}
                  onChange={(e) => void change({ pinned: e.target.checked })}
                />
              </label>
              <label className="inspector-toggle">
                <span>
                  <Star size={15} aria-hidden />
                  {t("즐겨찾기")}
                </span>
                <input
                  type="checkbox"
                  checked={s.note?.favorite ?? false}
                  disabled={!persisted || working}
                  onChange={(e) => void change({ favorite: e.target.checked })}
                />
              </label>
              <label className="inspector-toggle">
                <span>
                  <PencilOff size={15} aria-hidden />
                  {t("읽기 전용")}
                </span>
                <input
                  type="checkbox"
                  checked={s.note?.readonly ?? false}
                  disabled={!persisted || working}
                  onChange={(e) => void change({ readonly: e.target.checked })}
                />
              </label>
              <label className="inspector-toggle">
                <span>
                  <Archive size={15} aria-hidden />
                  {t("보관함")}
                </span>
                <input
                  type="checkbox"
                  checked={s.note?.archived ?? false}
                  disabled={!persisted || working || s.note?.trashed}
                  onChange={(e) => void change({ archived: e.target.checked })}
                />
              </label>
              <h3 className="inspector-notebooks-heading">{t("폴더")}</h3>
              <button
                className="inspector-notebook"
                onClick={() => document.getElementById("notebook-select")?.focus()}
              >
                {s.notebooks.find((n) => n.id === s.draft?.notebook_id)?.name || t("+ 추가")}
              </button>
              <dl className="inspector-times">
                <div>
                  <dt>{t("만든 날짜")}</dt>
                  <dd>
                    <time dateTime={s.note ? new Date(s.note.created_at).toISOString() : undefined}>
                      {timestamp(s.note?.created_at)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>{t("수정한 날짜")}</dt>
                  <dd>
                    <time dateTime={s.note ? new Date(s.note.updated_at).toISOString() : undefined}>
                      {timestamp(s.note?.updated_at)}
                    </time>
                  </dd>
                </div>
              </dl>
            </section>
            {s.note && <InspectorProperties key={s.note.id} />}
            {s.note && (
              <section aria-labelledby="inspector-connections">
                <h3 id="inspector-connections">{t("노트 연결")}</h3>
                <NoteConnections key={s.note.id} compact onClose={onClose} />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => window.dispatchEvent(new CustomEvent(KNOWLEDGE_EVENT, { detail: "note" }))}
                >
                  {t("연결 목록과 언급 보기")}
                </button>
              </section>
            )}
            <section aria-labelledby="inspector-history">
              <h3 id="inspector-history">{t("버전 기록")}</h3>
              <HistoryBody
                s={s}
                persisted={persisted}
                historyError={historyError}
                history={history}
                working={working}
                retry={() => setAttempt((value) => value + 1)}
                restore={restore}
              />
              <p className="inspector-note">{t("복원 전에 현재 내용이 버전으로 보관됩니다.")}</p>
              {persisted && !historyError && (
                <div className="inspector-links">
                  <button type="button" className="btn btn-ghost" onClick={() => setAttempt((value) => value + 1)}>
                    {t("기록 다시 불러오기")}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => s.openHistory()}>
                    {t("전체 버전 기록 보기")}
                  </button>
                </div>
              )}
            </section>
            <section aria-labelledby="inspector-links">
              <h3 id="inspector-links">
                {t("역링크")} <span className="inspector-count">{s.backlinks?.length ?? 0}</span>
              </h3>
              <BacklinkList s={s} />
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
