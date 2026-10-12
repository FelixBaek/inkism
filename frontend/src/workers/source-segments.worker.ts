import { modelSourceSegments } from "../lib/source-segments";
import type { SegmentAncestor } from "../types";
export interface SourceScanRequest {
  source: string;
  byteOffset: number;
  context: SegmentAncestor[];
  untilByte?: number;
}
export interface SourceSegmentSpan {
  ordinal: number;
  byte_offset: number;
  from: number;
  to: number;
  start_context: SegmentAncestor[];
  end_context: SegmentAncestor[];
}
self.onmessage = (event: MessageEvent<SourceScanRequest>) => {
  try {
    const { source, byteOffset, context, untilByte } = event.data;
    const spans: SourceSegmentSpan[] = [];
    let from = 0;
    for (const { source: part, ...segment } of modelSourceSegments(source, byteOffset, context)) {
      const to = from + part.length;
      spans.push({ ...segment, from, to });
      from = to;
      if (untilByte !== undefined && untilByte < segment.byte_offset + new TextEncoder().encode(part).length) break;
    }
    self.postMessage({ spans });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "문서 구간을 계산하지 못했습니다." });
  }
};
