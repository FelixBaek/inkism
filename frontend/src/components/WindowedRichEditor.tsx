import { ANCHOR_EVENT, type AnchorRequest } from "../lib/note-anchor";
import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { editorLocation, rememberLocation } from "../lib/editor-location";
import { api, RpcError } from "../api";
import type { Draft, DocumentSegment } from "../types";
import { renderSegment, projectSegment, contextIdentifiable, contextIdentity } from "../lib/rich-segment";
import { projectWindowSource } from "../lib/window-source";
import {
  saveSegmentSelection,
  restoreSegmentSelection,
  segmentEdgeSelection,
  segmentPositionMap,
} from "../lib/segment-selection";
import { locateBlockRange } from "../lib/block-range";
import type { BodySplice } from "../lib/body-splice";
import { scrollSpace } from "../lib/scroll-space";
import { BlockHeights } from "../lib/block-heights";
import { windowHistory, retainWindowHistory, nextHistorySession } from "../lib/window-history-cache";
import type { WindowPreview } from "../lib/window-history";
import { DocumentSearch } from "./DocumentSearch";
import { DocumentCopy } from "./DocumentCopy";
import { RichEditor, type RichChange } from "./RichEditor";
import { canonicalRichHTML, inspectRichHTML } from "../lib/rich-document";
import "./WindowedRichEditor.css";
import type { Editor } from "@tiptap/core";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { serializeModel } from "../lib/segment-model";
import { PendingSelection } from "../lib/pending-selection";
import { nativeClipboardPaste, type ClipboardPaste } from "../lib/native-clipboard";
import { Selection, TextSelection, EditorState, type Transaction } from "@tiptap/pm/state";
import { registerEditorFlush, type EditorFlushOptions } from "../lib/editor-flush";
import { useStore } from "../store";
import {
  changeSelection,
  changeSelectionAsync,
  changeBlockSelectionAsync,
  capturedSelectionSlice,
  comparePoints,
  windowSelection,
  documentPoint,
  prepareSelection,
  selectionClipboard,
  type DocumentPoint,
  type DocumentSelection,
  type SelectionOperation,
  type PreparedSelection,
} from "../lib/document-selection";
import { prepareBoundary, changeBoundary, applyBoundaryCommand, type BoundaryDirection } from "../lib/boundary-edit";
import { sourceSpan } from "../lib/source-segments";
import { visualRowStart } from "../lib/visual-cursor";
import { prepareBlockAction, type BlockCommand } from "../lib/document-block-action";
import type { DocumentBlockAction, DocumentBlockDrag } from "./BlockTools";
import { t } from "../i18n";
import { blockIdentityTransaction } from "../extensions/block-identity";

const WINDOW = 32;
type Edge = "start" | "end";
type Join = "backward" | "forward";
type WindowTarget = {
  byte?: number;
  within?: number;
  position?: number;
  bias?: "before" | "after";
  segment?: number;
  edge?: "previous" | "next";
  column?: number;
  vertical?: { origin: DocumentPoint; up: boolean; extend: boolean; freshColumn: boolean; ticket: number };
};
const INTERNAL_BYTES = 64 * 1024;
interface WindowState {
  offset: number;
  count: number;
  total: number;
  session: number;
  edge?: Edge;
  join?: Join;
  selection?: Record<string, unknown>;
  source: string;
  byteStart?: number;
  from: number;
  to: number;
  html: string;
  segment?: DocumentSegment;
  segmentTotal?: number;
  column?: number;
  segmentSpan?: { start: number; end: number };
  verticalStep?: NonNullable<WindowTarget["vertical"]>;
  projectedSelection?: boolean;
}
interface Props {
  id: string;
  readOnly?: boolean;
  historyIdentity?: string;
  readDraft: () => Draft | null;
  flush: (options?: EditorFlushOptions) => Promise<boolean>;
  changeRange: (edit: import("../lib/body-splice").BodySplice) => void;
  change: (content: string, windowEdit?: Draft["windowEdit"]) => void;
}
/** Re-render counter step; the counter value itself is never read. */
const increment = (value: number) => value + 1;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const navigationErrorMessage = (error: unknown) =>
  error instanceof RpcError && error.isConflict
    ? t("문서가 변경되었습니다. 다시 검색하거나 열어 주세요.")
    : messageOf(error);
/** Auto-scroll step while a pointer is within `margin` of the host's top or bottom edge. */
function edgeScrollSpeed(y: number, top: number, bottom: number, margin: number) {
  if (y < top + margin) return -Math.min(32, (top + margin - y) / 2);
  if (y > bottom - margin) return Math.min(32, (y - bottom + margin) / 2);
  return 0;
}
const clipboardWritable = () => Boolean(navigator.clipboard?.write) && typeof ClipboardItem !== "undefined";
const resolvedSelectionOperation = (operation: SelectionOperation | "cut") =>
  operation === "cut" ? ({ kind: "delete" } as const) : operation;
type BlockActionResult = Awaited<ReturnType<typeof prepareBlockAction>>;
/** Selection of one whole block, from its start byte to its end byte. */
const blockRangeSelection = (block: { ordinal: number; start: number; end: number }) => ({
  kind: "range" as const,
  anchor: { block: block.ordinal, position: 0, byte: block.start, within: 0 },
  head: { block: block.ordinal, position: 0, byte: block.end, within: 0 },
});
/** Editor selection before a block action, relative to the acted-on block. */
function blockSelectionBefore(
  original: EditorState,
  index: number,
  dragOrdinal: number | undefined,
  segmented: boolean,
) {
  let local = 0;
  for (let i = 0; i < index; i++) local += original.doc.child(i).nodeSize;
  const beforeSelection: Record<string, unknown> =
    dragOrdinal === undefined ? { ...original.selection.toJSON() } : { type: "node", anchor: 0 };
  if (dragOrdinal === undefined && !segmented) {
    for (const key of ["anchor", "head", "from"])
      if (typeof beforeSelection[key] === "number") beforeSelection[key] -= local;
  }
  return beforeSelection;
}
type TransactionStep = Transaction["steps"][number];
type StepJSON = ReturnType<TransactionStep["toJSON"]>;
/** Whether a provisional-input step touches anything outside its captured range. */
function stepOutside(step: TransactionStep, map: ReturnType<TransactionStep["getMap"]>, from: number, to: number) {
  let outside = false;
  map.forEach((start, end) => {
    if (start < from || end > to) outside = true;
  });
  const value = step.toJSON();
  if (!["replace", "replaceAround", "addMark", "removeMark"].includes(value.stepType)) outside = true;
  if ((value.stepType === "addMark" || value.stepType === "removeMark") && (value.from < from || value.to > to))
    outside = true;
  return outside;
}
/** Text or plain paragraphs only: safe to apply provisionally like IME input. */
const plainNodes = (nodes: Record<string, unknown>[]): boolean =>
  nodes.every(
    (node) =>
      node.type === "text" ||
      (node.type === "paragraph" && plainNodes((node.content ?? []) as Record<string, unknown>[])),
  );
type SavedLocation = ReturnType<typeof editorLocation>;
type NavigationPage = Awaited<ReturnType<typeof api.documentBlocks>>;
type Ready = <T extends { ready: boolean }>(read: () => Promise<T>) => Promise<T>;
interface NavigationRequest {
  offset: number;
  position: boolean;
  revision?: number;
  edge?: Edge;
  size: number;
  join?: Join;
  target?: WindowTarget;
}
interface WindowContent {
  segment?: DocumentSegment;
  segmentTotal?: number;
  raw: string;
  html: string;
  byteStart: number;
  count: number;
}
const UNSUPPORTED_WINDOW = t(
  "이 구간에는 그대로 보존할 수 없는 서식이 있습니다. HTML 원문 모드에서 편집해 주세요. 원문은 유지했습니다.",
);
/** Re-read until the server reports the range ready, validating between polls. */
async function pollReady<T extends { ready: boolean }>(
  read: () => Promise<T>,
  check: () => void,
  deadline: number,
  message: string,
) {
  let result = await read();
  while (!result.ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    check();
    result = await read();
  }
  check();
  if (!result.ready) throw new Error(message);
  return result;
}
/** Source byte at the start of a visual row, stepping past character references. */
function visualRowByte(
  map: ReturnType<typeof segmentPositionMap>,
  view: Editor["view"],
  position: number,
  rows: number,
) {
  let point = map.point(visualRowStart(view, position, rows));
  for (let extra = 1; point.within && extra <= 2; extra++)
    point = map.point(visualRowStart(view, position, rows + (rows < 0 ? -extra : extra)));
  if (point.within) throw new Error(t("문자 참조 내부의 줄 문맥을 준비하지 못했습니다."));
  return point.byte;
}
/** Join two adjacent internal segments whose source and tag context line up. */
function mergeSegments(left: DocumentSegment, right: DocumentSegment, ordinal: number): DocumentSegment {
  const same =
    left.end_context.length === right.start_context.length &&
    left.end_context.every((a, index) => {
      const b = right.start_context[index];
      return a.tag === b.tag && a.open === b.open && (a.prelude ?? "") === (b.prelude ?? "");
    });
  if (left.byte_offset + new TextEncoder().encode(left.source).length !== right.byte_offset || !same)
    throw new Error(t("표시 줄의 원문 경계가 일치하지 않습니다."));
  const source = left.source + right.source;
  if (new TextEncoder().encode(source).length > INTERNAL_BYTES) throw new Error(t("표시 줄의 문맥이 너무 큽니다."));
  return {
    ordinal,
    byte_offset: left.byte_offset,
    source,
    start_context: left.start_context,
    end_context: right.end_context,
  };
}
function blockWindowContent(page: NavigationPage, join?: Join): WindowContent {
  if (!page.blocks.length) throw new Error(t("문서 범위를 벗어났습니다."));
  if (join && page.blocks.length !== 2)
    throw new Error(t("두 블록을 합치는 범위를 준비하지 못했습니다. 원문은 유지했습니다."));
  const html = page.blocks.map((block) => block.html).join("");
  const count = page.blocks.length;
  const inspection = inspectRichHTML(html);
  if (!inspection.editable || inspection.blocks !== count) throw new Error(UNSUPPORTED_WINDOW);
  return { raw: html, html, byteStart: page.blocks[0].byte_offset, count };
}
/** Fraction of an oversized block covered by one internal segment window. */
function oversizedSpan(oversized: { byte_offset: number; byte_count: number }, byteStart: number, raw: string) {
  return {
    start: Math.max(0, (byteStart - oversized.byte_offset) / oversized.byte_count),
    end: Math.min(1, (byteStart + new TextEncoder().encode(raw).length - oversized.byte_offset) / oversized.byte_count),
  };
}
/** A saved text range that is non-empty or outside the loaded window must be located by byte. */
function savedRangeNeedsLocate(saved: Record<string, unknown>, start: number, end: number) {
  if (saved.type !== "text" || typeof saved.anchorByte !== "number" || typeof saved.headByte !== "number") return false;
  return (
    saved.anchorByte !== saved.headByte ||
    saved.anchorWithin !== saved.headWithin ||
    saved.anchorByte < start ||
    saved.headByte < start ||
    saved.anchorByte > end ||
    saved.headByte > end
  );
}
const windowSourceSegment = (segment: DocumentSegment | undefined, byteStart: number, raw: string): DocumentSegment =>
  segment ?? { ordinal: 0, byte_offset: byteStart, source: raw, start_context: [], end_context: [] };
/** Saved selection for a re-opened window, plus whether it was projected from a document range. */
function restoredSelection(
  saved: Record<string, unknown>,
  documentSelection: DocumentSelection | undefined,
  segment: DocumentSegment | undefined,
  source: DocumentSegment,
  offset: number,
) {
  if (documentSelection)
    return {
      selection: windowSelection(segmentPositionMap(source).doc(), offset, documentSelection, source)?.toJSON(),
      projected: true,
    };
  return { selection: segment ? restoreSegmentSelection(segment, saved) : saved, projected: false };
}
/** Caret selection for an explicit byte cursor or model position target. */
function targetSelection(source: DocumentSegment, cursor: number | undefined, target: WindowTarget | undefined) {
  if (cursor !== undefined)
    return segmentEdgeSelection(
      source,
      cursor,
      target?.bias === "before" || target?.edge === "previous" ? -1 : 1,
      target?.within ?? 0,
    );
  if (target?.position === undefined) return undefined;
  const model = segmentPositionMap(source).doc();
  return Selection.near(
    model.resolve(Math.min(target.position, model.content.size)),
    target.bias === "before" ? -1 : 1,
  ).toJSON();
}
function applyVerticalStep(
  next: WindowState,
  segment: DocumentSegment,
  byteStart: number,
  raw: string,
  vertical: NonNullable<WindowTarget["vertical"]>,
) {
  const point = vertical.origin,
    end = byteStart + new TextEncoder().encode(raw).length;
  if (point.byte !== undefined && point.byte >= byteStart && point.byte <= end) {
    next.selection = segmentEdgeSelection(segment, point.byte, vertical.up ? -1 : 1, point.within ?? 0);
    next.edge = undefined;
    next.verticalStep = vertical;
  }
}
function applyNavigationSelection(
  next: WindowState,
  context: {
    initial: SavedLocation;
    initialDocumentSelection: DocumentSelection | undefined;
    segment: DocumentSegment | undefined;
    byteStart: number;
    raw: string;
    cursor: number | undefined;
    target: WindowTarget | undefined;
  },
) {
  const { initial, initialDocumentSelection, segment, byteStart, raw, cursor, target } = context;
  const source = windowSourceSegment(segment, byteStart, raw);
  if (initial?.selection && (initial.offset === next.offset || cursor !== undefined)) {
    const restored = restoredSelection(initial.selection, initialDocumentSelection, segment, source, next.offset);
    next.selection = restored.selection;
    if (restored.projected) next.projectedSelection = true;
  } else {
    const selected = targetSelection(source, cursor, target);
    if (selected !== undefined) next.selection = selected;
  }
  if (next.selection) next.edge = undefined;
  if (target?.vertical && segment) applyVerticalStep(next, segment, byteStart, raw, target.vertical);
}
type HistoryStep = NonNullable<ReturnType<ReturnType<typeof windowHistory>["prepare"]>>;
/** Preview window restored by an undo/redo step, admitted before the body or history changes. */
function restoredHistoryWindow(result: HistoryStep) {
  const preview = result.preview ?? { html: result.html, count: result.count };
  const segment = preview.internal ? { ...preview.internal, source: preview.raw ?? result.html } : undefined;
  const raw = preview.raw ?? (segment ? result.html : preview.html);
  // Admit the restored model before changing the body or consuming history.
  const rendered = segment ? renderSegment(segment) : preview.html;
  if (!inspectRichHTML(rendered).editable || canonicalRichHTML(rendered) !== canonicalRichHTML(preview.html))
    throw new Error(t("이 실행 취소 구간의 서식을 복원하지 못했습니다. 원문과 기록을 유지했습니다."));
  return { preview, segment, raw };
}
/** Validate undo/redo ranges against the current body and return the replayed source ("" when paged). */
function replayHistoryRanges(draft: Draft, ranges: { start: number; expected: string; replacement: string }[]) {
  let source = draft.paged ? "" : draft.content;
  let bytes = draft.paged?.totalBytes ?? 0;
  for (const range of ranges) {
    if (draft.paged) {
      const removed = new TextEncoder().encode(range.expected).length;
      if (range.start < 0 || range.start + removed > bytes)
        throw new Error(t("실행 취소 위치가 문서 범위를 벗어났습니다."));
      bytes += new TextEncoder().encode(range.replacement).length - removed;
    } else {
      if (
        range.start < 0 ||
        range.start + range.expected.length > source.length ||
        source.slice(range.start, range.start + range.expected.length) !== range.expected
      )
        throw new Error(t("문서 내용이 변경되어 이 실행 취소 기록을 적용할 수 없습니다."));
      source = source.slice(0, range.start) + range.replacement + source.slice(range.start + range.expected.length);
    }
  }
  return source;
}
/** Body offset and source byte where an undo/redo preview window starts. */
function historyPreviewStart(
  draft: Draft,
  result: HistoryStep,
  preview: ReturnType<typeof restoredHistoryWindow>["preview"],
  segment: DocumentSegment | undefined,
  source: string,
) {
  const firstByte = draft.paged ? result.from : new TextEncoder().encode(source.slice(0, result.from)).length;
  const previewByte = preview.byteStart ?? segment?.byte_offset ?? firstByte;
  const from = draft.paged
    ? 0
    : result.from + (preview.relativeFrom ?? utf8PrefixLength(result.html, previewByte - firstByte));
  return { from, previewByte };
}
const UNSUPPORTED_SELECTION = t(
  "선택할 구간에는 그대로 보존할 수 없거나 너무 큰 서식이 있습니다. HTML 원문 모드에서 편집해 주세요.",
);
interface WindowExtension {
  editor: Editor;
  state: WindowState;
  selected: Selection;
  originalDoc: PMNode;
  ticket: number;
  anchor: DocumentPoint;
  origin: DocumentPoint;
  target: number;
  end: boolean;
  previous: boolean;
  cursor: number | undefined;
  column: number | undefined;
  vertical: boolean;
}
/** A vertical move continues line by line only inside a non-code text block. */
const continuesInTextblock = (editor: Editor) =>
  Boolean(editor.state.doc.firstChild?.isTextblock && editor.state.doc.firstChild.type.name !== "codeBlock");
/** Block a Shift-selection extends into: a document edge, or the block before/after the window. */
function extensionTarget(
  key: string,
  extreme: boolean,
  previous: boolean,
  offset: number,
  total: number,
  count: number,
) {
  if (extreme) return key === "Home" ? 0 : total - 1;
  return previous ? offset - 1 : offset + count;
}
function extensionCaret(
  map: ReturnType<typeof segmentPositionMap>,
  doc: PMNode,
  cursor: number | undefined,
  end: boolean,
  previous: boolean,
) {
  if (cursor === undefined) return end ? Selection.atEnd(doc).head : Selection.atStart(doc).head;
  return Selection.near(doc.resolve(map.position(cursor)), previous ? -1 : 1).head;
}
/** UTF-16 units of the character next to the caret: 2 for a surrogate pair. */
function caretStepSize(text: string | undefined, previous: boolean) {
  if (previous) return text && /[\uDC00-\uDFFF]/.test(text.at(-1)!) ? 2 : 1;
  return text?.codePointAt(0)! > 0xffff ? 2 : 1;
}
/** Move the caret one character past the boundary it was placed on. */
function stepCaret(doc: PMNode, caret: number, previous: boolean) {
  const resolved = doc.resolve(caret),
    text = previous ? resolved.nodeBefore?.text : resolved.nodeAfter?.text;
  const size = caretStepSize(text, previous);
  return Selection.near(
    doc.resolve(Math.max(0, Math.min(doc.content.size, caret + (previous ? -size : size)))),
    previous ? -1 : 1,
  ).head;
}
/** The range edge an unshifted Left/Right collapses to. */
function collapsedPoint(selection: { anchor: DocumentPoint; head: DocumentPoint }, end: boolean) {
  const forward = comparePoints(selection.anchor, selection.head) <= 0;
  if (end) return forward ? selection.head : selection.anchor;
  return forward ? selection.anchor : selection.head;
}
type EditorBoundary = "previous" | "next" | "first" | "last" | "backward" | "forward" | "up" | "down";
/** Vertical caret keys continue as previous/next window moves. */
const BOUNDARY_DIRECTION = {
  previous: "previous",
  next: "next",
  first: "first",
  last: "last",
  backward: "backward",
  forward: "forward",
  up: "previous",
  down: "next",
} as const satisfies Record<EditorBoundary, Exclude<EditorBoundary, "up" | "down">>;
/** UTF-16 length of the first `bytes` UTF-8 bytes of `text`. */
const utf8PrefixLength = (text: string, bytes: number) =>
  new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, bytes)).length;
/** The body after outside opening tags and one region splice at `range` (the
 * located UTF-16 span before the tags; unused for paged drafts). Multi-splice
 * history replays every splice; non-paged previews need their own UTF-16 starts
 * relative to the first splice (they differ by the tags). */
function regionSplice(
  draft: Draft,
  tags: { edits: BodySplice[]; source: string; shift: number },
  result: { start: number; expected: string; replacement: string },
  range: { from: number; to: number },
) {
  const regionFrom = draft.paged ? result.start : range.from + tags.shift;
  const source = draft.paged
    ? ""
    : tags.source.slice(0, regionFrom) + result.replacement + tags.source.slice(range.to + tags.shift);
  const edits = tags.edits.length
    ? [...tags.edits, { start: regionFrom, expected: result.expected, replacement: result.replacement }]
    : undefined;
  let historyFrom = draft.paged ? result.start : range.from;
  if (edits) historyFrom = edits[0].start;
  const relative = <P extends WindowPreview>(preview: P, at: number, text: string, byte: number) =>
    edits && !draft.paged
      ? { ...preview, relativeFrom: at + utf8PrefixLength(text, (preview.byteStart ?? byte) - byte) - edits[0].start }
      : preview;
  return { regionFrom, source, edits, historyFrom, relative };
}
/** Staged behind ?virtual=1 until cross-window selection/history is complete. */
export function WindowedRichEditor({
  id,
  historyIdentity = id,
  readDraft,
  flush,
  change,
  changeRange,
  readOnly = false,
}: Readonly<Props>) {
  const { confirm } = useStore();
  const initialLocation = useRef(editorLocation(id, readDraft()?.revision ?? 0, "windowed"));
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [findTarget, setFindTarget] = useState<{
    query: string;
    sensitive: boolean;
    request: number;
    session: number;
    occurrence?:number;
  }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, refreshHistory] = useReducer(increment, 0);
  const [history] = useState(() => ({
    current: windowHistory(historyIdentity, readDraft()?.revision ?? 0, readDraft()?.paged ? "utf8" : "utf16"),
  }));
  const retainHistory = () => {
    const draft = readDraft();
    if (draft?.id === id)
      retainWindowHistory(historyIdentity, draft.revision, draft.paged ? "utf8" : "utf16", history.current);
  };
  const edited = useRef({ html: "", raw: "", count: 0 });
  const blockDrag = useRef<{
    ordinal: number;
    token: string;
    ticket: number;
    content: string;
    paged: Draft["paged"];
    version?: number;
    format: Draft["content_format"];
    flush: Promise<boolean>;
    x: number;
    y: number;
    inside: boolean;
  }>();
  const blockDragTicket = useRef(0),
    blockDragFrame = useRef<number>(),
    blockDropPending = useRef(false);
  const releaseDragElement = useRef<() => void>();
  const receiveBlockDrop = useRef<(event: DragEvent) => void>();
  const total = useRef(0);
  const heights = useRef(new BlockHeights());
  const [, refreshHeights] = useReducer(increment, 0);
  const [jump, setJump] = useState("1");
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const layoutScroll = useRef<number | null>(null);
  // Explicit navigation pins the first measured model to the viewport. Browser
  // focus/layout can clamp the estimated scroll offset before this measurement.
  const alignAfterMeasure = useRef<WindowState | null>(null);
  useLayoutEffect(() => {
    if (layoutScroll.current !== null && scroll.current) {
      scroll.current.scrollTop = layoutScroll.current;
      layoutScroll.current = null;
    }
  });
  const active = useRef<WindowState | null>(null);
  const geometry = () => {
    const offset = active.current?.offset ?? 0;
    const internal = active.current?.segment;
    if (internal) {
      const length = active.current!.segmentTotal ?? 1;
      const blockHeight = heights.current.top(offset + 1) - heights.current.top(offset);
      const span = active.current!.segmentSpan ?? {
        start: internal.ordinal / length,
        end: (internal.ordinal + 1) / length,
      };
      const start = heights.current.top(offset) + blockHeight * span.start;
      return scrollSpace(
        heights.current.top(total.current),
        start,
        heights.current.top(offset) + blockHeight * span.end,
      );
    }
    return scrollSpace(
      heights.current.top(total.current),
      heights.current.top(offset),
      heights.current.top(offset + edited.current.count),
    );
  };
  const sequence = useRef(0);
  const locked = useRef(false);
  const composing = useRef(false);
  const navigating = useRef(false);
  const pending = useRef<{
    offset: number;
    position: boolean;
    revision?: number;
    edge?: Edge;
    size?: number;
    join?: Join;
    target?: WindowTarget;
  } | null>(null);
  const attempted = useRef(0);
  const attemptedTarget = useRef<WindowTarget>();
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);
  const navigateRef = useRef<
    (
      offset: number,
      position?: boolean,
      revision?: number,
      edge?: Edge,
      size?: number,
      join?: Join,
      target?: WindowTarget,
    ) => Promise<boolean | undefined>
  >(() => Promise.resolve(undefined));
  const callbacks = useRef({ readDraft, flush, change, changeRange, readOnly });
  callbacks.current = { readDraft, flush, change, changeRange, readOnly };
  const isReadOnly = () => callbacks.current.readOnly || Boolean(callbacks.current.readDraft()?.readonly);
  const editorRef = useRef<Editor | null>(null);
  const editorSession = useRef<number>();
  const verticalColumn = useRef<number>();
  const verticalOrigin = useRef<DocumentPoint>();
  const verticalSequence = useRef(0);
  const wrapCache = useRef<{ revision: number; layout: string; windows: Map<string, DocumentSegment> }>();
  const verticalQueue = useRef<{ key: string; shift: boolean }[]>([]);
  const verticalMoving = useRef(false);
  const verticalFrame = useRef<number>();
  const scheduleVertical = () => {
    if (verticalFrame.current !== undefined || !verticalQueue.current.length || !mounted.current) return;
    verticalFrame.current = requestAnimationFrame(() => {
      verticalFrame.current = undefined;
      const editor = editorRef.current;
      if (!mounted.current) return;
      if (
        verticalMoving.current ||
        navigating.current ||
        locked.current ||
        selectionRunning.current ||
        !editor?.isInitialized ||
        editor.isDestroyed ||
        editorSession.current !== active.current?.session
      ) {
        scheduleVertical();
        return;
      }
      const next = verticalQueue.current.shift()!;
      editor.view.focus();
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: next.key, shiftKey: next.shift, bubbles: true, cancelable: true }),
      );
      scheduleVertical();
    });
  };
  const resetVertical = () => {
    verticalColumn.current = undefined;
    verticalOrigin.current = undefined;
    verticalQueue.current = [];
    verticalSequence.current++;
  };
  const boundaryQueue = useRef<BoundaryDirection[]>([]);
  const boundaryRunning = useRef(false);
  const failedBoundary = useRef<BoundaryDirection>();
  const boundaryGuard = useRef<() => void>();
  const pointMapping = useRef<{ state: WindowState; raw: string; map: ReturnType<typeof segmentPositionMap> }>();
  const windowSource = (state: WindowState): DocumentSegment =>
    state.segment
      ? { ...state.segment, source: edited.current.raw }
      : { ordinal: 0, byte_offset: state.byteStart!, source: edited.current.raw, start_context: [], end_context: [] };
  const mountedPoint = (state: WindowState, position: number) => {
    const editor = editorRef.current!;
    const point = documentPoint(editor.state.doc, state.offset, position);
    if (state.byteStart === undefined) return point;
    let saved = pointMapping.current;
    if (saved?.state !== state || saved.raw !== edited.current.raw) {
      saved = { state, raw: edited.current.raw, map: segmentPositionMap(windowSource(state)) };
      pointMapping.current = saved;
    }
    const source = saved.map.point(position);
    return { ...point, byte: source.byte, within: source.within };
  };
  const documentSelected = useRef<DocumentSelection | null>(null);
  const [documentSelectedState, setDocumentSelectedState] = useState<DocumentSelection | null>(null);
  const selectionRunning = useRef(false);
  const blockSelectionRunning = useRef(false);
  const selectionPromise = useRef<Promise<boolean> | null>(null);
  const selectionSequence = useRef(0);
  const composition = useRef<{
    editor: Editor;
    originalState: EditorState;
    startState: EditorState;
    from: number;
    to: number;
    startFrom: number;
    startTo: number;
    edited: boolean;
    ticket: number;
    window: WindowState;
    content: string;
    bodyVersion?: number;
    pending?: PendingSelection;
    pendingStart?: ReturnType<PendingSelection["checkpoint"]>;
    failed?: boolean;
  } | null>(null);
  const compositionTimer = useRef<ReturnType<typeof setTimeout>>();
  const compositionEpoch = useRef(0);
  const locationSnapshot = useRef<{ state: EditorState; raw: string; selection: Record<string, unknown> }>();
  const projectionError = useRef<string | null>(null);
  const locationTimer = useRef<ReturnType<typeof setTimeout>>();
  const rememberInternalLocation = () => {
    const state = active.current,
      editor = editorRef.current,
      draft = callbacks.current.readDraft();
    if (!state?.segment || !editor || editor.isDestroyed || draft?.id !== id || composition.current) return;
    const raw = edited.current.raw,
      old = locationSnapshot.current;
    const selection =
      old?.state === editor.state && old.raw === raw
        ? old.selection
        : saveSegmentSelection({ ...state.segment, source: raw }, editor.state.selection.toJSON());
    locationSnapshot.current = { state: editor.state, raw, selection };
    rememberLocation(id, {
      revision: draft.revision,
      kind: "windowed",
      offset: state.offset,
      selection,
      documentSelection: documentSelected.current ?? undefined,
    });
  };
  const compositionWaiters = useRef<(() => void)[]>([]);
  const discardPrompt = useRef(false);
  const mouseSelection = useRef<{
    pointer: number;
    x: number;
    y: number;
    anchor: DocumentPoint;
    window: WindowState;
    crossed: boolean;
    released: boolean;
  }>();
  const mouseFrame = useRef<number>();
  const selectionNoticePending = useRef(false);
  const finishSelectionNotice = () => {
    if (selectionNoticePending.current) {
      selectionNoticePending.current = false;
      setDocumentSelectedState(documentSelected.current);
    }
  };
  const selectDocument = (
    selection: DocumentSelection | null,
    options: { deferNotice?: boolean; keepSelection?: boolean } = {},
  ) => {
    if (composition.current) return;
    selectionSequence.current++;
    documentSelected.current = selection;
    selectionNoticePending.current = !!options.deferNotice;
    if (!options.deferNotice) setDocumentSelectedState(selection);
    if (!selection && !options.keepSelection && editorRef.current && !editorRef.current.isDestroyed) {
      const editor = editorRef.current;
      if (!editor.state.selection.empty) editor.commands.setTextSelection(editor.state.selection.head);
    }
  };
  const updateMouseSelection = () => {
    const drag = mouseSelection.current,
      state = active.current,
      editor = editorRef.current;
    if (
      !drag?.crossed ||
      navigating.current ||
      !state ||
      !editor ||
      editor.isDestroyed ||
      editorSession.current !== state.session
    )
      return;
    const first = Selection.atStart(editor.state.doc),
      last = Selection.atEnd(editor.state.doc);
    const top = editor.view.coordsAtPos(first.head),
      bottom = editor.view.coordsAtPos(last.head);
    const bounds = editor.view.dom.getBoundingClientRect();
    const hit = editor.view.posAtCoords({
      left: Math.max(bounds.left + 1, Math.min(bounds.right - 1, drag.x)),
      top: Math.max(top.top + 1, Math.min(bottom.bottom - 1, drag.y)),
    });
    if (hit) {
      const head = mountedPoint(state, Selection.near(editor.state.doc.resolve(hit.pos)).head),
        selected = documentSelected.current;
      if (
        selected?.kind !== "range" ||
        comparePoints(selected.anchor, drag.anchor) ||
        comparePoints(selected.head, head)
      )
        selectDocument({ kind: "range", anchor: drag.anchor, head });
    }
    if (drag.released) mouseSelection.current = undefined;
  };
  const animateMouseSelection = () => {
    if (mouseFrame.current !== undefined) return;
    mouseFrame.current = requestAnimationFrame(() => {
      mouseFrame.current = undefined;
      const drag = mouseSelection.current,
        host = scroll.current;
      if (!mounted.current || !drag?.crossed || drag.released || !host) return;
      const bounds = host.getBoundingClientRect(),
        margin = 24;
      const speed = edgeScrollSpeed(drag.y, bounds.top, bounds.bottom, margin);
      if (speed) {
        host.scrollTop += speed;
        updateMouseSelection();
      }
      animateMouseSelection();
    });
  };
  /** First edit of an internal window that gave its enclosing block(s) an
   * identity: splice each outside opening tag (bounded: the tag alone), then the
   * window, as one undo step. The mounted window stays; its source position and
   * contexts move to the rewritten tags so later edits project as usual. */
  const commitWindowIdentity = (
    state: WindowState,
    identity: ReturnType<typeof contextIdentity>,
    before: string,
    raw: string,
    html: string,
    change: RichChange,
  ) => {
    const draft = callbacks.current.readDraft();
    if (!draft || !state.segment) throw new Error(t("편집 구간이 닫혔습니다."));
    const paged = Boolean(draft.paged),
      bytes = (text: string) => new TextEncoder().encode(text).length;
    let source = state.source;
    const tags: BodySplice[] = [];
    for (const tag of identity.tags) {
      const at = paged ? tag.start : utf8PrefixLength(source, tag.start);
      if (!paged && source.slice(at, at + tag.expected.length) !== tag.expected)
        throw new Error(t("블록 식별자를 붙일 위치를 찾지 못했습니다. 원문을 유지했습니다."));
      tags.push({ ...tag, start: at });
      if (!paged) source = source.slice(0, at) + tag.replacement + source.slice(at + tag.expected.length);
    }
    const growth = identity.tags.reduce((n, tag) => n + bytes(tag.replacement) - bytes(tag.expected), 0),
      shift = source.length - state.source.length;
    const byteStart = state.byteStart! + growth,
      from = state.from + shift;
    const edits = [...tags, { start: paged ? byteStart : from, expected: before, replacement: raw }];
    if (paged) for (const edit of edits) callbacks.current.changeRange(edit);
    const preview = (segment: DocumentSegment, value: string, text: string, count: number, at: number) => {
      const { source: _, ...context } = { ...segment, byte_count: bytes(text), total: state.segmentTotal! };
      // Multi-splice history has no single before/after string: keep the raw window.
      return { html: value, count, raw: text, internal: context, ...(paged ? {} : { relativeFrom: at - edits[0].start }) };
    };
    history.current.recordSpliced(
      {
        from: edits[0].start,
        offset: state.offset,
        before: "",
        after: "",
        edits,
        beforeCount: edited.current.count,
        afterCount: change.count,
        beforeSelection: change.beforeSelection,
        beforePreview: preview(state.segment, edited.current.html, before, edited.current.count, state.from),
        afterPreview: preview(identity.segment, html, raw, change.count, from),
        afterSelection: change.afterSelection,
        session: state.session,
        group: change.group,
        time: Date.now(),
      },
      paged ? state.byteStart! : state.from,
    );
    // The active window record moves with its source (same mounted editor).
    state.segment = { ...identity.segment, source: state.segment.source };
    state.byteStart = byteStart;
    state.source = source;
    state.from = from;
    state.to += shift;
    total.current += change.count - edited.current.count;
    heights.current.resize(total.current, state.offset);
    edited.current = { html, raw, count: change.count };
    projectionError.current = null;
    setError(null);
    retainHistory();
    refreshHistory();
    if (!paged)
      callbacks.current.change(source.slice(0, state.from) + raw + source.slice(state.to), {
        source,
        from: state.from,
        to: state.to,
        byteStart,
        html: raw,
      });
  };
  /** Exact splices of outside opening tags (UTF-8 for paged drafts, located
   * UTF-16 ranges otherwise), the body after them and their UTF-16 growth. */
  const boundaryTagEdits = async (draft: Draft, tags: BodySplice[], check: () => void) => {
    if (draft.paged || !tags.length) return { edits: tags, source: draft.content, shift: 0 };
    const edits: BodySplice[] = [];
    let source = draft.content;
    for (const tag of tags) {
      const located = await locateBlockRange(source, tag.start, tag.expected);
      check();
      edits.push({ ...tag, start: located.from });
      source = source.slice(0, located.from) + tag.replacement + source.slice(located.to);
    }
    return { edits, source, shift: source.length - draft.content.length };
  };
  /** Paged drafts replay every splice; others replace the body once. */
  const applyRegionSplice = (
    draft: Draft,
    edits: BodySplice[] | undefined,
    edit: { start: number; expected: string; replacement: string },
    source: string,
  ) => {
    if (draft.paged && edits) for (const splice of edits) callbacks.current.changeRange(splice);
    else applySourceChange(draft, edit, source);
  };
  const applySourceChange = (
    draft: Draft,
    edit: { start: number; expected: string; replacement: string },
    source: string,
  ) => {
    if (draft.paged)
      callbacks.current.changeRange({
        start: edit.start,
        expected: edit.expected,
        replacement: edit.replacement,
      });
    else callbacks.current.change(source);
  };
  const writeSelectionClipboard = (preparedPromise: Promise<PreparedSelection>) => {
    const clipboard = preparedPromise.then(selectionClipboard);
    const html = clipboard.then((value) => new Blob([value.html], { type: "text/html" }));
    const text = clipboard.then((value) => new Blob([value.text], { type: "text/plain" }));
    void html.catch(() => {});
    void text.catch(() => {});
    return navigator.clipboard.write([
      new ClipboardItem({
        "text/html": html,
        "text/plain": text,
      }),
    ]);
  };
  const changeProvisionalSelection = async (
    prepared: PreparedSelection,
    operation: () => Promise<SelectionOperation>,
  ) => {
    // Yielding validation allows new provisional keys/composition to arrive.
    // Rebuild from the latest captured state before any source/history write.
    const deadline = Date.now() + 60000,
      retry = {};
    for (;;) {
      const resolved = await operation(),
        capture = composition.current;
      if (!capture) throw new Error(t("입력 작업이 취소되었습니다. 원문을 유지합니다."));
      const snapshot = capture.editor.state;
      try {
        return await changeSelectionAsync(prepared, resolved, () => {
          if (Date.now() > deadline)
            throw new Error(
              t("계속 입력 중이어서 반영을 중단했습니다. 입력과 원문을 유지합니다. 잠시 후 다시 시도해 주세요."),
            );
          if (composition.current !== capture || capture.editor.isDestroyed)
            throw new Error(t("입력 작업이 취소되었습니다. 원문을 유지합니다."));
          if (composing.current || capture.editor.state !== snapshot) throw retry;
        });
      } catch (e) {
        if (e !== retry) throw e;
      }
    }
  };
  const followingBlockInput = async (
    check: () => void,
  ): Promise<{ operation?: SelectionOperation; current: () => boolean }> => {
    while (composing.current) await new Promise<void>((resolve) => compositionWaiters.current.push(resolve));
    check();
    const capture = composition.current;
    if (!capture) return { current: () => !composition.current && !composing.current };
    if (
      capture.editor.isDestroyed ||
      active.current !== capture.window ||
      capture.ticket !== selectionSequence.current ||
      callbacks.current.readDraft()?.content !== capture.content ||
      callbacks.current.readDraft()?.paged?.version !== capture.bodyVersion
    )
      throw new Error(t("문서가 변경되어 후속 입력을 반영하지 못했습니다. 입력과 원문을 유지합니다."));
    const snapshot = capture.editor.state;
    if (capture.pending) capture.pending.select(snapshot);
    return {
      operation: capture.pending
        ? capture.pending.operation()
        : capturedSelectionSlice(capture.originalState, snapshot, capture.from, capture.to),
      current: () =>
        composition.current === capture &&
        !composing.current &&
        !capture.editor.isDestroyed &&
        capture.editor.state === snapshot,
    };
  };
  const commitSelection = async (
    draft: Draft,
    range: { from: number; to: number },
    prepared: PreparedSelection,
    result: ReturnType<typeof changeSelection>,
    selection: DocumentSelection,
    inputCurrent: () => boolean,
  ) => {
    const tags = await boundaryTagEdits(draft, result.tags, prepared.check);
    prepared.check();
    // The tag lookup also yields: input accepted while it waits must be replayed.
    if (!inputCurrent()) return false;
    const { regionFrom, source, edits, historyFrom, relative } = regionSplice(draft, tags, result, range);
    applyRegionSplice(draft, edits, result, source);
    history.current.record({
      from: historyFrom,
      offset: prepared.blockOffset,
      before: edits ? "" : result.expected,
      after: edits ? "" : result.replacement,
      edits,
      beforeCount: prepared.blockCount,
      afterCount: result.count,
      beforePreview: relative(prepared.previewWindow, range.from, result.expected, prepared.byteStart),
      afterPreview: relative(result.previewWindow, regionFrom, result.replacement, result.start),
      beforeDocumentSelection: selection,
      afterDocumentSelection: result.documentSelection ?? undefined,
      beforeSelection: result.beforeSelection,
      afterSelection: result.selection,
      session: nextHistorySession(),
      group: 0,
      time: Date.now(),
    });
    total.current += result.count - prepared.blockCount;
    heights.current.resize(total.current, prepared.blockOffset);
    const committed = composition.current;
    const previewByte = result.previewWindow.byteStart ?? result.start;
    const previewFrom = draft.paged ? 0 : regionFrom + utf8PrefixLength(result.replacement, previewByte - result.start);
    const next: WindowState = {
      offset: result.previewWindow.offset ?? prepared.blockOffset,
      count: result.previewCount,
      total: total.current,
      source,
      from: previewFrom,
      to: previewFrom + (result.previewWindow.raw ?? result.preview).length,
      byteStart: previewByte,
      html: result.preview,
      segment: result.previewWindow.internal
        ? { ...result.previewWindow.internal, source: result.previewWindow.raw! }
        : undefined,
      segmentTotal: result.previewWindow.internal?.total,
      selection: result.selection,
      session: committed?.window.session ?? nextHistorySession(),
    };
    composition.current = null;
    selectDocument(result.documentSelection);
    edited.current = { html: next.html, raw: result.previewWindow.raw ?? next.html, count: next.count };
    active.current = next;
    // Keep the composing editor mounted across commit. Otherwise the next
    // native composition can target the old view before React replaces it.
    if (committed && !committed.editor.isDestroyed) {
      // A projection of the committed source, not a user edit: it must not
      // enter native history or give the mounted blocks new identities.
      committed.editor.chain().setContent(next.html, { emitUpdate: false }).setMeta("addToHistory", false).run();
      const selected = Selection.fromJSON(committed.editor.state.doc, result.selection);
      committed.editor.view.dispatch(committed.editor.state.tr.setSelection(selected).setMeta("addToHistory", false));
    }
    rememberLocation(id, {
      revision: callbacks.current.readDraft()?.revision ?? draft.revision,
      kind: "windowed",
      offset: next.offset,
      selection: next.segment ? saveSegmentSelection(next.segment, result.selection) : result.selection,
      documentSelection: result.documentSelection ?? undefined,
    });
    setWindowState(next);
    setJump(String(next.offset + 1));
    retainHistory();
    refreshHistory();
    if (scroll.current) layoutScroll.current = geometry().before;
    return true;
  };
  const failSelectionRun = (e: unknown) => {
    if (composition.current?.pending) composition.current.failed = true;
    if (mounted.current) setError(messageOf(e));
  };
  const finishSelectionRun = () => {
    selectionRunning.current = false;
    blockSelectionRunning.current = false;
    if (mounted.current) setBusy(false);
  };
  const selectionRunGuard = (editing: boolean, ticket: number) => () => {
    if (editing && isReadOnly()) throw new Error(t("읽기 전용 노트는 편집할 수 없습니다."));
    if (!mounted.current || ticket !== selectionSequence.current || callbacks.current.readDraft()?.id !== id)
      throw new Error(t("선택 작업이 취소되었습니다. 원문을 유지합니다."));
  };
  const prepareSelectionRun = async (
    selection: DocumentSelection,
    check: () => void,
    completeBlocks: boolean,
    onDraft: (draft: Draft | null) => void,
  ) => {
    if (!(await callbacks.current.flush({ editorOperation: true })))
      throw new Error(t("저장하지 못해 선택 작업을 중단했습니다. 원문을 유지합니다."));
    if (composition.current)
      window.dispatchEvent(new CustomEvent("inkism-editor-pending", { detail: { autosave: false } }));
    check();
    const snapshot = callbacks.current.readDraft();
    onDraft(snapshot);
    const version = snapshot?.paged?.version;
    if (!snapshot) throw new Error(t("노트가 닫혔습니다."));
    const revision = snapshot.revision;
    return prepareSelection(
      selection,
      {
        check: () => {
          check();
          if (
            callbacks.current.readDraft() !== snapshot ||
            snapshot.revision !== revision ||
            snapshot.paged?.version !== version
          )
            throw new Error(t("문서가 변경되어 선택 작업을 중단했습니다."));
        },
        read: (offset, limit) => api.documentBlocks(id, { revision, offset, limit, max_block_bytes: INTERNAL_BYTES }),
        segments: (ordinal, offset, limit) => api.documentSegments(id, revision, ordinal, { offset, limit }),
        locate: (byte, bias) => api.documentLocate(id, revision, byte, bias),
      },
      { completeBlocks },
    );
  };
  const commitLatestSelection = async (
    operation: SelectionOperation | "cut" | (() => Promise<SelectionOperation>),
    prepared: PreparedSelection, draft: Draft, range: { from: number; to: number },
    selection: DocumentSelection, check: () => void,
  ) => {
      const deadline = Date.now() + 30000;
      for (;;) {
        const capture = composition.current, inputState = capture?.editor.state;
        const inputCurrent = () => composition.current === capture && !composing.current &&
          (!capture || (!capture.editor.isDestroyed && capture.editor.state === inputState));
        let result: ReturnType<typeof changeSelection>;
        if (typeof operation === "function") {
          result = await changeProvisionalSelection(prepared, operation);
        } else {
          const resolved = resolvedSelectionOperation(operation as SelectionOperation | "cut");
          result = resolved.kind === "block"
            ? await changeBlockSelectionAsync(prepared, resolved, () => followingBlockInput(check))
            : changeSelection(prepared, resolved);
        }
        prepared.check();
        if (await commitSelection(draft, range, prepared, result, selection, inputCurrent)) break;
        if (Date.now() > deadline)
          throw new Error(t("계속 입력 중이어서 반영을 중단했습니다. 입력과 원문을 유지합니다. 잠시 후 다시 시도해 주세요."));
      }
  };
  const runSelection = async (operation: SelectionOperation | "copy" | "cut" | (() => Promise<SelectionOperation>)) => {
    if (operation !== "copy" && isReadOnly()) return false;
    const selection = documentSelected.current;
    if (!selection || selectionRunning.current || composing.current) return false;
    selectionRunning.current = true;
    setBusy(true);
    setError(null);
    const completeBlocks = typeof operation === "object" && operation.kind === "block";
    blockSelectionRunning.current = completeBlocks;
    const check = selectionRunGuard(operation !== "copy", selectionSequence.current);
    let expected: Draft | null = null;
    const clipboardOperation = operation === "copy" || operation === "cut";
    try {
      if (clipboardOperation && !clipboardWritable())
        throw new Error(t("클립보드를 사용할 수 없습니다. 원문을 유지합니다."));
      const preparedPromise = prepareSelectionRun(selection, check, completeBlocks, (draft) => {
        expected = draft;
      });
      // Clipboard permission may fail before the asynchronous range read finishes.
      // Observe that read's rejection even when no ClipboardItem consumer awaits it.
      void preparedPromise.catch(() => {});
      // Start clipboard permission acquisition in the keyboard event activation.
      if (clipboardOperation) {
        await writeSelectionClipboard(preparedPromise);
        if (operation === "copy") return true;
      }
      const prepared = await preparedPromise;
      const draft = expected!;
      // Resolve the asynchronous byte -> UTF-16 range before taking the final
      // composition slice. New input can arrive during this worker read.
      const range = draft.paged
        ? { from: 0, to: 0 }
        : await locateBlockRange(draft.content, prepared.byteStart, prepared.before);
      prepared.check();
      await commitLatestSelection(operation, prepared, draft, range, selection, check);
      return true;
    } catch (e) {
      failSelectionRun(e);
      return false;
    } finally {
      finishSelectionRun();
    }
  };
  const operateSelection = (operation: Parameters<typeof runSelection>[0]) => {
    if (selectionRunning.current) return Promise.resolve(false);
    const promise = runSelection(operation).finally(() => {
      if (selectionPromise.current === promise) selectionPromise.current = null;
    });
    selectionPromise.current = promise;
    return promise;
  };
  const blockActionGuard = (state: WindowState, editor: Editor, draft: Draft) => {
    const original = editor.state,
      revision = draft.revision,
      version = draft.paged?.version,
      ticket = selectionSequence.current;
    return () => {
      if (
        !mounted.current ||
        active.current !== state ||
        editor.isDestroyed ||
        editor.state.doc !== original.doc ||
        !editor.state.selection.eq(original.selection) ||
        ticket !== selectionSequence.current ||
        callbacks.current.readDraft() !== draft ||
        draft.revision !== revision ||
        draft.paged?.version !== version
      )
        throw new Error(t("입력이나 선택이 변경되어 블록 동작을 중단했습니다. 현재 입력과 원문을 유지합니다."));
    };
  };
  const capturedBlockWindow = (state: WindowState, ordinal: number) => {
    const context = state.segment ? (({ source: _, ...value }) => value)(state.segment) : undefined;
    return context && edited.current.count === 1 && ordinal === state.offset
      ? {
          html: edited.current.html,
          count: 1,
          raw: edited.current.raw,
          offset: state.offset,
          byteStart: state.byteStart,
          internal: { ...context, total: state.segmentTotal! },
        }
      : undefined;
  };
  const blockActionSource = async (
    draft: Draft,
    result: BlockActionResult,
    range: { from: number; to: number },
    check: () => void,
  ) => {
    let source = draft.paged ? "" : draft.content;
    let historyEdits = result.edits;
    if (!draft.paged) {
      if (result.edits) {
        historyEdits = [];
        for (const edit of result.edits) {
          const located = await locateBlockRange(source, edit.start, edit.expected);
          check();
          historyEdits.push({ ...edit, start: located.from });
          source = source.slice(0, located.from) + edit.replacement + source.slice(located.to);
        }
      } else source = draft.content.slice(0, range.from) + result.replacement + draft.content.slice(range.to);
    }
    return { source, historyEdits };
  };
  const locateBlockPreviews = async (
    draft: Draft,
    result: BlockActionResult,
    range: { from: number; to: number },
    source: string,
  ) => {
    const before = result.beforePreview,
      after = result.afterPreview;
    const beforeRange = draft.paged
      ? { from: 0, to: 0 }
      : await locateBlockRange(draft.content, before.byteStart!, before.raw!);
    const afterRange = draft.paged ? { from: 0, to: 0 } : await locateBlockRange(source, after.byteStart!, after.raw!);
    if (!draft.paged) {
      before.relativeFrom = beforeRange.from - range.from;
      after.relativeFrom = afterRange.from - range.from;
    }
    return afterRange;
  };
  const applyBlockEdits = (draft: Draft, result: BlockActionResult, source: string) => {
    if (draft.paged)
      for (const edit of result.edits ?? [
        { start: result.start, expected: result.expected, replacement: result.replacement },
      ])
        callbacks.current.changeRange(edit);
    else callbacks.current.change(source);
  };
  const showBlockAction = (
    action: BlockCommand,
    result: BlockActionResult,
    source: string,
    afterRange: { from: number; to: number },
    revision: number,
    afterDocumentSelection: DocumentSelection | undefined,
  ) => {
    const after = result.afterPreview;
    total.current += result.afterCount - result.beforeCount;
    if (typeof action !== "string" || action === "up" || action === "down") heights.current.clear();
    heights.current.resize(total.current, result.offset);
    const segment = after.internal ? { ...after.internal, source: after.raw! } : undefined;
    const next: WindowState = {
      offset: after.offset!,
      count: after.count,
      total: total.current,
      source,
      from: afterRange.from,
      to: afterRange.to,
      byteStart: after.byteStart,
      html: after.html,
      segment,
      segmentTotal: after.internal?.total,
      selection: result.selection,
      projectedSelection: true,
      session: nextHistorySession(),
    };
    wrapCache.current = undefined;
    resetVertical();
    projectionError.current = null;
    locationSnapshot.current = undefined;
    edited.current = { html: after.html, raw: after.raw!, count: after.count };
    active.current = next;
    selectDocument(afterDocumentSelection ?? null);
    setWindowState(next);
    setJump(String(next.offset + 1));
    rememberLocation(id, {
      revision: callbacks.current.readDraft()?.revision ?? revision,
      kind: "windowed",
      offset: next.offset,
      selection: segment ? saveSegmentSelection(segment, result.selection) : result.selection,
      documentSelection: afterDocumentSelection,
    });
    retainHistory();
    refreshHistory();
    if (scroll.current) layoutScroll.current = geometry().before;
  };
  const runBlockAction = async (action: BlockCommand, index: number, dragOrdinal?: number) => {
    if (isReadOnly()) return false;
    try {
      if (!(await callbacks.current.flush({ editorOperation: true })))
        throw new Error(t("저장하지 못해 블록 동작을 중단했습니다."));
      const state = active.current,
        editor = editorRef.current,
        draft = callbacks.current.readDraft();
      if (!state || !editor || draft?.id !== id || editor.isDestroyed) throw new Error(t("편집 구간이 닫혔습니다."));
      const original = editor.state,
        revision = draft.revision;
      const check = blockActionGuard(state, editor, draft);
      const ordinal = dragOrdinal ?? state.offset + index;
      const captured = capturedBlockWindow(state, ordinal);
      const result = await prepareBlockAction(
        {
          check,
          read: (ordinal) =>
            api.documentBlocks(id, { revision, offset: ordinal, limit: 1, max_block_bytes: INTERNAL_BYTES }),
          chunk: (ordinal, offset) => api.documentBlockWindow(id, revision, ordinal, offset),
          segments: (ordinal) => api.documentSegments(id, revision, ordinal, { offset: 0, limit: 1 }),
        },
        ordinal,
        total.current,
        action,
        captured,
      );
      const range = draft.paged
        ? { from: 0, to: 0 }
        : await locateBlockRange(draft.content, result.start, result.expected);
      const { source, historyEdits } = await blockActionSource(draft, result, range, check);
      const afterRange = await locateBlockPreviews(draft, result, range, source);
      const beforeSelection = blockSelectionBefore(original, index, dragOrdinal, Boolean(state.segment));
      const afterDocumentSelection: DocumentSelection | undefined = result.selectsBlock
        ? blockRangeSelection(result.selectedBlock)
        : undefined;
      check();
      applyBlockEdits(draft, result, source);
      const beforeDocumentSelection =
        dragOrdinal === undefined ? (documentSelected.current ?? undefined) : blockRangeSelection(result.originalBlock);
      history.current.record({
        from: draft.paged ? result.start : range.from,
        offset: result.offset,
        before: result.edits ? "" : result.expected,
        after: result.edits ? "" : result.replacement,
        edits: historyEdits,
        beforeCount: result.beforeCount,
        afterCount: result.afterCount,
        beforePreview: result.beforePreview,
        afterPreview: result.afterPreview,
        beforeSelection,
        afterSelection: result.selection,
        beforeDocumentSelection,
        afterDocumentSelection,
        session: nextHistorySession(),
        group: 0,
        time: Date.now(),
      });
      showBlockAction(action, result, source, afterRange, revision, afterDocumentSelection);
      return true;
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
      return false;
    } finally {
      selectionRunning.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const documentBlockAction: DocumentBlockAction = (action, index, execute, anchored = false) => {
    if (isReadOnly()) return false;
    const state = active.current,
      selected = documentSelected.current;
    if (
      !state ||
      busy ||
      selectionRunning.current ||
      navigating.current ||
      composing.current ||
      composition.current ||
      (!anchored && selected?.kind === "all") ||
      (!anchored && selected?.kind === "range" && selected.anchor.block !== selected.head.block)
    )
      return false;
    const ordinal = state.offset + index;
    if (
      ordinal < 0 ||
      ordinal >= total.current ||
      (action === "up" && ordinal === 0) ||
      (action === "down" && ordinal + 1 === total.current)
    )
      return false;
    if (!execute) return true;
    selectionRunning.current = true;
    setBusy(true);
    setError(null);
    const promise = runBlockAction(action, index).finally(() => {
      if (selectionPromise.current === promise) selectionPromise.current = null;
    });
    selectionPromise.current = promise;
    return true;
  };
  const documentBlockDrag: DocumentBlockDrag = (index, event) => {
    if (isReadOnly()) {
      event.preventDefault();
      return;
    }
    const state = active.current,
      draft = callbacks.current.readDraft();
    if (
      !state ||
      draft?.id !== id ||
      !event.dataTransfer ||
      navigating.current ||
      selectionRunning.current ||
      blockDropPending.current ||
      composing.current ||
      composition.current
    ) {
      event.preventDefault();
      return;
    }
    const ordinal = state.offset + index;
    if (index < 0 || index >= edited.current.count || ordinal >= total.current) {
      event.preventDefault();
      return;
    }
    const ticket = ++blockDragTicket.current,
      token = id + ":" + ticket + ":" + Date.now();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-inkism-block", token);
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>(".inkism-drag-handle") : null,
      parent = element?.parentElement;
    if (element && parent && scroll.current) {
      // Keep the native drag source connected when its editor window is
      // replaced. The plugin removes its old wrapper during unmount.
      releaseDragElement.current?.();
      const rect = element.getBoundingClientRect();
      event.dataTransfer.setDragImage(element, 0, 0);
      const host = scroll.current;
      const opacity = element.style.opacity,
        pointer = element.style.pointerEvents,
        width = element.style.width,
        height = element.style.height;
      element.style.width = rect.width + "px";
      element.style.height = rect.height + "px";
      // Chromium aborts a native drag whose source moves during dragstart.
      const frame = requestAnimationFrame(() => {
        host.appendChild(element);
        element.style.opacity = "0";
        element.style.pointerEvents = "none";
      });
      releaseDragElement.current = () => {
        cancelAnimationFrame(frame);
        element.style.opacity = opacity;
        element.style.pointerEvents = pointer;
        element.style.width = width;
        element.style.height = height;
        if (parent.isConnected) parent.appendChild(element);
        else element.remove();
        releaseDragElement.current = undefined;
      };
    }
    blockDrag.current = {
      ordinal,
      token,
      ticket,
      content: draft.content,
      paged: draft.paged,
      version: draft.paged?.version,
      format: draft.content_format,
      flush: callbacks.current.flush({ editorOperation: true }).catch(() => false),
      x: event.clientX,
      y: event.clientY,
      inside: false,
    };
  };
  receiveBlockDrop.current = (event) => {
    const drag = blockDrag.current,
      host = scroll.current,
      state = active.current,
      editor = editorRef.current;
    if (!drag || !host || !state || !editor || !(event.target instanceof Node) || !host.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    blockDrag.current = undefined;
    if (event.dataTransfer?.getData("application/x-inkism-block") !== drag.token) return;
    const children = Array.from(editor.view.dom.children);
    let destination: number;
    const bounds = editor.view.dom.getBoundingClientRect();
    if (event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
      const local = children.findIndex((child) => event.clientY < child.getBoundingClientRect().bottom);
      const index = local < 0 ? children.length - 1 : local,
        rect = children[index].getBoundingClientRect();
      destination = state.offset + index + (event.clientY >= (rect.top + rect.bottom) / 2 ? 1 : 0);
    } else {
      const rect = host.getBoundingClientRect(),
        pixel = host.scrollTop + event.clientY - rect.top;
      const logical = geometry().logicalAt(pixel, content.current?.offsetHeight ?? 0),
        ordinal = heights.current.at(logical);
      destination =
        ordinal + (logical >= (heights.current.top(ordinal) + heights.current.top(ordinal + 1)) / 2 ? 1 : 0);
    }
    destination = Math.max(0, Math.min(total.current, destination));
    if (destination === drag.ordinal || destination === drag.ordinal + 1) return;
    blockDropPending.current = true;
    void (async () => {
      try {
        if (!(await drag.flush)) throw new Error(t("저장하지 못해 블록 이동을 중단했습니다."));
        const deadline = Date.now() + 15000;
        while (navigating.current && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
        const draft = callbacks.current.readDraft();
        if (!mounted.current || drag.ticket !== blockDragTicket.current) return;
        if (
          navigating.current ||
          selectionRunning.current ||
          composing.current ||
          composition.current ||
          draft?.id !== id ||
          draft.content !== drag.content ||
          draft.paged !== drag.paged ||
          draft.paged?.version !== drag.version ||
          draft.content_format !== drag.format
        )
          throw new Error(t("문서나 입력이 변경되어 블록 이동을 중단했습니다. 원문을 유지합니다."));
        selectionRunning.current = true;
        setBusy(true);
        setError(null);
        const promise = runBlockAction({ kind: "move", destination }, 0, drag.ordinal).finally(() => {
          if (selectionPromise.current === promise) selectionPromise.current = null;
        });
        selectionPromise.current = promise;
        await promise;
      } catch (error) {
        if (mounted.current) setError(messageOf(error));
      } finally {
        blockDropPending.current = false;
      }
    })();
  };
  useEffect(() => {
    const clear = () => {
      blockDrag.current = undefined;
      releaseDragElement.current?.();
      if (blockDragFrame.current !== undefined) cancelAnimationFrame(blockDragFrame.current);
      blockDragFrame.current = undefined;
    };
    const animate = () => {
      blockDragFrame.current = undefined;
      const drag = blockDrag.current,
        host = scroll.current;
      if (!drag?.inside || !host) return;
      const rect = host.getBoundingClientRect(),
        margin = 40;
      const speed = edgeScrollSpeed(drag.y, rect.top, rect.bottom, margin);
      if (speed) {
        const before = host.scrollTop;
        host.scrollTop += speed;
        if (host.scrollTop !== before) blockDragFrame.current = requestAnimationFrame(animate);
      }
    };
    const over = (event: DragEvent) => {
      const drag = blockDrag.current,
        host = scroll.current;
      if (!drag || !host) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.inside = event.target instanceof Node && host.contains(event.target);
      if (!drag.inside) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      blockDragFrame.current ??= requestAnimationFrame(animate);
    };
    const drop = (event: DragEvent) => {
      receiveBlockDrop.current?.(event);
      clear();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        blockDragTicket.current++;
        clear();
      }
    };
    const blur = () => {
      blockDragTicket.current++;
      clear();
    };
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragend", clear, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      blockDragTicket.current++;
      clear();
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
    };
  }, [id]);
  const commitComposition = () => {
    if (composition.current) composition.current.failed = false;
    return operateSelection(async () => {
      while (composing.current) await new Promise<void>((resolve) => compositionWaiters.current.push(resolve));
      const capture = composition.current,
        draft = callbacks.current.readDraft();
      if (
        !mounted.current ||
        !capture ||
        capture.editor.isDestroyed ||
        active.current !== capture.window ||
        capture.ticket !== selectionSequence.current ||
        draft?.id !== id ||
        draft.content !== capture.content ||
        draft.paged?.version !== capture.bodyVersion
      )
        throw new Error(t("문서가 변경되어 조합 입력을 반영하지 못했습니다. 입력과 원문을 유지합니다."));
      if (capture.pending) {
        capture.pending.select(capture.editor.state);
        return capture.pending.operation();
      }
      return capturedSelectionSlice(capture.originalState, capture.editor.state, capture.from, capture.to);
    });
  };
  const runBoundary = async (direction: BoundaryDirection) => {
    if (!(await callbacks.current.flush({ editorOperation: true })))
      throw new Error(t("저장하지 못해 경계 입력을 중단했습니다. 원문을 유지합니다."));
    const state = active.current,
      editor = editorRef.current,
      draft = callbacks.current.readDraft();
    if (!state || !editor || !draft || editor.isDestroyed || draft.id !== id)
      throw new Error(t("편집 구간이 닫혔습니다."));
    const originalState = editor.state,
      revision = draft.revision,
      version = draft.paged?.version,
      ticket = selectionSequence.current;
    const point = mountedPoint(state, editor.state.selection.head);
    if (point.byte === undefined) throw new Error(t("경계의 원문 위치를 준비하지 못했습니다."));
    const check = () => {
      if (
        !mounted.current ||
        active.current !== state ||
        editor.isDestroyed ||
        editor.state.doc !== originalState.doc ||
        !editor.state.selection.eq(originalState.selection) ||
        ticket !== selectionSequence.current ||
        callbacks.current.readDraft() !== draft ||
        draft.revision !== revision ||
        draft.paged?.version !== version
      )
        throw new Error(t("편집이 변경되어 경계 입력을 중단했습니다. 현재 입력과 원문을 유지합니다."));
    };
    boundaryGuard.current = check;
    const prepared = await prepareBoundary({ byte: point.byte, within: point.within ?? 0 }, direction, {
      check,
      locate: (byte, bias) => api.documentLocate(id, revision, byte, bias),
      read: (offset) => api.documentBlocks(id, { revision, offset, limit: 1, max_block_bytes: INTERNAL_BYTES }),
      segments: (ordinal, offset) => api.documentSegments(id, revision, ordinal, { offset, limit: 1 }),
    });
    if (!prepared) return;
    const range = draft.paged
      ? { from: 0, to: 0 }
      : await locateBlockRange(draft.content, prepared.region.byte_offset, prepared.region.source);
    check();
    let repeat = 1;
    while (repeat < 64 && boundaryQueue.current[repeat - 1] === direction) repeat++;
    const result = changeBoundary(prepared, direction, repeat);
    if (!result) {
      boundaryQueue.current.splice(0, repeat - 1);
      return;
    }
    check();
    // Opening tags outside the region that received a block identity precede
    // it: splice them first (bounded: the tags alone), then the region.
    const tags = await boundaryTagEdits(draft, result.tags, check);
    check();
    const { regionFrom, source, edits, historyFrom, relative } = regionSplice(draft, tags, result, {
      from: range.from,
      to: range.from + result.expected.length,
    });
    if (edits || result.expected !== result.replacement) applyRegionSplice(draft, edits, result, source);
    history.current.record({
      from: historyFrom,
      offset: result.offset,
      before: edits ? "" : result.expected,
      after: edits ? "" : result.replacement,
      edits,
      beforeCount: result.beforeCount,
      afterCount: result.count,
      beforePreview: relative(result.beforePreview, range.from, result.expected, result.beforeStart),
      afterPreview: relative(result.afterPreview, regionFrom, result.replacement, result.start),
      beforeSelection: result.beforeSelection,
      afterSelection: result.selection,
      session: nextHistorySession(),
      group: 0,
      time: Date.now(),
    });
    total.current += result.count - result.beforeCount;
    heights.current.resize(total.current, result.offset);
    const preview = result.afterPreview,
      raw = preview.raw!,
      segment = preview.internal ? { ...preview.internal, source: raw } : undefined;
    const from = draft.paged
      ? 0
      : regionFrom + utf8PrefixLength(result.replacement, (preview.byteStart ?? result.start) - result.start);
    const next: WindowState = {
      offset: preview.offset ?? result.offset,
      count: preview.count,
      total: total.current,
      source,
      from,
      to: from + raw.length,
      byteStart: preview.byteStart ?? result.start,
      html: preview.html,
      segment,
      segmentTotal: preview.internal?.total,
      selection: result.selection,
      session: nextHistorySession(),
    };
    edited.current = { html: next.html, raw, count: next.count };
    active.current = next;
    projectionError.current = null;
    locationSnapshot.current = undefined;
    setWindowState(next);
    setJump(String(next.offset + 1));
    retainHistory();
    refreshHistory();
    if (scroll.current) layoutScroll.current = geometry().before;
    boundaryQueue.current.splice(0, result.consumed - 1);
  };
  const operateBoundary = (direction: BoundaryDirection, retry = false) => {
    if (isReadOnly()) return;
    if (!retry) boundaryQueue.current.push(direction);
    if (failedBoundary.current && !retry) return;
    if (boundaryRunning.current) return;
    boundaryRunning.current = true;
    selectionRunning.current = true;
    setBusy(true);
    setError(null);
    const promise = (async () => {
      const mountedEditor = async () => {
        const deadline = Date.now() + 5000;
        while (
          mounted.current &&
          (!editorRef.current || editorRef.current.isDestroyed || editorSession.current !== active.current?.session)
        ) {
          if (Date.now() > deadline) throw new Error(t("편집기 경계 입력을 준비하지 못했습니다."));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!mounted.current) throw new Error(t("편집 구간이 닫혔습니다."));
        return editorRef.current!;
      };
      let pendingKey: BoundaryDirection | undefined;
      try {
        if (retry) boundaryGuard.current?.();
        while (boundaryQueue.current.length) {
          const key = boundaryQueue.current.shift()!;
          pendingKey = key;
          const editor = await mountedEditor();
          const edge = key === "backward" ? Selection.atStart(editor.state.doc) : Selection.atEnd(editor.state.doc);
          if (editor.state.selection.eq(edge)) await runBoundary(key);
          else applyBoundaryCommand(editor, key);
          if (projectionError.current) throw new Error(projectionError.current);
          pendingKey = undefined;
          boundaryGuard.current = undefined;
          await mountedEditor();
        }
        failedBoundary.current = undefined;
        return true;
      } catch (error) {
        if (pendingKey) boundaryQueue.current.unshift(pendingKey);
        failedBoundary.current = boundaryQueue.current[0] ?? direction;
        if (mounted.current) setError(messageOf(error));
        return false;
      } finally {
        boundaryRunning.current = false;
        selectionRunning.current = false;
        if (mounted.current) setBusy(false);
      }
    })().finally(() => {
      if (selectionPromise.current === promise) selectionPromise.current = null;
    });
    selectionPromise.current = promise;
  };
  useEffect(
    () =>
      registerEditorFlush(
        async () => {
          if (composing.current || projectionError.current || composition.current?.failed) return false;
          const promise = selectionPromise.current ?? (composition.current ? commitComposition() : null);
          if (promise && !(await promise)) return false;
          rememberInternalLocation();
          return !composition.current;
        },
        () => Boolean(composing.current || composition.current || selectionRunning.current || projectionError.current),
      ),
    [],
  );
  /** Capture the mounted window's selection before provisional input changes it. */
  const newComposition = (editor: Editor, state: WindowState, draft: Draft, edited: boolean) => {
    const selected = editor.state.selection;
    return {
      editor,
      originalState: editor.state,
      startState: editor.state,
      from: selected.from,
      to: selected.to,
      startFrom: selected.from,
      startTo: selected.to,
      edited,
      ticket: selectionSequence.current,
      window: state,
      content: draft.content,
      bodyVersion: draft.paged?.version,
    };
  };
  const compositionStart = () => {
    if (isReadOnly()) return;
    resetVertical();
    compositionEpoch.current++;
    composing.current = true;
    locked.current = true;
    const editor = editorRef.current,
      state = active.current,
      draft = callbacks.current.readDraft();
    if (!editor || !state || !draft || !documentSelected.current) return;
    const capture = composition.current;
    if (capture) {
      capture.startState = editor.state;
      capture.startFrom = capture.from;
      capture.startTo = capture.to;
      capture.pendingStart = capture.pending?.checkpoint();
    } else if (!selectionRunning.current || blockSelectionRunning.current) {
      composition.current = newComposition(editor, state, draft, false);
    }
    if (composition.current) window.dispatchEvent(new Event("inkism-editor-pending"));
  };
  const restoreCompositionStart = (capture: NonNullable<typeof composition.current>) => {
    capture.editor.view.updateState(capture.startState);
    capture.from = capture.startFrom;
    capture.to = capture.startTo;
    if (capture.pending && capture.pendingStart) capture.pending.restore(capture.pendingStart);
    if (!capture.edited) composition.current = null;
  };
  const compositionEnd = (data: string) => {
    // ProseMirror observes the final DOM mutation after the end event bubbles.
    // Keep provisional changes isolated until that observation has completed.
    clearTimeout(compositionTimer.current);
    const epoch = compositionEpoch.current;
    if (data && composition.current) composition.current.edited = true;
    compositionTimer.current = setTimeout(() => {
      if (epoch !== compositionEpoch.current) return;
      const capture = composition.current;
      if (capture && !capture.editor.isDestroyed && !data) restoreCompositionStart(capture);
      composing.current = false;
      for (const resolve of compositionWaiters.current.splice(0)) resolve();
      if (composition.current && !composition.current.failed && !selectionPromise.current)
        void commitComposition().finally(unlock);
      else if (!selectionPromise.current) unlock();
      window.dispatchEvent(new Event("inkism-editor-pending"));
    }, 0);
  };
  const compositionTransaction = ({ transaction }: { transaction: Transaction }) => {
    const capture = composition.current;
    if (!capture) return;
    if (capture.pending) {
      if (!transaction.docChanged) {
        try {
          capture.pending.select(capture.editor.state);
        } catch {}
      }
      return;
    }
    if (!transaction.docChanged) return;
    capture.from = transaction.mapping.map(capture.from, -1);
    capture.to = transaction.mapping.map(capture.to, 1);
  };
  const cancelSelection = async () => {
    const capture = composition.current;
    if (!capture) {
      selectDocument(null);
      return;
    }
    if (composing.current || selectionRunning.current || discardPrompt.current) return;
    discardPrompt.current = true;
    try {
      const discard = await confirm({
        title: t("미반영 입력을 버릴까요?"),
        message: t("아직 저장되지 않은 조합 입력을 버리고 선택을 취소합니다. 노트 원문은 유지됩니다."),
        confirmLabel: t("입력 버리기"),
        danger: true,
      });
      if (
        !discard ||
        !mounted.current ||
        composition.current !== capture ||
        composing.current ||
        selectionRunning.current
      )
        return;
      if (!capture.editor.isDestroyed) capture.editor.view.updateState(capture.originalState);
      composition.current = null;
      selectDocument(null);
      setError(null);
      unlock();
      window.dispatchEvent(new Event("inkism-editor-pending"));
    } finally {
      discardPrompt.current = false;
    }
  };
  const showPending = (capture: NonNullable<typeof composition.current>) => {
    if (!capture.pending || composition.current !== capture || capture.editor.isDestroyed) return;
    const shown = capture.pending.preview();
    const html = serializeModel(shown.doc.content);
    if (new TextEncoder().encode(html).length > INTERNAL_BYTES)
      throw new Error(t("입력의 표시 구간이 너무 큽니다. 입력과 원문을 유지합니다."));
    capture.editor.view.updateState(
      EditorState.create({
        schema: capture.editor.schema,
        plugins: capture.editor.state.plugins,
        doc: shown.doc,
        selection: shown.selection,
      }),
    );
  };
  const displayPending = (next: NonNullable<typeof composition.current>) => {
    if (composition.current !== next) return;
    try {
      showPending(next);
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
      return;
    }
    if (!next.failed && !composing.current && !selectionPromise.current) void commitComposition().finally(unlock);
  };
  const acceptPendingPaste = (pending: PendingSelection, editor: Editor, slice: Slice | ClipboardPaste) => {
    if (slice instanceof Slice)
      pending.accept(editor.state, editor.state.tr.replaceSelection(slice).setMeta("uiEvent", "paste"));
    else pending.accept(editor.state, slice.parse(editor.state, slice.input).transaction, slice);
  };
  const pendingPaste = (slice: Slice | ClipboardPaste, deferred = false) => {
    if (isReadOnly()) return true;
    const capture = composition.current,
      editor = editorRef.current,
      state = active.current,
      draft = callbacks.current.readDraft();
    if (capture && !capture.pending) return false;
    if (!capture && !documentSelected.current) return false;
    if (!editor || !state || !draft || editor.isDestroyed) return true;
    if (selectionRunning.current && !blockSelectionRunning.current && !capture) {
      setError(t("현재 편집을 반영한 뒤 붙여넣어 주세요."));
      return true;
    }
    try {
      let next = capture;
      if (next) acceptPendingPaste(next.pending!, editor, slice);
      else {
        next = { ...newComposition(editor, state, draft, true), pending: new PendingSelection(editor.state, slice) };
        composition.current = next;
      }
      locked.current = true;
      window.dispatchEvent(new Event("inkism-editor-pending"));
      const display = () => displayPending(next);
      if (deferred) queueMicrotask(display);
      else display();
    } catch (e) {
      setError(messageOf(e));
    }
    return true;
  };
  const acceptPendingTransaction = (capture: NonNullable<typeof composition.current>, tr: Transaction) => {
    // Plugin follow-ups (e.g. block IDs) start from the not-yet-shown state; they
    // must not rewrite the provisional projection.
    if (tr.before !== capture.editor.state.doc) return true;
    try {
      capture.pending!.accept(capture.editor.state, tr);
      // Reproject before an accepted transaction could grow the visible DOM.
      if (tr.doc.childCount > WINDOW || tr.doc.content.size > 8192) {
        queueMicrotask(() => {
          try {
            showPending(capture);
          } catch (e) {
            if (mounted.current) setError(messageOf(e));
          }
        });
        return true;
      }
      return false;
    } catch (e) {
      setError(messageOf(e));
      return true;
    }
  };
  const rejectCompositionTransaction = (capture: NonNullable<typeof composition.current>, tr: Transaction) => {
    if (tr.doc.childCount > WINDOW) {
      setError(t("현재 입력을 반영한 뒤 큰 붙여넣기를 다시 시도해 주세요. 입력과 원문을 유지합니다."));
      return true;
    }
    let from = capture.from,
      to = capture.to;
    for (const step of tr.steps) {
      const map = step.getMap();
      if (stepOutside(step, map, from, to)) {
        setError(t("조합 입력을 반영한 뒤 다른 위치를 편집해 주세요. 입력과 원문을 유지합니다."));
        return true;
      }
      from = map.map(from, -1);
      to = map.map(to, 1);
    }
    return false;
  };
  const markSelectionSteps = (steps: StepJSON[]) => {
    if (!steps.length || !steps.every((step) => step.stepType === "addMark" || step.stepType === "removeMark"))
      return false;
    const name = steps[0].mark?.type;
    if (
      !["bold", "italic", "underline", "strike", "highlight", "code"].includes(name) ||
      !steps.every((step) => step.mark?.type === name)
    )
      return false;
    void operateSelection({ kind: "mark", mark: name });
    return true;
  };
  const startProvisionalInput = () => {
    const editor = editorRef.current,
      state = active.current,
      draft = callbacks.current.readDraft();
    if (!editor || !state || !draft) return false;
    const capture = newComposition(editor, state, draft, true);
    composition.current = capture;
    window.dispatchEvent(new Event("inkism-editor-pending"));
    queueMicrotask(() => {
      if (composition.current === capture && !composing.current && !selectionPromise.current)
        void commitComposition().finally(unlock);
    });
    return true;
  };
  const replaceSelectionStep = (tr: Transaction, step: StepJSON) => {
    const nodes = step.slice?.content ?? [];
    // A native keyboard emits one transaction per key. Keeping the selected
    // range operation asynchronous while refusing those transactions drops
    // every key after the first. Apply small text/deletion provisionally to
    // the bounded view, just like IME, until the original range is ready.
    if (
      (!selectionRunning.current || blockSelectionRunning.current) &&
      tr.doc.childCount <= WINDOW &&
      plainNodes(nodes) &&
      JSON.stringify(nodes).length <= 4096 &&
      startProvisionalInput()
    )
      return false;
    if (!step.slice?.content?.length) void operateSelection({ kind: "delete" });
    else {
      return pendingPaste(Slice.fromJSON(editorRef.current!.schema, step.slice), true);
    }
    return true;
  };
  const documentTransaction = (tr: Transaction) => {
    if (tr.docChanged && isReadOnly()) return true;
    const capture = composition.current;
    // Provisional input over a document selection (keys, IME, paste) is
    // committed from its captured slice or replayed steps, never from these
    // attribute-only transactions. Block identities requested for it are not
    // user input: they would fall outside the captured range or be compared with
    // a view state that is not updated yet, and refusing them as edits would
    // stop the input. The commit itself gives the blocks that input touched
    // their identities (changeSelection, same rule as the editor).
    if (blockIdentityTransaction(tr) && (capture || documentSelected.current)) return true;
    if (capture)
      return capture.pending ? acceptPendingTransaction(capture, tr) : rejectCompositionTransaction(capture, tr);
    if (!documentSelected.current) return false;
    if (composing.current) {
      setError(t("이 선택 범위에서는 조합 입력을 사용할 수 없습니다. 선택을 해제한 뒤 입력해 주세요."));
      return true;
    }
    const steps = tr.steps.map((step) => step.toJSON());
    if (markSelectionSteps(steps)) return true;
    if (steps.length === 1 && steps[0].stepType === "replace") return replaceSelectionStep(tr, steps[0]);
    setError(t("이 선택 범위에는 이 서식을 적용할 수 없습니다. 선택과 원문을 유지했습니다."));
    return true;
  };

  const navigationGuard = (seq: number, draft: Draft, target: WindowTarget | undefined) => {
    const bodyVersion = draft.paged?.version,
      currentRevision = draft.revision;
    return () => {
      const current = callbacks.current.readDraft();
      if (
        !mounted.current ||
        seq !== sequence.current ||
        current?.id !== id ||
        current.revision !== currentRevision ||
        current.content !== draft.content ||
        current.paged?.version !== bodyVersion ||
        (target?.vertical && target.vertical.ticket !== verticalSequence.current)
      )
        throw new Error(t("편집 중인 구간을 유지했습니다. 이동을 다시 시도해 주세요."));
    };
  };
  /** Source byte that pins a navigation target inside its block, if any. */
  const navigationCursor = (target: WindowTarget | undefined) => {
    if (target?.edge && active.current?.segment)
      return (
        active.current.byteStart! + (target.edge === "next" ? new TextEncoder().encode(edited.current.raw).length : 0)
      );
    return target?.byte;
  };
  const locateNavigation = async (ready: Ready, revision: number, cursor: number, target: WindowTarget | undefined) => {
    const located = await ready(() =>
      api.documentLocate(id, revision, cursor, target?.bias ?? (target?.edge === "previous" ? "before" : "after")),
    );
    if (!located.supported) throw new Error(t("구간의 서식을 준비하지 못했습니다. 현재 편집과 원문을 유지했습니다."));
    return located;
  };
  const readNavigationPage = async (ready: Ready, revision: number, offset: number, size: number, edge?: Edge) => {
    let page = await ready(() =>
      api.documentBlocks(id, { revision, offset, limit: size, max_block_bytes: INTERNAL_BYTES }),
    );
    if (edge === "end" && page.blocks.length < Math.min(size, page.total_blocks! - offset)) {
      offset = Math.min(page.total_blocks! - 1, offset + size - 1);
      page = await ready(() => api.documentBlocks(id, { revision, offset, limit: 1, max_block_bytes: INTERNAL_BYTES }));
    }
    return { page, offset };
  };
  /** Widen an internal segment to keep the visual line context of a vertical caret move. */
  const verticalSegment = (
    segment: DocumentSegment,
    live: WindowState,
    editor: Editor,
    offset: number,
    revision: number,
    up: boolean,
  ) => {
    const font = getComputedStyle(editor.view.dom),
      layout = [editor.view.dom.clientWidth, font.font, font.lineHeight, document.fonts.status].join("|");
    if (wrapCache.current?.revision !== revision || wrapCache.current.layout !== layout)
      wrapCache.current = { revision, layout, windows: new Map() };
    const cache = wrapCache.current.windows,
      current = windowSource(live),
      currentEnd = current.byte_offset + new TextEncoder().encode(current.source).length;
    cache.set(`${offset}:${current.ordinal}`, current);
    while (cache.size > 8) cache.delete(cache.keys().next().value!);
    const map = segmentPositionMap(current, editor.schema);
    if (!up) {
      const start = visualRowByte(map, editor.view, Selection.atEnd(editor.state.doc).head, -2),
        end = segment.byte_offset + new TextEncoder().encode(segment.source).length;
      if (start < currentEnd && currentEnd >= segment.byte_offset && currentEnd < end)
        return mergeSegments(
          sourceSpan(current, start, currentEnd),
          sourceSpan(segment, currentEnd, end),
          segment.ordinal,
        );
      return segment;
    }
    const previous = cache.get(`${offset}:${segment.ordinal}`);
    if (!previous) return segment;
    const end = previous.byte_offset + new TextEncoder().encode(previous.source).length;
    if (end >= current.byte_offset && end < currentEnd) {
      const after = visualRowByte(map, editor.view, map.position(end), 3);
      if (after > end) return mergeSegments(previous, sourceSpan(current, end, after), previous.ordinal);
    }
    return previous;
  };
  const segmentWindowContent = async (
    ready: Ready,
    revision: number,
    offset: number,
    segmentOffset: number | undefined,
    request: { edge?: Edge; join?: Join; target?: WindowTarget },
    cursor: number | undefined,
  ): Promise<WindowContent> => {
    const { edge, join, target } = request;
    if (join) throw new Error(t("이 경계의 문단을 합치는 범위를 준비하지 못했습니다. 입력과 원문을 유지했습니다."));
    let inner = await ready(() => api.documentSegments(id, revision, offset, { offset: segmentOffset ?? 0 }));
    if (!inner.supported) throw new Error(UNSUPPORTED_WINDOW);
    if (segmentOffset === undefined && edge === "end" && inner.total_segments! > 1)
      inner = await ready(() => api.documentSegments(id, revision, offset, { offset: inner.total_segments! - 1 }));
    let segment: DocumentSegment | undefined = inner.segments[0];
    if (!segment) throw new Error(t("문서 범위를 벗어났습니다."));
    const segmentTotal = inner.total_segments!;
    const live = active.current,
      editor = editorRef.current,
      vertical = target?.vertical;
    if (vertical && live?.segment && editor && live.offset === offset && cursor !== undefined)
      segment = verticalSegment(segment, live, editor, offset, revision, vertical.up);
    const html = renderSegment(segment);
    const inspection = inspectRichHTML(html);
    if (!inspection.editable) throw new Error(UNSUPPORTED_WINDOW);
    return {
      segment,
      segmentTotal,
      raw: segment.source,
      html,
      byteStart: segment.byte_offset,
      count: inspection.blocks,
    };
  };
  const initialNavigationSelection = async (
    ready: Ready,
    revision: number,
    initial: SavedLocation,
    byteStart: number,
    raw: string,
  ): Promise<DocumentSelection | undefined> => {
    const saved = initial?.selection;
    if (initial?.documentSelection) return initial.documentSelection;
    if (saved?.type === "all") return { kind: "all" };
    if (!saved || !savedRangeNeedsLocate(saved, byteStart, byteStart + new TextEncoder().encode(raw).length))
      return initial?.documentSelection;
    const anchorByte = saved.anchorByte as number,
      headByte = saved.headByte as number;
    const anchor = await ready(() => api.documentLocate(id, revision, anchorByte, "before"));
    const head = await ready(() => api.documentLocate(id, revision, headByte, "after"));
    return {
      kind: "range",
      anchor: {
        block: anchor.ordinal,
        position: Number(saved.anchor),
        byte: anchorByte,
        within: Number(saved.anchorWithin ?? 0),
      },
      head: {
        block: head.ordinal,
        position: Number(saved.head),
        byte: headByte,
        within: Number(saved.headWithin ?? 0),
      },
    };
  };
  const showNavigation = (
    next: WindowState,
    draft: Draft,
    loaded: WindowContent,
    initialDocumentSelection: DocumentSelection | undefined,
    position: boolean,
    logicalTarget: number | null,
  ) => {
    const { html, raw, count, segment, segmentTotal } = loaded;
    initialLocation.current = undefined;
    projectionError.current = null;
    locationSnapshot.current = undefined;
    edited.current = { html, raw, count };
    total.current = next.total;
    heights.current.resize(next.total);
    if (segment)
      heights.current.set(next.offset, (segmentTotal ?? 1) * Math.max(48, content.current?.offsetHeight ?? 48));
    active.current = next;
    alignAfterMeasure.current = position && !next.verticalStep ? next : null;
    if (initialDocumentSelection) selectDocument(initialDocumentSelection);
    setWindowState(next);
    setJump(String(next.offset + 1));
    rememberLocation(id, {
      revision: draft.revision,
      kind: "windowed",
      offset: next.offset,
      selection: next.selection,
      documentSelection: documentSelected.current ?? undefined,
    });
    if (scroll.current) {
      const space = geometry();
      if (position) layoutScroll.current = space.before;
      else if (logicalTarget !== null)
        layoutScroll.current =
          space.before + Math.max(0, Math.min(logicalTarget - space.start, space.end - space.start - 1));
    }
  };
  const loadNavigation = async (seq: number, request: NavigationRequest, logicalTarget: number | null) => {
    const { position, revision, edge, join, target } = request;
    let { offset, size } = request;
    if (!(await callbacks.current.flush()))
      throw new Error(t("저장하지 못해 현재 구간을 유지합니다. 저장 상태를 확인해 주세요."));
    const draft = callbacks.current.readDraft();
    if (draft?.id !== id) return;
    if (revision !== undefined && draft.revision !== revision)
      throw new Error(t("검색 후 문서가 변경되었습니다. 다시 검색해 주세요."));
    const currentRevision = draft.revision,
      deadline = Date.now() + 60000;
    const check = navigationGuard(seq, draft, target);
    const ready: Ready = (read) =>
      pollReady(read, check, deadline, t("문서 구간을 준비 중입니다. 잠시 후 다시 시도해 주세요."));
    const cursor = navigationCursor(target);
    let segmentOffset = target?.segment;
    if (cursor !== undefined) {
      const located = await locateNavigation(ready, currentRevision, cursor, target);
      offset = located.ordinal;
      segmentOffset = located.offset;
      size = 1;
    }
    const loaded = await readNavigationPage(ready, currentRevision, offset, size, edge);
    const page = loaded.page;
    offset = loaded.offset;
    const windowContent = page.oversized_block
      ? await segmentWindowContent(ready, currentRevision, offset, segmentOffset, request, cursor)
      : blockWindowContent(page, join);
    const { segment, segmentTotal, raw, html, byteStart, count } = windowContent;
    const range = draft.paged ? { from: 0, to: raw.length } : await locateBlockRange(draft.content, byteStart, raw);
    check();
    if (locked.current) {
      pending.current = { offset, position, revision, edge, size, join, target };
      return;
    }
    const next: WindowState = {
      offset,
      count,
      total: page.total_blocks!,
      source: draft.content,
      byteStart,
      html,
      ...range,
      edge,
      join,
      segment,
      segmentTotal,
      column: target?.column,
      session: nextHistorySession(),
    };
    if (segment && page.oversized?.byte_count) next.segmentSpan = oversizedSpan(page.oversized, byteStart, raw);
    const initial = initialLocation.current;
    const initialDocumentSelection = await initialNavigationSelection(ready, currentRevision, initial, byteStart, raw);
    applyNavigationSelection(next, { initial, initialDocumentSelection, segment, byteStart, raw, cursor, target });
    showNavigation(next, draft, windowContent, initialDocumentSelection, position, logicalTarget);
    return true;
  };
  const failNavigation = (e: unknown, seq: number) => {
    if (mounted.current && seq === sequence.current) {
      setError(navigationErrorMessage(e));
      if (scroll.current && active.current) scroll.current.scrollTop = geometry().before;
    }
  };
  const finishNavigation = () => {
    navigating.current = false;
    if (mounted.current) setBusy(false);
    const next = pending.current;
    pending.current = null;
    if (mounted.current && next)
      void navigateRef.current(next.offset, next.position, next.revision, next.edge, next.size, next.join, next.target);
  };
  const navigate = useCallback(
    async (
      offset: number,
      position = false,
      revision?: number,
      edge?: Edge,
      size = WINDOW,
      join?: Join,
      target?: WindowTarget,
    ) => {
      offset = Math.max(0, Math.floor(offset));
      if (position) {
        clearTimeout(scrollTimer.current);
        scrollTimer.current = undefined;
        pending.current = null;
      }
      if (locked.current || navigating.current) {
        if (position || !pending.current?.position)
          pending.current = { offset, position, revision, edge, size, join, target };
        return;
      }
      if (active.current?.offset === offset && !edge && !join && !target) {
        if (position && scroll.current) scroll.current.scrollTop = geometry().before;
        return true;
      }
      const logicalTarget =
        !position && scroll.current && content.current
          ? geometry().logicalAt(scroll.current.scrollTop, content.current.offsetHeight)
          : null;
      attempted.current = offset;
      attemptedTarget.current = target;
      navigating.current = true;
      const seq = ++sequence.current;
      setBusy(true);
      setError(null);
      try {
        return await loadNavigation(seq, { offset, position, revision, edge, size, join, target }, logicalTarget);
      } catch (e) {
        failNavigation(e, seq);
      } finally {
        finishNavigation();
      }
    },
    [id],
  );
  navigateRef.current = navigate;
  useEffect(() => {
    mounted.current = true;
    const saved = initialLocation.current?.selection;
    let byte: number | undefined;
    if (typeof saved?.headByte === "number") byte = saved.headByte;
    else if (typeof saved?.anchorByte === "number") byte = saved.anchorByte;
    void navigateRef.current(
      initialLocation.current?.offset ?? 0,
      true,
      undefined,
      undefined,
      WINDOW,
      undefined,
      byte === undefined ? undefined : { byte },
    );
    return () => {
      mounted.current = false;
      sequence.current++;
      clearTimeout(scrollTimer.current);
      if (verticalFrame.current !== undefined) cancelAnimationFrame(verticalFrame.current);
      verticalFrame.current = undefined;
      verticalQueue.current = [];
      clearTimeout(compositionTimer.current);
      clearTimeout(locationTimer.current);
      composition.current = null;
      composing.current = false;
      for (const resolve of compositionWaiters.current.splice(0)) resolve();
    };
  }, [id]);
  const unlock = () => {
    if (composing.current) return;
    locked.current = false;
    const target = pending.current;
    pending.current = null;
    if (target !== null)
      void navigate(
        target.offset,
        target.position,
        target.revision,
        target.edge,
        target.size,
        target.join,
        target.target,
      );
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = mouseSelection.current;
      if (drag?.pointer !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.crossed) {
        event.preventDefault();
        updateMouseSelection();
      }
    };
    const release = (event: PointerEvent) => {
      const drag = mouseSelection.current;
      if (drag?.pointer === event.pointerId) {
        drag.x = event.clientX;
        drag.y = event.clientY;
        drag.released = true;
        if (drag.crossed) updateMouseSelection();
        else mouseSelection.current = undefined;
      }
      unlock();
      // Keep the notice's geometry until mouseup/click finish targeting text.
      // An outside release may not generate click, so finish in the next task.
      if (selectionNoticePending.current) setTimeout(finishSelectionNotice, 0);
    };
    const cancel = () => {
      mouseSelection.current = undefined;
      resetVertical();
      finishSelectionNotice();
      unlock();
    };
    const preventDrag = (event: DragEvent) => {
      // A reprojected range must stay a text-selection gesture. The browser
      // can otherwise turn its detached old mousedown target into native DnD.
      if (mouseSelection.current?.crossed) event.preventDefault();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("click", finishSelectionNotice);
    window.addEventListener("dragstart", preventDrag, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("click", finishSelectionNotice);
      window.removeEventListener("dragstart", preventDrag, true);
      if (mouseFrame.current !== undefined) cancelAnimationFrame(mouseFrame.current);
      mouseSelection.current = undefined;
    };
  }, []);
  /** A failed source projection keeps edits local to the mounted editor's own history. */
  const undoMountedEditor = (direction: "undo" | "redo") => {
    const editor = editorRef.current;
    if (editor && !editor.isDestroyed) direction === "undo" ? editor.commands.undo() : editor.commands.redo();
  };
  const applyHistory = (direction: "undo" | "redo") => {
    if (isReadOnly()) return;
    if (locked.current || navigating.current || composing.current || selectionRunning.current) return;
    if (projectionError.current) {
      undoMountedEditor(direction);
      return;
    }
    const draft = callbacks.current.readDraft();
    if (draft?.id !== id) return;
    try {
      clearTimeout(scrollTimer.current);
      scrollTimer.current = undefined;
      pending.current = null;
      const result = history.current.prepare(direction);
      if (!result) return;
      const { preview, segment, raw } = restoredHistoryWindow(result);
      const ranges = result.edits ?? [{ start: result.from, expected: result.expected, replacement: result.html }];
      const source = replayHistoryRanges(draft, ranges);
      if (draft.paged) {
        for (const range of ranges) callbacks.current.changeRange(range);
      } else callbacks.current.change(source);
      history.current.commit(direction, result.edit);
      total.current += result.countDelta;
      if (result.edits) heights.current.clear();
      heights.current.resize(total.current, result.offset);
      const { from, previewByte } = historyPreviewStart(draft, result, preview, segment, source);
      const next: WindowState = {
        offset: preview.offset ?? result.offset,
        count: preview.count,
        total: total.current,
        source,
        from,
        to: from + raw.length,
        byteStart: previewByte,
        html: preview.html,
        segment,
        segmentTotal: preview.internal?.total,
        selection: result.selection,
        projectedSelection: Boolean(result.documentSelection),
        session: nextHistorySession(),
      };
      projectionError.current = null;
      locationSnapshot.current = undefined;
      selectDocument(result.documentSelection ?? null);
      edited.current = { html: preview.html, raw, count: preview.count };
      active.current = next;
      alignAfterMeasure.current = next;
      setWindowState(next);
      setJump(String(result.offset + 1));
      rememberLocation(id, {
        revision: callbacks.current.readDraft()?.revision ?? draft.revision,
        kind: "windowed",
        offset: next.offset,
        selection: segment ? saveSegmentSelection(segment, result.selection ?? {}) : result.selection,
        documentSelection: result.documentSelection,
      });
      setError(null);
      retainHistory();
      refreshHistory();
      if (scroll.current) layoutScroll.current = geometry().before;
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const measureSegmentHeight = (state: WindowState, root: HTMLElement) => {
    const fraction = state.segmentSpan
      ? state.segmentSpan.end - state.segmentSpan.start
      : 1 / (state.segmentTotal ?? 1);
    return heights.current.set(
      state.offset,
      Math.max(48, root.getBoundingClientRect().height) / Math.max(Number.EPSILON, fraction),
    );
  };
  /** Keep the viewport on the same content after measured heights move the window. */
  const settleMeasuredHeights = (state: WindowState, previousTop: number, changed: boolean) => {
    const shift = geometry().before - previousTop;
    const align = alignAfterMeasure.current === state;
    if (scroll.current && (align || shift))
      layoutScroll.current = align ? geometry().before : scroll.current.scrollTop + shift;
    if (align) alignAfterMeasure.current = null;
    if (changed || shift || align) refreshHeights();
  };
  useEffect(() => {
    const host = content.current;
    if (!host || !windowState) return;
    let frame = 0;
    let width = host.clientWidth;
    const observed = new Set<Element>();
    const measureBlocks = (root: HTMLElement, children: HTMLElement[]) => {
      for (const child of observed) {
        if (!children.includes(child as HTMLElement)) {
          observer.unobserve(child);
          observed.delete(child);
        }
      }
      let changed = false;
      const rootRect = root.getBoundingClientRect();
      children.forEach((child, index) => {
        if (!observed.has(child)) {
          observer.observe(child);
          observed.add(child);
        }
        const top = index === 0 ? rootRect.top : child.getBoundingClientRect().top;
        const bottom = index + 1 < children.length ? children[index + 1].getBoundingClientRect().top : rootRect.bottom;
        changed = heights.current.set(windowState.offset + index, bottom - top) || changed;
      });
      return changed;
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (active.current !== windowState) return;
        const previousTop = geometry().before;
        if (host.clientWidth !== width) {
          width = host.clientWidth;
          heights.current.clear();
          resetVertical();
        }
        const root = host.querySelector<HTMLElement>(".tiptap-prose");
        if (!root) return;
        const children = Array.from(root.children) as HTMLElement[];
        if (children.length !== edited.current.count) return;
        if (windowState.segment) {
          settleMeasuredHeights(windowState, previousTop, measureSegmentHeight(windowState, root));
          return;
        }
        settleMeasuredHeights(windowState, previousTop, measureBlocks(root, children));
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const mutations = new MutationObserver(measure);
    mutations.observe(host, { childList: true, subtree: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [windowState]);
  /** A mouse drag that scrolls past the mounted window becomes a document range selection. */
  const continueMouseDrag = (state: WindowState) => {
    const drag = mouseSelection.current,
      editor = editorRef.current;
    if (!drag || drag.released || !editor || editor.isDestroyed) return;
    if (!drag.crossed) {
      drag.anchor = mountedPoint(state, editor.state.selection.anchor);
      drag.crossed = true;
      selectDocument({
        kind: "range",
        anchor: drag.anchor,
        head: mountedPoint(state, editor.state.selection.head),
      });
    }
    locked.current = false;
    animateMouseSelection();
  };
  const onScroll = () => {
    // Scroll continuously during a drag. Debouncing every event would defer
    // the next window forever while browser/custom edge scrolling is active.
    if (scrollTimer.current !== undefined) return;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = undefined;
      const host = scroll.current,
        state = active.current,
        block = content.current;
      if (!host || !state || !block || navigating.current) return;
      const space = geometry();
      const top = space.before;
      if (host.scrollTop < top + block.offsetHeight && host.scrollTop + host.clientHeight > top) return;
      continueMouseDrag(state);
      const atEnd = host.scrollTop + host.clientHeight >= host.scrollHeight - 2;
      if (state.segment) {
        const logical = space.logicalAt(host.scrollTop, block.offsetHeight);
        const start = heights.current.top(state.offset),
          end = heights.current.top(state.offset + 1);
        if (logical >= start && logical < end) {
          const segment = Math.max(
            0,
            Math.min(
              (state.segmentTotal ?? 1) - 1,
              Math.floor(((logical - start) / Math.max(1, end - start)) * (state.segmentTotal ?? 1)),
            ),
          );
          if (segment !== state.segment.ordinal)
            void navigate(state.offset, false, undefined, undefined, 1, undefined, { segment });
          return;
        }
      }
      const next = atEnd
        ? Math.max(0, total.current - WINDOW)
        : Math.min(
            Math.max(0, total.current - WINDOW),
            Math.floor(heights.current.at(space.logicalAt(host.scrollTop, block.offsetHeight)) / WINDOW) * WINDOW,
          );
      if (next !== state.offset) void navigate(next, false, undefined, atEnd ? "end" : undefined);
    }, 120);
  };
  /** Anchor of the current document range, or the mounted editor position. */
  const rangeAnchor = (state: WindowState, position: number) =>
    documentSelected.current?.kind === "range" ? documentSelected.current.anchor : mountedPoint(state, position);
  const queueVerticalKey = (event: React.KeyboardEvent, verticalKey: boolean) => {
    if (!verticalKey || !(verticalMoving.current || navigating.current)) return false;
    event.preventDefault();
    event.stopPropagation();
    verticalQueue.current.push({ key: event.key, shift: event.shiftKey });
    scheduleVertical();
    return true;
  };
  const queueBoundaryKey = (event: React.KeyboardEvent) => {
    if (
      !boundaryRunning.current ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !["Backspace", "Delete"].includes(event.key)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    boundaryQueue.current.push(event.key === "Backspace" ? "backward" : "forward");
    return true;
  };
  const compositionKey = (event: React.KeyboardEvent) => {
    if (!composition.current) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void cancelSelection();
    }
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) event.preventDefault();
    return true;
  };
  const selectionShortcutKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && documentSelected.current) {
      event.preventDefault();
      event.stopPropagation();
      selectDocument(null);
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      selectDocument({ kind: "all" });
      return true;
    }
    return false;
  };
  /** Whether a Shift+arrow key leaves the mounted window before or after it. */
  const windowEdgeKeys = (key: string, editor: Editor, state: WindowState, selected: Selection, vertical: boolean) => {
    const nearFirst = selected.head === Selection.atStart(editor.state.doc).head,
      nearLast = selected.head === Selection.atEnd(editor.state.doc).head;
    // endOfTextblock normally checks the range's outer endpoint. Check a
    // temporary collapsed state so shrinking a backwards range follows its
    // moving head too. No selection or document transaction is dispatched.
    const headState = vertical
      ? editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selected.head)))
      : editor.state;
    const atVisualEdge = (up: boolean) =>
      vertical &&
      selected.$head.sameParent((up ? Selection.atStart(editor.state.doc) : Selection.atEnd(editor.state.doc)).$head) &&
      editor.view.endOfTextblock(up ? "up" : "down", headState);
    const previous =
      ((key === "ArrowLeft" && nearFirst) || (key === "ArrowUp" && atVisualEdge(true))) &&
      (state.offset > 0 || Boolean(state.segment?.ordinal));
    const next =
      ((key === "ArrowRight" && nearLast) || (key === "ArrowDown" && atVisualEdge(false))) &&
      (state.offset + edited.current.count < total.current ||
        Boolean(state.segment && state.segment.ordinal + 1 < (state.segmentTotal ?? 1)));
    return { previous, next };
  };
  const extensionGuard = (extension: WindowExtension, draft: Draft) => {
    const { editor, state, selected, originalDoc, ticket } = extension;
    const revision = draft.revision,
      version = draft.paged?.version;
    return () => {
      if (
        !mounted.current ||
        ticket !== selectionSequence.current ||
        active.current !== state ||
        editor.isDestroyed ||
        editor.state.doc !== originalDoc ||
        !editor.state.selection.eq(selected) ||
        callbacks.current.readDraft() !== draft ||
        draft.revision !== revision ||
        draft.paged?.version !== version
      )
        throw new Error(t("문서나 커서가 변경되어 현재 선택을 유지합니다."));
    };
  };
  /** Continue a Shift+vertical move into the neighbouring internal segment, keeping the column. */
  const extendVertically = async (extension: WindowExtension, check: () => void, revision: number) => {
    const { state, anchor, origin, previous, column } = extension;
    check();
    selectDocument({ kind: "range", anchor, head: origin });
    await navigate(state.offset, true, revision, undefined, 1, undefined, {
      edge: previous ? "previous" : "next",
      column,
      vertical: {
        origin,
        up: previous,
        extend: true,
        freshColumn: verticalOrigin.current?.byte === origin.byte,
        ticket: verticalSequence.current,
      },
    });
  };
  /** Bounded source of the block (or internal segment) a selection extends into. */
  const extensionSource = async (
    ready: Ready,
    revision: number,
    ordinal: number,
    innerOffset: number | undefined,
    end: boolean,
  ) => {
    const page = await ready(() =>
      api.documentBlocks(id, { revision, offset: ordinal, limit: 1, max_block_bytes: INTERNAL_BYTES }),
    );
    let source: DocumentSegment;
    if (page.oversized_block) {
      let inner = await ready(() => api.documentSegments(id, revision, ordinal, { offset: innerOffset ?? 0 }));
      if (end && innerOffset === undefined && inner.total_segments! > 1)
        inner = await ready(() => api.documentSegments(id, revision, ordinal, { offset: inner.total_segments! - 1 }));
      if (!inner.supported || !inner.segments.length) throw new Error(UNSUPPORTED_SELECTION);
      source = inner.segments[0];
    } else {
      const block = page.blocks[0];
      if (!block) throw new Error(t("선택 구간이 변경되었습니다."));
      source = {
        ordinal: 0,
        byte_offset: block.byte_offset,
        source: block.html,
        start_context: [],
        end_context: [],
      };
    }
    if (!inspectRichHTML(renderSegment(source)).editable) throw new Error(UNSUPPORTED_SELECTION);
    return source;
  };
  const extendAcrossWindows = async (extension: WindowExtension) => {
    const { editor, state, anchor, origin, target, end, previous, cursor, column, vertical } = extension;
    try {
      if (!(await callbacks.current.flush())) throw new Error(t("저장하지 못해 선택 범위를 유지합니다."));
      const draft = callbacks.current.readDraft();
      if (draft?.id !== id) return;
      const revision = draft.revision,
        deadline = Date.now() + 60000;
      const check = extensionGuard(extension, draft);
      const ready: Ready = (read) => pollReady(read, check, deadline, t("선택 구간을 준비 중입니다."));
      if (vertical && state.segment && continuesInTextblock(editor)) {
        await extendVertically(extension, check, revision);
        return;
      }
      let ordinal = Math.max(0, target),
        innerOffset: number | undefined;
      if (cursor !== undefined) {
        const found = await ready(() => api.documentLocate(id, revision, cursor, previous ? "before" : "after"));
        ordinal = found.ordinal;
        innerOffset = found.offset;
      }
      const source = await extensionSource(ready, revision, ordinal, innerOffset, end);
      const map = segmentPositionMap(source),
        doc = map.doc();
      let caret = extensionCaret(map, doc, cursor, end, previous);
      if (!vertical && cursor !== undefined && origin.byte !== undefined) {
        const located = await ready(() => api.documentLocate(id, revision, origin.byte!));
        if (located.ordinal === ordinal) caret = stepCaret(doc, caret, previous);
      }
      const point = map.point(caret),
        head = { block: ordinal, position: caret, byte: point.byte, within: point.within };
      selectDocument({ kind: "range", anchor, head });
      await navigate(ordinal, true, revision, undefined, 1, undefined, {
        byte: point.byte,
        within: point.within,
        bias: end ? "before" : "after",
        column,
      });
    } catch (e) {
      verticalQueue.current = [];
      if (mounted.current) setError(messageOf(e));
    } finally {
      if (vertical) {
        verticalMoving.current = false;
        scheduleVertical();
      }
    }
  };
  /** Shift+arrow/Home/End past the mounted window extends a document range selection. */
  const extendSelectionKey = (event: React.KeyboardEvent) => {
    const editor = editorRef.current,
      state = active.current;
    if (!event.shiftKey || !editor || !state || selectionRunning.current) return false;
    const selected = editor.state.selection;
    const extreme = (event.ctrlKey || event.metaKey) && (event.key === "Home" || event.key === "End");
    const vertical =
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      selected instanceof TextSelection &&
      (event.key === "ArrowUp" || event.key === "ArrowDown");
    const { previous, next } = windowEdgeKeys(event.key, editor, state, selected, vertical);
    if (!extreme && !previous && !next) return false;
    event.preventDefault();
    event.stopPropagation();
    const anchor = rangeAnchor(state, selected.anchor);
    const target = extensionTarget(event.key, extreme, previous, state.offset, total.current, edited.current.count);
    const end = previous || (extreme && event.key === "End"),
      ticket = selectionSequence.current;
    let cursor: number | undefined;
    if (!extreme && state.segment)
      cursor = state.byteStart! + (previous ? 0 : new TextEncoder().encode(edited.current.raw).length);
    const origin = mountedPoint(state, selected.head);
    if (vertical) verticalColumn.current ??= editor.view.coordsAtPos(selected.head).left;
    const column = vertical ? verticalColumn.current : undefined;
    const originalDoc = editor.state.doc;
    if (vertical) verticalMoving.current = true;
    void extendAcrossWindows({
      editor,
      state,
      selected,
      originalDoc,
      ticket,
      anchor,
      origin,
      target,
      end,
      previous,
      cursor,
      column,
      vertical,
    });
    return true;
  };
  /** Collapse a document range to one edge and mount the window holding that edge. */
  const collapseDocumentSelection = (selection: DocumentSelection, end: boolean) => {
    selectDocument(null);
    if (selection.kind === "all")
      void navigate(end ? Math.max(0, total.current - 1) : 0, true, undefined, end ? "end" : "start", 1);
    else {
      const point = collapsedPoint(selection, end);
      void navigate(point.block, true, undefined, undefined, 1, undefined, {
        byte: point.byte,
        within: point.within,
        position: point.position,
        bias: end ? "after" : "before",
      });
    }
  };
  const documentSelectionKey = (event: React.KeyboardEvent) => {
    const selection = documentSelected.current;
    if (!selection) return false;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ["c", "x"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      void operateSelection(key === "c" ? "copy" : "cut");
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      void operateSelection({ kind: "delete" });
      return true;
    }
    if (!event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      collapseDocumentSelection(selection, event.key === "ArrowRight");
      return true;
    }
    if (!event.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
      selectDocument(null);
    return false;
  };
  const historyKey = (event: React.KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !(event.target as HTMLElement).closest(".tiptap-prose"))
      return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    event.stopPropagation();
    applyHistory(key === "y" || event.shiftKey ? "redo" : "undo");
  };
  const windowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") mouseSelection.current = undefined;
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if (!(event.target as HTMLElement).closest(".tiptap-prose")) return;
    const verticalKey =
      !event.ctrlKey && !event.metaKey && !event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key);
    if (queueVerticalKey(event, verticalKey)) return;
    if (!verticalKey && !["Shift", "Control", "Meta", "Alt"].includes(event.key)) resetVertical();
    if (verticalKey && !verticalOrigin.current && editorRef.current && active.current)
      verticalOrigin.current = mountedPoint(active.current, editorRef.current.state.selection.head);
    if (
      queueBoundaryKey(event) ||
      compositionKey(event) ||
      selectionShortcutKey(event) ||
      extendSelectionKey(event) ||
      documentSelectionKey(event)
    )
      return;
    historyKey(event);
  };
  const boundaryColumn = (vertical: boolean) => {
    const editor = editorRef.current;
    if (!vertical || !editor) return undefined;
    verticalColumn.current ??= editor.view.coordsAtPos(editor.state.selection.head).left;
    return verticalColumn.current;
  };
  const moveToBoundary = (vertical: boolean, ...args: Parameters<typeof navigate>) => {
    if (vertical) verticalMoving.current = true;
    void navigate(...args)
      .then((result) => {
        if (result !== true) verticalQueue.current = [];
      })
      .finally(() => {
        if (vertical) {
          verticalMoving.current = false;
          scheduleVertical();
        }
      });
  };
  /** Backspace/Delete at a window edge edits across the boundary. */
  const editAcrossBoundary = (direction: BoundaryDirection, current: WindowState) => {
    if (direction === "backward" && current.offset === 0 && !current.segment?.ordinal) return false;
    if (
      direction === "forward" &&
      current.offset + edited.current.count >= total.current &&
      (!current.segment || current.segment.ordinal + 1 >= (current.segmentTotal ?? 1))
    )
      return false;
    operateBoundary(direction);
    return true;
  };
  const crossSegmentBoundary = (
    current: WindowState,
    segment: DocumentSegment,
    backwards: boolean,
    vertical: boolean,
    column: number | undefined,
  ) => {
    if (backwards && current.offset === 0 && segment.ordinal === 0) return false;
    if (
      !backwards &&
      current.offset + edited.current.count >= total.current &&
      segment.ordinal + 1 >= (current.segmentTotal ?? 1)
    )
      return false;
    const editor = editorRef.current!,
      origin = mountedPoint(current, editor.state.selection.head);
    const continuation = vertical && continuesInTextblock(editor);
    moveToBoundary(vertical, current.offset, true, undefined, backwards ? "end" : "start", 1, undefined, {
      edge: backwards ? "previous" : "next",
      column,
      vertical: continuation
        ? {
            origin,
            up: backwards,
            extend: false,
            freshColumn: verticalOrigin.current?.byte === origin.byte,
            ticket: verticalSequence.current,
          }
        : undefined,
    });
    return true;
  };
  const windowBoundaryTarget = (
    direction: "first" | "last" | "previous" | "next",
    current: WindowState,
  ): { offset: number; edge: Edge; size: number } | undefined => {
    if (direction === "first") return { offset: 0, edge: "start", size: WINDOW };
    if (direction === "last") return { offset: Math.max(0, total.current - WINDOW), edge: "end", size: WINDOW };
    if (direction === "previous") {
      if (current.offset === 0) return undefined;
      // End precisely before the current window, including a short first window.
      const offset = Math.max(0, current.offset - WINDOW);
      return { offset, edge: "end", size: current.offset - offset };
    }
    const offset = current.offset + edited.current.count;
    if (offset >= total.current) return undefined;
    return { offset, edge: "start", size: WINDOW };
  };
  const crossWindowBoundary = (
    direction: "first" | "last" | "previous" | "next",
    current: WindowState,
    vertical: boolean,
    column: number | undefined,
  ) => {
    // A mounted document edge needs only a synchronous selection.
    // Reloading here leaves the next keystroke at the old caret.
    if (direction === "first" && current.offset === 0 && !current.segment?.ordinal) return false;
    if (
      direction === "last" &&
      current.offset + edited.current.count === total.current &&
      (!current.segment || current.segment.ordinal + 1 === (current.segmentTotal ?? 1))
    )
      return false;
    const move = windowBoundaryTarget(direction, current);
    if (!move) return false;
    moveToBoundary(
      vertical,
      move.offset,
      true,
      undefined,
      move.edge,
      move.size,
      undefined,
      column === undefined ? undefined : { column },
    );
    return true;
  };
  const windowBoundary = (requested: EditorBoundary) => {
    if (isReadOnly() && (requested === "backward" || requested === "forward")) return true;
    if (locked.current || navigating.current) return true;
    const current = active.current;
    if (!current) return false;
    const vertical = requested === "up" || requested === "down";
    const column = boundaryColumn(vertical);
    const direction = BOUNDARY_DIRECTION[requested];
    if (direction === "backward" || direction === "forward") return editAcrossBoundary(direction, current);
    if (current.segment && (direction === "previous" || direction === "next"))
      return crossSegmentBoundary(current, current.segment, direction === "previous", vertical, column);
    return crossWindowBoundary(direction, current, vertical, column);
  };
  useEffect(() => {
    const jump = (event: Event) => {
      const request = (event as CustomEvent<AnchorRequest>).detail;
      if (request.note.id !== id || request.ordinal === undefined) return;
      request.accept((async () => {
        if (locked.current || navigating.current || !(await callbacks.current.flush()) || callbacks.current.readDraft()?.revision !== request.note.revision)
          throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
        if (!await navigate(request.ordinal!, true, request.note.revision, undefined, WINDOW, undefined, request.anchor.byteOffset===undefined?undefined:{byte:request.anchor.byteOffset}))
          throw new Error(t("현재 편집 화면에서 해당 위치로 이동하지 못했습니다."));
        if (request.anchor.text) {
          let occurrence=0;
          if(request.anchor.searchText){
            const bytes=new TextEncoder().encode(request.anchor.byteOffset===undefined?request.note.content.slice(0,request.anchor.sourceOffset):active.current!.source);
            const prefix=new TextDecoder().decode(request.anchor.byteOffset===undefined?bytes.slice(active.current!.byteStart??0):bytes.slice(0,Math.max(0,request.anchor.byteOffset-(active.current!.byteStart??0))));
            const template=document.createElement('template');template.innerHTML=prefix;const text=template.content.textContent??'';
            let at=0,next:number;while((next=text.indexOf(request.anchor.searchText,at))>=0){occurrence++;at=next+request.anchor.searchText.length;}
          }
          setFindTarget({ query: request.anchor.searchText??request.anchor.text, sensitive: true, occurrence, request: Date.now(), session: active.current!.session });
        }
      })());
    };
    window.addEventListener(ANCHOR_EVENT, jump);
    return () => window.removeEventListener(ANCHOR_EVENT, jump);
  });
  const space = geometry();
  return (
    <div className="windowed-editor" data-testid="windowed-rich-editor" onPointerDownCapture={resetVertical}>
      <div className="window-controls" aria-label={t("문서 구간 이동")}>
        <button
          className="btn btn-secondary"
          disabled={busy || !windowState || (windowState.offset === 0 && !windowState.segment?.ordinal)}
          onClick={() =>
            windowState!.segment
              ? void navigate(windowState!.offset, true, undefined, "end", 1, undefined, { edge: "previous" })
              : void navigate(Math.max(0, windowState!.offset - WINDOW), true)
          }
        >
          {t("이전 구간")}
        </button>
        <span>
          {windowState
            ? t("{from}–{to} / {total} 블록", {
                from: windowState.offset + 1,
                to: windowState.offset + edited.current.count,
                total: total.current,
              })
            : t("문서 준비 중…")}
        </span>
        <label>
          {t("블록 번호")}{" "}
          <input
            aria-label={t("이동할 블록 번호")}
            inputMode="numeric"
            value={jump}
            onChange={(e) => setJump(e.target.value)}
          />
        </label>
        <button
          className="btn btn-secondary"
          disabled={busy || !windowState}
          onClick={() => {
            const n = Number(jump);
            if (Number.isSafeInteger(n) && n >= 1 && n <= total.current) void navigate(n - 1, true);
          }}
        >
          {t("이동")}
        </button>
        <button
          className="btn btn-secondary"
          disabled={
            busy ||
            !windowState ||
            (windowState.offset + edited.current.count >= total.current &&
              (!windowState.segment || windowState.segment.ordinal + 1 >= (windowState.segmentTotal ?? 1)))
          }
          onClick={() =>
            windowState!.segment
              ? void navigate(windowState!.offset, true, undefined, "start", 1, undefined, { edge: "next" })
              : void navigate(windowState!.offset + edited.current.count, true)
          }
        >
          {t("다음 구간")}
        </button>
      </div>
      <DocumentCopy readDraft={readDraft} />
      <DocumentSearch
        id={id}
        readDraft={readDraft}
        flush={flush}
        reveal={async (ordinal, revision, query, sensitive) => {
          if (locked.current || navigating.current)
            throw new Error(t("현재 편집을 마친 뒤 검색 결과를 다시 선택해 주세요."));
          if (!(await callbacks.current.flush()) || callbacks.current.readDraft()?.revision !== revision)
            throw new Error(t("검색 후 문서가 변경되었습니다. 다시 검색해 주세요."));
          if (await navigate(ordinal, true, revision))
            setFindTarget({ query, sensitive, request: Date.now(), session: active.current!.session });
        }}
      />
      {error && (
        <div role="alert" className="window-error">
          {error}
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (composition.current) void commitComposition().finally(unlock);
              else if (failedBoundary.current) operateBoundary(failedBoundary.current, true);
              else
                void navigate(
                  attempted.current,
                  true,
                  undefined,
                  undefined,
                  WINDOW,
                  undefined,
                  attemptedTarget.current,
                );
            }}
          >
            {t("다시 시도")}
          </button>
        </div>
      )}
      {documentSelectedState && (
        <output className="document-selection-status">
          {documentSelectedState.kind === "all" ? t("문서 전체 선택됨") : t("화면 밖을 포함한 문서 범위 선택됨")}
          <button type="button" onClick={() => void cancelSelection()}>
            {t("선택 취소")}
          </button>
        </output>
      )}
      <div
        className="window-scroll"
        ref={scroll}
        onKeyDownCapture={windowKeyDown}
        onScroll={onScroll}
        onCompositionStartCapture={compositionStart}
        onCompositionEndCapture={(event) => compositionEnd(event.data)}
        onPointerDownCapture={(event) => {
          alignAfterMeasure.current = null;
          if (composition.current) {
            event.preventDefault();
            return;
          }
          const target = event.target as HTMLElement;
          mouseSelection.current = undefined;
          const editor = editorRef.current,
            state = active.current;
          if (
            event.button === 0 &&
            event.pointerType === "mouse" &&
            state &&
            editor &&
            !editor.isDestroyed &&
            target.closest(".tiptap-prose") &&
            !target.closest('button,input,a,img,[contenteditable="false"]')
          ) {
            const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (hit)
              mouseSelection.current = {
                pointer: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                anchor: event.shiftKey
                  ? rangeAnchor(state, editor.state.selection.anchor)
                  : mountedPoint(state, Selection.near(editor.state.doc.resolve(hit.pos)).head),
                window: state,
                crossed: false,
                released: false,
              };
          }
          // Removing the selection notice moves the checkbox between pointerdown
          // and pointerup, so the browser delivers click to the enclosing item.
          // Clear the selection when click already has its final target, before
          // the native checkbox change command reaches the document guard.
          if (target.closest(".tiptap-prose") && !event.shiftKey && !target.closest('input[type="checkbox"]'))
            selectDocument(null, { deferNotice: true, keepSelection: true });
          locked.current = true;
        }}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('.tiptap-prose input[type="checkbox"]')) selectDocument(null);
        }}
      >
        {windowState && (
          <>
            <div aria-hidden="true" style={{ height: space.before }} />
            <div
              ref={content}
              data-window-start={windowState.offset}
              data-segment-start={windowState.segment?.ordinal}
              data-segment-byte={windowState.segment?.byte_offset}
            >
              <RichEditor
                key={`${id}-${windowState.session}`}
                readOnly={readOnly}
                embedded
                internalWindow={Boolean(windowState.segment)}
                internalIdentity={Boolean(windowState.segment && contextIdentifiable(windowState.segment))}
                initialContent={windowState.html}
                findTarget={findTarget?.session === windowState.session ? findTarget : undefined}
                initialSelection={windowState.selection}
                initialProjection={windowState.projectedSelection}
                initialEdge={windowState.edge}
                initialColumn={windowState.column}
                verticalColumn={verticalColumn}
                initialVerticalStep={windowState.verticalStep}
                initialJoin={windowState.join}
                onEditor={(editor) => {
                  editorRef.current?.off("transaction", compositionTransaction);
                  editorRef.current = editor;
                  editorSession.current = editor ? windowState.session : undefined;
                  editor?.on("transaction", compositionTransaction);
                  // Restored histories may carry raw alias tags in their preview.
                  // Compare future edits with the actual canonical mounted model.
                  if (editor && active.current === windowState) edited.current.html = editor.getHTML();
                  if (editor) scheduleVertical();
                  if (editor && windowState.verticalStep)
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => {
                        if (
                          mounted.current &&
                          editorRef.current === editor &&
                          active.current === windowState &&
                          windowState.verticalStep?.ticket === verticalSequence.current
                        )
                          editor.view.dispatch(editor.state.tr.scrollIntoView().setMeta("addToHistory", false));
                      }),
                    );
                  if (editor && mouseSelection.current?.crossed)
                    requestAnimationFrame(() => {
                      if (mounted.current && editorRef.current === editor) {
                        updateMouseSelection();
                        editor.view.focus();
                      }
                    });
                }}
                documentSelection={
                  !composition.current && documentSelectedState && documentSelected.current
                    ? {
                        selection: documentSelected.current,
                        offset: windowState.offset,
                        source: windowState.byteStart === undefined ? undefined : windowSource(windowState),
                      }
                    : undefined
                }
                onDocumentBlockAction={documentBlockAction}
                onDocumentBlockDrag={documentBlockDrag}
                onDocumentTransaction={documentTransaction}
                onDocumentBlockFormat={(operation, execute) => {
                  // Provisional paste/IME already owns the insertion model. Let
                  // its native transaction replay record subsequent formatting.
                  if (!documentSelected.current || composition.current) return false;
                  if (execute) void operateSelection(operation);
                  return true;
                }}
                onDocumentPaste={(slice) => pendingPaste(slice)}
                onDocumentClipboard={(input) =>
                  pendingPaste({
                    input,
                    parse: (state, value) => nativeClipboardPaste(editorRef.current!.view, state, value),
                  })
                }
                onSelection={(selection) => {
                  if (composition.current) return;
                  if (selection.type === "all" && !documentSelected.current) selectDocument({ kind: "all" });
                  const draft = callbacks.current.readDraft();
                  const selected = documentSelected.current,
                    editor = editorRef.current;
                  const drag = mouseSelection.current;
                  if (drag && !drag.crossed && editor && drag.window === windowState)
                    drag.anchor = mountedPoint(windowState, editor.state.selection.anchor);
                  if (selected?.kind === "range" && editor && active.current === windowState)
                    selectDocument({
                      kind: "range",
                      anchor: selected.anchor,
                      head: mountedPoint(windowState, editor.state.selection.head),
                    });
                  if (mounted.current && draft?.id === id && active.current === windowState && !windowState.segment)
                    rememberLocation(id, {
                      revision: draft.revision,
                      kind: "windowed",
                      offset: windowState.offset,
                      selection,
                      documentSelection: documentSelected.current ?? undefined,
                    });
                  else if (windowState.segment) {
                    clearTimeout(locationTimer.current);
                    locationTimer.current = setTimeout(() => {
                      if (mounted.current && active.current === windowState && !projectionError.current) {
                        try {
                          rememberInternalLocation();
                        } catch (e) {
                          setError(messageOf(e));
                        }
                      }
                    }, 300);
                  }
                }}
                onBoundary={windowBoundary}
                history={{
                  canUndo: !busy && (Boolean(projectionError.current) || history.current.canUndo),
                  canRedo: !busy && history.current.canRedo,
                  undo: () => applyHistory("undo"),
                  redo: () => applyHistory("redo"),
                }}
                onChange={(html, _text, change) => {
                  if (isReadOnly()) return;
                  wrapCache.current = undefined;
                  const state = windowState;
                  if (composition.current) {
                    window.dispatchEvent(new Event("inkism-editor-pending"));
                    return;
                  }
                  if (!mounted.current || active.current !== state || callbacks.current.readDraft()?.id !== id) return;
                  const paged = callbacks.current.readDraft()?.paged;
                  const before = edited.current.raw;
                  let raw: string;
                  let identity: ReturnType<typeof contextIdentity> | undefined;
                  try {
                    // An internal window's enclosing block (outside the window)
                    // may have just received an identity: its opening tag is
                    // spliced on its own, the window projects as usual.
                    if (state.segment) identity = contextIdentity({ ...state.segment, source: before }, html);
                    raw = identity
                      ? projectSegment(identity.segment, html)
                      : projectWindowSource(before, edited.current.html, html);
                    if (identity?.tags.length) {
                      commitWindowIdentity(state, identity, before, raw, html, change);
                      return;
                    }
                  } catch (e) {
                    projectionError.current = messageOf(e);
                    setError(projectionError.current);
                    window.dispatchEvent(new Event("inkism-editor-pending"));
                    return;
                  }
                  if (paged)
                    callbacks.current.changeRange({ start: state.byteStart!, expected: before, replacement: raw });
                  const preview = (value: string, source: string, count: number) => {
                    const internal = state.segment
                      ? {
                          ...state.segment,
                          byte_count: new TextEncoder().encode(source).length,
                          total: state.segmentTotal!,
                        }
                      : undefined;
                    if (internal) {
                      const { source: _, ...context } = internal;
                      return { html: value, count, internal: context };
                    }
                    return { html: value, count };
                  };
                  history.current.record({
                    from: paged ? state.byteStart! : state.from,
                    offset: state.offset,
                    before,
                    after: raw,
                    beforeCount: edited.current.count,
                    afterCount: change.count,
                    beforeSelection: change.beforeSelection,
                    beforePreview: state.segment
                      ? preview(edited.current.html, before, edited.current.count)
                      : undefined,
                    afterPreview: state.segment ? preview(html, raw, change.count) : undefined,
                    afterSelection: change.afterSelection,
                    session: state.session,
                    group: change.group,
                    time: Date.now(),
                  });
                  total.current += change.count - edited.current.count;
                  heights.current.resize(total.current, state.offset);
                  edited.current = { html, raw, count: change.count };
                  projectionError.current = null;
                  setError(null);
                  retainHistory();
                  refreshHistory();
                  if (!paged)
                    callbacks.current.change(
                      state.source.slice(0, state.from) + raw + state.source.slice(state.to),
                      state.byteStart === undefined
                        ? undefined
                        : {
                            source: state.source,
                            from: state.from,
                            to: state.to,
                            byteStart: state.byteStart,
                            html: raw,
                          },
                    );
                }}
              />
            </div>
            <div aria-hidden="true" style={{ height: space.after }} />
          </>
        )}
      </div>
    </div>
  );
}
