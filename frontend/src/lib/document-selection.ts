import { elementFromString, getSchema } from "@tiptap/core";
import { replayPendingSelection, type PendingSelectionOperation } from "./pending-selection";
import { DOMParser, Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { toggleMark } from "@tiptap/pm/commands";
import { contentExtensions } from "../extensions/content-schema";
import { identifyTouchedBlocks } from "../extensions/block-identity";
import { cloneSliceIdentity } from "./block-identity";
import { sanitizeRichHtml } from "./sanitize";
import type { DocumentSegment, DocumentSegmentPage } from "../types";
import type { WindowPreview } from "./window-history";
import type { BodySplice } from "./body-splice";
import { projectSegment, inspectSegment, contextIdentity, rebaseSegmentIdentity } from "./rich-segment";
import { segmentPositionMap } from "./segment-selection";
import {
  SegmentModelBuilder,
  serializeModel,
  serializeModelMappedWork,
  previewSegment,
  modelSourceSegments,
} from "./segment-model";
import { previewSelectionRegion, previewSourceRegionWork } from "./selection-preview";
import { projectModelSegmentWork, parseBoundedRichSliceWork, type SourcePoint } from "./segment-projection";
import { finishEditWork, scheduleEditWork, type EditWorkStep } from "./edit-work";
import { nativeBlockFormat, type BlockFormatOperation } from "./native-block-format";
import { formatBlocksInWorker, type BlockTransform } from "./native-block-client";
import { t } from "../i18n";
export type { BlockFormatOperation } from "./native-block-format";

/** Position within a top-level block, including its opening token (text starts at 1).
 * The ordinal never depends on which window happens to be mounted. */
export interface DocumentPoint {
  block: number;
  position: number;
  byte?: number;
  within?: number;
}
export type DocumentSelection = { kind: "all" } | { kind: "range"; anchor: DocumentPoint; head: DocumentPoint };
export interface SelectionBlock {
  ordinal: number;
  byte_offset: number;
  html: string;
}
export interface SelectionPage {
  blocks: SelectionBlock[];
  next_offset: number | null;
  total_blocks?: number | null;
  ready: boolean;
  oversized_block?: boolean;
}
export interface SelectionSource {
  read(offset: number, limit: number): Promise<SelectionPage>;
  segments?(ordinal: number, offset: number, limit: number): Promise<DocumentSegmentPage>;
  locate?(
    byte: number,
    bias?: "before" | "after",
  ): Promise<{ ready: boolean; ordinal: number; offset?: number; supported?: boolean }>;
  /** Must reject revision/draft changes, cancellation, unmount and note switches. */
  check(): void;
}
const schema = getSchema(contentExtensions());
const parser = DOMParser.fromSchema(schema);
const encoder = new TextEncoder();
const serializeBlocks = serializeModel;
function previewWindow(raw: string, start: number, region?: DocumentSegment, total?: number): WindowPreview {
  const segment = region?.start_context.length
    ? modelSourceSegments(raw, start, region.start_context).next().value
    : previewSegment(raw, start);
  if (!segment) throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  if (region) segment.ordinal = region.ordinal;
  const inspected = inspectSegment(segment);
  if (!inspected.editable) throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  const { source, ...context } = segment;
  return {
    html: inspected.content,
    count: inspected.blocks,
    raw: source,
    byteStart: start,
    internal:
      segment.start_context.length || segment.end_context.length
        ? {
            ...context,
            total: Math.max(
              segment.ordinal + 1 + (segment.end_context.length ? 1 : 0),
              total ?? 0,
              Math.ceil(encoder.encode(raw).length / 16384),
            ),
          }
        : undefined,
  };
}

export function comparePoints(a: DocumentPoint, b: DocumentPoint) {
  return (
    a.block - b.block ||
    (a.byte !== undefined && b.byte !== undefined
      ? a.byte - b.byte || (a.within ?? 0) - (b.within ?? 0)
      : a.position - b.position)
  );
}
export function selectionBlockSize(html: string) {
  const doc = parser.parse(elementFromString(sanitizeRichHtml(html)), { preserveWhitespace: "full" });
  if (doc.childCount !== 1) throw new Error("Selection block cannot be represented safely");
  return doc.firstChild!.nodeSize;
}
function validPoint(point: DocumentPoint) {
  if (
    !Number.isSafeInteger(point.block) ||
    point.block < 0 ||
    !Number.isSafeInteger(point.position) ||
    point.position < 0
  )
    throw new Error("Invalid document selection position");
  if (
    (point.byte === undefined) !== (point.within === undefined) ||
    (point.byte !== undefined &&
      (!Number.isSafeInteger(point.byte) || point.byte < 0 || !Number.isSafeInteger(point.within) || point.within! < 0))
  )
    throw new Error("Invalid source selection position");
}
/** Capture immutable endpoints before asynchronous reads. */
export function selectionSnapshot(selection: DocumentSelection): DocumentSelection {
  if (selection.kind === "all") return { kind: "all" };
  validPoint(selection.anchor);
  validPoint(selection.head);
  return { kind: "range", anchor: { ...selection.anchor }, head: { ...selection.head } };
}
/** Convert a mounted ProseMirror position to a stable document endpoint. */
export function documentPoint(doc: PMNode, windowOffset: number, position: number): DocumentPoint {
  if (!Number.isSafeInteger(position) || position < 0 || position > doc.content.size || !doc.childCount)
    throw new Error("Invalid mounted selection position");
  let start = 0;
  for (let index = 0; index < doc.childCount; index++) {
    const size = doc.child(index).nodeSize;
    if (position < start + size || index === doc.childCount - 1)
      return { block: windowOffset + index, position: position - start };
    start += size;
  }
  throw new Error("Selection block not found");
}
/** Project global endpoints onto just the mounted window (no extra DOM). */
export function windowSelection(
  doc: PMNode,
  windowOffset: number,
  selection: DocumentSelection,
  source?: DocumentSegment,
) {
  if (selection.kind === "all") return new AllSelection(doc);
  const mapping = source ? segmentPositionMap(source) : undefined;
  const local = (point: DocumentPoint) => {
    if (mapping && point.byte !== undefined) return mapping.position(point.byte, point.within);
    if (point.block < windowOffset) return 0;
    if (point.block >= windowOffset + doc.childCount) return doc.content.size;
    let position = 0;
    for (let i = 0; i < point.block - windowOffset; i++) position += doc.child(i).nodeSize;
    const node = doc.child(point.block - windowOffset);
    if (point.position > node.nodeSize) throw new Error("Selection is stale");
    return position + point.position;
  };
  const first = comparePoints(selection.anchor, selection.head) <= 0 ? selection.anchor : selection.head;
  const last = first === selection.anchor ? selection.head : selection.anchor;
  if (last.block < windowOffset || first.block >= windowOffset + doc.childCount) return null;
  return TextSelection.between(doc.resolve(local(selection.anchor)), doc.resolve(local(selection.head)));
}

interface SelectionFragment {
  segment: DocumentSegment;
  shift: number;
  from: number;
  to: number;
}
export interface PreparedSelection {
  byteStart: number;
  before: string;
  state: EditorState;
  blockOffset: number;
  blockCount: number;
  preview: string;
  previewCount: number;
  previewWindow: WindowPreview;
  fragments: SelectionFragment[];
  region: DocumentSegment;
  segmentTotal?: number;
  previewSelection: Record<string, unknown>;
  check(): void;
}
const UNSUPPORTED_SELECTION = t(
  "선택 범위에 그대로 보존할 수 없거나 너무 큰 서식이 있습니다. HTML 원문 모드에서 편집해 주세요.",
);
async function waitReady<T extends { ready: boolean }>(
  source: SelectionSource,
  deadline: number,
  read: () => Promise<T>,
) {
  source.check();
  let value = await read();
  while (!value.ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    source.check();
    value = await read();
  }
  source.check();
  if (!value.ready) throw new Error("Selection blocks are not ready");
  return value;
}
function byteForward(anchor: DocumentPoint, head: DocumentPoint) {
  if (anchor.byte === undefined || head.byte === undefined) return false;
  return anchor.byte < head.byte || (anchor.byte === head.byte && anchor.within! <= head.within!);
}
function invalidLocation(found: { ordinal: number; offset?: number; supported?: boolean }) {
  return (
    found.supported === false ||
    !Number.isSafeInteger(found.ordinal) ||
    found.ordinal < 0 ||
    (found.offset !== undefined && (!Number.isSafeInteger(found.offset) || found.offset < 0))
  );
}
/** Move byte endpoints onto their located blocks; returns segment offsets inside those blocks. */
async function locateInnerBounds(selection: DocumentSelection, source: SelectionSource, deadline: number) {
  const innerBounds = new Map<DocumentPoint, number>();
  if (selection.kind !== "range" || !source.locate) return innerBounds;
  const before = byteForward(selection.anchor, selection.head) ? selection.anchor : selection.head;
  for (const point of [selection.anchor, selection.head]) {
    if (point.byte === undefined) continue;
    const byte = point.byte;
    const found = await waitReady(source, deadline, () => source.locate!(byte, point === before ? "before" : "after"));
    if (invalidLocation(found)) throw new Error("Invalid selection source location");
    point.block = found.ordinal;
    if (found.offset !== undefined) innerBounds.set(point, found.offset);
  }
  return innerBounds;
}
function selectionEnds(selection: DocumentSelection) {
  if (selection.kind === "all") return { first: null, last: null };
  if (comparePoints(selection.anchor, selection.head) <= 0) return { first: selection.anchor, last: selection.head };
  return { first: selection.head, last: selection.anchor };
}
function pageBlocks(page: SelectionPage, offset: number) {
  if (page.oversized_block && page.blocks.length) throw new Error("Unbounded selection block response");
  const blocks = page.oversized_block ? [{ ordinal: offset, byte_offset: 0, html: "" }] : page.blocks;
  if (!blocks.length) throw new Error("Selection is stale");
  return blocks;
}
function pageDone(page: SelectionPage, offset: number, last: DocumentPoint | null, total: number | null | undefined) {
  if (last && offset > last.block) return true;
  if (page.oversized_block) return total !== undefined && total !== null && offset >= total;
  if (page.next_offset === null) {
    if (last) throw new Error("Selection extends beyond the document");
    return true;
  }
  if (page.next_offset !== offset) throw new Error("Invalid selection page cursor");
  return false;
}
function checkInnerPage(
  inner: DocumentSegmentPage,
  offset: number,
  limit: number,
  innerTotal: number | undefined,
  bounds: { initial: number; final?: number },
) {
  if (
    !inner.supported ||
    inner.ordinal !== offset ||
    !inner.segments.length ||
    inner.segments.length > limit ||
    inner.total_segments === null ||
    (innerTotal !== undefined && inner.total_segments !== innerTotal)
  )
    throw new Error(t("선택 범위의 내부 서식을 보존하지 못했습니다."));
  const total = inner.total_segments;
  if (bounds.initial >= total || (bounds.final !== undefined && bounds.final >= total))
    throw new Error("Invalid selection segment bounds");
  return total;
}
function checkSegment(
  segment: DocumentSegment,
  innerOffset: number,
  innerTotal: number,
  initial: number,
  prior: DocumentSegment | undefined,
) {
  if (segment.ordinal !== innerOffset || innerOffset >= innerTotal || encoder.encode(segment.source).length > 32768)
    throw new Error("Invalid selection segment order or size");
  if (!prior && (initial === 0 ? segment.start_context.length : !segment.start_context.length))
    throw new Error("Incomplete initial selection context");
  if (prior && JSON.stringify(prior.end_context) !== JSON.stringify(segment.start_context))
    throw new Error("Invalid selection segment context");
}
/** Whether the requested final segment was reached (validating the cursor there). */
function finalSegmentReached(
  next: number | null,
  innerOffset: number,
  innerTotal: number,
  final: number | undefined,
  prior: DocumentSegment | undefined,
) {
  if (final === undefined || innerOffset !== final + 1) return false;
  if (innerOffset < innerTotal && !prior?.end_context.length) throw new Error("Incomplete final selection context");
  if (next !== null && next !== innerOffset) throw new Error("Invalid selection segment cursor");
  if (next === null && innerOffset !== innerTotal) throw new Error("Incomplete selection segments");
  return true;
}
function segmentsDone(
  next: number | null,
  innerOffset: number,
  innerTotal: number,
  final: number | undefined,
  prior: DocumentSegment | undefined,
) {
  if (innerOffset === innerTotal && (next !== null || prior?.end_context.length))
    throw new Error("Incomplete selection segments");
  if (finalSegmentReached(next, innerOffset, innerTotal, final, prior)) return true;
  if (next === null) {
    if (innerTotal !== innerOffset || prior?.end_context.length) throw new Error("Incomplete selection segments");
    return true;
  }
  if (next !== innerOffset) throw new Error("Invalid selection segment cursor");
  return false;
}
function selectionPosition(point: DocumentPoint, entries: SelectionFragment[], doc: PMNode, modelSize: number) {
  if (point.byte === undefined) {
    if (point.position > doc.firstChild!.nodeSize) throw new Error("Selection is stale");
    return modelSize + point.position;
  }
  const byte = point.byte;
  const entry = entries.find(
    (e) => byte >= e.segment.byte_offset && byte <= e.segment.byte_offset + encoder.encode(e.segment.source).length,
  );
  if (!entry) throw new Error("Selection source cursor is stale");
  return entry.shift + segmentPositionMap(entry.segment, schema).position(byte, point.within);
}
interface BlockRead {
  doc: PMNode | undefined;
  entries: SelectionFragment[];
  raw: string[];
}
/** Accumulates contiguous selection blocks into one bounded model. */
class SelectionCollector {
  byteStart = -1;
  byteEnd = -1;
  bytes = 0;
  modelSize = 0;
  anchor = 0;
  head = 0;
  segmentTotal: number | undefined;
  readonly nodes: PMNode[] = [];
  readonly original: string[] = [];
  readonly fragments: SelectionFragment[] = [];
  private yieldAt = performance.now() + 8;
  constructor(
    private readonly source: SelectionSource,
    private readonly deadline: number,
  ) {}
  ready<T extends { ready: boolean }>(read: () => Promise<T>) {
    return waitReady(this.source, this.deadline, read);
  }
  async pause() {
    if (performance.now() >= this.yieldAt) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.source.check();
      this.yieldAt = performance.now() + 8;
    }
  }
  admit(segment: DocumentSegment, shift: number) {
    this.source.check();
    const length = encoder.encode(segment.source).length;
    if (this.byteStart < 0) this.byteStart = segment.byte_offset;
    if (this.byteEnd >= 0 && segment.byte_offset !== this.byteEnd) throw new Error("Noncontiguous selection blocks");
    this.byteEnd = segment.byte_offset + length;
    this.bytes += length;
    if (this.bytes > 20 * 1024 * 1024) throw new Error("Selected content exceeds 20 MiB");
    if (!inspectSegment(segment).editable) throw new Error(UNSUPPORTED_SELECTION);
    const mapping = segmentPositionMap(segment, schema),
      doc = mapping.doc();
    const entry = {
      segment,
      shift,
      from: shift + mapping.position(segment.byte_offset),
      to: shift + mapping.position(this.byteEnd),
    };
    return { mapping, doc, entry };
  }
  readPlain(block: SelectionBlock): BlockRead {
    if (encoder.encode(block.html).length > 512 * 1024) throw new Error("Selection block exceeds admission bound");
    const admitted = this.admit(
      { ordinal: 0, byte_offset: block.byte_offset, source: block.html, start_context: [], end_context: [] },
      this.modelSize,
    );
    return { doc: admitted.doc, entries: [admitted.entry], raw: [block.html] };
  }
  async readOversized(offset: number, bounds: { initial: number; final?: number }, first: boolean): Promise<BlockRead> {
    const builder = new SegmentModelBuilder();
    if (!this.source.segments) throw new Error(UNSUPPORTED_SELECTION);
    const { initial, final } = bounds;
    const entries: SelectionFragment[] = [],
      raw: string[] = [];
    let innerOffset = initial,
      innerTotal: number | undefined,
      prior: DocumentSegment | undefined;
    for (;;) {
      const limit = final === undefined ? 8 : Math.min(8, final - innerOffset + 1);
      if (limit < 1) throw new Error("Invalid selection segment bounds");
      const inner = await this.ready(() => this.source.segments!(offset, innerOffset, limit));
      innerTotal = checkInnerPage(inner, offset, limit, innerTotal, bounds);
      if (first) this.segmentTotal = innerTotal;
      for (const segment of inner.segments) {
        checkSegment(segment, innerOffset, innerTotal, initial, prior);
        const admitted = this.admit(segment, this.modelSize);
        // ponytail: one carry run is synchronous; schedule within it if its latency becomes material.
        const shift = finishEditWork(builder.append(admitted.doc, segment.start_context));
        admitted.entry.shift += shift;
        admitted.entry.from += shift;
        admitted.entry.to += shift;
        entries.push(admitted.entry);
        raw.push(segment.source);
        prior = segment;
        innerOffset++;
        await this.pause();
      }
      if (segmentsDone(inner.next_offset, innerOffset, innerTotal, final, prior)) break;
    }
    return { doc: await scheduleEditWork(builder.finish(), this.source.check), entries, raw };
  }
  add(selection: DocumentSelection, offset: number, { doc, entries, raw }: BlockRead) {
    if (doc?.childCount !== 1) throw new Error("Selection block cannot be represented safely");
    if (selection.kind === "range") {
      if (selection.anchor.block === offset)
        this.anchor = selectionPosition(selection.anchor, entries, doc, this.modelSize);
      if (selection.head.block === offset) this.head = selectionPosition(selection.head, entries, doc, this.modelSize);
    }
    this.nodes.push(doc.firstChild!);
    this.original.push(raw.join(""));
    this.fragments.push(...entries);
    this.modelSize += doc.content.size;
  }
}
function innerBlockBounds(
  bounded: boolean,
  innerBounds: Map<DocumentPoint, number>,
  offset: number,
  first: DocumentPoint | null,
  last: DocumentPoint | null,
) {
  return {
    initial: bounded && offset === first!.block ? innerBounds.get(first!)! : 0,
    final: bounded && offset === last!.block ? innerBounds.get(last!)! : undefined,
  };
}
function checkBlockOrder(block: SelectionBlock, offset: number, last: DocumentPoint | null) {
  if (block.ordinal !== offset || (last && offset > last.block)) throw new Error("Invalid selection block order");
}
/** Parse only bounded source pieces, then join immutable model ancestors. */
export async function prepareSelection(
  input: DocumentSelection,
  source: SelectionSource,
  options: { completeBlocks?: boolean } = {},
): Promise<PreparedSelection> {
  const selection = selectionSnapshot(input),
    deadline = Date.now() + 60000;
  const innerBounds = await locateInnerBounds(selection, source, deadline);
  const { first, last } = selectionEnds(selection);
  // Changing a textblock's type also changes its opening/closing tags. A
  // truncated internal piece cannot represent those edits safely.
  const bounded = !options.completeBlocks && !!first && !!last && innerBounds.has(first) && innerBounds.has(last);
  const blockBounds = (offset: number) => innerBlockBounds(bounded, innerBounds, offset, first, last);
  const firstBlock = first?.block ?? 0;
  const collector = new SelectionCollector(source, deadline);
  let offset = firstBlock,
    total: number | null | undefined;
  for (;;) {
    source.check();
    const page = await collector.ready(() => source.read(offset, Math.min(32, last ? last.block - offset + 1 : 32)));
    if (total !== undefined && total !== page.total_blocks) throw new Error("Selection is stale");
    total = page.total_blocks;
    for (const block of pageBlocks(page, offset)) {
      checkBlockOrder(block, offset, last);
      const read = page.oversized_block
        ? await collector.readOversized(offset, blockBounds(offset), offset === firstBlock)
        : collector.readPlain(block);
      collector.add(selection, offset, read);
      offset++;
      await collector.pause();
    }
    if (pageDone(page, offset, last, total)) break;
  }
  source.check();
  const { nodes, original, fragments, byteStart, segmentTotal } = collector;
  const doc = schema.topNodeType.create(null, Fragment.fromArray(nodes));
  const selected =
    selection.kind === "all"
      ? new AllSelection(doc)
      : TextSelection.between(doc.resolve(collector.anchor), doc.resolve(collector.head));
  const before = original.join(""),
    region: DocumentSegment = {
      ...fragments[0].segment,
      source: before,
      end_context: fragments.at(-1)!.segment.end_context,
    };
  const nearby = previewSelectionRegion(region, selected.toJSON(), schema, firstBlock, segmentTotal);
  const preview = nearby?.window ?? previewWindow(before, byteStart, region, segmentTotal);
  return {
    byteStart,
    before,
    state: EditorState.create({ doc, selection: selected }),
    blockOffset: firstBlock,
    blockCount: nodes.length,
    preview: preview.html,
    previewCount: preview.count,
    previewWindow: preview,
    fragments,
    region,
    segmentTotal,
    previewSelection: nearby?.selection ?? selected.toJSON(),
    check: source.check,
  };
}
export function selectionClipboard(prepared: PreparedSelection) {
  prepared.check();
  const fragment = prepared.state.selection.content().content;
  return { html: serializeBlocks(fragment), text: fragment.textBetween(0, fragment.size, "\n\n", "\ufffc") };
}
export type SelectionOperation =
  | { kind: "delete" }
  | { kind: "text"; text: string }
  | { kind: "paste"; html: string }
  | { kind: "slice"; slice: ReturnType<Slice["toJSON"]>; cursor?: { anchorOffset: number; headOffset: number } }
  | PendingSelectionOperation
  | BlockFormatOperation
  | { kind: "mark"; mark: "bold" | "italic" | "underline" | "strike" | "highlight" | "code" };
/** Preserve the provisional native caret relative to the fitted insertion,
 * whose absolute position can differ between a preview and the full model. */
export function capturedSelectionSlice(
  before: EditorState,
  current: EditorState,
  from: number,
  to: number,
): Extract<SelectionOperation, { kind: "slice" }> {
  if (!(current.selection instanceof TextSelection) || current.selection.from < from || current.selection.to > to)
    throw new Error(t("입력 범위 밖의 선택을 반영하지 못했습니다. 입력과 원문을 유지합니다."));
  const slice = current.doc.slice(from, to),
    head = before.tr.replaceSelection(slice).selection.head;
  return {
    kind: "slice",
    slice: slice.toJSON(),
    cursor: { anchorOffset: current.selection.anchor - head, headOffset: current.selection.head - head },
  };
}
function replaceSelectionSlice(tr: Transaction, operation: Extract<SelectionOperation, { kind: "slice" }>) {
  tr.replaceSelection(Slice.fromJSON(tr.doc.type.schema, operation.slice));
  if (operation.cursor) {
    const head = tr.selection.head;
    tr.setSelection(
      TextSelection.between(
        tr.doc.resolve(head + operation.cursor.anchorOffset),
        tr.doc.resolve(head + operation.cursor.headOffset),
      ),
    );
  }
}
/** Return an exact expected range plus a replacement; callers commit through the
 * normal guarded splice queue and record one range undo entry. No writes here. */
export function changeSelection(prepared: PreparedSelection, operation: SelectionOperation) {
  return finishEditWork(changeSelectionWork(prepared, operation));
}
export function changeSelectionAsync(
  prepared: PreparedSelection,
  operation: SelectionOperation,
  check = prepared.check,
) {
  return scheduleEditWork(changeSelectionWork(prepared, operation), () => {
    prepared.check();
    check();
  });
}
/** Compute the format once, then replay the latest provisional input against
 * its full-document selection. Projection retries never repeat the worker. */
export async function changeBlockSelectionAsync(
  prepared: PreparedSelection,
  operation: BlockFormatOperation,
  following: () => Promise<{ operation?: SelectionOperation; current: () => boolean }>,
) {
  prepared.check();
  if (prepared.region.start_context.length || prepared.region.end_context.length)
    throw new Error(t("문단 전체를 준비하지 못해 서식 변경을 중단했습니다. 원문을 유지합니다."));
  const state = prepared.state;
  const transform =
    state.doc.content.size > 64 * 1024 || state.doc.childCount > 128
      ? await formatBlocksInWorker(state, operation, prepared.check)
      : nativeBlockFormat(state, operation);
  const deadline = Date.now() + 60000,
    retry = {};
  for (;;) {
    prepared.check();
    const next = await following();
    try {
      return await scheduleEditWork(
        changeSelectionWork(prepared, operation, { transform, following: next.operation }),
        () => {
          prepared.check();
          if (Date.now() > deadline)
            throw new Error(
              t("계속 입력 중이어서 반영을 중단했습니다. 입력과 원문을 유지합니다. 잠시 후 다시 시도해 주세요."),
            );
          if (!next.current()) throw retry;
        },
      );
    } catch (error) {
      if (error !== retry) throw error;
    }
  }
}
function operationSize(operation: SelectionOperation) {
  if (operation.kind === "text") return encoder.encode(operation.text).length;
  if (operation.kind === "paste") return encoder.encode(operation.html).length;
  return 0;
}
type BlockOperation = Extract<SelectionOperation, { kind: "block" }>;
function* applyBlockOperation(
  prepared: PreparedSelection,
  operation: BlockOperation,
  block: { transform: BlockTransform } | undefined,
) {
  if (prepared.region.start_context.length || prepared.region.end_context.length)
    throw new Error(t("문단 전체를 준비하지 못해 서식 변경을 중단했습니다. 원문을 유지합니다."));
  const state = prepared.state;
  let tr = state.tr;
  let workerTransform: BlockTransform | undefined;
  if (block) workerTransform = block.transform;
  else if (state.doc.content.size > 64 * 1024 || state.doc.childCount > 128) {
    yield {
      runSync: () => {
        tr = nativeBlockFormat(state, operation);
      },
      runAsync: async (check: () => void) => {
        workerTransform = await formatBlocksInWorker(state, operation, check);
      },
    };
  } else tr = nativeBlockFormat(state, operation);
  return workerTransform ?? tr;
}
function applyMark(state: EditorState, name: Extract<SelectionOperation, { kind: "mark" }>["mark"]) {
  const mark = schema.marks[name];
  let tr = state.tr;
  if (
    !mark ||
    !toggleMark(mark)(state, (transaction) => {
      tr = transaction;
    })
  )
    throw new Error("Selection does not support this format");
  return tr;
}
function* applyOperation(
  prepared: PreparedSelection,
  operation: SelectionOperation,
  block: { transform: BlockTransform } | undefined,
  operationBytes: number,
): Generator<EditWorkStep, BlockTransform, unknown> {
  const state = prepared.state;
  const tr = state.tr;
  if (operation.kind === "delete") tr.deleteSelection();
  else if (operation.kind === "text") tr.insertText(operation.text);
  else if (operation.kind === "slice") replaceSelectionSlice(tr, operation);
  else if (operation.kind === "replay") return replayPendingSelection(state, operation);
  else if (operation.kind === "paste") {
    const slice =
      (operationBytes > 64 * 1024 ? yield* parseBoundedRichSliceWork(operation.html, state.schema) : null) ??
      parser.parseSlice(elementFromString(sanitizeRichHtml(operation.html)), { preserveWhitespace: "full" });
    // Pasted blocks are copies: like the editor's paste, they never keep a
    // source identity (duplicates), and receive new ones as touched blocks.
    tr.replaceSelection(slice.size ? cloneSliceIdentity(slice) : Slice.empty);
  } else if (operation.kind === "block") return yield* applyBlockOperation(prepared, operation, block);
  else return applyMark(state, operation.mark);
  return tr;
}
function applyFollowing(state: EditorState, transformed: BlockTransform, following: SelectionOperation) {
  const formatted = EditorState.create({
    schema: state.schema,
    doc: transformed.doc,
    selection: transformed.selection,
    storedMarks: state.storedMarks,
  });
  let input = formatted.tr;
  if (following.kind === "replay") input = replayPendingSelection(formatted, following);
  else if (following.kind === "slice") replaceSelectionSlice(input, following);
  else throw new Error(t("후속 입력을 보존할 수 없습니다. 입력과 원문을 유지합니다."));
  const mapping = transformed.mapping.slice();
  mapping.appendMapping(input.mapping);
  return { doc: input.doc, selection: input.selection, mapping };
}
function fragmentRange(prepared: PreparedSelection, operation: SelectionOperation, from: number, to: number) {
  const first = operation.kind === "block" ? 0 : prepared.fragments.findIndex((e) => e.to >= from);
  let last = prepared.fragments.length - 1;
  if (operation.kind !== "block") while (last >= 0 && prepared.fragments[last].from > to) last--;
  if (first < 0 || last < first) throw new Error("Selection source bounds are stale");
  return { first, last };
}
function unchangedPoints(prepared: PreparedSelection, transformed: BlockTransform) {
  return [transformed.selection.anchor, transformed.selection.head].map((pos) => {
    const entry = prepared.fragments.find((entry) => entry.from <= pos && entry.to >= pos);
    if (!entry) throw new Error("Unchanged selection cursor is outside its source");
    return segmentPositionMap(entry.segment, schema).point(pos - entry.shift);
  });
}
/** Project the edited model slice back onto its source region with mapped selection points. */
function* projectRegion(
  prepared: PreparedSelection,
  transformed: BlockTransform,
  region: DocumentSegment,
  slice: Slice,
  positions: number[],
  sourceSelection: boolean,
): Generator<EditWorkStep, { projected: string; points: SourcePoint[]; tags: BodySplice[] }, unknown> {
  if (transformed.doc.eq(prepared.state.doc))
    return { projected: region.source, points: sourceSelection ? unchangedPoints(prepared, transformed) : [], tags: [] };
  const serialized = yield* serializeModelMappedWork(slice.content, positions),
    edited = serialized.html;
  const identity = contextIdentity(region, edited);
  region = identity.segment;
  if (encoder.encode(edited).length > 64 * 1024 || encoder.encode(region.source).length > 64 * 1024) {
    const result = yield* projectModelSegmentWork(
      region,
      edited,
      schema.topNodeType.create(null, slice.content),
      serialized.points,
    );
    return { projected: result.replacement, points: result.points, tags: identity.tags };
  }
  const projected = projectSegment(region, edited);
  if (!sourceSelection) return { projected, points: [], tags: identity.tags };
  const map = segmentPositionMap({ ...region, source: projected }, schema);
  return { projected, points: positions.map((pos) => map.point(pos)), tags: identity.tags };
}
function documentSelectionOf(
  prepared: PreparedSelection,
  transformed: BlockTransform,
  points: SourcePoint[],
  offscreen: boolean,
): DocumentSelection | null {
  const selection = transformed.selection;
  if (selection instanceof AllSelection) return { kind: "all" };
  if (!(selection instanceof TextSelection) || selection.empty || points.length !== 2 || !offscreen) return null;
  return {
    kind: "range",
    anchor: { ...documentPoint(transformed.doc, prepared.blockOffset, selection.anchor), ...points[0] },
    head: { ...documentPoint(transformed.doc, prepared.blockOffset, selection.head), ...points[1] },
  };
}
/** Identities for touched blocks, including the ancestors of a bounded source
 * span. Their opening tokens are saved separately by contextIdentity. */
function identifyInput(transformed: BlockTransform, first: number, to: number): BlockTransform {
  if (first >= transformed.mapping.maps.length) return transformed;
  const doc = identifyTouchedBlocks(transformed.doc, transformed.mapping, { first, from: 0, to });
  if (doc === transformed.doc) return transformed;
  return { doc, selection: Selection.fromJSON(doc, transformed.selection.toJSON()), mapping: transformed.mapping };
}
function* changeSelectionWork(
  prepared: PreparedSelection,
  operation: SelectionOperation,
  block?: { transform: BlockTransform; following?: SelectionOperation },
) {
  prepared.check();
  const operationBytes = operationSize(operation);
  if (operationBytes > 20 * 1024 * 1024)
    throw new Error(t("붙여넣은 내용이 20 MiB를 초과했습니다. 원문을 유지합니다."));
  const state = prepared.state;
  let transformed: BlockTransform = yield* applyOperation(prepared, operation, block, operationBytes);
  const from = state.selection.from,
    to = state.selection.to;
  // Typed, pasted or deleted content (also input replayed after a block format)
  // gives the blocks it touched an identity, like an edit in the editor. A block
  // format also identifies the blocks it changes; a mark alone still does not.
  const input = operation.kind === "mark" ? transformed.mapping.maps.length : 0;
  if (block?.following) transformed = applyFollowing(state, transformed, block.following);
  const { first, last } = fragmentRange(prepared, operation, from, to);
  const left = prepared.fragments[first],
    right = prepared.fragments[last];
  const start = left.segment.byte_offset,
    end = right.segment.byte_offset + encoder.encode(right.segment.source).length;
  const region: DocumentSegment = {
    ...left.segment,
    source: prepared.fragments
      .slice(first, last + 1)
      .map((e) => e.segment.source)
      .join(""),
    end_context: right.segment.end_context,
  };
  const mappedFrom = transformed.mapping.map(left.from, -1),
    mappedTo = transformed.mapping.map(right.to, 1);
  transformed = identifyInput(transformed, input, mappedTo);
  const slice = transformed.doc.slice(mappedFrom, mappedTo, true);
  const textSelection = transformed.selection instanceof TextSelection;
  const nodeSelection = transformed.selection instanceof NodeSelection;
  const sourceSelection = textSelection || nodeSelection;
  const positions = textSelection
    ? [transformed.selection.anchor, transformed.selection.head].map((pos) => pos - mappedFrom + slice.openStart)
    : nodeSelection
      ? [transformed.selection.from, transformed.selection.to].map((pos) => pos - mappedFrom + slice.openStart)
    : [];
  const { projected, points, tags } = yield* projectRegion(prepared, transformed, region, slice, positions, sourceSelection);
  const old = encoder.encode(prepared.before),
    replacement =
      new TextDecoder().decode(old.subarray(0, start - prepared.byteStart)) +
      projected +
      new TextDecoder().decode(old.subarray(end - prepared.byteStart));
  if (encoder.encode(replacement).length > 20 * 1024 * 1024) throw new Error("Replacement exceeds 20 MiB");
  prepared.check();
  const rebased = rebaseSegmentIdentity(prepared.region, tags);
  const afterRegion = { ...rebased, source: replacement };
  const nearby =
    points.length === 2
      ? yield* previewSourceRegionWork(
          afterRegion,
          points[0],
          points[1],
          schema,
          prepared.blockOffset,
          prepared.segmentTotal,
          nodeSelection ? "node" : "text",
        )
      : previewSelectionRegion(
          afterRegion,
          transformed.selection.toJSON(),
          schema,
          prepared.blockOffset,
          prepared.segmentTotal,
        );
  if (nodeSelection && !nearby) throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  const preview = nearby?.window ?? previewWindow(replacement, rebased.byte_offset, afterRegion, prepared.segmentTotal);
  const previewStart = preview.byteStart ?? rebased.byte_offset,
    previewEnd = previewStart + encoder.encode(preview.raw ?? preview.html).length;
  const offscreen = points.some((point) => point.byte < previewStart || point.byte > previewEnd);
  const documentSelection = documentSelectionOf(prepared, transformed, points, offscreen);
  return {
    start: rebased.byte_offset,
    tags,
    expected: prepared.before,
    replacement,
    count: transformed.doc.childCount,
    preview: preview.html,
    previewCount: preview.count,
    previewWindow: preview,
    selection: nearby?.selection ?? transformed.selection.toJSON(),
    beforeSelection: prepared.previewSelection,
    documentSelection,
  };
}
