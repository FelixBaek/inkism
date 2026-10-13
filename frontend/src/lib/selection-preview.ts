import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { DocumentSegment } from "../types";
import { sourceSegmentWork } from "./source-segment-work";
import { sourceSpan } from "./source-segments";
import { segmentPositionMap } from "./segment-selection";
import { inspectSegment } from "./rich-segment";
import type { WindowPreview } from "./window-history";
import type { SourcePoint } from "./segment-projection";
import { finishEditWork, type EditWork } from "./edit-work";
import { t } from "../i18n";

const encoder = new TextEncoder();
/** The caller must hand in a region already bounded to this size; larger
 * regions fall back to the caller's bounded first-source preview. */
const REGION_LIMIT = 128 * 1024;
interface RegionPiece {
  segment: DocumentSegment;
  block: number;
  innerIndex: number;
  end: number;
}

/** Bounded live preview for a selection region whose source replacement span
 * and display span differ. The whole limited region model is only mapped to
 * stable byte/within endpoints; the display parses just the single <=32KiB
 * piece under the selection head inside a detached template, never the whole
 * document. The source is never normalized: raw stays the exact piece text. */
export function previewSelectionRegion(
  region: DocumentSegment,
  selection: Record<string, unknown>,
  schema: Schema,
  blockOffset: number,
  totalSegments?: number,
): { window: WindowPreview; selection: Record<string, unknown> } | null {
  const anchor = selection.anchor;
  const nodeSelection = selection.type === "node";
  let head = selection.head;
  if (
    (selection.type !== "text" && !nodeSelection) ||
    typeof anchor !== "number" ||
    !Number.isSafeInteger(anchor) ||
    anchor < 0
  )
    return null;
  // A UTF-16 length above the limit already exceeds it in bytes; encode only
  // when the cheaper check passes.
  if (region.source.length > REGION_LIMIT || encoder.encode(region.source).length > REGION_LIMIT) return null;
  // Move the whole limited region's anchor/head PM positions to byte/within.
  const map = segmentPositionMap(region, schema);
  if (nodeSelection) head = NodeSelection.fromJSON(map.doc(), selection as { anchor: number }).to;
  if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) return null;
  const anchorPoint = map.point(anchor),
    headPoint = map.point(head);
  return previewSourceRegion(region, anchorPoint, headPoint, schema, blockOffset, totalSegments, nodeSelection ? "node" : "text");
}

/** A serialization-time source cursor also works beyond the bounded DOM
 * mapping limit. Only the chosen piece is parsed for display. */
export function previewSourceRegion(
  region: DocumentSegment,
  anchorPoint: SourcePoint,
  headPoint: SourcePoint,
  schema: Schema,
  blockOffset: number,
  totalSegments?: number,
  selectionMode: "text" | "node" = "text",
): { window: WindowPreview; selection: Record<string, unknown> } | null {
  return finishEditWork(previewSourceRegionWork(region, anchorPoint, headPoint, schema, blockOffset, totalSegments, selectionMode));
}
export function* previewSourceRegionWork(
  region: DocumentSegment,
  anchorPoint: SourcePoint,
  headPoint: SourcePoint,
  schema: Schema,
  blockOffset: number,
  totalSegments?: number,
  selectionMode: "text" | "node" = "text",
): EditWork<{ window: WindowPreview; selection: Record<string, unknown> } | null> {
  const picked = yield* pickRegionPiece(region, anchorPoint, headPoint, selectionMode);
  if (!picked.chosen) return null;
  const chosen = selectionMode === "node" ? joinNodePieces(picked.chosen, picked.nodePieces, anchorPoint, headPoint) : picked.chosen;
  // A head exactly on a seam selects the next piece; at the region's last
  // endpoint it stays on the last piece.
  const inspected = inspectSegment(chosen.segment);
  if (!inspected.editable) throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  // Cut both endpoints into the displayed piece and rebuild the selection in
  // its own model, as a mounted window would restore it.
  const cut = (point: { byte: number; within: number }) => {
    if (point.byte < chosen.segment.byte_offset) return { byte: chosen.segment.byte_offset, within: 0 };
    return point.byte > chosen.end ? { byte: chosen.end, within: 0 } : point;
  };
  const pieceMap = segmentPositionMap(chosen.segment, schema);
  const shown = { anchor: cut(anchorPoint), head: cut(headPoint) };
  const from = pieceMap.position(shown.anchor.byte, shown.anchor.within),
    to = pieceMap.position(shown.head.byte, shown.head.within);
  const display = pieceSelection(pieceMap.doc(), from, to, selectionMode);
  const preview: WindowPreview = {
    html: inspected.content,
    count: inspected.blocks,
    raw: chosen.segment.source,
    offset: blockOffset + chosen.block,
    byteStart: chosen.segment.byte_offset,
    internal: pieceInternal(chosen, region, totalSegments),
  };
  return { window: preview, selection: display };
}

/** The piece under the selection head (node mode: every piece the node spans). */
function* pickRegionPiece(
  region: DocumentSegment,
  anchorPoint: SourcePoint,
  headPoint: SourcePoint,
  selectionMode: "text" | "node",
): EditWork<{ chosen: RegionPiece | undefined; nodePieces: DocumentSegment[] }> {
  // A top-level close (empty end_context) ends the relative block: the next
  // piece opens block+1 at inner piece 0; otherwise the piece continues the
  // current block as its next inner piece.
  let chosen: RegionPiece | undefined, last: RegionPiece | undefined;
  const nodePieces: DocumentSegment[] = [];
  const targetByte = selectionMode === "node" ? anchorPoint.byte : headPoint.byte;
  let block = 0,
    innerIndex = 0;
  const segments = yield* sourceSegmentWork(region.source, region.byte_offset, region.start_context, headPoint.byte);
  for (const segment of segments) {
    const end = segment.byte_offset + encoder.encode(segment.source).length;
    const piece = { segment, block, innerIndex, end };
    last = piece;
    if (targetByte < end) chosen ??= piece;
    if (chosen) {
      if (selectionMode === "text") break;
      nodePieces.push(segment);
      if (headPoint.byte <= end) break;
    }
    if (segment.end_context.length) innerIndex++;
    else {
      block++;
      innerIndex = 0;
    }
    yield;
  }
  return { chosen: chosen ?? last, nodePieces };
}

/** One display piece for a node selection whose atom straddles scanner seams. */
function joinNodePieces(
  chosen: RegionPiece,
  nodePieces: DocumentSegment[],
  anchorPoint: SourcePoint,
  headPoint: SourcePoint,
): RegionPiece {
  const end = nodePieces.at(-1);
  if (!end || anchorPoint.byte < chosen.segment.byte_offset || headPoint.byte > end.byte_offset + encoder.encode(end.source).length)
    throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  const segment = {
    ...chosen.segment,
    source: nodePieces.map(part => part.source).join(""),
    end_context: end.end_context,
  };
  // An atom can straddle a scanner seam. Keep it whole, trimming the
  // surrounding source when joining the pieces exceeds a viewport span.
  const shown = encoder.encode(segment.source).length <= 32768
    ? segment : sourceSpan(segment, anchorPoint.byte, headPoint.byte);
  if (encoder.encode(shown.source).length > 32768)
    throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  return { ...chosen, segment: shown, end: shown.byte_offset + encoder.encode(shown.source).length };
}

function pieceSelection(pieceDoc: PMNode, from: number, to: number, selectionMode: "text" | "node"): Record<string, unknown> {
  if (selectionMode === "text") return TextSelection.between(pieceDoc.resolve(from), pieceDoc.resolve(to)).toJSON();
  const node = pieceDoc.nodeAt(from);
  if (!node || !NodeSelection.isSelectable(node) || from + node.nodeSize !== to)
    throw new Error(t("편집 결과의 표시 구간을 보존하지 못했습니다."));
  return NodeSelection.create(pieceDoc, from).toJSON();
}

function pieceInternal(chosen: RegionPiece, region: DocumentSegment, totalSegments?: number): WindowPreview["internal"] {
  const { segment } = chosen;
  if (!segment.start_context.length && !segment.end_context.length) return undefined;
  // Inner segment ordinal: region pieces continue the entry block, later
  // blocks count their own pieces from the region start.
  const ordinal = chosen.block === 0 ? region.ordinal + chosen.innerIndex : chosen.innerIndex;
  const following = segment.end_context.length ? 1 : 0;
  return {
    ordinal,
    byte_offset: segment.byte_offset,
    start_context: segment.start_context,
    end_context: segment.end_context,
    total: Math.max(ordinal + 1 + following, totalSegments ?? 0),
  };
}
