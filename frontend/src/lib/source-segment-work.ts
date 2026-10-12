import type { DocumentSegment, SegmentAncestor } from "../types";
import type { EditWork } from "./edit-work";
import { modelSourceSegments } from "./source-segments";
import { scanSourceInWorker } from "./source-scan-client";

/** Short/synchronous calculations keep the incremental scanner. Large async
 * calculations scan elsewhere and resume with immutable source spans. */
export function* sourceSegmentWork(
  source: string,
  byteOffset: number,
  context: SegmentAncestor[] = [],
  untilByte?: number,
): EditWork<Iterable<DocumentSegment>> {
  if (source.length <= 64 * 1024) return modelSourceSegments(source, byteOffset, context);
  let segments: Iterable<DocumentSegment>;
  yield {
    runSync: () => {
      segments = modelSourceSegments(source, byteOffset, context);
    },
    runAsync: async (check) => {
      segments = await scanSourceInWorker({ source, byteOffset, context, untilByte }, check);
    },
  };
  return segments!;
}
