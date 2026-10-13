import React, { useEffect, useMemo, useRef, useState } from "react";
import { Files, List, Search, X } from "../icons";
import { CalendarBlankIcon as CalendarDays } from "@phosphor-icons/react";
import { api, rpc, hasRpcDiagnostic } from "../api";
import { useStore } from "../store";
import type { Note, Summary } from "../types";
import { t } from "../i18n";
import { defaultEditor } from "../lib/editor-settings";
import {
  localDate,
  localTime,
  rankNotes,
  headingSiblingIndex,
  reorderMarkdownHeading,
  reorderHTMLHeading,
} from "../lib/writing-tools";
import { navigateNoteAnchor, noteAnchors, type NoteAnchor } from "../lib/note-anchor";
import { knowledge } from "../lib/knowledge";
import { readPref, writePref } from "../lib/pref";
import "./WritingTools.css";
interface KnowledgeSettings {
  version: number;
  template_ids: string[];
  daily_template_id: string | null;
}
type MergePreview = { id: string; status: string; source: Note; target: Note; merged: Note; redirect: boolean };
type MergeChange = {
  id: string;
  status: string;
  can_undo: boolean;
  created_at: number;
  source_title: string;
  target_title: string;
};
type Panel = "quick" | "templates" | "outline" | "merge" | null;
export const WRITING_TOOL_EVENT = "inkism-open-writing-tool";
const RECENT_KEY = "inkism.writing.recent";
function recentNotes(): string[] {
  try {
    const value = JSON.parse(readPref(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}
/** Mount once in the application toolbar, including when no note is selected. */
function writingPanelTitle(panel: Panel) {
  if (panel === "quick") return t("빠른 전환");
  if (panel === "templates") return t("템플릿");
  if (panel === "merge") return t("노트 합치기");
  return t("목차");
}

export function WritingTools() {
  const s = useStore(),
    latest = useRef(s);
  latest.current = s;
  const [panel, setPanel] = useState<Panel>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notes, setNotes] = useState<Summary[]>([]),
    [limited, setLimited] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const [settings, setSettings] = useState<KnowledgeSettings | null>(null),
    [templates, setTemplates] = useState<Summary[]>([]);
  const [outline, setOutline] = useState<{ note: Note; anchors: NoteAnchor[] } | null>(null);
  const [mergeSource, setMergeSource] = useState(""),
    [mergeTarget, setMergeTarget] = useState(""),
    [mergeRedirect, setMergeRedirect] = useState(true);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null),
    [mergeChanges, setMergeChanges] = useState<MergeChange[]>([]);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    seq = useRef(0),
    running = useRef(false);
  // Text typed in the template popup's quick-switch field carries over into the quick switch panel.
  const pendingQuery = useRef(""),
    [switchText, setSwitchText] = useState("");
  const close = () => {
    seq.current++;
    setPanel(null);
    setError("");
    setBusy(false);
  };
  const recent = useMemo(recentNotes, [panel, s.selectedId]);
  useEffect(() => {
    if (s.selectedId)
      writePref(
        RECENT_KEY,
        JSON.stringify([s.selectedId, ...recentNotes().filter((id) => id !== s.selectedId)].slice(0, 50)),
      );
  }, [s.selectedId]);
  // 셸(사이드바 등)에서 패널을 연다: dispatchEvent(new CustomEvent(WRITING_TOOL_EVENT,{detail:"templates"})).
  useEffect(() => {
    const open = (e: Event) => {
      const p = (e as CustomEvent<Panel>).detail;
      if (p && !running.current) setPanel(p);
    };
    window.addEventListener(WRITING_TOOL_EVENT, open);
    return () => window.removeEventListener(WRITING_TOOL_EVENT, open);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o" && !e.altKey && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!running.current) setPanel("quick");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // 편집기 도구줄의 [목차] 버튼이 보내는 요청.
  useEffect(() => {
    const open = () => {
      if (!running.current) setPanel("outline");
    };
    window.addEventListener("inkism-open-outline", open);
    return () => window.removeEventListener("inkism-open-outline", open);
  }, []);
  useEffect(() => {
    if (!panel) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    setError("");
    setQuery(pendingQuery.current);
    pendingQuery.current = "";
    setActive(0);
    setBusy(true);
    const request = ++seq.current;
    const alive = () => request === seq.current;
    void (async () => {
      if (panel === "quick" || panel === "merge") {
        if (panel === "merge") {
          setMergePreview(null);
          const result = await rpc<{ items: MergeChange[] }>("merge_changes");
          if (!alive()) return;
          setMergeChanges(result.items);
        }
        const collected: Summary[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await api.list({
            view: "all",
            limit: 100,
            cursor,
            sort_by: "updated_at",
            sort_direction: "desc",
          });
          if (!alive()) return;
          for (const note of page.items)
            if (!seen.has(note.id) && !note.trashed) {
              collected.push(note);
              seen.add(note.id);
            }
          cursor = page.next_cursor ?? undefined;
          if (cursor && collected.length >= 10000) break;
        } while (cursor);
        const metadata = await knowledge.list();
        if (!alive()) return;
        const aliases = new Map(metadata.items.map((n) => [n.id, n.aliases]));
        setNotes(collected.map((n) => ({ ...n, aliases: aliases.get(n.id) ?? [] })));
        setLimited(Boolean(cursor));
      } else if (panel === "templates") {
        const config = await rpc<KnowledgeSettings>("knowledge_settings_get");
        const list = await Promise.all(
          config.template_ids.map(async (id) => {
            try {
              const note = await api.get(id);
              return note.trashed ? null : { ...note, preview: "" };
            } catch {
              return null;
            }
          }),
        );
        if (!alive()) return;
        setSettings(config);
        setTemplates(list.filter((note): note is Note & { preview: string } => note !== null));
      } else {
        if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
        const draft = latest.current.readDraft();
        if (!draft?.id || draft.isNew) throw new Error(t("저장한 노트에서 목차를 열어 주세요."));
        const note = await api.get(draft.id);
        if (!alive()) return;
        if (latest.current.readDraft()?.id !== note.id || latest.current.readDraft()?.revision !== note.revision)
          throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
        if (new Blob([note.content]).size > 8 * 1024 * 1024)
          throw new Error(t("목차는 8MB 이하 문서에서 사용할 수 있습니다."));
        setOutline({
          note,
          anchors: noteAnchors(note.content, note.content_format).filter((a) => a.kind === "heading"),
        });
      }
    })()
      .catch((e) => {
        if (alive()) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive()) {
          setBusy(false);
          setTimeout(() => input.current?.focus(), 0);
        }
      });
    return () => {
      seq.current++;
    };
  }, [panel]);
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        hasRpcDiagnostic(e, "duplicate_block_id")
          ? t(
              "같은 문단 ID가 있어 병합하지 않았습니다. HTML id 또는 Markdown ^ID의 중복을 수정한 뒤 다시 시도해 주세요.",
            )
          : message,
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const openNote = async (id: string) => {
    await latest.current.selectNote(id);
    if (latest.current.readDraft()?.id === id) close();
    else throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
  };
  const newTitled = (title: string) =>
    void run(async () => {
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const note = await api.save({
        id: crypto.randomUUID(),
        title: title.trim(),
        content: "",
        content_format: defaultEditor(),
      });
      latest.current.refreshList();
      await latest.current.refreshMeta();
      await openNote(note.id);
    });
  const daily = () =>
    void run(async () => {
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const date = new Date();
      const note = await rpc<Note>("daily_note", {
        date: localDate(date),
        time: localTime(date),
        content_format: defaultEditor(),
      });
      latest.current.refreshList();
      await latest.current.refreshMeta();
      await openNote(note.id);
    });
  const saveConfig = async (patch: Partial<KnowledgeSettings>) => {
    if (!settings) return;
    const config = await rpc<KnowledgeSettings>("knowledge_settings_set", { version: settings.version, ...patch });
    setSettings(config);
  };
  const registerTemplate = () =>
    void run(async () => {
      if (!settings || !(await latest.current.ensurePersisted()))
        throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const draft = latest.current.readDraft();
      if (!draft?.id) return;
      const note = await api.get(draft.id);
      if (note.trashed) throw new Error(t("지운 노트는 템플릿으로 등록할 수 없습니다."));
      if (!settings.template_ids.includes(note.id))
        await saveConfig({ template_ids: [...settings.template_ids, note.id] });
      setTemplates((rows) => (rows.some((row) => row.id === note.id) ? rows : [...rows, { ...note, preview: "" }]));
    });
  const createTemplate = (template: Summary) =>
    void run(async () => {
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      // Use the app prompt above the closed modal, then reopen on cancellation/failure.
      dialog.current?.close();
      const title = await latest.current.prompt({
        title: t("템플릿으로 새 노트"),
        message: t("새 노트의 제목을 입력하세요."),
        label: t("노트 제목"),
        initial: template.title,
      });
      if (!title) {
        dialog.current?.showModal();
        return;
      }
      try {
        const date = new Date(),
          note = await rpc<Note>("template_create", {
            template_id: template.id,
            title: title.value,
            date: localDate(date),
            time: localTime(date),
          });
        latest.current.refreshList();
        await latest.current.refreshMeta();
        await openNote(note.id);
      } catch (e) {
        dialog.current?.showModal();
        throw e;
      }
    });
  const mergeNotes = () =>
    void run(async () => {
      if (!mergeSource || !mergeTarget || mergeSource === mergeTarget)
        throw new Error(t("합칠 원본과 대상 노트를 다르게 선택해 주세요."));
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const [source, target] = await Promise.all([api.get(mergeSource), api.get(mergeTarget)]);
      if (source.trashed || target.trashed) throw new Error(t("지운 노트는 합칠 수 없습니다."));
      if (source.readonly || target.readonly) throw new Error(t("읽기 전용 노트는 합칠 수 없습니다."));
      if (source.content_format !== target.content_format)
        throw new Error(t("같은 편집기 형식의 노트만 합칠 수 있습니다."));
      setMergePreview(
        await rpc<MergePreview>("merge_preview", {
          source_id: source.id,
          target_id: target.id,
          source_revision: source.revision,
          target_revision: target.revision,
          redirect: mergeRedirect,
        }),
      );
    });
  const applyMerge = () =>
    void run(async () => {
      if (!mergePreview) return;
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const result = await rpc<MergePreview>("merge_apply", { id: mergePreview.id });
      setMergePreview(null);
      setMergeSource("");
      setNotes((rows) => rows.filter((note) => note.id !== result.source.id));
      latest.current.refreshList();
      await latest.current.refreshMeta();
      await latest.current.selectNote(result.target.id);
      setMergeChanges((await rpc<{ items: MergeChange[] }>("merge_changes")).items);
    });
  const undoMerge = (id: string) =>
    void run(async () => {
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const result = await rpc<MergePreview>("merge_undo", { id });
      setMergePreview(null);
      const restored = await api.get(result.source.id);
      setNotes((rows) => [{ ...restored, preview: "" }, ...rows.filter((note) => note.id !== restored.id)]);
      latest.current.refreshList();
      await latest.current.refreshMeta();
      await latest.current.selectNote(result.source.id);
      setMergeChanges((await rpc<{ items: MergeChange[] }>("merge_changes")).items);
    });
  const matched = useMemo(() => rankNotes(notes, query, recent).slice(0, 100), [notes, query, recent]);
  const index = Math.min(active, Math.max(0, matched.length - 1));
  const selectAnchor = (anchor: NoteAnchor) =>
    void run(async () => {
      if (!outline) return;
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const draft = latest.current.readDraft();
      if (draft?.id !== outline.note.id || draft.revision !== outline.note.revision)
        throw new Error(t("문서가 변경되었습니다. 목차를 다시 열어 주세요."));
      dialog.current?.close();
      try {
        await navigateNoteAnchor(outline.note, anchor);
        close();
      } catch (e) {
        dialog.current?.showModal();
        throw e;
      }
    });
  const moveHeading = (anchor: NoteAnchor, direction: "up" | "down") =>
    void run(async () => {
      if (!outline) return;
      if (!(await latest.current.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      const snapshot = latest.current.readDraft();
      if (!snapshot || snapshot.id !== outline.note.id || snapshot.readonly)
        throw new Error(t("현재 노트를 편집할 수 없습니다."));
      if (snapshot.revision !== outline.note.revision)
        throw new Error(t("문서가 변경되었습니다. 목차를 다시 열어 주세요."));
      const next =
        (outline.note.content_format ?? "html") === "html"
          ? reorderHTMLHeading(outline.note.content, anchor.index, direction, anchor.sourceOffset)
          : reorderMarkdownHeading(outline.note.content, anchor.index, direction);
      if (next === null || next === outline.note.content) return;
      latest.current.stageWholeBody(snapshot, snapshot.revision, snapshot.paged?.version, next, outline.note.content);
      if (!(await latest.current.flushNow())) throw new Error(t("목차 순서를 저장하지 못했습니다."));
      setPanel(null);
      setTimeout(() => setPanel("outline"), 0);
    });
  const unregisterTemplate = (id: string) =>
    void run(async () => {
      if (!settings) return;
      await saveConfig({
        template_ids: settings.template_ids.filter((key) => key !== id),
        ...(settings.daily_template_id === id ? { daily_template_id: null } : {}),
      });
      setTemplates((rows) => rows.filter((row) => row.id !== id));
    });
  return (
    <>
      <div className="writing-tools" role="group" aria-label={t("작성 도구")}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={daily}
          disabled={busy}
          aria-label={t("일일 노트")}
          title={t("오늘의 노트")}
        >
          <CalendarDays size={16} />
          <span>{t("일일 노트")}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setPanel("templates")}
          disabled={busy}
          aria-label={t("템플릿")}
        >
          <Files size={16} />
          <span>{t("템플릿")}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setPanel("quick")}
          disabled={busy}
          aria-label={t("빠른 전환")}
          title="Ctrl/⌘+O"
        >
          <Search size={16} />
          <span>{t("빠른 전환")}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setPanel("outline")}
          disabled={busy || !s.draft}
          aria-label={t("목차")}
        >
          <List size={16} />
          <span>{t("목차")}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setPanel("merge")}
          disabled={busy}
          aria-label={t("노트 합치기")}
        >
          <span>{t("노트 합치기")}</span>
        </button>
      </div>
      {!panel && error && (
        <span role="alert" className="writing-tools-error">
          {error}
        </span>
      )}
      <dialog
        ref={dialog}
        className="writing-tools-dialog"
        aria-label={writingPanelTitle(panel)}
        onCancel={(e) => {
          if (running.current) e.preventDefault();
          else close();
        }}
      >
        <header>
          <strong>{writingPanelTitle(panel)}</strong>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label={t("닫기")}
            disabled={running.current}
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {busy && (
          <p>
            <output>{t("불러오는 중…")}</output>
          </p>
        )}
        {panel === "quick" && (
          <>
            <input
              ref={input}
              aria-label={t("노트 제목 검색")}
              placeholder={t("노트 제목 검색")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls="writing-quick-results"
              aria-activedescendant={matched.length ? `writing-quick-${index}` : undefined}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(Math.max(0, Math.min(matched.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
                }
                if (e.key === "Enter" && matched[index]) {
                  e.preventDefault();
                  void run(() => openNote(matched[index].id));
                }
              }}
            />
            <p className="writing-tools-hint">
              {query ? t("제목이 일치하는 노트") : t("최근에 연 노트가 먼저 표시됩니다.")}
              {limited && ` · ${t("최근 수정된 10,000개 노트에서 검색합니다.")}`}
            </p>
            <div id="writing-quick-results" role="listbox" className="writing-tools-list">
              {matched.map((note, i) => (
                <button
                  type="button"
                  id={`writing-quick-${i}`}
                  key={note.id}
                  role="option"
                  aria-selected={index === i}
                  disabled={busy}
                  onMouseMove={() => setActive(i)}
                  onClick={() => void run(() => openNote(note.id))}
                >
                  {note.title || t("제목 없는 노트")}
                </button>
              ))}
            </div>
            {!busy && !matched.length && <p>{t("일치하는 노트가 없습니다.")}</p>}
            {query.trim() && (
              <button className="btn" disabled={busy} onClick={() => newTitled(query)}>
                {t("이 제목으로 새 노트")}
              </button>
            )}
          </>
        )}
        {panel === "templates" && settings && (
          <>
            <label className="writing-tools-field">
              {t("일일 노트 템플릿")}
              <select
                disabled={busy}
                value={settings.daily_template_id ?? ""}
                onChange={(e) => void run(() => saveConfig({ daily_template_id: e.target.value || null }))}
              >
                <option value="">{t("빈 노트")}</option>
                {templates.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title || t("제목 없는 노트")}
                  </option>
                ))}
              </select>
            </label>
            <div className="writing-tools-actions">
              <button className="btn btn-primary" disabled={busy} onClick={daily}>
                {t("오늘의 노트 열기")}
              </button>
              <button className="btn btn-secondary" disabled={busy || !s.draft} onClick={registerTemplate}>
                {t("현재 노트를 템플릿으로 등록")}
              </button>
            </div>
            <div className="writing-tools-list">
              {templates.map((note) => (
                <div key={note.id} className="writing-template-row">
                  <span title={note.title}>{note.title || t("제목 없는 노트")}</span>
                  <span>
                    <button
                      type="button"
                      className="writing-link"
                      disabled={busy}
                      aria-label={t("템플릿으로 새 노트") + ": " + (note.title || t("제목 없는 노트"))}
                      onClick={() => createTemplate(note)}
                    >
                      {t("새 노트 만들기")}
                    </button>{" "}
                    ·{" "}
                    <button
                      type="button"
                      className="writing-link"
                      disabled={busy}
                      onClick={() => unregisterTemplate(note.id)}
                    >
                      {t("등록 해제")}
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {!templates.length && !busy && <p className="writing-tools-hint">{t("등록한 템플릿이 없습니다.")}</p>}
            <p className="writing-tools-hint">
              {t("템플릿의 {{title}}, {{date}}, {{time}}는 새 노트의 제목, 날짜, 시각으로 바뀝니다.")}
            </p>
            <label className="writing-tools-field writing-tools-divided">
              {t("노트 제목으로 빠른 전환")}
              <span className="writing-tools-inline">
                <input
                  placeholder={t("제목 또는 별칭 검색")}
                  value={switchText}
                  onChange={(e) => setSwitchText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && switchText.trim()) {
                      e.preventDefault();
                      pendingQuery.current = switchText;
                      setSwitchText("");
                      setPanel("quick");
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || !switchText.trim()}
                  onClick={() => newTitled(switchText)}
                >
                  {t("이 제목으로 새 노트")}
                </button>
              </span>
            </label>
          </>
        )}
        {panel === "merge" && !busy && (
          <div className="writing-tools-merge">
            <p className="writing-tools-hint">
              {t(
                "원본 노트의 내용을 대상 노트 뒤에 붙이고 원본은 지운 노트로 옮깁니다. 기존 ID 링크는 자동으로 바꾸지 않고 원본 제목을 대상의 별칭으로 보존합니다.",
              )}
            </p>
            <label>
              {t("원본 노트")}
              <select
                aria-label={t("원본 노트")}
                value={mergeSource}
                onChange={(e) => {
                  setMergeSource(e.target.value);
                  setMergePreview(null);
                }}
              >
                <option value="">{t("노트 선택")}</option>
                {notes.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title || t("제목 없는 노트")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("대상 노트")}
              <select
                aria-label={t("대상 노트")}
                value={mergeTarget}
                onChange={(e) => {
                  setMergeTarget(e.target.value);
                  setMergePreview(null);
                }}
              >
                <option value="">{t("노트 선택")}</option>
                {notes.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title || t("제목 없는 노트")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={mergeRedirect}
                onChange={(e) => {
                  setMergeRedirect(e.target.checked);
                  setMergePreview(null);
                }}
              />
              {t("원본 ID 링크를 대상 노트로 연결")}
            </label>
            <button
              className="btn"
              disabled={!mergeSource || !mergeTarget || mergeSource === mergeTarget}
              onClick={mergeNotes}
            >
              {t("합치기 미리보기")}
            </button>
            {mergePreview && (
              <section className="merge-preview" aria-label={t("합치기 미리보기")}>
                <p>
                  {mergePreview.source.title} → {mergePreview.target.title}
                </p>
                <p>
                  {t("대상 본문 뒤에 원본을 추가하고 원본을 지운 노트로 옮깁니다. 원본 제목은 대상 별칭에 추가됩니다.")}
                </p>
                <p>
                  {mergePreview.redirect ? t("원본 ID 링크를 대상 노트로 연결") : t("원본 ID 연결을 변경하지 않음")}
                </p>
                <details>
                  <summary>{t("합쳐질 본문 원문")}</summary>
                  <pre style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>
                    {mergePreview.merged.content}
                  </pre>
                </details>
                <p>{t("적용 후 어느 노트나 관련 메타데이터라도 변경되면 전체 취소가 거부됩니다.")}</p>
                <button className="btn" onClick={applyMerge}>
                  {t("미리보기대로 합치기 적용")}
                </button>
              </section>
            )}
            {mergeChanges.length > 0 && (
              <section aria-label={t("최근 합치기")}>
                <h3>{t("최근 합치기")}</h3>
                <p>
                  {t(
                    "이 기기의 최근 10개 합치기를 보관합니다. 전체 취소는 본문·지운 상태·별칭·ID 연결을 함께 복원합니다.",
                  )}
                </p>
                {mergeChanges.map((change) => (
                  <div key={change.id}>
                    <span>
                      {change.source_title} → {change.target_title}
                    </span>{" "}
                    <time>{new Date(change.created_at).toLocaleString()}</time>{" "}
                    <button className="btn" disabled={!change.can_undo} onClick={() => undoMerge(change.id)}>
                      {change.status === "undone" ? t("합치기 취소됨") : t("합치기 전체 취소")}
                    </button>
                    {change.status === "applied" && !change.can_undo && (
                      <span>{t("이후 변경으로 취소할 수 없음")}</span>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
        {panel === "outline" && !busy && outline && (
          <div className="writing-tools-list">
            {outline.anchors.map((anchor, index) => (
              <div className="writing-outline-row" key={anchor.index}>
                <button
                  type="button"
                  style={{ paddingInlineStart: 12 + (anchor.level - 1) * 14 }}
                  onClick={() => selectAnchor(anchor)}
                >
                  <span className="writing-heading-level">H{anchor.level}</span>
                  {anchor.text || t("제목 없는 항목")}
                </button>
                <span>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={
                      outline.note.content_format === "text" ||
                      outline.note.readonly ||
                      headingSiblingIndex(outline.anchors, index, "up") < 0
                    }
                    aria-label={t("위로 이동")}
                    onClick={() => moveHeading(anchor, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={
                      outline.note.content_format === "text" ||
                      outline.note.readonly ||
                      headingSiblingIndex(outline.anchors, index, "down") < 0
                    }
                    aria-label={t("아래로 이동")}
                    onClick={() => moveHeading(anchor, "down")}
                  >
                    ↓
                  </button>
                </span>
              </div>
            ))}
            {!outline.anchors.length && <p>{t("본문에 제목을 추가하면 목차가 표시됩니다.")}</p>}
          </div>
        )}
      </dialog>
    </>
  );
}
