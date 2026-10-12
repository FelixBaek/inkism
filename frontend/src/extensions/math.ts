/** 수식 블록·인라인 수식: Tiptap mathematics 확장에 React 편집 화면을 붙인다. */
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import type { Editor, NodeViewRenderer } from "@tiptap/core";
import { mergeAttributes } from "@tiptap/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./math.css";
import { t } from "../i18n";
import {mathDiagnostic,type MathDiagnostic} from "../lib/math-diagnostics";

export type MathKind = "blockMath" | "inlineMath";
export interface MathRequest {
  kind: MathKind;
  pos?: number;
}
export const MATH_EVENT = "inkism-edit-math";
export const MAX_MATH_LENGTH = 8192;
export const mathOptions = {
  trust: false,
  throwOnError: false,
  maxExpand: 1000,
  maxSize: 20,
  strict: "ignore" as const,
};
export function requestMath(editor: Editor, request: MathRequest) {
  if (!editor.isDestroyed && editor.isEditable) {
    editor.view.dom.dispatchEvent(new CustomEvent<MathRequest>(MATH_EVENT, { detail: request }));
  }
}
export function renderMath(latex: string, element: HTMLElement, block: boolean):MathDiagnostic|null {
  if (latex.length > MAX_MATH_LENGTH) {
    element.textContent = t("수식이 너무 길어 미리보기를 표시하지 않습니다.");
    return mathDiagnostic(new Error(element.textContent),latex);
  }
  try {
    katex.render(latex, element, { ...mathOptions, displayMode: block, throwOnError:true });
    return null;
  } catch(error) {
    element.textContent = latex;
    return mathDiagnostic(error,latex);
  }
}
function mathView(editor: Editor, kind: MathKind): NodeViewRenderer {
  return ({ node, getPos }) => {
    const block = kind === "blockMath";
    const dom: HTMLElement = document.createElement(block ? "div" : "span");
    dom.className = "inkism-math";
    dom.dataset.type = block ? "block-math" : "inline-math";
    dom.dataset.latex = node.attrs.latex;
    dom.contentEditable = "false";
    dom.tabIndex = 0;
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", t("수식 편집: {latex}", { latex: String(node.attrs.latex).slice(0, 160) }));
    renderMath(String(node.attrs.latex ?? ""), dom, block);
    const open = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = getPos();
      if (typeof pos === "number") {
        editor.commands.setNodeSelection(pos);
        requestMath(editor, { kind, pos });
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    };
    dom.addEventListener("click", open);
    dom.addEventListener("keydown", key);
    return {
      dom,
      stopEvent: (event) =>
        event.type === "click" || (event.type === "keydown" && ["Enter", " "].includes((event as KeyboardEvent).key)),
      destroy() {
        dom.removeEventListener("click", open);
        dom.removeEventListener("keydown", key);
      },
    };
  };
}
export const InkismBlockMath = BlockMath.extend({
  renderText: ({ node }) => String(node.attrs.latex ?? ""),
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "block-math" }), String(node.attrs.latex ?? "")];
  },
  addNodeView() {
    return mathView(this.editor, "blockMath");
  },
});
export const InkismInlineMath = InlineMath.extend({
  renderText: ({ node }) => String(node.attrs.latex ?? ""),
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "inline-math" }), String(node.attrs.latex ?? "")];
  },
  addNodeView() {
    return mathView(this.editor, "inlineMath");
  },
});
