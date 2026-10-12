import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { t } from "../i18n";

/** Prefers the position at the remembered column when it lies on the line the browser moved to. */
function alignToColumn(view: EditorView, position: number, from: number, column: number, up: boolean) {
  const line = view.coordsAtPos(position, up ? -1 : 1);
  const located = view.posAtCoords({ left: column, top: (line.top + line.bottom) / 2 });
  if (
    position === from ||
    !located ||
    !view.state.doc.resolve(located.pos).sameParent(view.state.doc.resolve(position))
  )
    return position;
  const candidate = view.coordsAtPos(located.pos, up ? -1 : 1);
  return candidate.top < line.bottom && candidate.bottom > line.top ? located.pos : position;
}

/** Use the browser's line layout, retaining the intended column after a short
 * line or an editor-window replacement. No document content is changed. */
export function moveVisualCursor(view: EditorView, up: boolean, column: number, extend: boolean): boolean {
  const selected = view.state.selection;
  const native = view.dom.ownerDocument.getSelection();
  if (!(selected instanceof TextSelection) || !native || typeof native.modify !== "function") return false;
  const before = {
    anchor: native.anchorNode,
    anchorOffset: native.anchorOffset,
    head: native.focusNode,
    headOffset: native.focusOffset,
  };
  try {
    const head = view.domAtPos(selected.head);
    native.collapse(head.node, head.offset);
    native.modify("move", up ? "backward" : "forward", "line");
    if (!native.focusNode || !view.dom.contains(native.focusNode)) throw new Error("cursor outside editor");
    const moved = view.posAtDOM(native.focusNode, native.focusOffset, up ? -1 : 1);
    const position = alignToColumn(view, moved, selected.head, column, up);
    const doc = view.state.doc,
      anchor = extend ? doc.resolve(selected.anchor) : doc.resolve(position);
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.between(anchor, doc.resolve(position), up ? -1 : 1))
        .setMeta("addToHistory", false)
        .scrollIntoView(),
    );
    return true;
  } catch {
    // Selection.modify may be unavailable for an embedded node view. Restore
    // the DOM selection before letting the usual editor handler take over.
    if (before.anchor && before.head)
      native.setBaseAndExtent(before.anchor, before.anchorOffset, before.head, before.headOffset);
    return false;
  }
}

/** Measured line starts for bounded source overlap. Restore the selection in
 * the same task so the browser's temporary probe never becomes an edit. */
export function visualRowStart(view: EditorView, position: number, rows: number): number {
  const native = view.dom.ownerDocument.getSelection();
  if (!native || typeof native.modify !== "function") throw new Error(t("표시 줄 위치를 확인하지 못했습니다."));
  const before = {
    anchor: native.anchorNode,
    anchorOffset: native.anchorOffset,
    head: native.focusNode,
    headOffset: native.focusOffset,
  };
  try {
    const head = view.domAtPos(position);
    native.collapse(head.node, head.offset);
    for (let i = 0; i < Math.abs(rows); i++) native.modify("move", rows < 0 ? "backward" : "forward", "line");
    native.modify("move", "backward", "lineboundary");
    if (!native.focusNode || !view.dom.contains(native.focusNode))
      throw new Error(t("표시 줄이 편집 범위를 벗어났습니다."));
    return view.posAtDOM(native.focusNode, native.focusOffset, 1);
  } finally {
    if (before.anchor && before.head)
      native.setBaseAndExtent(before.anchor, before.anchorOffset, before.head, before.headOffset);
    else native.removeAllRanges();
  }
}
