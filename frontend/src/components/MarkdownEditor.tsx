import { peekHistory } from "../lib/persistent-history";
import React, { useState, useRef, useEffect } from "react";
import { errorText } from "../lib/text";
import { SourceEditor } from "./SourceEditor";
import { editableMarkdown, markdownToEditableHTML } from "../lib/markdown";
import { editorLocation, rememberLocation } from "../lib/editor-location";
import { forgetSourceHistory } from "../lib/source-history-cache";
import type { Draft } from "../types";
import { t } from "../i18n";

const sourceCache = new Map<string, { html: string; source: string }>();

/** Last Markdown source known to produce `html`; otherwise regenerated from the HTML. */
function sourceFor(draft: Draft) {
  const saved = peekHistory("source", draft.id, draft.revision) as { document?: string } | undefined;
  if (saved?.document && !sourceCache.has(draft.id) && markdownToEditableHTML(saved.document).content === draft.content)
    sourceCache.set(draft.id, { html: draft.content, source: saved.document });
  const cached = sourceCache.get(draft.id);
  if (cached?.html !== draft.content) forgetSourceHistory(draft.id);
  return cached?.html === draft.content ? cached.source : editableMarkdown(draft.content);
}

export function MarkdownEditor({
  draft,
  onChange,
  onError,
  readDraft,
}: Readonly<{
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onError: (message: string | null) => void;
  readDraft: () => Draft | null;
}>) {
  const [initial] = useState(() => {
    try {
      return { text: sourceFor(draft), error: null };
    } catch (e) {
      return { text: "", error: errorText(e) };
    }
  });
  const [view, setView] = useState({ generation: 0, text: initial.text });
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<string | null>(null);
  // The store blocks saving and navigation while the source cannot be converted.
  const report = (message: string | null) => {
    if (errorRef.current === message) return;
    errorRef.current = message;
    setError(message);
    onError(message);
  };
  // Unmounting follows a successful flush or an explicit server replacement.
  useEffect(
    () => () => {
      if (errorRef.current) onError(null);
    },
    [],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceRef = useRef(initial.text);
  if (initial.error)
    return (
      <div role="alert" className="source-hint">
        {initial.error}
      </div>
    );
  const discard = () => {
    const current = readDraft();
    if (current?.id !== draft.id) return;
    let text: string;
    try {
      text = sourceFor(current);
    } catch (e) {
      report(t("Markdown 변환 실패: {error}", { error: errorText(e) }));
      return;
    }
    forgetSourceHistory(draft.id);
    sourceRef.current = text;
    report(null);
    setView((v) => ({ generation: v.generation + 1, text }));
  };
  return (
    <div className="editor-scroll source-scroll">
      <p className="source-hint">
        {t(
          "Markdown으로 보기 · 고친 내용은 텍스트 화면에도 그대로 반영됩니다. Markdown으로 나타낼 수 없는 서식은 HTML로 함께 보입니다.",
        )}
      </p>
      {error && (
        <p className="source-hint" role="alert">
          {error} · {t("고치기 전에는 저장하거나 다른 노트로 이동하지 않습니다.")}{" "}
          <button type="button" className="btn btn-small" onClick={discard}>
            {t("마지막으로 반영된 원문으로 되돌리기")}
          </button>
        </p>
      )}
      <SourceEditor
        key={view.generation}
        id={draft.id}
        revision={draft.revision}
        language="markdown"
        format={draft.content_format ?? "html"}
        initialContent={view.text}
        readOnly={Boolean(draft.readonly)}
        toolbar={
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              window.dispatchEvent(new Event("inkism-flush-editor"));
              const url = URL.createObjectURL(new Blob([sourceRef.current], { type: "text/markdown;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = "inkism-source.md";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            }}
          >
            {t("Markdown 원문 파일로 보관")}
          </button>
        }
        initialLocation={view.generation ? undefined : editorLocation(draft.id, draft.revision, "markdown")}
        onLocation={(location) => {
          const current = readDraft();
          if (current?.id === draft.id)
            rememberLocation(draft.id, { revision: current.revision, kind: "markdown", offset: 0, ...location });
        }}
        onChange={(source) => {
          sourceRef.current = source;
          try {
            const converted = markdownToEditableHTML(source);
            sourceCache.delete(draft.id);
            sourceCache.set(draft.id, { html: converted.content, source });
            while (sourceCache.size > 16) {
              const id = sourceCache.keys().next().value!;
              sourceCache.delete(id);
              forgetSourceHistory(id);
            }
            report(null);
            onChange({ ...converted, textDirty: false });
          } catch (e) {
            report(t("Markdown 변환 실패: {error}", { error: errorText(e) }));
          }
        }}
      />
    </div>
  );
}
