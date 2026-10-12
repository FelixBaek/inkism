import React from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ExternalLink, GlobeSimple } from "../../icons";
import { linkChild, safeSrc } from "./shared";
import { t } from "../../i18n";

/** Web pages only — an embed never points at an attachment or another scheme. */
const webSrc = (value: unknown) => {
  const src = safeSrc(value);
  return /^https?:\/\//i.test(src) ? src : "";
};
/** Card title without fetching the page: host + path (no request, no iframe, no favicon). */
export function embedLabel(src: string): string {
  try {
    const url = new URL(src);
    return url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "") || src;
  } catch {
    return src;
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: { insertEmbed: (options: { src: string }) => ReturnType };
  }
}

/** 링크 미리보기 카드. 저장 형식은 다른 미디어 블록처럼 data-* div + 이식용 링크. */
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "", parseHTML: (el) => webSrc(el.dataset.src), rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-embed"]' }];
  },
  renderHTML({ node }) {
    const { src } = node.attrs;
    return ["div", { "data-type": "inkism-embed", "data-src": src }, ...linkChild(src, src)];
  },
  renderText({ node }) {
    return node.attrs.src;
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
  addCommands() {
    return {
      insertEmbed:
        ({ src }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src: webSrc(src) } }),
    };
  },
});

function EmbedView({ node }: ReactNodeViewProps) {
  const src = node.attrs.src as string,
    label = embedLabel(src);
  return (
    <NodeViewWrapper className="media-block embed-card" data-type="inkism-embed" contentEditable={false}>
      <div className="media-caption">
        <span className="media-caption-icon" aria-hidden>
          <GlobeSimple size={16} />
        </span>
        <span className="embed-text">
          <span className="media-caption-title">{label || t("빈 링크")}</span>
          <span className="media-caption-meta">{src}</span>
        </span>
        {src && (
          <a
            className="media-action"
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("{label} 열기", { label })}
            title={src}
          >
            <ExternalLink size={14} aria-hidden />
            {t("열기")}
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}
