import { canonicalRichHTML, inspectRichHTML } from "./rich-document";
import type { DocumentSegment, SegmentAncestor } from "../types";
import { t } from "../i18n";

/** Wrappers exist only in the active rich model. The source stays a contiguous
 * UTF-8 span from the canonical document, including any real tags at its edges. */
export function renderSegment(segment: DocumentSegment): string {
  const start = segment.start_context.slice(),
    end = segment.end_context.slice();
  let source = segment.source;
  // A real closing/opening mark immediately at an artificial edge cancels the
  // virtual mark. Otherwise an edge formatting edit would create empty marks
  // in the local HTML and fail admission on the next edit/undo.
  const mark = (tag: string) => /^(strong|b|em|i|s|u|strike|del|span|mark|code|sub|sup|a|small)$/.test(tag);
  while (start.length) {
    const a = start.at(-1)!,
      close = `</${a.tag}>`;
    if (!mark(a.tag) || source.slice(0, close.length).toLowerCase() !== close) break;
    source = source.slice(close.length);
    start.pop();
  }
  while (end.length) {
    const a = end.at(-1)!;
    if (!mark(a.tag) || !source.endsWith(a.open)) break;
    source = source.slice(0, -a.open.length);
    end.pop();
  }
  end.reverse();
  return start.map((a) => a.open + (a.prelude ?? "")).join("") + source + end.map((a) => `</${a.tag}>`).join("");
}

/** Admission for a rendered segment. A cut table shows only part of its
 * first row, so its derived colgroup may legitimately be shorter. */
export function inspectSegment(segment: DocumentSegment) {
  return inspectRichHTML(renderSegment(segment), {
    partialTable: segment.start_context.length > 0 || segment.end_context.length > 0,
  });
}

const aliases: Record<string, string> = { b: "strong", i: "em", del: "s", strike: "s" };
export function ancestorElement(ancestor: SegmentAncestor): Element {
  const template = document.createElement("template");
  const around: Record<string, [string, string]> = {
    tbody: ["<table>", "</table>"],
    thead: ["<table>", "</table>"],
    tfoot: ["<table>", "</table>"],
    colgroup: ["<table>", "</table>"],
    tr: ["<table><tbody>", "</tbody></table>"],
    td: ["<table><tbody><tr>", "</tr></tbody></table>"],
    th: ["<table><tbody><tr>", "</tr></tbody></table>"],
    li: ["<ul>", "</ul>"],
  };
  if (!/^[a-z][a-z0-9]*$/.test(ancestor.tag)) throw new Error(t("잘못된 구간 서식입니다."));
  const [prefix, suffix] = around[ancestor.tag] ?? ["", ""];
  template.innerHTML = prefix + ancestor.open + `</${ancestor.tag}>` + suffix;
  const element = template.content.querySelector(ancestor.tag);
  if (!element) throw new Error(t("구간의 바깥 서식을 확인하지 못했습니다."));
  return element;
}
function sameAncestor(node: Node | null, ancestor: SegmentAncestor, borrowAliases = true): node is Element {
  if (!(node instanceof Element)) return false;
  const expected = ancestorElement(ancestor);
  if ((borrowAliases ? (aliases[expected.localName] ?? expected.localName) : expected.localName) !== node.localName)
    return false;
  return Array.from(expected.attributes).every((a) => node.getAttribute(a.name) === a.value);
}
function openingEnd(html: string, at: number): number {
  if (html[at] !== "<" || html[at + 1] === "/") throw new Error(t("구간 시작 서식이 변경되었습니다."));
  let quote = "";
  for (let i = at + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i + 1;
  }
  throw new Error(t("구간 시작 서식이 닫히지 않았습니다."));
}

/** Convert the edited bounded model back into the exact canonical source span.
 * Common ancestor tags cancel out. Formatting changes at an artificial edge
 * close/reopen the real outside mark, so toggling bold does not affect unseen
 * text. Paragraph splits can similarly retain their first/last outer paragraph.
 * Structural edits requiring a larger enclosing range must be coordinated by
 * the navigator; this function never silently lets HTML recovery reshape them. */
export function projectSegment(segment: DocumentSegment, edited: string): string {
  const original = renderSegment(segment);
  const initial = inspectRichHTML(original);
  if (!initial.editable) throw new Error(t("이 구간의 서식을 그대로 보존할 수 없습니다."));
  // Mounting and selection/undo-to-baseline never normalize the source slice.
  if (edited === initial.content) return segment.source;
  if (!inspectRichHTML(edited).editable) throw new Error(t("편집 결과의 서식을 그대로 보존할 수 없습니다."));
  const template = document.createElement("template");
  template.innerHTML = edited;
  const { replacement } = projectSegmentEdges(segment, edited, template.content.firstChild, template.content.lastChild);
  if (canonicalRichHTML(renderSegment({ ...segment, source: replacement })) !== canonicalRichHTML(edited))
    throw new Error(t("이 구조 변경에는 더 넓은 편집 범위가 필요합니다. 원문을 유지했습니다."));
  return replacement;
}

/** Step over an unchanged table prelude (colgroup) right after its opening tag. */
function skipFixedColumns(prelude: string, edited: string, left: number, first: Node | null) {
  const columns = document.createElement("template");
  columns.innerHTML = "<table>" + prelude + "</table>";
  for (const fixed of Array.from(columns.content.querySelector("table")!.childNodes)) {
    if (!(first instanceof Element) || !first.isEqualNode(fixed) || !edited.slice(left).startsWith(first.outerHTML))
      throw new Error(t("표의 열 변경에는 더 넓은 편집 범위가 필요합니다."));
    left += first.outerHTML.length;
    first = first.nextSibling;
  }
  return { left, first };
}

/** First/last DOM nodes may come from bounded source windows. Only structural
 * edge cancellation is performed here; callers must validate equivalence. */
export function projectSegmentEdges(
  segment: DocumentSegment,
  edited: string,
  first: Node | null,
  last: Node | null,
  borrowAliases = true,
) {
  let left = 0,
    right = edited.length,
    leftCount = 0,
    rightCount = 0;
  for (const ancestor of segment.start_context) {
    if (!sameAncestor(first, ancestor, borrowAliases)) break;
    left = openingEnd(edited, left);
    leftCount++;
    first = first.firstChild;
    if (ancestor.prelude) ({ left, first } = skipFixedColumns(ancestor.prelude, edited, left, first));
  }
  for (const ancestor of segment.end_context) {
    if (!sameAncestor(last, ancestor, borrowAliases)) break;
    const close = `</${last.localName}>`;
    if (!edited.slice(0, right).endsWith(close)) throw new Error(t("구간 끝 서식이 변경되었습니다."));
    right -= close.length;
    rightCount++;
    last = last.lastChild;
  }
  if (left > right) throw new Error(t("구간 서식 범위가 겹칩니다."));
  const closeOutside = segment.start_context
    .slice(leftCount)
    .reverse()
    .map((a) => `</${a.tag}>`)
    .join("");
  const openOutside = segment.end_context
    .slice(rightCount)
    .map((a) => a.open + (a.prelude ?? ""))
    .join("");
  const replacement = closeOutside + edited.slice(left, right) + openOutside;
  return { replacement, left, right, closeOutside };
}
