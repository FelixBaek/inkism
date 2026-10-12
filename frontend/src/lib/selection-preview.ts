import type { Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { DocumentSegment } from "../types";
import { sourceSegmentWork } from "./source-segment-work";
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
  const anchor = selection.anchor,
    head = selection.head;
  if (
    selection.type !== "text" ||
    typeof anchor !== "number" ||
    typeof head !== "number" ||
    !Number.isSafeInteger(anchor) ||
    !Number.isSafeInteger(head) ||
    anchor < 0 ||
    head < 0
  )
    return null;
  // A UTF-16 length above the limit already exceeds it in bytes; encode only
  // when the cheaper check passes.
  if (region.source.length > REGION_LIMIT || encoder.encode(region.source).length > REGION_LIMIT) return null;
  // Move the whole limited region's anchor/head PM positions to byte/within.
  const map = segmentPositionMap(region, schema);
  const anchorPoint = map.point(anchor),
    headPoint = map.point(head);
  return previewSourceRegion(region, anchorPoint, headPoint, schema, blockOffset, totalSegments);
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
): { window: WindowPreview; selection: Record<string, unknown> } | null {
  return finishEditWork(previewSourceRegionWork(region, anchorPoint, headPoint, schema, blockOffset, totalSegments));
}
export function* previewSourceRegionWork(
  region: DocumentSegment,
  anchorPoint: SourcePoint,
  headPoint: SourcePoint,
  schema: Schema,
  blockOffset: number,
  totalSegments?: number,
): EditWork<{ window: WindowPreview; selection: Record<string, unknown> } | null> {
  // A top-level close (empty end_context) ends the relative block: the next
  // piece opens block+1 at inner piece 0; otherwise the piece continues the
  // current block as its next inner piece.
  let chosen: RegionPiece | undefined, last: RegionPiece | undefined;
  let block = 0,
    innerIndex = 0;
  const segments = yield* sourceSegmentWork(region.source, region.byte_offset, region.start_context, headPoint.byte);
  for (const segment of segments) {
    const end = segment.byte_offset + encoder.encode(segment.source).length;
    const piece = { segment, block, innerIndex, end };
    last = piece;
    if (headPoint.byte < end) {
      chosen = piece;
      break;
    }
    if (segment.end_context.length) innerIndex++;
    else {
      block++;
      innerIndex = 0;
    }
    yield;
  }
  chosen ??= last;
  if (!chosen) return null;
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
  const pieceMap = segmentPositionMap(chosen.segment, schema),
    pieceDoc = pieceMap.doc();
  const shown = { anchor: cut(anchorPoint), head: cut(headPoint) };
  const display = TextSelection.between(
    pieceDoc.resolve(pieceMap.position(shown.anchor.byte, shown.anchor.within)),
    pieceDoc.resolve(pieceMap.position(shown.head.byte, shown.head.within)),
  ).toJSON();
  // Inner segment ordinal: region pieces continue the entry block, later
  // blocks count their own pieces from the region start.
  const ordinal = chosen.block === 0 ? region.ordinal + chosen.innerIndex : chosen.innerIndex;
  const preview: WindowPreview = {
    html: inspected.content,
    count: inspected.blocks,
    raw: chosen.segment.source,
    offset: blockOffset + chosen.block,
    byteStart: chosen.segment.byte_offset,
    internal:
      chosen.segment.start_context.length || chosen.segment.end_context.length
        ? {
            ordinal,
            byte_offset: chosen.segment.byte_offset,
            start_context: chosen.segment.start_context,
            end_context: chosen.segment.end_context,
            total: Math.max(ordinal + 1 + (chosen.segment.end_context.length ? 1 : 0), totalSegments ?? 0),
          }
        : undefined,
  };
  return { window: preview, selection: display };
}
