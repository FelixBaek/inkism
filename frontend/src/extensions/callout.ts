/**
 * 강조 상자(callout). 아이콘 하나와 밝은·어두운 테마별 배경·테두리 색을 가진 블록 묶음이다.
 * 저장 형식: <div data-type="callout" data-icon=… icon=…> — 이미 저장된 노트와 맞물려 있어 이름을 바꾸지 않는다.
 */
import { Node, mergeAttributes, wrappingInputRule } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import "./callout.css";

const ICON_MAX = 32;
const COLORS = {
  backColor: { fallback: "#eeeeee", css: "--callout-bg" },
  backColorDark: { fallback: "rgba(101, 117, 133, 0.16)", css: "--callout-bg-dark" },
  borderColor: { fallback: "#dddddd", css: "--callout-border" },
  borderColorDark: { fallback: "#333333", css: "--callout-border-dark" },
} as const;
const ICON_FALLBACK = "🌾";

const validColor = (value: string | null | undefined, fallback: string) =>
  value && CSS.supports("color", value) ? value : fallback;

/** data-* 이름과 예전 맨 이름을 함께 읽고 함께 쓴다. */
function stored(name: string, read: (raw: string | null) => string, fallback: string) {
  const plain = name.toLowerCase();
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => read(el.getAttribute(`data-${plain}`) ?? el.getAttribute(name)),
    renderHTML: (attrs: Record<string, string>) => ({ [`data-${plain}`]: attrs[name], [plain]: attrs[name] }),
  };
}

/** 선택 위치를 감싼 가장 안쪽 callout과 시작 위치. */
function enclosingCallout(state: EditorState, type: string): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === type) return { node: sel.node, pos: sel.from };
  for (let d = sel.$from.depth; d > 0; d--) {
    const node = sel.$from.node(d);
    if (node.type.name === type) return { node, pos: sel.$from.before(d) };
  }
  return null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { toggleCallout: () => ReturnType };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  draggable: true,

  addAttributes() {
    const attrs: Record<string, ReturnType<typeof stored>> = {
      icon: stored("icon", (raw) => (raw ?? ICON_FALLBACK).slice(0, ICON_MAX), ICON_FALLBACK),
    };
    for (const [name, { fallback }] of Object.entries(COLORS)) {
      attrs[name] = stored(name, (raw) => validColor(raw, fallback), fallback);
    }
    return attrs;
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const style = Object.entries(COLORS)
      .map(([name, { fallback, css }]) => `${css}:${validColor(node.attrs[name], fallback)}`)
      .join(";");
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout", style }), 0];
  },

  addCommands() {
    return {
      // 밖이면 감싸고, 안이면 상자 전체를 벗긴다(형제 문단·제목까지 함께).
      toggleCallout:
        () =>
        ({ state, tr, dispatch, commands }) => {
          const found = enclosingCallout(state, this.name);
          if (!found) return commands.wrapIn(this.name);
          if (!dispatch) return true;
          const { node, pos } = found;
          const end = pos + node.nodeSize;
          const sel = state.selection;
          tr.replaceWith(pos, end, node.content);
          const inside = sel instanceof TextSelection && sel.from > pos && sel.to < end;
          // 벗기면 내용이 한 칸 앞당겨진다.
          tr.setSelection(
            inside
              ? TextSelection.create(tr.doc, sel.anchor - 1, sel.head - 1)
              : TextSelection.near(tr.doc.resolve(pos)),
          );
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-c": () => this.editor.commands.toggleCallout() };
  },

  addInputRules() {
    // 줄 맨 앞에서 "? "(전각 "？ " 포함)를 치면 강조 상자로 바꾼다.
    return [wrappingInputRule({ find: /^[?？]\s$/, type: this.type })];
  },
});
