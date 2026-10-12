import { t } from "../../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { SparklesAi } from "../../icons";
import { requestAi } from "../../lib/ai";
import { useEditable } from "./shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiBlock: { insertAiBlock: (options?: { prompt?: string }) => ReturnType };
  }
}

export const AiBlock = Node.create({
  name: "aiBlock",
  group: "block",
  content: "block*",
  defining: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      prompt: {
        default: "",
        parseHTML: (el) => (el.dataset.prompt || "").slice(0, 2000),
        rendered: false,
      },
      status: {
        default: "empty",
        parseHTML: (el) => (el.dataset.status === "done" ? "done" : "empty"),
        rendered: false,
      },
      pending: { default: null, parseHTML: () => null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-ai"]' }];
  },
  renderHTML({ node }) {
    return ["div", { "data-type": "inkism-ai", "data-prompt": node.attrs.prompt, "data-status": node.attrs.status }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AiBlockView);
  },
  addCommands() {
    return {
      insertAiBlock:
        (options = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { prompt: options.prompt ?? "", status: "empty", pending: "focus" },
          }),
    };
  },
});

function AiBlockView({ node, editor, getPos }: ReactNodeViewProps) {
  const { prompt, status, pending } = node.attrs as {
    prompt: string;
    status: "empty" | "done";
    pending: string | null;
  };
  const editable = useEditable(editor);
  const [draft, setDraft] = useState(prompt);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(prompt), [prompt]);
  useEffect(() => {
    if (pending !== "focus") return;
    const pos = getPos();
    if (typeof pos === "number")
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "pending", null).setMeta("addToHistory", false));
    // After Tiptap's own focus('…') (scheduled in a frame) so the prompt keeps the caret.
    requestAnimationFrame(() => setTimeout(() => input.current?.focus()));
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async (text: string) => {
    text = text.trim().slice(0, 2000);
    if (!text || busy || !editor.isEditable) return;
    setBusy(true);
    let result: { text: string } | null = null;
    try {
      result = await requestAi("block", { prompt: text });
    } catch {
      result = null;
    }
    setBusy(false);
    const pos = getPos(),
      current = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    if (!result?.text?.trim() || current?.type.name !== "aiBlock" || !editor.isEditable) return;
    // Plain text only: each non-empty line becomes a paragraph (no HTML from the model).
    const { schema } = editor.state;
    const blocks = result.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => schema.nodes.paragraph.create(null, schema.text(line)));
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(pos! + 1, pos! + current.nodeSize - 1, blocks)
        .setNodeMarkup(pos!, undefined, { ...current.attrs, prompt: text, status: "done", pending: null }),
    );
  };

  const done = status === "done";
  return (
    <NodeViewWrapper className={"media-block ai-block" + (done ? " is-done" : "")} data-type="inkism-ai">
      {done ? (
        <div className="ai-head" contentEditable={false}>
          <SparklesAi size={14} className="ai-icon" aria-hidden />
          <span className="ai-prompt">{prompt}</span>
          {editable && (
            <button type="button" className="ai-rewrite" disabled={busy} onClick={() => generate(prompt)}>
              {busy ? t("쓰는 중…") : t("다시 쓰기")}
            </button>
          )}
        </div>
      ) : (
        <div className="ai-input-row" contentEditable={false}>
          <SparklesAi size={16} className="ai-icon" aria-hidden />
          <input
            ref={input}
            className="ai-input"
            value={draft}
            disabled={!editable || busy}
            aria-label={t("AI 요청")}
            placeholder={t("AI에게 쓸 내용을 요청하세요 — 예: 회의 내용을 요점 3개로 정리해 줘")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void generate(draft);
              }
            }}
          />
          <span className="ai-hint" aria-hidden>
            {busy ? t("쓰는 중…") : "Enter"}
          </span>
        </div>
      )}
      <NodeViewContent className="ai-content" />
    </NodeViewWrapper>
  );
}
