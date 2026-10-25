import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { restoreLocations } from "../lib/editor-location";
import { FileText, X } from "../icons";
import { useStore } from "../store";
import "./NoteTabs.css";
import { loadWorkspace, queueWorkspace, flushWorkspace, registerWorkspaceCapture } from "../lib/workspace";
import { t } from "../i18n";

const OPEN_TAB_EVENT = "inkism-open-tab";
/** 탭 끌기 데이터 형식: 값은 노트 id. 분할 편집기도 이 형식을 받는다. */
export const TAB_DRAG_TYPE = "application/x-inkism-tab";
/** Open a note in its own tab instead of replacing the preview tab (menu, Ctrl/middle click). */
export function openInNewTab(s: { selectNote: (id: string) => Promise<void> }, id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: id }));
  return s.selectNote(id);
}

/** Saved tabs that are not already open, followed by the open tabs. */
function prependMissing<T extends { id: string }>(saved: T[], current: T[]): T[] {
  return [...saved.filter((t) => !current.some((c) => c.id === t.id)), ...current];
}

/** Persist identifiers and bounded positions; inactive note bodies are not mounted.
 * Preview tab: a plain click replaces the single preview tab until it is edited or pinned. */
export function NoteTabs() {
  const s = useStore();
  const [tabs, setTabs] = useState<{ id: string; title: string; preview?: boolean }[]>([]);
  const newTabFor = useRef<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const active = s.selectedId;
  const store = useRef(s);
  store.current = s;
  const [ready, setReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const version = store.current.selectionVersion();
    void loadWorkspace()
      .then(async (saved) => {
        if (cancelled) return;
        restoreLocations(saved.locations);
        setTabs((current) => prependMissing(saved.tabs, current));
        if (store.current.selectionVersion() === version && !store.current.readDraft() && saved.active)
          await store.current.selectNote(saved.active);
        if (!cancelled) {
          setReady(true);
          setWorkspaceError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setWorkspaceError(t("이전 탭을 불러오지 못했습니다."));
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);
  useLayoutEffect(() => {
    const capture = () => {
      if (!ready) return;
      const ids = tabs.map((t) => t.id);
      // Native close can finish saving a new note before React commits its tab.
      const draft = store.current.readDraft();
      if (draft && !draft.isNew && !ids.includes(draft.id)) ids.push(draft.id);
      const selected = draft && !draft.isNew ? draft.id : store.current.selectedId;
      queueWorkspace({ ids, active: selected && ids.includes(selected) ? selected : null });
    };
    const unregister = registerWorkspaceCapture(capture);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let positionChanged = false;
    const save = () => {
      if (positionChanged) {
        capture();
        positionChanged = false;
      }
      void flushWorkspace()
        .then(() => setWorkspaceError(null))
        .catch(() => setWorkspaceError(t("편집 위치를 저장하지 못했습니다.")));
    };
    const changed = () => {
      positionChanged = true;
      clearTimeout(timer);
      timer = setTimeout(save, 500);
    };
    window.addEventListener("inkism-location-changed", changed);
    window.addEventListener("pagehide", save);
    return () => {
      clearTimeout(timer);
      unregister();
      window.removeEventListener("inkism-location-changed", changed);
      window.removeEventListener("pagehide", save);
    };
  }, [ready, tabs]);
  useLayoutEffect(() => {
    if (!ready) return;
    const ids = tabs.map((t) => t.id);
    queueWorkspace({ ids, active: active && ids.includes(active) ? active : null });
    void flushWorkspace()
      .then(() => setWorkspaceError(null))
      .catch(() => setWorkspaceError(t("열린 탭을 저장하지 못했습니다.")));
  }, [ready, tabs, active]);
  useEffect(() => {
    const save = () => {
      void flushWorkspace().catch(() => {});
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  useEffect(() => {
    const d = s.draft;
    if (!d || d.isNew) return;
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === d.id);
      if (index < 0) {
        const forced = newTabFor.current === d.id;
        newTabFor.current = null;
        // A freshly opened, unedited note is a preview; a restored dirty draft or new note is kept.
        const tab = { id: d.id, title: d.title, preview: !forced && store.current.saveState === "idle" };
        const preview = current.findIndex((t) => t.preview);
        return tab.preview && preview >= 0 ? current.map((t, i) => (i === preview ? tab : t)) : [...current, tab];
      }
      if (current[index].title === d.title) return current;
      return current.map((tab) => (tab.id === d.id ? { ...tab, title: d.title } : tab));
    });
  }, [s.draft?.id, s.draft?.title, s.draft?.isNew]);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      newTabFor.current = id;
      setTabs((current) => current.map((t) => (t.id === id ? { ...t, preview: false } : t)));
    };
    window.addEventListener(OPEN_TAB_EVENT, open);
    return () => window.removeEventListener(OPEN_TAB_EVENT, open);
  }, []);
  useEffect(() => {
    // Editing keeps the tab open.
    if (active && (s.saveState === "dirty" || s.saveState === "saving"))
      setTabs((current) =>
        current.some((t) => t.id === active && t.preview)
          ? current.map((t) => (t.id === active ? { ...t, preview: false } : t))
          : current,
      );
  }, [active, s.saveState]);
  useEffect(() => {
    const deleted = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setTabs((current) => current.filter((tab) => tab.id !== id));
    };
    window.addEventListener("inkism-note-deleted", deleted);
    return () => window.removeEventListener("inkism-note-deleted", deleted);
  }, []);
  useEffect(() => {
    setFocusId(active);
  }, [active]);
  useEffect(() => {
    if (active) buttons.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);
  // 끌어서 순서 바꾸기: 끄는 탭 id와 놓일 자리(앞에 끼울 탭 순번, 끝이면 tabs.length).
  const dragId = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dropIndex = (strip: HTMLElement, x: number) => {
    const items = [...strip.querySelectorAll<HTMLElement>(":scope > .note-tab")];
    const at = items.findIndex((item) => {
      const r = item.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return at < 0 ? items.length : at;
  };
  const latestTabs = useRef(tabs);
  latestTabs.current = tabs;
  useEffect(() => {
    // Ctrl+Tab·Ctrl+PageDown 다음 탭, Shift/PageUp 이전 탭, Ctrl+1..8 해당 탭, Ctrl+9 마지막 탭.
    const onKey = (event: KeyboardEvent) => {
      const list = latestTabs.current;
      if (event.defaultPrevented || event.isComposing || event.altKey || !list.length) return;
      if (document.querySelector("dialog[open]")) return;
      const index = list.findIndex((tab) => tab.id === store.current.selectedId);
      let next: number;
      if (event.ctrlKey && (event.key === "Tab" || event.key === "PageDown" || event.key === "PageUp")) {
        const back = event.key === "PageUp" || (event.key === "Tab" && event.shiftKey);
        if (event.key !== "Tab" && event.shiftKey) return;
        next = ((index < 0 && back ? 0 : index) + (back ? list.length - 1 : 1)) % list.length;
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        next = event.key === "9" ? list.length - 1 : Number(event.key) - 1;
        if (next >= list.length) return;
      } else return;
      event.preventDefault();
      if (list[next].id !== store.current.selectedId) void store.current.selectNote(list[next].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const close = async (id: string) => {
    if (closingRef.current) return;
    if (active !== id) {
      const hadFocus = document.activeElement === buttons.current.get(id);
      const index = tabs.findIndex((tab) => tab.id === id);
      const next = tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
      setTabs((current) => current.filter((tab) => tab.id !== id));
      if (hadFocus && next) buttons.current.get(next)?.focus();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    try {
      const index = tabs.findIndex((tab) => tab.id === id);
      const next = tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
      await s.selectNote(next);
      // selectNote keeps the draft on a failed flush or superseded navigation.
      if ((s.readDraft()?.id ?? null) !== next) return;
      setTabs((current) => current.filter((tab) => tab.id !== id));
      if (next) buttons.current.get(next)?.focus();
    } finally {
      closingRef.current = false;
      setClosing(false);
    }
  };
  if (!tabs.length && !workspaceError) return null;
  return (
    <div
      className="note-tabs"
      role="tablist"
            tabIndex={-1}
      aria-label={t("열린 노트")}
      data-tauri-drag-region="false"
      // 세로 휠로도 탭 줄을 가로로 넘긴다(스크롤바를 숨겼으므로).
      onWheel={(event) => {
        if (!event.deltaX) event.currentTarget.scrollLeft += event.deltaY;
      }}
      onDragOver={(event) => {
        if (!dragId.current || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropAt(dropIndex(event.currentTarget, event.clientX));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null);
      }}
      onDrop={(event) => {
        const id = dragId.current;
        if (!id || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
        event.preventDefault();
        dragId.current = null; // 줄 안에서 놓았다: dragend에서 닫지 않는다.
        const at = dropIndex(event.currentTarget, event.clientX);
        setDropAt(null);
        setTabs((current) => {
          const from = current.findIndex((tab) => tab.id === id);
          if (from < 0) return current;
          const to = at > from ? at - 1 : at;
          if (to === from) return current;
          const next = current.filter((tab) => tab.id !== id);
          next.splice(to, 0, current[from]);
          return next;
        });
      }}
    >
      {workspaceError && (
        <button
          type="button"
          onClick={() => {
            if (!ready) setLoadAttempt((n) => n + 1);
            else
              void flushWorkspace()
                .then(() => setWorkspaceError(null))
                .catch(() => {});
          }}
        >
          {workspaceError} {t("다시 시도")}
        </button>
      )}
      {tabs.map((tab, index) => (
        <div
          className={`note-tab${tab.id === active ? " is-selected" : ""}${tab.preview ? " is-preview" : ""}${
            dropAt === index ? " is-drop-before" : dropAt === tabs.length && index === tabs.length - 1 ? " is-drop-after" : ""
          }`}
          key={tab.id}
          role="presentation"
          draggable
          onDragStart={(event) => {
            dragId.current = tab.id;
            event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
            event.dataTransfer.effectAllowed = "copyMove";
          }}
          onDragEnd={(event) => {
            // 다른 곳(분할 탭 줄)이 "옮기기"로 받았으면 여기서는 닫는다.
            if (dragId.current && event.dataTransfer.dropEffect === "move") void close(tab.id);
            dragId.current = null;
            setDropAt(null);
          }}
          // 가운데 버튼 클릭으로 탭을 닫는다(자동 스크롤은 막는다).
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (event.button !== 1 || closing) return;
            event.preventDefault();
            void close(tab.id);
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            aria-controls="note-editor-panel"
            id={`note-tab-${tab.id}`}
            title={tab.title || t("제목 없음")}
            aria-label={t("노트 탭: {title}", { title: tab.title || t("제목 없음") })}
            tabIndex={tab.id === (focusId ?? active ?? tabs[0].id) ? 0 : -1}
            ref={(button) => {
              if (button) buttons.current.set(tab.id, button);
              else buttons.current.delete(tab.id);
            }}
            onFocus={() => setFocusId(tab.id)}
            onClick={() => void s.selectNote(tab.id)}
            onDoubleClick={() =>
              setTabs((current) => current.map((t) => (t.id === tab.id ? { ...t, preview: false } : t)))
            }
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else if (event.key === "Delete") {
                event.preventDefault();
                void close(tab.id);
                return;
              } else return;
              event.preventDefault();
              buttons.current.get(tabs[next].id)?.focus();
            }}
          >
            <FileText size={13} aria-hidden />
            <span className={tab.title ? undefined : "is-untitled"}>{tab.title || t("제목 없음")}</span>
          </button>
          <button
            type="button"
            className="note-tab-close"
            aria-label={t("탭 닫기: {title}", { title: tab.title || t("제목 없음") })}
            title={t("탭 닫기 (탭에 초점을 두고 Delete)")}
            tabIndex={-1}
            disabled={closing}
            onClick={() => void close(tab.id)}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
