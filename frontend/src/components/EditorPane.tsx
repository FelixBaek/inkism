import "./WordCount.css";
import {DocumentTools,useDocumentMetadata} from "./DocumentTools";
import { SyncIndicator } from "./SyncSettings";
import { EditorZoom } from "./EditorZoom";
import React, { useState, useMemo, useRef, lazy, Suspense } from "react";
import { editorLocation, rememberLocation } from "../lib/editor-location";
import { Type, FileCode2, X, Loader2, CheckCircle2, AlertTriangle, CloudUpload, RefreshCw, List, Settings, PanelRight, Eye } from "../icons";
import { PREVIEW_EVENT } from "./PreviewExport";
import { IconButton } from "./IconButton";
import { CoverBanner } from "./NotebookCover";
import { useStore } from "../store";
import { htmlBlocks } from "../lib/text";
import type { ContentFormat } from "../types";
import { useNarrow } from "../lib/narrow";
import { SaveProtection } from "./SaveProtection";
import { EmptyWorkspace } from "./EmptyWorkspace";
import { TrashedNoteBanner } from "./TrashedNoteBanner";
import { NoteInspector } from "./NoteInspector";
import { SourceEditor } from "./SourceEditor";
import { TagInput } from "./TagInput";
import { MarkdownEditor } from "./MarkdownEditor";
import { usePref } from "../lib/pref";
import { lang, t } from "../i18n";

export const parseWrap = (raw: string | null) => raw === "true";
const RichDocument = lazy(() => import("./RichDocument").then((module) => ({ default: module.RichDocument })));

/** Inspector open state is owned by the app's top bar. */
export function EditorPane({
  inspectorOpen,
  openInspector,
  closeInspector,
}: Readonly<{
  inspectorOpen: boolean;
  openInspector: () => void;
  closeInspector: () => void;
}>) {
  const s = useStore();
  const documentData=useDocumentMetadata(s.draft?.id,Boolean(s.draft?.isNew));
  const [wrap, setWrap] = usePref("inkism.source.wrap", parseWrap);
  // 문서 설정 판은 연 노트에만 열려 있다(다른 노트로 가면 닫힘).
  const [documentPanel, setDocumentPanel] = useState<string | null>(null);
  const documentOpen = Boolean(s.draft) && documentPanel === s.draft?.id;
  const setDocumentOpen = (open: boolean) => setDocumentPanel(open ? s.draft?.id ?? null : null);

  if (!s.draft) {
    return (
      <div className="editor-workspace">
        <EmptyWorkspace />
        <NoteInspector open={inspectorOpen} onClose={closeInspector} />
      </div>
    );
  }

  const d = s.draft;

  return (
    <div className="editor-workspace">
      <main className="editor-pane" aria-label={t("편집기")} id="note-editor-panel" data-document-width={documentData.metadata?.document?.width} data-document-spacing={documentData.metadata?.document?.spacing} data-document-tone={documentData.metadata?.document?.tone}>
        <div className="meta-right">
          <fieldset className="mode-toggle plain-fieldset" aria-label={t("편집 모드")} disabled={s.editorConverting}>
            <button
              type="button"
              className={`mode-btn ${s.mode === "text" ? "is-active" : ""}`}
              aria-pressed={s.mode === "text"}
              onClick={() => void s.setMode("text")}
            >
              <Type size={13} aria-hidden /> {t("텍스트")}
            </button>
            <button
              type="button"
              className={`mode-btn ${s.mode === "html" ? "is-active" : ""}`}
              aria-pressed={s.mode === "html"}
              onClick={() => void s.setMode("html")}
            >
              <FileCode2 size={13} aria-hidden /> HTML
            </button>
            <button
              type="button"
              className={`mode-btn ${s.mode === "markdown" ? "is-active" : ""}`}
              aria-pressed={s.mode === "markdown"}
              onClick={() => void s.setMode("markdown")}
            >
              <FileCode2 size={13} aria-hidden /> MARKDOWN
            </button>
          </fieldset>
        </div>
        {s.mode !== "text" && (
          /* 원문 화면(Figma 29)의 도구줄: 서식 도구 대신 미리보기 */
          <div className="editor-source-actions" role="group" aria-label={t("원문 편집 도구")}>
            <IconButton label={t("미리보기")} onClick={() => window.dispatchEvent(new Event(PREVIEW_EVENT))}>
              <Eye size={16} aria-hidden />
            </IconButton>
          </div>
        )}
        {/* Figma 01 도구줄 오른쪽: 목차 · 문서 설정 · 노트 정보 */}
        <div className="editor-doc-actions" role="group" aria-label={t("문서 동작")}>
          <IconButton label={t("목차")} onClick={() => window.dispatchEvent(new Event("inkism-open-outline"))}>
            <List size={16} aria-hidden />
          </IconButton>
          <IconButton
            label={t("문서 설정")}
            active={documentOpen}
            aria-expanded={documentOpen}
            aria-controls="document-settings-panel"
            onClick={() => setDocumentOpen(!documentOpen)}
          >
            <Settings size={16} aria-hidden />
          </IconButton>
          <IconButton
            label={t("노트 정보")}
            active={inspectorOpen}
            aria-expanded={inspectorOpen}
            aria-controls="note-inspector"
            onMouseDown={(event) => event.preventDefault()}
            onClick={inspectorOpen ? closeInspector : openInspector}
          >
            <PanelRight size={16} aria-hidden />
          </IconButton>
        </div>
        <SaveProtection />
        {documentData.metadata?.document?.cover && <CoverBanner cover={documentData.metadata.document.cover} />}
        <div className="editor-meta-row">
          <div className="meta-left">
            <input
              className="title-input"
              type="text"
              value={d.title}
              placeholder={t("제목 없는 노트")}
              aria-label={t("노트 제목")}
              readOnly={Boolean(d.readonly) || s.editorConverting}
              onChange={(e) => s.updateDraft({ title: e.target.value })}
            />

            {s.largeDoc && (
              <span className="large-badge" title={t("큰 문서도 보이는 구간만 화면에 표시합니다")}>
                {t("대용량 문서")}
              </span>
            )}
          </div>
          <button type="button" className="mode-btn editor-compatibility-switch" disabled={Boolean(d.readonly) || s.editorConverting}
            aria-label={d.content_format==="markdown"?t("HTML 에디터로 변환"):t("MARKDOWN 에디터로 변환")}
            title={t("내용을 보존할 수 있는 경우에만 에디터를 변환합니다.")}
            onClick={()=>void s.convertEditorCompatibility()}>
            <RefreshCw size={13} aria-hidden /> {d.content_format==="markdown"?"MD":d.content_format==="text"?"TXT":"HTML"}
          </button>
        </div>

        <TrashedNoteBanner />

        <fieldset className="note-classification plain-fieldset" disabled={s.editorConverting}>
          <label className="visually-hidden" htmlFor="notebook-select">
            {t("폴더 지정")}
          </label>
          <select
            id="notebook-select"
            className="meta-select"
            value={d.notebook_id ?? ""}
            onChange={(e) => s.updateDraft({ notebook_id: e.target.value || null })}
            disabled={Boolean(d.readonly) || s.editorConverting}
            aria-label={t("이 노트가 속한 폴더")}
          >
            <option value="">{t("폴더 없음")}</option>
            {s.notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.name}
              </option>
            ))}
          </select>
          <span className="classification-divider" aria-hidden>
            |
          </span>
          <TagEditor />
        </fieldset>

        <DocumentTools key={d.id} data={documentData} open={documentOpen} onOpenChange={setDocumentOpen}/>
        <NoteBody draft={d} wrap={wrap} setWrap={setWrap} />
      </main>
      <NoteInspector open={inspectorOpen} onClose={closeInspector} />
    </div>
  );
}

type DraftValue = NonNullable<ReturnType<typeof useStore>["draft"]>;

/** Rich, markdown or source editor for the current draft. */
function NoteBody({
  draft: d,
  wrap,
  setWrap,
}: Readonly<{ draft: DraftValue; wrap: boolean; setWrap: (value: boolean) => void }>) {
  const s = useStore();
  if (s.mode === "markdown" && (d.content_format ?? "html") === "html")
    return (
      <MarkdownEditor
        key={`${d.id}-md-${s.editorGeneration}`}
        draft={s.editorConverting ? {...d,readonly:true} : d}
        readDraft={s.readDraft}
        onError={s.setEditorError}
        onChange={(patch) => {
          if (s.readDraft()?.id === d.id) s.updateDraft(patch);
        }}
      />
    );
  if (s.mode === "text")
    return (
      <Suspense fallback={<p className="source-hint">{t("편집기를 불러오는 중…")}</p>}>
        <RichDocument key={`${d.id}-rich-${s.editorGeneration}`} />
      </Suspense>
    );
  return (
    <div className="editor-scroll source-scroll">
      <p className="source-hint">
        {s.mode === "html" ? t("HTML 원문") : t("MARKDOWN 원문")} · {t("입력한 내용을 그대로 저장합니다.")}
      </p>
      <SourceEditor
        attachments
        id={d.id}
        revision={d.revision}
        language={s.mode}
        wrap={wrap}
        readOnly={Boolean(d.readonly) || s.editorConverting}
        toolbar={
          <button type="button" className="btn btn-small" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            {t("자동 줄바꿈")}
          </button>
        }
        key={`${d.id}-${s.mode}-${s.editorGeneration}`}
        initialContent={d.content}
        initialLocation={editorLocation(d.id, d.revision, s.mode === "markdown" ? "markdown" : "source")}
        onLocation={(location) => {
          const current = s.readDraft();
          if (current?.id === d.id)
            rememberLocation(d.id, {
              revision: current.revision,
              kind: s.mode === "markdown" ? "markdown" : "source",
              offset: 0,
              ...location,
            });
        }}
        onChange={(content) => {
          if (s.readDraft()?.id === d.id) s.updateDraft({ content, text: content, textDirty: false });
        }}
      />
    </div>
  );
}

function TagEditor() {
  const s = useStore();
  const [value, setValue] = useState("");
  const d = s.draft;
  if (!d) return null;

  const addTag = (text = value) => {
    const t = text.trim().replace(/^#/, "");
    if (!t) return;
    if (!d.tags.includes(t) && d.tags.length < 100) {
      s.updateDraft({ tags: [...d.tags, t] });
    }
    setValue("");
  };

  return (
    <div className="tag-editor" aria-label={t("태그 편집")}>
      {d.tags.map((tag) => (
        <span key={tag} className="tag-chip">
          <span className="tag-chip-label" title={tag}>
            #{tag}
          </span>
          <button
            type="button"
            className="tag-remove"
            aria-label={t("태그 삭제: {tag}", { tag })}
            onClick={() => s.updateDraft({ tags: d.tags.filter((x) => x !== tag) })}
          >
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
      <TagInput
        value={value}
        onChange={setValue}
        current={d.tags}
        placeholder={d.tags.length === 0 ? t("태그 추가 (Enter)") : t("태그 더 추가")}
        onCommit={addTag}
        onRemoveLast={() => s.updateDraft({ tags: d.tags.slice(0, -1) })}
      />
    </div>
  );
}

function idleStatus(d: DraftValue | null) {
  if (d?.isNew) return t("새 노트");
  if (!d) return t("노트를 선택해 주세요");
  return (
    <>
      {t("저장된 상태")} <CheckCircle2 size={13} aria-hidden />
    </>
  );
}

function wholeBodyUndoLabel(undo: { kind?: string; undone: boolean }) {
  if (undo.kind === "cut") return undo.undone ? t("전체 잘라내기 다시 적용") : t("전체 잘라내기 취소");
  return undo.undone ? t("전체 바꾸기 다시 적용") : t("최근 전체 바꾸기 취소");
}

const FORMAT_LABEL: Record<ContentFormat, string> = { html: "HTML", markdown: "Markdown", text: "TXT" };

export function StatusBar() {
  const s = useStore();
  const narrow = useNarrow();
  const d = s.draft;
  const chars = d?.content.length ?? 0;

  let status: React.ReactNode;
  let statusClass = "";
  switch (s.saveState) {
    case "saving":
      status = (
        <>
          <CloudUpload size={13} className="spin-slow" aria-hidden /> {t("저장 중…")}
        </>
      );
      statusClass = "muted";
      break;
    case "dirty":
      status = <>{t("변경됨 — 곧 저장됩니다")}</>;
      statusClass = "muted";
      break;
    case "saved":
      status = (
        <>
          <time>
            {s.note
              ? new Date(s.note.updated_at).toLocaleString(lang, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : t("저장됨")}
          </time>
          <CheckCircle2 size={13} aria-hidden />
        </>
      );
      statusClass = "ok";
      break;
    case "error":
      status = (
        <>
          <AlertTriangle size={13} aria-hidden /> {t("저장 실패")} — {s.saveError ?? t("알 수 없는 오류")}
        </>
      );
      statusClass = "bad";
      break;
    case "conflict":
      status = (
        <>
          <AlertTriangle size={13} aria-hidden /> {t("저장 충돌")} —{" "}
          {s.saveError ?? t("다른 곳에서 이 노트가 변경되었습니다")}
        </>
      );
      statusClass = "bad";
      break;
    default:
      status = <>{idleStatus(d)}</>;
      statusClass = "muted";
  }

  return (
    <footer className="status-bar" aria-label={t("노트 상태")}>
      {/* 넓은 화면에서는 사이드바 아래가 동기화 상태를 보여 주고, 좁은 화면에서만 여기 보인다. */}
      {narrow && (
        <span className="status-sync">
          <SyncIndicator />
        </span>
      )}
      {d && <span className="status-format">{FORMAT_LABEL[d.content_format ?? "html"]}</span>}
      {d && <WordCount draft={d} sourceChars={chars} />}
      <span className="status-spacer" />
      {d && <EditorZoom />}
      <span className={`status-save ${statusClass}`} data-save-state={s.saveState} aria-live="polite">
        {status}
      </span>
      {s.wholeBodyUndo && (
        <button
          type="button"
          className="btn btn-small"
          disabled={s.saveState === "saving" || s.saveState === "conflict"}
          onClick={s.toggleWholeBodyUndo}
        >
          {wholeBodyUndoLabel(s.wholeBodyUndo)}
        </button>
      )}
      {s.indexPending !== null && s.indexPending > 0 && (
        <span className="status-index" aria-live="polite">
          <Loader2 size={12} className="spin" aria-hidden />
          {t("색인 진행 중({n}) — 검색 결과에 곧 반영됩니다", { n: s.indexPending })}
        </span>
      )}
    </footer>
  );
}

/** 본문 글자 통계(상태줄 단어 수). 서식 노트는 화면에 보이는 글자로 센다. */
function textStats(d: NonNullable<ReturnType<typeof useStore>["draft"]>) {
  const format = d.content_format ?? "html";
  const blocks =
    format === "html"
      ? htmlBlocks(d.content)
      : d.content
          .split(/\n/)
          .map((b) => b.replaceAll("\u00a0", " "))
          .filter((b) => b.trim());
  const text = blocks.join("\n");
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    chars: Array.from(text.replaceAll("\n", "")).length,
    paragraphs: blocks.length,
    spaces: (text.match(/ /g) ?? []).length,
  };
}

function WordCount({
  draft,
  sourceChars,
}: Readonly<{ draft: ReturnType<typeof useStore>["draft"]; sourceChars: number }>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const stats = useMemo(() => {
    if (!draft) return null;
    if (draft.paged)
      return draft.textStats
        ? { words: draft.textStats.words, chars: draft.textStats.chars, paragraphs: null, spaces: null }
        : null;
    try {
      return textStats(draft);
    } catch {
      return null;
    }
  }, [draft?.id, draft?.content, draft?.content_format, draft?.paged, draft?.textStats]);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [open]);
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString(lang));
  const size = draft?.paged
    ? `${(draft.paged.totalBytes / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })}KB`
    : t("{n}자", { n: sourceChars.toLocaleString(lang) });
  return (
    <span className="status-words" ref={root}>
      <button
        type="button"
        className="word-count-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label={stats ? t("단어 {n}개 — 글자 통계 보기", { n: stats.words }) : t("글자 통계 보기")}
      >
        {stats ? `${n(stats.words)} words` : t("원문 {size}", { size })}
      </button>
      {open && (
        <div className="word-count-pop" role="dialog" aria-label={t("글자 통계")}>
          <dl>
            <dt>Words</dt>
            <dd>{n(stats?.words ?? null)}</dd>
            <dt>Characters</dt>
            <dd>{n(stats?.chars ?? null)}</dd>
            <dt>Paragraphs</dt>
            <dd>{n(stats?.paragraphs ?? null)}</dd>
            <dt>Spaces</dt>
            <dd>{n(stats?.spaces ?? null)}</dd>
          </dl>
          <button
            type="button"
            className="word-count-close"
            aria-label={t("글자 통계 닫기")}
            onClick={() => setOpen(false)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
    </span>
  );
}

