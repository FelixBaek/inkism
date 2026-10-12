import { getSchema } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { contentExtensions } from "../extensions/content-schema";
import { sanitizeRichHtml } from "./sanitize";

const schema = getSchema(contentExtensions());

// Block-level tags whose surrounding whitespace-only text is pure source formatting.
const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "AUDIO",
  "BLOCKQUOTE",
  "CAPTION",
  "COL",
  "COLGROUP",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
  "VIDEO",
]);
const blockSide = (node: Node | null) =>
  !node || (node.nodeType === Node.ELEMENT_NODE && BLOCK.has((node as Element).tagName));
/** Drops whitespace-only text nodes that sit between block elements (e.g. `<p>a</p>\n<p>b</p>`,
 * `<ul>\n<li>`). HTML renders them as nothing and ProseMirror would otherwise turn them into
 * empty paragraphs, or refuse admission because the DOM shape changed. Whitespace inside inline
 * content, inside <pre>, and alone in an element (`<p> </p>`) stays. */
function dropInterBlockWhitespace(root: Node) {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (
        /^[ \t\r\n\f]*$/.test(child.textContent ?? "") &&
        blockSide(child.previousSibling) &&
        blockSide(child.nextSibling) &&
        (child.previousSibling || child.nextSibling)
      )
        child.remove();
    } else if (child.nodeType === Node.ELEMENT_NODE && child.nodeName !== "PRE") dropInterBlockWhitespace(child);
  }
}

/** Used only when entering a rich view or explicitly making a rich copy. */
export function canonicalRichHTML(source: string): string {
  const input = document.createElement("template");
  input.innerHTML = sanitizeRichHtml(source);
  dropInterBlockWhitespace(input.content);
  const doc = DOMParser.fromSchema(schema).parse(input.content, { preserveWhitespace: "full" });
  const output = document.createElement("div");
  output.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  return output.innerHTML;
}

const aliases: Record<string, string> = { B: "STRONG", I: "EM", DEL: "S", STRIKE: "S" };
function preserves(original: Node, converted: Node, partial = false): boolean {
  if (original.nodeType !== converted.nodeType) return false;
  if (original.nodeType !== Node.ELEMENT_NODE) return original.textContent === converted.textContent;
  const a = original as Element,
    b = converted as Element;
  if ((aliases[a.tagName] ?? a.tagName) !== (aliases[b.tagName] ?? b.tagName)) return false;
  if (partial && a.tagName === "TABLE" && preservesPartialTable(a, b)) return true;
  // Tiptap may add schema defaults, but it must retain every source attribute.
  if (Array.from(a.attributes).some((attr) => b.getAttribute(attr.name) !== attr.value)) return false;
  // Plain external tables omit Tiptap's derived column group. Permit only
  // this addition; every original attribute and child still has to survive.
  if(a.tagName==="TABLE"&&a.firstElementChild?.tagName!=="COLGROUP"&&b.firstElementChild?.tagName==="COLGROUP"){
    const group=b.firstElementChild;
    if(!group.attributes.length&&Array.from(group.children).every(col=>col.tagName==="COL"&&col.attributes.length===1&&colLength.test(col.getAttribute("style")??""))&&b.childNodes.length===a.childNodes.length+1)
      return Array.from(a.childNodes).every((child,index)=>preserves(child,b.childNodes[index+1],partial));
  }
  return preservesChildren(a, b, partial);
}
function preservesChildren(a: Node, b: Node, partial = false): boolean {
  return (
    a.childNodes.length === b.childNodes.length &&
    Array.from(a.childNodes).every((child, index) => preserves(child, b.childNodes[index], partial))
  );
}
const colLength = /^(min-)?width: (\d+)px;?$/;
/** Tiptap derives a table's width style and <colgroup> from its first row.
 * A segment that cuts the table shows fewer cells, so the regenerated
 * colgroup is shorter. Accept that only when the source parts are exactly
 * Tiptap's derived form (nothing else to lose) and the visible columns match. */
function preservesPartialTable(a: Element, b: Element): boolean {
  const ag = a.firstChild as Element | null,
    bg = b.firstChild as Element | null;
  if (
    ag?.nodeName !== "COLGROUP" ||
    bg?.nodeName !== "COLGROUP" ||
    ag.attributes.length ||
    bg.attributes.length ||
    bg.childNodes.length > ag.childNodes.length ||
    a.childNodes.length !== b.childNodes.length
  )
    return false;
  let total = 0,
    fixed = true;
  for (const col of Array.from(ag.childNodes) as Element[]) {
    const length =
      col.nodeName === "COL" && col.attributes.length === 1 && !col.childNodes.length
        ? colLength.exec(col.getAttribute("style") ?? "")
        : null;
    if (!length) return false;
    total += Number(length[2]);
    fixed &&= !length[1];
  }
  return (
    (a.getAttribute("style") ?? "").replace(/;$/, "") === `${fixed ? "width" : "min-width"}: ${total}px` &&
    Array.from(a.attributes).every((attr) => attr.name === "style" || b.getAttribute(attr.name) === attr.value) &&
    Array.from(bg.childNodes).every((col, index) => preserves(ag.childNodes[index], col)) &&
    Array.from(a.childNodes)
      .slice(1)
      .every((child, index) => preserves(child, b.childNodes[index + 1], true))
  );
}

/** Conservative admission. Unknown tags/attributes/comments never silently
 * disappear on the first edit. Merely viewing never writes normalized HTML.
 */
export function inspectRichHTML(
  source: string,
  options: { partialTable?: boolean } = {},
): { content: string; editable: boolean; blocks: number } {
  const content = canonicalRichHTML(source);
  const original = document.createElement("template"),
    converted = document.createElement("template");
  original.innerHTML = source;
  converted.innerHTML = content;
  dropInterBlockWhitespace(original.content);
  const blocks = converted.content.children.length;
  if (!source) return { content, editable: true, blocks };
  return {
    content,
    blocks,
    editable:
      !/<!doctype\b|<\/?(?:html|head|body)\b/i.test(source) &&
      preservesChildren(original.content, converted.content, options.partialTable),
  };
}
