import { DOMSerializer, Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { DocumentSegment, SegmentAncestor } from "../types";
import { ancestorElement } from "./rich-segment";
import { finishEditWork, type EditWork } from "./edit-work";
import { modelSourceSegments } from "./source-segments";
import { t } from "../i18n";
export { modelSourceSegments } from "./source-segments";

/** Join only the structural ancestors that are actually open at the source
 * seam. Marks and HTML-only wrappers (tbody, for example) are not PM nodes. */
function segmentJoinTypes(left: PMNode, right: PMNode, context: SegmentAncestor[]) {
  let a = left.lastChild,
    b = right.firstChild;
  return context.flatMap((ancestor) => {
    const element = ancestorElement(ancestor);
    if (
      !a ||
      a.isLeaf ||
      !a.type.spec.parseDOM?.some(
        (rule) => rule.tag && element.matches(rule.tag) && rule.getAttrs?.(element as HTMLElement) !== false,
      )
    )
      return [];
    if (!b || !a.sameMarkup(b)) throw new Error(t("구간 경계의 구조가 일치하지 않습니다."));
    const type = a.type;
    a = a.lastChild;
    b = b.firstChild;
    return [type];
  });
}
export function joinSegmentModels(left: PMNode, right: PMNode, context: SegmentAncestor[]) {
  const types = segmentJoinTypes(left, right, context);
  const merge = (a: Fragment, b: Fragment, depth: number): Fragment => {
    if (depth === types.length) return a.append(b);
    const last = a.lastChild,
      first = b.firstChild;
    if (!last || !first || last.type !== types[depth] || first.type !== types[depth] || !last.sameMarkup(first))
      throw new Error(t("구간 경계의 구조가 일치하지 않습니다. 원문을 유지합니다."));
    const joined = last.copy(merge(last.content, first.content, depth + 1));
    if (!joined.type.validContent(joined.content)) throw new Error(t("구간 구조를 안전하게 합치지 못했습니다."));
    return a
      .cut(0, a.size - last.nodeSize)
      .append(Fragment.from(joined))
      .append(b.cut(first.nodeSize));
  };
  return { doc: left.copy(merge(left.content, right.content, 0)), shift: left.content.size - 2 * types.length };
}

/** Balanced source-order merges shared by paste and oversized selections.
 * Cursor shifts depend on the seam and total size, not on merge order. */
export class SegmentModelBuilder {
  private runs: ({ doc: PMNode; context: SegmentAncestor[] } | undefined)[] = [];
  private size = 0;
  *append(doc: PMNode, context: SegmentAncestor[]): EditWork<number> {
    const tail = this.runs.find(Boolean);
    const shift = tail ? this.size - 2 * segmentJoinTypes(tail.doc, doc, context).length : 0;
    let run = { doc, context };
    for (let level = 0; ; level++) {
      const prior = this.runs[level];
      if (!prior) {
        this.runs[level] = run;
        break;
      }
      this.runs[level] = undefined;
      run = { doc: joinSegmentModels(prior.doc, run.doc, run.context).doc, context: prior.context };
      yield;
    }
    this.size = shift + doc.content.size;
    return shift;
  }
  *finish(): EditWork<PMNode | undefined> {
    let doc: PMNode | undefined;
    // Higher levels hold earlier source ranges.
    for (let level = this.runs.length - 1; level >= 0; level--) {
      const run = this.runs[level];
      if (!run) continue;
      this.runs[level] = undefined;
      doc = doc ? joinSegmentModels(doc, run.doc, run.context).doc : run.doc;
      yield;
    }
    this.size = 0;
    return doc;
  }
}

/** Serialize one node shell at a time, never an offscreen table/list DOM.
 * Marks are shared across adjacent children exactly as DOMSerializer does. */
export function serializeModel(fragment: Fragment): string {
  return serializeModelMapped(fragment, []).html;
}

/** Positions refer to the enclosing fragment's PM content. Record source
 * cursors during serialization, without reparsing a large HTML document. */
export function serializeModelMapped(fragment: Fragment, positions: number[]) {
  return finishEditWork(serializeModelMappedWork(fragment, positions));
}
type OpenMark = { mark: PMNode["marks"][number]; end: string };
export function* serializeModelMappedWork(
  fragment: Fragment,
  positions: number[],
): Generator<void, { html: string; points: { byte: number; within: number }[] }> {
  if (positions.some((pos) => !Number.isSafeInteger(pos) || pos < 0 || pos > fragment.size))
    throw new Error("Invalid serialized model cursor");
  const points = new Map<number, { byte: number; within: number }>(),
    wanted = new Set(positions),
    encoder = new TextEncoder();
  const first = fragment.firstChild;
  if (!first) return { html: "", points: positions.map(() => ({ byte: 0, within: 0 })) };
  const serializer = DOMSerializer.fromSchema(first.type.schema),
    parts: string[] = [];
  let bytes = 0;
  const push = (value: string) => {
    parts.push(value);
    if (wanted.size) bytes += encoder.encode(value).length;
  };
  const record = (pos: number) => {
    if (wanted.has(pos) && !points.has(pos)) points.set(pos, { byte: bytes, within: 0 });
  };
  const shell = (spec: Parameters<typeof DOMSerializer.renderSpec>[1]) => {
    const { dom, contentDOM } = DOMSerializer.renderSpec(document, spec);
    if (contentDOM) {
      const marker = document.createComment("inkism:content");
      contentDOM.appendChild(marker);
    }
    const container = document.createElement("div");
    container.appendChild(dom);
    const html = container.innerHTML,
      markerHTML = "<!--inkism:content-->",
      at = html.indexOf(markerHTML);
    return at < 0 ? [html, ""] : [html.slice(0, at), html.slice(at + markerHTML.length)];
  };
  /** Closes the open marks this node does not share, then opens its remaining marks. */
  const syncMarks = (open: OpenMark[], node: PMNode) => {
    let keep = 0;
    while (
      keep < open.length &&
      keep < node.marks.length &&
      open[keep].mark.eq(node.marks[keep]) &&
      node.marks[keep].type.spec.spanning !== false
    )
      keep++;
    while (open.length > keep) push(open.pop()!.end);
    for (const mark of node.marks.slice(keep)) {
      const render = serializer.marks[mark.type.name];
      if (!render) continue;
      const [start, end] = shell(render(mark, node.isInline));
      push(start);
      open.push({ mark, end });
    }
  };
  /** Records wanted cursors inside text[at, end) before that chunk is pushed. */
  const recordTextCursors = (text: string, pos: number, at: number, end: number) => {
    for (const cursor of wanted) {
      if (points.has(cursor) || cursor < pos + at || cursor > pos + end) continue;
      let relative = cursor - pos,
        within = 0;
      if (
        relative > at &&
        relative < end &&
        /[\uD800-\uDBFF]/.test(text[relative - 1]) &&
        /[\uDC00-\uDFFF]/.test(text[relative])
      ) {
        relative--;
        within = 1;
      }
      const prefix = document.createElement("div");
      prefix.textContent = text.slice(at, relative);
      points.set(cursor, { byte: bytes + encoder.encode(prefix.innerHTML).length, within });
    }
  };
  /** Escapes text in 16K chunks without splitting a surrogate pair. */
  const textChunks = function* (text: string, pos: number): Generator<void, void> {
    for (let at = 0; at < text.length;) {
      let end = Math.min(at + 16384, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      const host = document.createElement("div");
      host.textContent = text.slice(at, end);
      recordTextCursors(text, pos, at, end);
      push(host.innerHTML);
      at = end;
      yield;
    }
  };
  const children = function* (content: Fragment, start: number): Generator<void, void> {
    const open: OpenMark[] = [];
    let offset = 0;
    for (let index = 0; index < content.childCount; index++) {
      const node = content.child(index);
      const pos = start + offset;
      record(pos);
      syncMarks(open, node);
      if (node.isText) {
        yield* textChunks(node.text!, pos);
      } else {
        const [opening, closing] = shell(serializer.nodes[node.type.name](node));
        push(opening);
        if (!node.isLeaf) {
          record(pos + 1);
          yield* children(node.content, pos + 1);
          record(pos + node.nodeSize - 1);
        }
        push(closing);
      }
      record(pos + node.nodeSize);
      offset += node.nodeSize;
      yield;
    }
    while (open.length) push(open.pop()!.end);
  };
  yield* children(fragment, 0);
  record(fragment.size);
  return {
    html: parts.join(""),
    points: positions.map((pos) => {
      const point = points.get(pos);
      if (!point) throw new Error("Serialized cursor is outside the model");
      return point;
    }),
  };
}

/** First viewport source from generated canonical HTML. Scan a bounded prefix;
 * retain ordinary row/item boundaries and the table's fixed column metadata. */
export function firstModelSegment(source: string, byteOffset: number): DocumentSegment {
  return (
    modelSourceSegments(source, byteOffset).next().value ?? {
      ordinal: 0,
      byte_offset: byteOffset,
      source: "",
      start_context: [],
      end_context: [],
    }
  );
}

const VOID_TAGS = new Set([
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
/** Index just past the `>` that closes the tag starting at `at`, skipping quoted values. */
function tagEnd(source: string, at: number) {
  let quote = "";
  let end = at + 1;
  for (; end < source.length; end++) {
    const c = source[end];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return end + 1;
  }
  return end;
}
/** -1 for a closing tag, +1 for an opening non-void tag, 0 otherwise. */
function depthDelta(token: string) {
  const tag = /^<(\/)?([a-z][a-z0-9]*)\b/i.exec(token);
  if (!tag) return 0;
  if (tag[1]) return -1;
  return !VOID_TAGS.has(tag[2].toLowerCase()) && !token.endsWith("/>") ? 1 : 0;
}
function utf8Length(cp: number) {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  return cp <= 0xffff ? 3 : 4;
}

/** One tag or one character of the preview: where it ends, its UTF-8 size, and its nesting change. */
function previewToken(source: string, at: number) {
  if (source[at] === "<") {
    const end = tagEnd(source, at);
    return {
      end,
      size: new TextEncoder().encode(source.slice(at, end)).length,
      depth: depthDelta(source.slice(at, end)),
    };
  }
  const cp = source.codePointAt(at)!;
  return { end: cp > 0xffff ? at + 2 : at + 1, size: utf8Length(cp), depth: 0 };
}

/** Bound the live preview before any DOM parsing. */
export function previewSegment(source: string, byteOffset: number): DocumentSegment {
  let at = 0,
    bytes = 0,
    complete = 0,
    completeBytes = 0,
    count = 0,
    depth = 0;
  while (at < source.length) {
    const token = previewToken(source, at);
    depth += token.depth;
    bytes += token.size;
    at = token.end;
    if (bytes - completeBytes > 65536 || bytes > 512 * 1024) {
      if (!complete) return firstModelSegment(source, byteOffset);
      break;
    }
    if (depth === 0) {
      complete = at;
      completeBytes = bytes;
      if (++count === 32) break;
    }
  }
  return { ordinal: 0, byte_offset: byteOffset, source: source.slice(0, complete), start_context: [], end_context: [] };
}
