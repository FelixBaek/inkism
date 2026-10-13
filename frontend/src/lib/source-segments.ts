import type { DocumentSegment, SegmentAncestor } from "../types";

const VOIDS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** End of a tag starting at `at`, skipping quoted attribute values; unterminated tags run to the end. */
function tagEnd(source: string, at: number): number {
  let quote = "";
  for (let end = at + 1; end < source.length; end++) {
    const c = source[end];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return end + 1;
  }
  return source.length;
}

/** One indivisible token: a tag, a character reference, CRLF, or one code point. */
function tokenEnd(source: string, at: number): number {
  const c = source[at];
  if (c === "<") return tagEnd(source, at);
  if (c === "&") {
    const match = /^&(?:#[xX][a-fA-F0-9]+|#\d+|[a-zA-Z0-9]+);/.exec(source.slice(at, at + 64));
    return match ? at + match[0].length : at + 1;
  }
  if (c === "\r" && source[at + 1] === "\n") return at + 2;
  return source.codePointAt(at)! > 0xffff ? at + 2 : at + 1;
}

/** Read an actual opening-tag attribute, ignoring quoted values of other
 * attributes. The pure scanner is also used in a worker, without a DOM. */
function dataType(token: string): string | undefined {
  const name = /^<[a-z][a-z0-9]*\b/i.exec(token);
  if (!name) return;
  let at = name[0].length;
  while (at < token.length) {
    at = skipSpace(token, at);
    if (token[at] === ">" || token[at] === "/") return;
    const attr = /^[^\s=/>]+/.exec(token.slice(at));
    if (!attr) return;
    const parsed = attributeValue(token, at + attr[0].length);
    if (!parsed) return;
    if (attr[0].toLowerCase() === "data-type") return parsed.value;
    at = parsed.at;
  }
}

function skipSpace(token: string, at: number): number {
  while (/\s/.test(token[at] ?? "")) at++;
  return at;
}

/** The optional `=value` after an attribute name ending at `at`, and the offset
 * after it; null when the value is malformed. */
function attributeValue(token: string, at: number): { value?: string; at: number } | null {
  at = skipSpace(token, at);
  if (token[at] !== "=") return { at };
  at = skipSpace(token, at + 1);
  const quote = token[at];
  if (quote === '"' || quote === "'") {
    const end = token.indexOf(quote, at + 1);
    return end < 0 ? null : { value: token.slice(at + 1, end), at: end + 1 };
  }
  const unquoted = /^[^\s>]+/.exec(token.slice(at));
  return unquoted ? { value: unquoted[0], at: at + unquoted[0].length } : null;
}

/** Canonical math HTML represents a leaf, not editable span/div content.
 * Splitting its text duplicates the atom when bounded models are joined.
 * Keep known leaves whole; ordinary HTML wrappers retain normal token cuts. */
function mathLeafEnd(source: string, at: number, openingEnd: number): number | undefined {
  const opening = source.slice(at, openingEnd), tag = /^<(span|div)\b/i.exec(opening)?.[1].toLowerCase();
  if (!tag || dataType(opening) !== (tag === "span" ? "inline-math" : "block-math")) return;
  const bounded = source.slice(openingEnd, at + 32769), close = bounded.indexOf("<");
  if (close < 0) {
    if (source.length > at + 32768) throw new Error("큰 서식 토큰의 표시 범위를 준비하지 못했습니다. 원문을 유지합니다.");
    return;
  }
  const closing = new RegExp(`^<\\/${tag}\\s*>`, "i").exec(source.slice(openingEnd + close, openingEnd + close + 64));
  return closing ? openingEnd + close + closing[0].length : undefined;
}

function utf8Length(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  return cp <= 0xffff ? 3 : 4;
}

function tokenSize(source: string, at: number, token: string, encoder: TextEncoder): number {
  if (source[at] === "<" || source[at] === "&") return encoder.encode(token).length;
  if (source[at] === "\r" && source[at + 1] === "\n") return 2;
  return utf8Length(source.codePointAt(at)!);
}

/** Maintain the open-ancestor stack (and table colgroup preludes) for one token. */
function trackTag(
  stack: SegmentAncestor[],
  opened: number[],
  source: string,
  at: number,
  end: number,
  token: string,
  byte: number,
) {
  const tag = source[at] === "<" ? /^<(\/)?([a-z][a-z0-9]*)\b/i.exec(token) : null;
  if (!tag) return;
  const name = tag[2].toLowerCase();
  if (tag[1]) {
    const ancestor = stack.pop(),
      start = opened.pop();
    if (ancestor?.tag !== name) throw new Error("표시 구간의 태그가 맞지 않습니다.");
    if (name === "colgroup" && start! >= 0 && stack.at(-1)?.tag === "table")
      stack.at(-1)!.prelude = source.slice(start!, end);
  } else if (!VOIDS.has(name) && !token.endsWith("/>")) {
    stack.push({ tag: name, open: token, at: byte });
    opened.push(at);
  }
}

/** Validates forced cuts; returns the index of the first cut after the window start. */
function firstCut(cuts: readonly number[], byteOffset: number) {
  if (
    cuts.some((cut, index) => !Number.isSafeInteger(cut) || cut < byteOffset || (index > 0 && cut <= cuts[index - 1]))
  )
    throw new Error("잘못된 원문 경계입니다.");
  return cuts[0] === byteOffset ? 1 : 0;
}

/** Soft boundary: enough bytes, not before a closing tag, and outside rows/items/colgroups. */
function softBoundary(stack: SegmentAncestor[], pending: number, closingNext: boolean) {
  return pending >= 16384 && !closingNext && !stack.some((a) => ["tr", "li", "colgroup"].includes(a.tag));
}

/** The token at `at` (a known math leaf whole) and its UTF-8 size. */
function nextToken(source: string, at: number, encoder: TextEncoder) {
  const openingEnd = tokenEnd(source, at),
    leafEnd = source[at] === "<" ? mathLeafEnd(source, at, openingEnd) : undefined,
    end = leafEnd ?? openingEnd,
    token = source.slice(at, end);
  return { leafEnd, end, token, size: tokenSize(source, at, token, encoder) };
}

/** Pure source scanner shared by the synchronous editor and its worker. */
export function* modelSourceSegments(
  source: string,
  byteOffset: number,
  context: SegmentAncestor[] = [],
  cuts: readonly number[] = [],
): Generator<DocumentSegment> {
  const encoder = new TextEncoder();
  const clone = () => stack.map((a) => ({ ...a }));
  const stack: SegmentAncestor[] = context.map((a) => ({ ...a })),
    opened: number[] = context.map(() => -1);
  let at = 0,
    bytes = 0,
    start = 0,
    startBytes = 0,
    ordinal = 0,
    startContext = clone();
  const take = (): DocumentSegment => {
    const segment = {
      ordinal: ordinal++,
      byte_offset: byteOffset + startBytes,
      source: source.slice(start, at),
      start_context: startContext,
      end_context: clone(),
    };
    start = at;
    startBytes = bytes;
    startContext = clone();
    return segment;
  };
  let cutIndex = firstCut(cuts, byteOffset);
  while (at < source.length) {
    const { leafEnd, end, token, size } = nextToken(source, at, encoder);
    // A past-the-end cut is undefined and compares false.
    if (cuts[cutIndex] < byteOffset + bytes + size)
      throw new Error("원문 토큰 내부에서 줄 경계를 자를 수 없습니다.");
    if (bytes - startBytes + size > 32768 && at > start) yield take();
    if (size > 32768) throw new Error("큰 서식 토큰의 표시 범위를 준비하지 못했습니다. 원문을 유지합니다.");
    if (leafEnd === undefined) trackTag(stack, opened, source, at, end, token, byteOffset + bytes);
    bytes += size;
    at = end;
    // Keep closing ancestor shells with their content. Parsing a final </ul>
    // alone would fill an empty synthetic list with a phantom item.
    const closingNext = source.startsWith("</", at);
    const forced = cuts[cutIndex] === byteOffset + bytes;
    cutIndex += Number(forced);
    if (forced || !stack.length || softBoundary(stack, bytes - startBytes, closingNext)) yield take();
  }
  if (at > start) yield take();
  if (cutIndex !== cuts.length) throw new Error("원문 줄 경계가 표시 구간을 벗어났습니다.");
}

/** Keep canonical tokens and exact open ancestors at a measured line boundary.
 * The input is an already bounded source window, never the full note body. */
export function sourceSpan(
  segment: DocumentSegment,
  start = segment.byte_offset,
  end = segment.byte_offset + new TextEncoder().encode(segment.source).length,
): DocumentSegment {
  const limit = segment.byte_offset + new TextEncoder().encode(segment.source).length;
  if (start < segment.byte_offset || end > limit || start >= end) throw new Error("잘못된 표시 줄 범위입니다.");
  const cuts = [start, end].filter(
    (value, index, values) => value > segment.byte_offset && value <= limit && values.indexOf(value) === index,
  );
  const pieces = Array.from(
    modelSourceSegments(segment.source, segment.byte_offset, segment.start_context, cuts),
  ).filter((piece) => piece.byte_offset >= start && piece.byte_offset < end);
  if (!pieces.length || pieces[0].byte_offset !== start) throw new Error("표시 줄의 원문을 찾지 못했습니다.");
  return {
    ordinal: segment.ordinal,
    byte_offset: start,
    source: pieces.map((piece) => piece.source).join(""),
    start_context: pieces[0].start_context,
    end_context: pieces.at(-1)!.end_context,
  };
}
