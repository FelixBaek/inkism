import { sourceOffsetForByte, ANCHOR_EVENT, type AnchorRequest } from "../lib/note-anchor";
import { SourceAttachments } from "./SourceAttachments";
import { HistoryPersistenceNotice } from "./HistoryPersistenceNotice";
import { acquireSourceHistory, releaseSourceHistory, observeSourceHistory } from "../lib/source-history-cache";
import { forgetWindowHistory } from "../lib/window-history-cache";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { Compartment, EditorState, EditorSelection, Text } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
import { t } from "../i18n";
import {
  defaultKeymap,
  history,
  historyField,
  isolateHistory,
  historyKeymap,
  redo,
  indentWithTab,
} from "@codemirror/commands";

interface Props {
  id: string;
  language?: "text" | "html" | "markdown";
  /** Stored format of the note when the editor shows a view of it (Markdown view of an HTML note). */
  format?: string;
  wrap?: boolean;
  attachments?: boolean;
  toolbar?: React.ReactNode;
  readOnly?: boolean;
  revision: number;
  initialContent: string;
  initialLocation?: { selection?: Record<string, unknown>; scrollTop?: number };
  onLocation?: (location: { selection: Record<string, unknown>; scrollTop: number }) => void;
  onChange: (content: string) => void;
}

const PLACEHOLDERS = {
  text: t("텍스트를 입력하세요…"),
  html: t("HTML 원문을 입력하세요…"),
  markdown: t("Markdown 원문을 입력하세요…"),
} as const;
const EDITOR_LABELS = {
  text: t("노트 본문 (텍스트 원문 편집기)"),
  html: t("노트 본문 (HTML 원문 편집기)"),
  markdown: t("노트 본문 (Markdown 원문 편집기)"),
} as const;

/**
 * 대용량 문서용 원문 편집기 (CodeMirror 6).
 * CodeMirror의 뷰포트 가상화로 화면에 보이는 줄만 DOM에 유지한다.
 * 전체 문서를 DOM으로 파싱하지 않는다 (DOMParser/DOMPurify 미사용).
 */
export function SourceEditor({
  id,
  revision,
  initialContent,
  onChange,
  initialLocation,
  onLocation,
  language = "html",
  format = language,
  wrap = false,
  attachments = false,
  toolbar,
  readOnly = false,
}: Readonly<Props>) {
  const [attachmentView, setAttachmentView] = useState<EditorView | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapping = useRef(new Compartment());
  const permission = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const onLocationRef = useRef(onLocation);
  onLocationRef.current = onLocation;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const cached = acquireSourceHistory(id, revision, initialContent, format);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const flush = () => {
      if (timer) clearTimeout(timer);
      if (!pending) return;
      pending = false;
      onChangeRef.current(view.state.doc.toString());
    };
    let selection: EditorSelection | undefined;
    try {
      if (initialLocation?.selection) {
        const parsed = EditorSelection.fromJSON(initialLocation.selection);
        if (parsed.ranges.every((range) => range.from >= 0 && range.to <= initialContent.length)) selection = parsed;
      }
    } catch {
      /* A stale position must never prevent opening the note. */
    }
    const record = () =>
      onLocationRef.current?.({ selection: view.state.selection.toJSON(), scrollTop: view.scrollDOM.scrollTop });
    const focusAtMount = document.activeElement;
    const focusPaneAtMount = focusAtMount?.closest(".split-primary,.split-secondary");
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        // CR is source data. Only LF separates Text lines; never normalize
        // CRLF, standalone CR or mixed endings when opening or editing.
        doc: Text.of(initialContent.split("\n")),
        selection,
        extensions: [
          EditorState.lineSeparator.of("\n"),
          lineNumbers(),
          history(),
          ...(cached.value ? [historyField.init(() => cached.value)] : []),
          search({ top: true }),
          EditorState.phrases.of({
            Find: t("원문에서 찾을 내용"),
            Replace: t("원문에서 바꿀 내용"),
            next: t("다음"),
            previous: t("이전"),
            all: t("모두 선택"),
            "match case": t("대소문자 구분"),
            regexp: t("정규식"),
            "by word": t("단어 단위"),
            replace: t("바꾸기"),
            "replace all": t("모두 바꾸기"),
            close: t("검색 닫기"),
          }),
          keymap.of([
            ...searchKeymap,
            ...defaultKeymap,
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            ...historyKeymap,
            indentWithTab,
          ]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          permission.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorState.transactionFilter.of((tr) => (tr.docChanged && readOnlyRef.current ? [] : tr)),
          cmPlaceholder(PLACEHOLDERS[language]),
          EditorView.contentAttributes.of({ "aria-label": EDITOR_LABELS[language] }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) record();
            if (u.docChanged) {
              // Window undo stores byte offsets into the body it edited. A source
              // edit moves them, so that history must never replay on the new body.
              const note = id.replace(/:split$/, "");
              forgetWindowHistory(note);
              forgetWindowHistory(note + ":split");
              pending = true;
              window.dispatchEvent(new CustomEvent("inkism-editor-dirty", { detail: { editorId: id } }));
              if (timer) clearTimeout(timer);
              timer = setTimeout(flush, 300);
            }
          }),
        ],
      }),
    });
    view.dispatch({ annotations: isolateHistory.of("full") });
    viewRef.current = view;
    if (attachments) setAttachmentView(view);
    observeSourceHistory(cached.handle, () => view.state, language !== format);
    view.scrollDOM.addEventListener("scroll", record);
    if (initialLocation) {
      view.requestMeasure({
        read: () => null,
        write: () => {
          if (viewRef.current !== view) return;
          view.scrollDOM.scrollTop = Math.max(0, initialLocation.scrollTop ?? 0);
          // Measurement is deferred. A newer click/tab focus takes precedence
          // over restoring the old editor cursor. Still restore its scroll.
          const ownPane = view.dom.closest(".split-primary,.split-secondary");
          if (
            (document.activeElement === focusAtMount && (!focusPaneAtMount || focusPaneAtMount === ownPane)) ||
            view.dom.contains(document.activeElement)
          )
            view.focus();
        },
      });
    }
    const find = () => {
      const focusedPane = document.activeElement?.closest(".split-primary,.split-secondary");
      const ownPane = view.dom.closest(".split-primary,.split-secondary");
      if (focusedPane ? focusedPane !== ownPane : ownPane?.classList.contains("split-secondary")) return;
      openSearchPanel(view);
    };
    window.addEventListener("inkism-find-in-note", find);
    window.addEventListener("inkism-flush-editor", flush);
    return () => {
      // Navigation/mode/close handlers flush explicitly before unmount. A server
      // replacement intentionally discards this editor; do not revive its draft.
      window.removeEventListener("inkism-find-in-note", find);
      window.removeEventListener("inkism-flush-editor", flush);
      if (timer) clearTimeout(timer);
      view.scrollDOM.removeEventListener("scroll", record);
      releaseSourceHistory(id, cached.handle, view.state);
      view.destroy();
      viewRef.current = null;
    };
    // 노트/모드 전환 시 remount를 가정하므로 최초 1회만 마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const navigate = (event: Event) => {
      const request = (event as CustomEvent<AnchorRequest>).detail, view = viewRef.current;
      if (!view || id !== request.note.id || language !== (request.note.content_format ?? "html")) return;
      if (request.anchor.byteOffset===undefined?view.state.doc.toString() !== request.note.content:revision!==request.note.revision) {
        request.accept(Promise.reject(new Error(t("문서가 변경되었습니다. 다시 시도해 주세요.")))); return;
      }
      const at = Math.min(request.anchor.byteOffset===undefined?request.anchor.sourceOffset:sourceOffsetForByte(view.state.doc.toString(),request.anchor.byteOffset), view.state.doc.length);
      const end=request.anchor.byteEnd===undefined?request.anchor.sourceEnd:sourceOffsetForByte(view.state.doc.toString(),request.anchor.byteEnd);
      view.dispatch({ selection: end===undefined?EditorSelection.cursor(at):EditorSelection.range(at,Math.min(end,view.state.doc.length)), effects: EditorView.scrollIntoView(at, { y: "center" }) });
      view.focus(); request.accept();
    };
    window.addEventListener(ANCHOR_EVENT, navigate);
    return () => window.removeEventListener(ANCHOR_EVENT, navigate);
  }, [id, language]);
  useEffect(() => {
    // Reconfigure the display only: preserve the document, selection and history.
    const view = viewRef.current;
    if (view) view.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view)
      view.dispatch({
        effects: permission.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      });
  }, [readOnly]);

  const controls = (
    <>
      {toolbar}
      <button
        type="button"
        className="btn btn-small"
        aria-label={t("원문에서 찾기·바꾸기 (Ctrl+F)")}
        title={t("원문에서 찾기·바꾸기 (Ctrl+F)")}
        onClick={() => {
          if (viewRef.current) openSearchPanel(viewRef.current);
        }}
      >
        {t("찾기·바꾸기")}
      </button>
    </>
  );
  return (
    <>
      {attachments && attachmentView ? (
        <SourceAttachments view={attachmentView} format={language} readOnly={readOnly} controls={controls} />
      ) : (
        <fieldset className="source-toolbar plain-fieldset" aria-label={t("원문 편집 도구")}>
          {controls}
        </fieldset>
      )}
      <HistoryPersistenceNotice id={id} />
      <div className="source-editor" ref={hostRef} />
    </>
  );
}
