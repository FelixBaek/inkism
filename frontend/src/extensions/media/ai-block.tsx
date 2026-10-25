import { t } from "../../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ArrowUp, SparklesAi } from "../../icons";
import { requestAi } from "../../lib/ai";
import { useEditable } from "./shared";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiBlock: { insertAiBlock: (options?: { prompt?: string }) => ReturnType };
  }
}

/** 블록 안의 대화 한 줄. 블록과 함께 저장돼 다음 요청의 맥락이 된다. */
export type AiTurn = { role: "user" | "ai"; text: string };
const MAX_TURNS = 40;
const MAX_TEXT = 2000;

export function parseAiChat(raw: string | undefined): AiTurn[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((m) => (m?.role === "user" || m?.role === "ai") && typeof m.text === "string" && m.text.trim())
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TEXT) }));
  } catch {
    // Imported malformed chat metadata must not prevent the document from opening.
    return [];
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
        parseHTML: (el) => (el.dataset.prompt || "").slice(0, MAX_TEXT),
        rendered: false,
      },
      // empty: 첫 요청 전 · open: 대화하며 만드는 중 · done: 대화를 접고 내용만
      status: {
        default: "empty",
        parseHTML: (el) => (el.dataset.status === "done" || el.dataset.status === "open" ? el.dataset.status : "empty"),
        rendered: false,
      },
      chat: { default: [], parseHTML: (el) => parseAiChat(el.dataset.chat), rendered: false },
      pending: { default: null, parseHTML: () => null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-ai"]' }];
  },
  renderHTML({ node }) {
    const chat = node.attrs.chat as AiTurn[];
    return [
      "div",
      {
        "data-type": "inkism-ai",
        "data-prompt": node.attrs.prompt,
        "data-status": node.attrs.status,
        ...(chat.length ? { "data-chat": JSON.stringify(chat) } : {}),
      },
      0,
    ];
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

/** 블록 내용을 Markdown으로 — 표·목록 구조를 AI가 그대로 이어 고치게 한다. */
async function blockMarkdown(node: PMNode): Promise<string> {
  const box = document.createElement("div");
  box.appendChild(DOMSerializer.fromSchema(node.type.schema).serializeFragment(node.content));
  try {
    const { htmlToMarkdown } = await import("../../lib/markdown");
    return htmlToMarkdown(box.innerHTML);
  } catch {
    // Preserve the block text when the optional Markdown conversion is unavailable.
    return node.textBetween(0, node.content.size, "\n");
  }
}

function instruction(chat: AiTurn[], request: string) {
  const history = chat.map((m) => (m.role === "user" ? "User: " : "AI: ") + m.text).join("\n");
  return [
    "You are building one block of a note together with the user, turn by turn.",
    "The document is the block's current content (empty on the first turn).",
    history ? "Conversation so far:\n" + history : "",
    "Latest request: " + request,
    "Reply in the user's language. First line: '>> ' followed by one short sentence saying what you changed.",
    "Then return the complete new block content in Markdown (headings, lists and tables allowed).",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 모델 답을 '한 줄 답' + '블록 내용'으로 나눈다. */
export function splitAiReply(text: string): { reply: string; body: string } {
  const lines = text.replace(/^\s+/, "").split(/\r?\n/);
  if (lines[0]?.startsWith(">>")) return { reply: lines[0].replace(/^>>\s*/, "").trim(), body: lines.slice(1).join("\n").trim() };
  return { reply: "", body: text.trim() };
}

function AiBlockView({ node, editor, getPos }: ReactNodeViewProps) {
  const { prompt, status, pending } = node.attrs as {
    prompt: string;
    status: "empty" | "open" | "done";
    pending: string | null;
  };
  const stored = node.attrs.chat as AiTurn[];
  // 옛 블록(대화 기록 없이 요청 하나만 저장)도 첫 요청을 대화로 보여 준다.
  const chat: AiTurn[] = stored.length ? stored : prompt && status !== "empty" ? [{ role: "user", text: prompt }] : [];
  const editable = useEditable(editor);
  const [draft, setDraft] = useState(status === "empty" ? prompt : "");
  const [busy, setBusy] = useState<string | null>(null);
  // 이 화면에서 바꾸기 전 내용(되돌리기용). 저장하지 않는다.
  const [versions, setVersions] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (pending !== "focus") return;
    const pos = getPos();
    if (typeof pos === "number")
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "pending", null).setMeta("addToHistory", false));
    // After Tiptap's own focus('…') (scheduled in a frame) so the prompt keeps the caret.
    requestAnimationFrame(() => setTimeout(() => input.current?.focus()));
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = () => {
    const pos = getPos();
    const n = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    return n?.type.name === "aiBlock" ? { pos: pos as number, node: n } : null;
  };
  const html = (n: PMNode) => {
    const box = document.createElement("div");
    box.appendChild(DOMSerializer.fromSchema(n.type.schema).serializeFragment(n.content));
    return box.innerHTML;
  };
  /** 블록 안 내용을 바꾸고 속성을 함께 고친다 — 되돌리기 한 번으로 이전 상태가 된다. */
  const replace = (pos: number, size: number, content: string, attrs: Record<string, unknown>) =>
    editor
      .chain()
      .insertContentAt({ from: pos + 1, to: pos + size - 1 }, content || "<p></p>")
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, ...attrs });
        return true;
      })
      .run();

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, MAX_TEXT);
    const at = current();
    if (!text || busy || !editor.isEditable || !at) return;
    const history = chat;
    const asked: AiTurn[] = [...history, { role: "user" as const, text }].slice(-MAX_TURNS);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, chat: asked, status: "open", prompt: history.length ? at.node.attrs.prompt : text }),
    );
    setDraft("");
    setBusy(text);
    const controller = new AbortController();
    abort.current = controller;
    const source = status === "empty" ? "" : await blockMarkdown(at.node);
    const result = await requestAi("block", { prompt: instruction(history, text), selection: source }, undefined, controller.signal);
    setBusy(null);
    const now = current();
    if (controller.signal.aborted || !now || !editor.isEditable) return;
    if (!result?.text?.trim()) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(now.pos, undefined, { ...now.node.attrs, chat: history }));
      setDraft(text);
      return;
    }
    const { reply, body } = splitAiReply(result.text);
    const { markdownToHTML } = await import("../../lib/markdown");
    const content = markdownToHTML(body).content;
    const latest = current();
    if (!latest) return;
    setVersions((v) => [...v, html(latest.node)]);
    const chatNow = latest.node.attrs.chat as AiTurn[];
    replace(latest.pos, latest.node.nodeSize, content, {
      chat: [...chatNow, { role: "ai", text: (reply || t("블록 내용을 바꿨어요.")).slice(0, MAX_TEXT) }].slice(-MAX_TURNS),
      status: "open",
    });
  };

  const stop = () => {
    abort.current?.abort();
    setBusy(null);
    const at = current();
    if (!at) return;
    const list = at.node.attrs.chat as AiTurn[];
    const last = list.at(-1);
    if (last?.role === "user") {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, chat: list.slice(0, -1) }));
      setDraft(last.text);
    }
  };

  const undo = () => {
    const at = current();
    const previous = versions[versions.length - 1];
    if (!at || previous === undefined || busy) return;
    setVersions((v) => v.slice(0, -1));
    replace(at.pos, at.node.nodeSize, previous, {
      chat: [...(at.node.attrs.chat as AiTurn[]), { role: "ai", text: t("이전 버전으로 되돌렸어요.") }].slice(-MAX_TURNS),
    });
  };

  const setStatus = (next: "open" | "done") => {
    const at = current();
    if (at) editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, status: next }));
  };

  const unwrap = () => {
    const at = current();
    if (!at || busy) return;
    const tr = editor.state.tr;
    if (at.node.content.size) tr.replaceWith(at.pos, at.pos + at.node.nodeSize, at.node.content);
    else tr.delete(at.pos, at.pos + at.node.nodeSize);
    editor.view.dispatch(tr);
  };

  const aiTurns = chat.filter((m) => m.role === "ai").length;
  const done = status === "done";
  const lastAi = chat.length - 1 - [...chat].reverse().findIndex((m) => m.role === "ai");

  return (
    <NodeViewWrapper
      className={"media-block ai-block is-" + status + (busy ? " is-busy" : "")}
      data-type="inkism-ai"
    >
      <div className="ai-head" contentEditable={false}>
        <SparklesAi size={14} className="ai-icon" aria-hidden />
        <span className="ai-title">{t("AI 블록")}</span>
        <span className="ai-spacer" />
        {done ? (
          editable && (
            <button type="button" className="ai-chip" onClick={() => setStatus("open")}>
              {t("대화 열기 · {count}", { count: chat.length })}
            </button>
          )
        ) : (
          <span className="ai-meta">
            {aiTurns ? t("버전 {count}", { count: aiTurns }) : t("블록 안 내용과 이 대화만 AI에 보냅니다")}
          </span>
        )}
      </div>
      <NodeViewContent className="ai-content" />
      {!done && editable && (
        <div className="ai-thread" contentEditable={false}>
          {chat.map((m, i) => (
            <div key={i} className={"ai-msg is-" + m.role}>
              <span className="ai-who">{m.role === "ai" ? "AI" : t("나")}</span>
              <span className="ai-text">{m.text}</span>
              {m.role === "ai" && i === lastAi && versions.length > 0 && !busy && (
                <div className="ai-msg-actions">
                  <button type="button" className="ai-btn is-outline" onClick={undo}>
                    {t("이전 버전으로")}
                  </button>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="ai-msg is-ai">
              <span className="ai-who">AI</span>
              <div className="ai-busy">
                <output className="ai-text is-muted">{t("쓰는 중…")}</output>
                <button type="button" className="ai-btn is-outline" onClick={stop}>
                  {t("멈추기")}
                </button>
              </div>
            </div>
          )}
          <form
            className="ai-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <SparklesAi size={16} className="ai-icon" aria-hidden />
            <input
              ref={input}
              className="ai-input"
              value={draft}
              disabled={Boolean(busy)}
              aria-label={t("AI 요청")}
              placeholder={
                chat.length
                  ? t("이어서 요청하세요 — 예: 더 짧게, 제목 바꿔 줘")
                  : t("무엇을 만들까요? — 예: 회의 내용을 요점 3개로 정리해 줘")
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
              }}
            />
            <button type="submit" className="ai-send" disabled={Boolean(busy) || !draft.trim()} aria-label={t("보내기")}>
              <ArrowUp size={16} aria-hidden />
            </button>
          </form>
        </div>
      )}
      {status === "open" && editable && (
        <div className="ai-foot" contentEditable={false}>
          <span className="ai-meta">{t("완료하면 대화를 접고 내용만 남깁니다")}</span>
          <span className="ai-spacer" />
          <button type="button" className="ai-btn" disabled={Boolean(busy)} onClick={unwrap}>
            {t("AI 블록 풀기")}
          </button>
          <button type="button" className="ai-btn is-primary" disabled={Boolean(busy)} onClick={() => setStatus("done")}>
            {t("완료")}
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
