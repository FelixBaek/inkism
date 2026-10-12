import React, { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useStore } from "../store";
import { compatibleMarkdownHTML, serializeCompatibleMarkdown, markdownDefinitions } from "../lib/markdown-compatible";
import { registerEditorFlush } from "../lib/editor-flush";
import { RichEditor } from "./RichEditor";
import { t } from "../i18n";

/** Opening projects Markdown into blocks; only an actual edit rewrites source. */
export function MarkdownVisualDocument({ fallback }: Readonly<{ fallback?: React.ReactNode }>) {
  const s = useStore(),
    [snapshot] = useState(() => s.draft!);
  const editor = useRef<Editor | null>(null),
    failed = useRef(false);
  const latest = useRef(s);
  latest.current = s;
  const [initial] = useState(() => {
    try {
      return { html: compatibleMarkdownHTML(snapshot.content), error: null };
    } catch (e) {
      return { html: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const [definitions] = useState(() => initial.html === null ? [] : markdownDefinitions(snapshot.content));
  const change = (content: string, text: string) => {
    const store = latest.current,
      current = store.readDraft();
    if (!current || current.id !== snapshot.id || current.readonly || current.content_format !== "markdown") return;
    try {
      if (!editor.current) return;
      const markdown = serializeCompatibleMarkdown(editor.current.getJSON(), definitions);
      failed.current = false;
      store.setEditorError(null);
      if (current.content !== markdown) store.updateDraft({ content: markdown, text, textDirty: false });
    } catch (e) {
      failed.current = true;
      store.setEditorError(e instanceof Error ? e.message : String(e));
    }
  };
  const flush = useRef(change);
  flush.current = change;
  useEffect(
    () =>
      registerEditorFlush(
        async () => {
          const store = latest.current,
            current = store.readDraft(),
            instance = editor.current;
          if (!instance || instance.isDestroyed || current?.id !== snapshot.id || current.content_format !== "markdown")
            return true;
          if (failed.current) flush.current(instance.getHTML(), instance.getText());
          return !failed.current;
        },
        () => failed.current,
      ),
    [snapshot.id],
  );
  useEffect(
    () => () => {
      if (failed.current) latest.current.setEditorError(null);
    },
    [],
  );
  if (initial.html === null)
    return (
      <>
        <div className="source-hint">
          <p role="status">{initial.error}</p>
          <button type="button" className="btn btn-small" onClick={() => void s.setMode("markdown")}>
            {t("Markdown 원문 편집")}
          </button>
        </div>
        {fallback}
      </>
    );
  return (
    <RichEditor
      initialContent={initial.html}
      markdownCompatible
      readOnly={Boolean(s.draft?.readonly) || s.editorConverting}
      noteIdentity={{ id: snapshot.id, revision: s.draft?.revision ?? snapshot.revision }}
      onEditor={(value) => {
        editor.current = value;
      }}
      onChange={change}
    />
  );
}
