import type { DocumentSegment } from "../types";
import type { DocumentPoint, DocumentSelection } from "./document-selection";
import type { BodySplice } from "./body-splice";
export interface WindowPreview {
  html: string;
  count: number;
  raw?: string;
  offset?: number;
  byteStart?: number;
  /** UTF-16 position relative to the splice start, computed by the range worker. */
  relativeFrom?: number;
  internal?: Omit<DocumentSegment, "source"> & { total: number };
}
/** Undo applies the recorded splices in reverse order with expected/replacement swapped. */
function directedEdits(edits: BodySplice[] | undefined, direction: "undo" | "redo") {
  if (!edits || direction !== "undo") return edits;
  return [...edits]
    .reverse()
    .map((range) => ({ start: range.start, expected: range.replacement, replacement: range.expected }));
}
export interface WindowEdit {
  from: number;
  offset: number;
  before: string;
  after: string;
  beforeCount: number;
  afterCount: number;
  beforeSelection?: Record<string, unknown>;
  afterSelection?: Record<string, unknown>;
  beforeDocumentSelection?: DocumentSelection;
  afterDocumentSelection?: DocumentSelection;
  beforePreview?: WindowPreview;
  afterPreview?: WindowPreview;
  /** Sequential edits in this history's UTF-8 or UTF-16 coordinates. */
  edits?: BodySplice[];
  session: number;
  group: number;
  time: number;
}

/** Stores edited windows, never a whole document snapshot. The caller chooses UTF-16 or UTF-8 offsets for its document representation. */
export class WindowHistory {
  private done: WindowEdit[] = [];
  private undone: WindowEdit[] = [];
  serialize() {
    return { done: this.done, undone: this.undone };
  }
  static restore(value: unknown) {
    const h = new WindowHistory();
    const v = value as { done?: WindowEdit[]; undone?: WindowEdit[] };
    if (!v || !Array.isArray(v.done) || !Array.isArray(v.undone)) return h;
    const preview = (p: WindowPreview | undefined) =>
      !p ||
      (typeof p.html === "string" &&
        (p.raw === undefined || typeof p.raw === "string") &&
        (p.relativeFrom === undefined || Number.isSafeInteger(p.relativeFrom)) &&
        [p.offset, p.byteStart].every((n) => n === undefined || (Number.isSafeInteger(n) && n >= 0)) &&
        Number.isInteger(p.count) &&
        (!p.internal ||
          (Number.isSafeInteger(p.internal.ordinal) &&
            p.internal.ordinal >= 0 &&
            Number.isSafeInteger(p.internal.total) &&
            p.internal.total > p.internal.ordinal &&
            Number.isSafeInteger(p.internal.byte_offset) &&
            p.internal.byte_offset >= 0 &&
            [p.internal.start_context, p.internal.end_context].every(
              (a) =>
                Array.isArray(a) &&
                a.length <= 128 &&
                a.every(
                  (v) =>
                    v &&
                    /^[a-z][a-z0-9]*$/.test(v.tag) &&
                    typeof v.open === "string" &&
                    (v.prelude === undefined || typeof v.prelude === "string"),
                ),
            ))));
    const point = (p: DocumentPoint) => {
      return (
        p &&
        [p.block, p.position].every((n) => Number.isSafeInteger(n) && n >= 0) &&
        ((p.byte === undefined && p.within === undefined) ||
          [p.byte, p.within].every((n) => Number.isSafeInteger(n) && Number(n) >= 0))
      );
    };
    const selection = (s: DocumentSelection | undefined) =>
      !s || s.kind === "all" || (s.kind === "range" && point(s.anchor) && point(s.head));
    const valid = (e: WindowEdit) =>
      e &&
      typeof e.before === "string" &&
      typeof e.after === "string" &&
      Number.isInteger(e.from) &&
      e.from >= 0 &&
      Number.isInteger(e.offset) &&
      e.offset >= 0 &&
      Number.isInteger(e.beforeCount) &&
      Number.isInteger(e.afterCount) &&
      preview(e.beforePreview) &&
      preview(e.afterPreview) &&
      selection(e.beforeDocumentSelection) &&
      selection(e.afterDocumentSelection) &&
      (e.edits === undefined ||
        (Array.isArray(e.edits) &&
          e.edits.length === 2 &&
          e.edits.every(
            (edit) =>
              edit &&
              Number.isSafeInteger(edit.start) &&
              edit.start >= 0 &&
              typeof edit.expected === "string" &&
              typeof edit.replacement === "string",
          )));
    if (v.done.length + v.undone.length > 100 || ![...v.done, ...v.undone].every(valid)) return h;
    h.done = v.done.map((e) => ({ ...e, session: -1 }));
    h.undone = v.undone.map((e) => ({ ...e, session: -1 }));
    if (h.byteSize > 8 * 1024 * 1024) return new WindowHistory();
    return h;
  }
  private size(e: WindowEdit) {
    return (
      (e.before.length +
        e.after.length +
        (e.edits?.reduce((n, edit) => n + edit.expected.length + edit.replacement.length, 0) ?? 0) +
        (e.beforePreview?.html.length ?? 0) +
        (e.afterPreview?.html.length ?? 0) +
        (e.beforePreview?.raw?.length ?? 0) +
        (e.afterPreview?.raw?.length ?? 0) +
        JSON.stringify(e.beforePreview?.internal ?? "").length +
        JSON.stringify(e.afterPreview?.internal ?? "").length +
        JSON.stringify(e.beforeDocumentSelection ?? "").length +
        JSON.stringify(e.afterDocumentSelection ?? "").length) *
      2
    );
  }
  get byteSize() {
    return [...this.done, ...this.undone].reduce((sum, e) => sum + this.size(e), 0);
  }
  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  record(edit: WindowEdit) {
    if (edit.before === edit.after && !edit.edits?.some((range) => range.expected !== range.replacement)) return;
    const last = this.done.at(-1);
    if (
      !edit.edits &&
      !last?.edits &&
      !this.undone.length &&
      last?.session === edit.session &&
      last.group === edit.group &&
      edit.time - last.time < 500 &&
      last.from === edit.from &&
      last.after === edit.before
    ) {
      this.done[this.done.length - 1] = {
        ...last,
        after: edit.after,
        afterCount: edit.afterCount,
        afterSelection: edit.afterSelection,
        afterDocumentSelection: edit.afterDocumentSelection,
        afterPreview: edit.afterPreview,
        time: edit.time,
      };
    } else this.done.push({ ...edit });
    this.undone = [];
    // Keep at most 100 groups / 8 MiB of window strings. Always retain the latest
    // edit even if that single window is oversized, so it can still be undone.
    let bytes = this.done.reduce((sum, e) => sum + this.size(e), 0);
    while (this.done.length > 1 && (this.done.length > 100 || bytes > 8 * 1024 * 1024)) {
      const removed = this.done.shift()!;
      bytes -= this.size(removed);
    }
  }
  prepare(direction: "undo" | "redo") {
    const origin = direction === "undo" ? this.done : this.undone;
    const edit = origin.at(-1);
    if (!edit) return null;
    return {
      edit,
      expected: direction === "undo" ? edit.after : edit.before,
      html: direction === "undo" ? edit.before : edit.after,
      from: edit.from,
      offset: edit.offset,
      count: direction === "undo" ? edit.beforeCount : edit.afterCount,
      countDelta: direction === "undo" ? edit.beforeCount - edit.afterCount : edit.afterCount - edit.beforeCount,
      selection: direction === "undo" ? edit.beforeSelection : edit.afterSelection,
      documentSelection: direction === "undo" ? edit.beforeDocumentSelection : edit.afterDocumentSelection,
      preview: direction === "undo" ? edit.beforePreview : edit.afterPreview,
      edits: directedEdits(edit.edits, direction),
    };
  }
  commit(direction: "undo" | "redo", edit: WindowEdit) {
    const origin = direction === "undo" ? this.done : this.undone;
    const target = direction === "undo" ? this.undone : this.done;
    if (origin.at(-1) !== edit) throw new Error("실행 취소 기록이 변경되었습니다.");
    origin.pop();
    target.push(edit);
  }
  apply(direction: "undo" | "redo", source: string) {
    const result = this.prepare(direction);
    if (!result) return null;
    let content = source;
    for (const range of result.edits ?? [{ start: result.from, expected: result.expected, replacement: result.html }]) {
      if (
        range.start < 0 ||
        range.start + range.expected.length > content.length ||
        content.slice(range.start, range.start + range.expected.length) !== range.expected
      )
        throw new Error("문서 내용이 변경되어 이 실행 취소 기록을 적용할 수 없습니다.");
      content = content.slice(0, range.start) + range.replacement + content.slice(range.start + range.expected.length);
    }
    this.commit(direction, result.edit);
    return { ...result, content };
  }
}
