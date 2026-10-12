import { getSchema } from "@tiptap/core";
import { DOMParser, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { contentExtensions } from "../extensions/content-schema";
import type { DocumentSegment } from "../types";
import { t } from "../i18n";

const parser = DOMParser.fromSchema(getSchema(contentExtensions()));
const encoder = new TextEncoder();
/** End of a tag whose "<" precedes `end`: just past the first ">" outside quotes, or the source end. */
function tagEnd(source: string, end: number) {
  let quote = "";
  for (; end < source.length; end++) {
    const c = source[end];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return end + 1;
  }
  return end;
}

/** End of a character reference whose "&" precedes `end`. */
function referenceEnd(source: string, end: number) {
  if (source[end] === "#") end++;
  while (end < source.length && /[a-zA-Z0-9]/.test(source[end])) end++;
  if (source[end] === ";") end++;
  return end;
}

/** Safe source boundaries: whole tags, character references, CRLF and scalars.
 * A cursor inside a multi-character reference also stores its decoded offset. */
function boundaries(source: string) {
  const result = [{ at: 0, byte: 0 }];
  let at = 0,
    byte = 0;
  while (at < source.length) {
    let end = at + 1;
    if (source.startsWith("<!--", at)) {
      const close = source.indexOf("-->", at + 4);
      if (close < 0) throw new Error(t("구간 주석이 닫히지 않았습니다."));
      end = close + 3;
    } else if (source[at] === "<") end = tagEnd(source, end);
    else if (source[at] === "&") end = referenceEnd(source, end);
    else if (source[at] === "\r" && source[end] === "\n") end++;
    else if (source.codePointAt(at)! > 0xffff) end++;
    byte += encoder.encode(source.slice(at, end)).length;
    at = end;
    result.push({ at, byte });
  }
  return result;
}

/** Detached, bounded parsing only. A comment is legal inside table sections,
 * unlike an element marker that the browser would foster outside the table. */
export function segmentPositionMap(segment: DocumentSegment, schema?: Schema) {
  const modelParser = schema ? DOMParser.fromSchema(schema) : parser;
  const points = boundaries(segment.source);
  const prefix = segment.start_context.map((a) => a.open + (a.prelude ?? "")).join("");
  const suffix = segment.end_context
    .slice()
    .reverse()
    .map((a) => `</${a.tag}>`)
    .join("");
  // A drag visits many source boundaries. Cache only position/size per probe,
  // rather than retaining another complete parsed window for every boundary.
  const cached = new Map<number, { position: number; size: number }>();
  let initialDoc: PMNode | undefined;
  const read = (index: number) => {
    const old = cached.get(index);
    if (old) return old;
    const at = points[index].at,
      template = document.createElement("template");
    template.innerHTML =
      prefix + segment.source.slice(0, at) + "<!--inkism:position-->" + segment.source.slice(at) + suffix;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
    let marker: Node | null = null,
      candidate: Node | null;
    while ((candidate = walker.nextNode())) {
      if (candidate.nodeValue === "inkism:position") {
        marker = candidate;
        break;
      }
    }
    if (!marker?.parentNode) throw new Error(t("구간의 커서 위치를 확인하지 못했습니다."));
    const found = {
      node: marker.parentNode,
      offset: Array.from(marker.parentNode.childNodes).indexOf(marker as ChildNode),
      pos: undefined as number | undefined,
    };
    const doc = modelParser.parse(template.content, { preserveWhitespace: "full", findPositions: [found] });
    if (found.pos === undefined) throw new Error(t("구간 커서를 문서 위치로 변환하지 못했습니다."));
    if (index === 0) initialDoc = doc;
    const value = { position: found.pos, size: doc.content.size };
    cached.set(index, value);
    return value;
  };
  const point = (position: number) => {
    let low = 0,
      high = points.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (read(mid).position <= position) low = mid;
      else high = mid - 1;
    }
    return { byte: segment.byte_offset + points[low].byte, within: Math.max(0, position - read(low).position) };
  };
  const position = (byte: number, within = 0) => {
    if (byte <= segment.byte_offset) return Math.min(read(0).size, read(0).position + within);
    if (byte >= segment.byte_offset + points.at(-1)!.byte)
      return Math.min(read(points.length - 1).size, read(points.length - 1).position + within);
    let low = 0,
      high = points.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].byte < byte - segment.byte_offset) low = mid + 1;
      else high = mid;
    }
    if (points[low].byte !== byte - segment.byte_offset) throw new Error(t("저장된 커서가 원문 경계를 벗어났습니다."));
    return Math.min(read(low).size, read(low).position + within);
  };
  return {
    point,
    position,
    doc: () => {
      read(0);
      return initialDoc!;
    },
  };
}

export function saveSegmentSelection(segment: DocumentSegment, selection: Record<string, unknown>) {
  if (!["text", "node", "cell"].includes(selection.type as string) || typeof selection.anchor !== "number")
    return selection;
  const map = segmentPositionMap(segment),
    anchor = map.point(selection.anchor);
  const result = { ...selection, anchorByte: anchor.byte, anchorWithin: anchor.within };
  return typeof selection.head === "number"
    ? {
        ...result,
        ...(() => {
          const head = map.point(selection.head as number);
          return { headByte: head.byte, headWithin: head.within };
        })(),
      }
    : result;
}
export function restoreSegmentSelection(segment: DocumentSegment, saved: Record<string, unknown>) {
  if (typeof saved.anchorByte !== "number") return saved;
  const map = segmentPositionMap(segment),
    doc = map.doc();
  const anchor = map.position(saved.anchorByte, Number(saved.anchorWithin ?? 0));
  const head =
    typeof saved.headByte === "number" ? map.position(saved.headByte, Number(saved.headWithin ?? 0)) : anchor;
  try {
    return Selection.fromJSON(doc, { ...saved, anchor, ...(typeof saved.head === "number" ? { head } : {}) }).toJSON();
  } catch {
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head)).toJSON();
  }
}
export function segmentEdgeSelection(segment: DocumentSegment, byte: number, bias: -1 | 1, within = 0) {
  const map = segmentPositionMap(segment);
  return Selection.near(map.doc().resolve(map.position(byte, within)), bias).toJSON();
}
