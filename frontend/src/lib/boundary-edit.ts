import { Editor, getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import type { DocumentBlockPage, DocumentSegment, DocumentSegmentPage } from "../types";
import { contentExtensions } from "../extensions/content-schema";
import { inspectRichHTML } from "./rich-document";
import { projectSegment, renderSegment } from "./rich-segment";
import { segmentPositionMap } from "./segment-selection";
import { joinSegmentModels, modelSourceSegments } from "./segment-model";
import type { WindowPreview } from "./window-history";
import { t } from "../i18n";

const schema = getSchema(contentExtensions({ trailingNode: false }));
const encoder = new TextEncoder();
export type BoundaryDirection = "backward" | "forward";
export interface BoundaryPoint {
  byte: number;
  within: number;
}
interface Location {
  ready: boolean;
  supported?: boolean;
  ordinal: number;
  offset: number;
  total_blocks: number;
}
export interface BoundarySource {
  locate(byte: number, bias: "before" | "after"): Promise<Location>;
  read(offset: number): Promise<DocumentBlockPage>;
  segments(ordinal: number, offset: number): Promise<DocumentSegmentPage>;
  check(): void;
}
interface Piece {
  block: number;
  index: number;
  total: number;
  segment: DocumentSegment;
}
export interface PreparedBoundary {
  state: EditorState;
  region: DocumentSegment;
  blockOffset: number;
  blockCount: number;
  left: Piece;
  right: Piece;
  check(): void;
}

type Ready = <T extends { ready: boolean }>(read: () => Promise<T>) => Promise<T>;
type ReadPiece = (block: number, index: number | "last") => Promise<Piece>;

/** Polls a cache response until it is ready, re-checking the source between reads. */
function waitReady(source: BoundarySource, deadline: number): Ready {
  return async <T extends { ready: boolean }>(read: () => Promise<T>) => {
    source.check();
    let value = await read();
    while (!value.ready && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      source.check();
      value = await read();
    }
    source.check();
    if (!value.ready) throw new Error(t("경계 구간을 준비 중입니다. 원문을 유지했습니다."));
    return value;
  };
}

/** One 32 KiB segment of a block too large to load whole. */
async function oversizedPiece(
  ready: Ready,
  source: BoundarySource,
  page: DocumentBlockPage,
  block: number,
  index: number | "last",
): Promise<Piece> {
  if (page.blocks.length) throw new Error("Unbounded boundary block response");
  let offset = index;
  if (offset === "last") {
    const metadata = page.oversized;
    if (!metadata) throw new Error("Missing oversized boundary metadata");
    const last = await ready(() => source.locate(metadata.byte_offset + metadata.byte_count, "before"));
    if (last.ordinal !== block) throw new Error("Invalid boundary block end");
    offset = last.offset;
  }
  const inner = await ready(() => source.segments(block, offset as number));
  const segment = inner.segments[0];
  if (
    !inner.supported ||
    inner.ordinal !== block ||
    !segment ||
    inner.total_segments === null ||
    segment.ordinal !== (index === "last" ? inner.total_segments - 1 : index) ||
    encoder.encode(segment.source).length > 32768
  )
    throw new Error(t("경계 구간의 번호나 서식을 보존하지 못했습니다."));
  return { block, index: segment.ordinal, total: inner.total_segments, segment };
}

/** A whole block (64 KiB cap) as a single piece. */
function wholeBlockPiece(page: DocumentBlockPage, block: number): Piece {
  const blockSource = page.blocks[0];
  if (
    !blockSource ||
    page.blocks.length !== 1 ||
    blockSource.ordinal !== block ||
    encoder.encode(blockSource.html).length > 65536
  )
    throw new Error("Invalid bounded boundary block");
  return {
    block,
    index: 0,
    total: 1,
    segment: {
      ordinal: 0,
      byte_offset: blockSource.byte_offset,
      source: blockSource.html,
      start_context: [],
      end_context: [],
    },
  };
}

function pieceReader(ready: Ready, source: BoundarySource): ReadPiece {
  return async (block, index) => {
    const page = await ready(() => source.read(block));
    if (page.oversized_block) return oversizedPiece(ready, source, page, block, index);
    return wholeBlockPiece(page, block);
  };
}

/** The neighbouring piece in the edit direction, or null at the document edge. */
async function adjacentPiece(
  piece: ReadPiece,
  current: Piece,
  direction: BoundaryDirection,
  totalBlocks: number,
): Promise<Piece | null> {
  if (direction === "backward") {
    if (current.index > 0) return piece(current.block, current.index - 1);
    if (current.block > 0) return piece(current.block - 1, "last");
    return null;
  }
  if (current.index + 1 < current.total) return piece(current.block, current.index + 1);
  if (current.block + 1 < totalBlocks) return piece(current.block + 1, 0);
  return null;
}

function assertContiguous(pieces: Piece[]) {
  for (let i = 0; i < pieces.length; i++) {
    const part = pieces[i],
      previous = pieces[i - 1];
    if (
      previous &&
      (previous.segment.byte_offset + encoder.encode(previous.segment.source).length !== part.segment.byte_offset ||
        JSON.stringify(previous.segment.end_context) !== JSON.stringify(part.segment.start_context))
    )
      throw new Error("Noncontiguous boundary source");
    if (!inspectRichHTML(renderSegment(part.segment)).editable)
      throw new Error(t("이 경계의 서식을 그대로 보존할 수 없습니다."));
  }
}

/** Joins the pieces into one document and maps the cursor into it. */
function joinPieces(pieces: Piece[], current: Piece, point: BoundaryPoint) {
  let doc = segmentPositionMap(pieces[0].segment, schema).doc(),
    position = 0;
  for (let i = 0; i < pieces.length; i++) {
    const part = pieces[i],
      map = segmentPositionMap(part.segment, schema);
    const joined = i ? joinSegmentModels(doc, map.doc(), part.segment.start_context) : { doc, shift: 0 };
    doc = joined.doc;
    if (part === current) position = joined.shift + map.position(point.byte, point.within);
  }
  return { doc, position };
}

/** Adjacent cache pieces, independent of the enclosing block size. A leaf block
 * also needs the textblock beyond it for native join semantics (128 KiB cap).
 * Unknown markup, stale revisions and missing source continuity fail before edits. */
export async function prepareBoundary(
  point: BoundaryPoint,
  direction: BoundaryDirection,
  source: BoundarySource,
): Promise<PreparedBoundary | null> {
  if (!Number.isSafeInteger(point.byte) || point.byte < 0 || !Number.isSafeInteger(point.within) || point.within < 0)
    throw new Error("Invalid boundary position");
  const ready = waitReady(source, Date.now() + 60000);
  const piece = pieceReader(ready, source);
  const found = await ready(() => source.locate(point.byte, direction === "backward" ? "after" : "before"));
  if (!found.supported) throw new Error(t("이 경계의 서식을 그대로 보존할 수 없습니다."));
  const current = await piece(found.ordinal, found.offset);
  if (
    point.byte < current.segment.byte_offset ||
    point.byte > current.segment.byte_offset + encoder.encode(current.segment.source).length
  )
    throw new Error("Boundary cursor is outside its source piece");
  const adjacent = await adjacentPiece(piece, current, direction, found.total_blocks);
  if (!adjacent) return null;
  const pieces = direction === "backward" ? [adjacent, current] : [current, adjacent];
  const adjacentDoc = segmentPositionMap(adjacent.segment, schema).doc();
  if (adjacent.total === 1 && adjacentDoc.childCount === 1 && adjacentDoc.firstChild!.isAtom) {
    if (direction === "backward" && adjacent.block > 0) pieces.unshift(await piece(adjacent.block - 1, "last"));
    if (direction === "forward" && adjacent.block + 1 < found.total_blocks)
      pieces.push(await piece(adjacent.block + 1, 0));
  }
  const left = pieces[0],
    right = pieces.at(-1)!;
  assertContiguous(pieces);
  const { doc, position } = joinPieces(pieces, current, point);
  const region = {
    ...left.segment,
    source: pieces.map((part) => part.segment.source).join(""),
    end_context: right.segment.end_context,
  };
  if (encoder.encode(region.source).length > 131072)
    throw new Error(t("경계 편집의 제한 범위를 벗어났습니다. 원문을 유지했습니다."));
  source.check();
  return {
    state: EditorState.create({
      doc,
      selection: Selection.near(doc.resolve(position), direction === "backward" ? -1 : 1),
    }),
    region,
    blockOffset: left.block,
    blockCount: right.block - left.block + 1,
    left,
    right,
    check: source.check,
  };
}

function selectionAt(map: ReturnType<typeof segmentPositionMap>, point: BoundaryPoint, kind: string) {
  const doc = map.doc(),
    at = map.position(point.byte, point.within);
  return (
    kind === "node" ? NodeSelection.create(doc, at) : TextSelection.between(doc.resolve(at), doc.resolve(at))
  ).toJSON();
}

// A selected atom must retain its neighbouring textblock. Showing just the
// atom makes the next native Delete insert a filler paragraph in its place.
function nodePreview(prepared: PreparedBoundary, region: DocumentSegment, point: BoundaryPoint) {
  if (encoder.encode(region.source).length > 65536)
    throw new Error(t("선택한 블록의 편집 범위를 준비하지 못했습니다. 원문을 유지했습니다."));
  const inspection = inspectRichHTML(renderSegment(region)),
    map = segmentPositionMap(region);
  if (!inspection.editable) throw new Error(t("선택한 블록의 서식을 보존하지 못했습니다."));
  const { source, ...context } = region;
  const window: WindowPreview = {
    html: inspection.content,
    count: inspection.blocks,
    raw: source,
    offset: prepared.blockOffset,
    byteStart: region.byte_offset,
    internal:
      region.start_context.length || region.end_context.length
        ? {
            ...context,
            ordinal: prepared.left.index,
            total: Math.max(prepared.left.index + 2, prepared.left.total, prepared.right.total),
          }
        : undefined,
  };
  return { window, selection: selectionAt(map, point, "node") };
}

function preview(prepared: PreparedBoundary, region: DocumentSegment, point: BoundaryPoint, kind = "text") {
  if (kind === "node") return nodePreview(prepared, region, point);
  if (!region.start_context.length && !region.end_context.length && encoder.encode(region.source).length <= 65536) {
    const inspection = inspectRichHTML(region.source),
      map = segmentPositionMap(region);
    if (!inspection.editable) throw new Error(t("경계 편집의 표시 서식을 보존하지 못했습니다."));
    return {
      window: {
        html: inspection.content,
        count: inspection.blocks,
        raw: region.source,
        offset: prepared.blockOffset,
        byteStart: region.byte_offset,
      } as WindowPreview,
      selection: selectionAt(map, point, kind),
    };
  }
  let relativeBlock = 0,
    index = 0;
  const parts = Array.from(modelSourceSegments(region.source, region.byte_offset, region.start_context)).map(
    (segment) => {
      const part = { segment, block: relativeBlock, index: index++ };
      if (!segment.end_context.length) {
        relativeBlock++;
        index = 0;
      }
      return part;
    },
  );
  const chosen =
    parts.find(
      (part) =>
        point.byte >= part.segment.byte_offset &&
        point.byte < part.segment.byte_offset + encoder.encode(part.segment.source).length,
    ) ?? parts.at(-1);
  if (!chosen) throw new Error(t("경계 편집의 표시 구간을 보존하지 못했습니다."));
  const ordinal = (chosen.block === 0 ? prepared.left.index : 0) + chosen.index;
  const total = Math.max(
    ordinal + 1 + (chosen.segment.end_context.length ? 1 : 0),
    prepared.left.total,
    prepared.right.total,
  );
  const segment = { ...chosen.segment, ordinal };
  const inspection = inspectRichHTML(renderSegment(segment));
  if (!inspection.editable || inspection.blocks !== 1)
    throw new Error(t("경계 편집의 표시 서식을 보존하지 못했습니다."));
  const { source, ...context } = segment;
  const window: WindowPreview = {
    html: inspection.content,
    count: 1,
    raw: source,
    offset: prepared.blockOffset + chosen.block,
    byteStart: segment.byte_offset,
    internal: segment.start_context.length || segment.end_context.length ? { ...context, total } : undefined,
  };
  const map = segmentPositionMap(segment);
  const selection = selectionAt(map, point, kind);
  return { window, selection };
}

/** Run the shipped Tiptap keymaps for structural edits in a bounded detached
 * editor. Character deletion uses decoded graphemes, never slices source HTML. */
export function changeBoundary(prepared: PreparedBoundary, direction: BoundaryDirection, repeat = 1) {
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 64) throw new Error("Invalid boundary repeat");
  prepared.check();
  const editor = new Editor({
    element: document.createElement("div"),
    // Like segment windows: an outside opening tag cannot acquire a new block ID.
    extensions: contentExtensions({ trailingNode: false, automaticIds: false }),
    content: prepared.state.doc.toJSON(),
    parseOptions: { preserveWhitespace: "full" },
    injectCSS: false,
  });
  try {
    editor.view.dispatch(
      editor.state.tr.setSelection(Selection.fromJSON(editor.state.doc, prepared.state.selection.toJSON())),
    );
    const before = editor.state.doc,
      originalSelection = editor.state.selection;
    applyBoundaryCommand(editor, direction);
    let consumed = 1;
    while (consumed < repeat) {
      const edge = direction === "backward" ? Selection.atStart(editor.state.doc) : Selection.atEnd(editor.state.doc);
      const outside =
        direction === "backward"
          ? prepared.left.block > 0 || prepared.left.index > 0
          : Boolean(prepared.region.end_context.length || prepared.right.index + 1 < prepared.right.total);
      if (outside && editor.state.selection.eq(edge)) break;
      applyBoundaryCommand(editor, direction);
      consumed++;
    }
    if (before.eq(editor.state.doc) && originalSelection.eq(editor.state.selection)) return null;
    prepared.check();
    const replacement = projectSegment(prepared.region, editor.getHTML());
    const afterRegion = { ...prepared.region, source: replacement };
    const beforeKind = String(originalSelection.toJSON().type),
      afterKind = String(editor.state.selection.toJSON().type);
    const beforePoint = segmentPositionMap(prepared.region).point(
      beforeKind === "node" ? originalSelection.anchor : originalSelection.head,
    );
    const afterPoint = segmentPositionMap(afterRegion).point(
      afterKind === "node" ? editor.state.selection.anchor : editor.state.selection.head,
    );
    const beforePreview = preview(prepared, prepared.region, beforePoint, beforeKind),
      afterPreview = preview(prepared, afterRegion, afterPoint, afterKind);
    return {
      start: prepared.region.byte_offset,
      expected: prepared.region.source,
      replacement,
      offset: prepared.blockOffset,
      beforeCount: prepared.blockCount,
      count: editor.state.doc.childCount,
      beforePreview: beforePreview.window,
      afterPreview: afterPreview.window,
      beforeSelection: beforePreview.selection,
      selection: afterPreview.selection,
      consumed,
    };
  } finally {
    editor.destroy();
  }
}

/** The same command is also used for queued keys after the new viewport mounts. */
export function applyBoundaryCommand(editor: Editor, direction: BoundaryDirection): void {
  if (!editor.state.selection.empty) {
    editor.commands.keyboardShortcut(direction === "backward" ? "Backspace" : "Delete");
    return;
  }
  const position = editor.state.selection.$head;
  if (
    position.parent.isTextblock &&
    ((direction === "backward" && position.parentOffset > 0) ||
      (direction === "forward" && position.parentOffset < position.parent.content.size))
  ) {
    const text = position.parent.textBetween(0, position.parent.content.size, "\n", "\ufffc");
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text));
    const at = position.parentOffset;
    const grapheme = segments.find((segment) =>
      direction === "backward"
        ? segment.index < at && segment.index + segment.segment.length >= at
        : segment.index <= at && segment.index + segment.segment.length > at,
    );
    if (!grapheme) throw new Error(t("삭제할 문자의 경계를 보존하지 못했습니다."));
    // Blink visually places a caret inside a composite glyph after that glyph.
    // A cache seam may end between its scalars; forward deletion must start
    // after the full glyph, matching the complete editor's native keyboard.
    if (direction === "forward" && grapheme.index < at) {
      editor.commands.setTextSelection(position.start() + grapheme.index + grapheme.segment.length);
      return applyBoundaryCommand(editor, direction);
    }
    editor.view.dispatch(
      editor.state.tr.delete(
        position.start() + grapheme.index,
        position.start() + grapheme.index + grapheme.segment.length,
      ),
    );
  } else editor.commands.keyboardShortcut(direction === "backward" ? "Backspace" : "Delete");
}
