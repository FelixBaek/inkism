import type { CommandProps } from "@tiptap/core";
import { EditorState, Selection } from "@tiptap/pm/state";
import { nativeBlockFormat, type BlockFormatOperation } from "./native-block-format";

/** Compute against the current command chain, without mutating it during
 * `can()` checks. Replaying into its transaction keeps focus, metadata and
 * history grouping while each formatted block retains its own attributes. */
export function mountedBlockFormat(props: CommandProps, operation: BlockFormatOperation): boolean {
  const state = EditorState.create({
    doc: props.tr.doc,
    selection: props.tr.selection,
    storedMarks: props.tr.storedMarks,
  });
  let formatted;
  try {
    formatted = nativeBlockFormat(state, operation);
  } catch {
    return false;
  }
  if (props.dispatch) {
    for (const step of formatted.steps) props.tr.step(step);
    if (formatted.selectionSet)
      props.tr.setSelection(Selection.fromJSON(props.tr.doc, formatted.selection.toJSON()));
    if (formatted.storedMarksSet) props.tr.setStoredMarks(formatted.storedMarks);
    if (formatted.docChanged) props.tr.scrollIntoView();
  }
  return true;
}
