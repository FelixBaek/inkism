import { t } from "../i18n";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";
import { splitBlock } from "@tiptap/pm/commands";
import type { ClipboardPaste } from "./native-clipboard";

export interface PendingSelectionOperation {
  kind: "replay";
  slice: ReturnType<Slice["toJSON"]>;
  head: number;
  steps: ReturnType<Step["toJSON"]>[];
  selection: ReturnType<Selection["toJSON"]>;
  clipboard?: ClipboardPaste;
}
const shiftedStep = (step: Step, shift: number) => {
  const json = step.toJSON();
  if (!["replace", "replaceAround", "addMark", "removeMark"].includes(json.stepType))
    throw new Error(t("현재 입력을 반영한 뒤 이 편집을 시도해 주세요."));
  for (const key of ["from", "to", "gapFrom", "gapTo"]) if (typeof json[key] === "number") json[key] += shift;
  return json;
};
const shiftedSelection = (selection: Selection, shift: number) => {
  const json = selection.toJSON();
  if (json.type !== "text" && json.type !== "node")
    throw new Error(t("현재 입력을 반영한 뒤 다른 위치를 선택해 주세요."));
  json.anchor += shift;
  if (json.type === "text") json.head += shift;
  return json;
};
const inRange = (step: Step, from: number, to: number) => {
  const json = step.toJSON();
  if (typeof json.from !== "number" || typeof json.to !== "number" || json.from < from || json.to > to)
    throw new Error(t("현재 입력을 반영한 뒤 다른 위치를 편집해 주세요. 입력과 원문을 유지합니다."));
};
const stateFrom = (tr: Transaction) =>
  EditorState.create({ schema: tr.doc.type.schema, doc: tr.doc, selection: tr.selection, storedMarks: tr.storedMarks });

function stepIntent(slice: Slice, doc: PMNode, from: number): "text" | "split" | undefined {
  if (
    slice.openStart === 0 &&
    slice.openEnd === 0 &&
    slice.content.childCount &&
    Array.from({ length: slice.content.childCount }, (_, i) => slice.content.child(i)).every((node) => node.isText)
  )
    return "text";
  if (
    slice.openStart === 1 &&
    slice.openEnd === 1 &&
    slice.content.childCount === 2 &&
    slice.content.firstChild!.type === doc.resolve(from).parent.type &&
    !slice.content.firstChild!.content.size &&
    !slice.content.lastChild!.content.size
  )
    return "split";
  return undefined;
}

/** A full immutable paste model, with only a short cursor excerpt mounted.
 * Follow-up native transactions map into this model, never into the old source. */
export class PendingSelection {
  private state: EditorState;
  private readonly initial: Slice;
  private readonly initialHead: number;
  private readonly clipboard?: ClipboardPaste;
  private readonly steps: {
    step: Step;
    intent?: "text" | "split";
    marks?: unknown[];
    clipboard?: ClipboardPaste;
    head?: number;
  }[] = [];
  private from: number;
  private to: number;
  private offset = 0;
  private display: PMNode;
  constructor(before: EditorState, input: Slice | ClipboardPaste) {
    this.clipboard = input instanceof Slice ? undefined : input;
    const parsed =
      input instanceof Slice
        ? { slice: input, transaction: before.tr.replaceSelection(input) }
        : input.parse(before, input.input);
    this.initial = parsed.slice;
    const tr = parsed.transaction;
    this.state = stateFrom(tr);
    this.initialHead = tr.selection.head;
    this.from = tr.mapping.map(before.selection.from, -1);
    this.to = tr.mapping.map(before.selection.to, 1);
    this.display = before.doc;
  }
  preview() {
    const { doc, selection } = this.state,
      head = selection.head;
    let from = Math.max(0, head - 1024),
      to = Math.min(doc.content.size, head + 1024);
    let slice = doc.slice(from, to, true);
    // Many short paragraphs also need a block bound during preparation.
    if (slice.content.childCount > 32) {
      const resolved = doc.resolve(head);
      if (resolved.depth) {
        from = Math.max(from, resolved.before(1));
        to = Math.min(to, resolved.after(1));
      } else {
        from = selection.from;
        to = selection.to;
      }
      slice = doc.slice(from, to, true);
    }
    const shown = doc.type.create(doc.attrs, slice.content);
    if (!shown.type.validContent(shown.content))
      throw new Error(t("입력의 표시 구간을 준비하지 못했습니다. 입력과 원문을 유지합니다."));
    this.offset = from - slice.openStart;
    this.display = shown;
    return { doc: shown, selection: Selection.fromJSON(shown, shiftedSelection(selection, -this.offset)) };
  }
  accept(before: EditorState, input: Transaction, clipboard?: ClipboardPaste) {
    if (!before.doc.eq(this.display)) throw new Error(t("입력 화면이 변경되었습니다. 입력과 원문을 유지합니다."));
    const tr = this.state.tr,
      steps: typeof this.steps = [];
    let from = this.from,
      to = this.to;
    if (clipboard && input.steps.length !== 1)
      throw new Error(t("붙여넣기 변경을 보존하지 못했습니다. 입력과 원문을 유지합니다."));
    for (const step of input.steps) {
      const mapped = Step.fromJSON(tr.doc.type.schema, shiftedStep(step, this.offset));
      inRange(mapped, from, to);
      const json = mapped.toJSON(),
        slice = json.stepType === "replace" ? Slice.fromJSON(tr.doc.type.schema, json.slice) : null;
      const intent = input.getMeta("uiEvent") !== "paste" && slice ? stepIntent(slice, tr.doc, json.from) : undefined;
      const marks =
        intent === "text" && before.storedMarks ? before.storedMarks.map((mark) => mark.toJSON()) : undefined;
      const map = mapped.getMap();
      tr.step(mapped);
      from = map.map(from, -1);
      to = map.map(to, 1);
      steps.push({
        step: mapped,
        intent,
        marks,
        clipboard,
        head: clipboard ? input.selection.head + this.offset : undefined,
      });
    }
    tr.setSelection(Selection.fromJSON(tr.doc, shiftedSelection(input.selection, this.offset)));
    tr.setStoredMarks(input.storedMarks);
    this.state = stateFrom(tr);
    this.steps.push(...steps);
    this.from = from;
    this.to = to;
    this.display = input.doc;
  }
  select(shown: EditorState) {
    if (!shown.doc.eq(this.display)) return;
    const selection = Selection.fromJSON(this.state.doc, shiftedSelection(shown.selection, this.offset));
    if (selection.from < this.from || selection.to > this.to) return;
    this.state = stateFrom(this.state.tr.setSelection(selection).setStoredMarks(shown.storedMarks));
  }
  checkpoint() {
    return {
      state: this.state,
      steps: this.steps.length,
      from: this.from,
      to: this.to,
      offset: this.offset,
      display: this.display,
    };
  }
  restore(saved: ReturnType<PendingSelection["checkpoint"]>) {
    this.state = saved.state;
    this.steps.length = saved.steps;
    this.from = saved.from;
    this.to = saved.to;
    this.offset = saved.offset;
    this.display = saved.display;
  }
  operation(): PendingSelectionOperation {
    return {
      kind: "replay",
      slice: this.initial.toJSON(),
      head: this.initialHead,
      clipboard: this.clipboard,
      steps: this.steps.map(({ step, intent, marks, clipboard, head }) => ({
        ...step.toJSON(),
        pendingIntent: intent,
        pendingMarks: marks,
        pendingClipboard: clipboard,
        pendingPasteHead: head,
      })),
      selection: this.state.selection.toJSON(),
    };
  }
}

type StepJSON = ReturnType<Step["toJSON"]>;
type ClipboardShape = { type: string; text?: string; content?: ClipboardShape[] };
const shape = (nodes: ClipboardShape[] | null | undefined): ClipboardShape[] =>
  (nodes ?? []).map((node) => ({ type: node.type, text: node.text, content: shape(node.content) }));
const geometry = (slice: Slice) =>
  JSON.stringify({ openStart: slice.openStart, openEnd: slice.openEnd, nodes: shape(slice.content.toJSON()) });

/** Returns the new shift and whether the clipboard reinterpretation changed structure. */
function replayClipboardStep(tr: Transaction, state: EditorState, json: StepJSON, mapped: StepJSON) {
  const selection = TextSelection.between(tr.doc.resolve(mapped.from), tr.doc.resolve(mapped.to));
  const current = EditorState.create({ schema: state.schema, doc: tr.doc, selection, storedMarks: tr.storedMarks });
  const clipboard = json.pendingClipboard as ClipboardPaste,
    native = clipboard.parse(current, clipboard.input);
  for (const part of native.transaction.steps) tr.step(part);
  tr.setSelection(Selection.fromJSON(tr.doc, native.transaction.selection.toJSON()));
  const shift: number = native.transaction.selection.head - json.pendingPasteHead;
  const old = Slice.fromJSON(state.schema, mapped.slice);
  return { shift, changed: geometry(old) !== geometry(native.slice) };
}
function replayTextStep(tr: Transaction, state: EditorState, json: StepJSON, mapped: StepJSON) {
  if (json.pendingMarks)
    tr.setStoredMarks(
      json.pendingMarks.map((mark: Parameters<typeof state.schema.markFromJSON>[0]) => state.schema.markFromJSON(mark)),
    );
  else tr.setStoredMarks(null);
  const slice = Slice.fromJSON(state.schema, mapped.slice);
  tr.insertText(slice.content.textBetween(0, slice.content.size, ""), mapped.from, mapped.to);
}
function replaySplitStep(tr: Transaction, state: EditorState, mapped: StepJSON) {
  const selection = TextSelection.between(tr.doc.resolve(mapped.from), tr.doc.resolve(mapped.to));
  const current = EditorState.create({ schema: state.schema, doc: tr.doc, selection });
  let split: Transaction | undefined;
  if (
    !splitBlock(current, (value) => {
      split = value;
    })
  )
    throw new Error(t("이 구조에 입력을 반영하지 못했습니다. 입력과 원문을 유지합니다."));
  for (const part of split!.steps) tr.step(part);
}
function mapTotals(maps: ReturnType<Step["getMap"]>[]) {
  let removed = 0,
    added = 0;
  for (const map of maps)
    map.forEach((a, b, c, d) => {
      removed += b - a;
      added += d - c;
    });
  return [removed, added];
}

function replayStep(tr: Transaction, state: EditorState, json: StepJSON, step: Step, mapped: StepJSON) {
  if (json.pendingClipboard) return replayClipboardStep(tr, state, json, mapped);
  if (json.pendingIntent === "text") replayTextStep(tr, state, json, mapped);
  else if (json.pendingIntent === "split") replaySplitStep(tr, state, mapped);
  else tr.step(step);
  return undefined;
}
/** Returns the edit range mapped through the steps appended since `before`. */
function checkReplayedSteps(tr: Transaction, step: Step, before: number, from: number, to: number, strict: boolean) {
  // Recalculated text marks/parent types must preserve the native position map.
  const wanted = mapTotals([step.getMap()]),
    actual = mapTotals(tr.steps.slice(before).map((step) => step.getMap()));
  if (strict && (wanted[0] !== actual[0] || wanted[1] !== actual[1]))
    throw new Error(t("입력 위치를 그대로 반영하지 못했습니다. 입력과 원문을 유지합니다."));
  for (const part of tr.steps.slice(before)) {
    inRange(part, from, to);
    const map = part.getMap();
    from = map.map(from, -1);
    to = map.map(to, 1);
  }
  return { from, to };
}

/** Fit the original clipboard slice to the real document-wide selection,
 * then replay only edits within that insertion. The source is still unwritten. */
export function replayPendingSelection(state: EditorState, operation: PendingSelectionOperation) {
  const original = Slice.fromJSON(state.schema, operation.slice),
    parsed = operation.clipboard?.parse(state, operation.clipboard.input);
  const tr = parsed?.transaction ?? state.tr.replaceSelection(original);
  let shift = tr.selection.head - operation.head;
  // If clipboard interpretation changes structure/text, only the following
  // suffix has a proven position map. Refuse edits in the ambiguous preview
  // before any write; the retained raw clipboard and edits remain retryable.
  let protectedEnd = parsed && geometry(original) !== geometry(parsed.slice) ? tr.selection.head : -1;
  let from = tr.mapping.map(state.selection.from, -1),
    to = tr.mapping.map(state.selection.to, 1);
  for (const json of operation.steps) {
    const step = Step.fromJSON(state.schema, shiftedStep(Step.fromJSON(state.schema, json), shift));
    inRange(step, from, to);
    const mapped = step.toJSON(),
      before = tr.steps.length;
    if (protectedEnd >= 0 && mapped.from < protectedEnd)
      throw new Error(t("붙여넣기 문맥이 달라 이 위치의 입력을 반영하지 못했습니다. 입력과 원문을 유지합니다."));
    const replayed = replayStep(tr, state, json, step, mapped);
    if (replayed) {
      shift = replayed.shift;
      if (replayed.changed) protectedEnd = tr.selection.head;
    }
    ({ from, to } = checkReplayedSteps(tr, step, before, from, to, !json.pendingClipboard));
  }
  const selection = { ...operation.selection };
  selection.anchor += shift;
  if (selection.type === "text") selection.head += shift;
  if (
    protectedEnd >= 0 &&
    (selection.anchor < protectedEnd || (selection.type === "text" && selection.head < protectedEnd))
  )
    throw new Error(t("붙여넣기 문맥이 달라 선택을 반영하지 못했습니다. 입력과 원문을 유지합니다."));
  tr.setSelection(Selection.fromJSON(tr.doc, selection));
  return tr;
}
