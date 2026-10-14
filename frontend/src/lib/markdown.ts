import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { contentExtensions } from "../extensions/content-schema";
import { sanitizeRichHtml } from "./sanitize";
import { termAttrs, validTermDefinition } from "../extensions/term-definition";
import { t } from "../i18n";
import { inspectRichHTML } from "./rich-document";

// File conversion and bounded Markdown source editing share the same schema.
export const MARKDOWN_FILE_LIMIT = 8 * 1024 * 1024;
const extensions = contentExtensions();
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });
const normalized = (doc: JSONContent) => schema.nodeFromJSON(doc).toJSON() as JSONContent;
const equal = (a: JSONContent, b: JSONContent) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const needsHTML = (node: JSONContent): boolean =>
  ["details", "callout", "attachment"].includes(node.type || "") ||
  Boolean(node.marks?.some((mark) => mark.type === "underline" || mark.type === "highlight" || mark.type === "termDefinition")) ||
  Boolean(node.content?.some(needsHTML));
const docOf = (node: JSONContent): JSONContent => ({ type: "doc", content: [node] });

/** Plain-text stand-in for atom nodes (attachments, math) in the derived text. */
function leafText(node: PMNode) {
  if (node.type.name === "attachment") return String(node.attrs.name);
  if (node.type.name.endsWith("Math")) return String(node.attrs.latex);
  return "";
}

/** Drops trailing dots and spaces (Windows rejects them at the end of a file name). */
function trimTrailingDotsAndSpaces(value: string) {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "." || value[end - 1] === " ")) end--;
  return value.slice(0, end);
}

export function markdownToHTML(markdown: string): { content: string; text: string } {
  if (new Blob([markdown]).size > MARKDOWN_FILE_LIMIT)
    throw new Error(t("Markdown 파일은 8MB까지 가져올 수 있습니다."));
  const parsed = manager.parse(markdown.replace(/^\uFEFF/, ""));
  const content = sanitizeRichHtml(generateHTML(parsed, extensions));
  const document = schema.nodeFromJSON(generateJSON(content, extensions));
  return {
    content,
    text: document.textBetween(0, document.content.size, "\n", leafText),
  };
}

export function htmlToMarkdown(html: string): string {
  // Compare the source before schema parsing/sanitizing can discard unknown
  // markup. A successful schema round trip alone cannot detect that loss.
  if (!inspectRichHTML(html).editable)
    throw new Error(t("이 문서의 서식을 Markdown으로 보존하지 못했습니다. ZIP 백업을 사용해 주세요."));
  const original = normalized(generateJSON(sanitizeRichHtml(html), extensions));
  const blocks = (original.content || []).map((node) => {
    const doc = docOf(node);
    if (needsHTML(node)) return generateHTML(doc, extensions);
    try {
      const markdown = manager.serialize(doc);
      if (equal(doc, manager.parse(markdown))) return markdown;
    } catch {
      /* Unsupported Markdown nodes keep their HTML representation below. */
    }
    return generateHTML(doc, extensions);
  });
  const markdown = blocks.join("\n\n");
  try {
    if (equal(original, manager.parse(markdown))) return markdown + "\n";
  } catch {
    /* HTML fallback */
  }
  // Adjacent Markdown lists, for example, may merge. Preserve the whole document
  // rather than knowingly export a lossy representation.
  const fallback = generateHTML(original, extensions);
  if (!equal(original, manager.parse(fallback)))
    throw new Error(t("이 문서의 서식을 Markdown으로 보존하지 못했습니다. ZIP 백업을 사용해 주세요."));
  return fallback + "\n";
}

/** Plain text remains literal text, even when it contains Markdown syntax. */
export function textToMarkdown(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/([\\`*_[\]{}<>#+.!|~$&-])/g, String.raw`\$1`).replaceAll("\n", "  \n");
}

export function sourceToMarkdown(content: string, format: "text" | "html" | "markdown" = "html"): string {
  if (format === "markdown") return content;
  return format === "text" ? textToMarkdown(content) : portableTermMarkdown(content);
}

/** Portable copies expose definitions as ordinary Markdown footnotes. Canonical
 * editing uses htmlToMarkdown and retains the lossless annotation span instead. */
export function portableTermMarkdown(html: string): string {
  if (!inspectRichHTML(html).editable) return htmlToMarkdown(html); // same loss checks
  const root = document.createElement('div'); root.innerHTML = html;
  const notes: {token:string; label:string; definition:string}[] = [];
  for (const span of root.querySelectorAll<HTMLElement>('span[data-term-id][data-term-definition]')) {
    const attrs = termAttrs(span);
    if (!validTermDefinition(attrs)) continue;
    // Unique per occurrence, even when a pasted term shares an annotation ID.
    let token = `INKISMTERM${notes.length}END`;
    while (html.includes(token)) token += 'X';
    const label = `inkism-term-${notes.length + 1}-${attrs.id}`;
    notes.push({token,label,definition:attrs.definition});
    span.replaceWith(...Array.from(span.childNodes), document.createTextNode(token));
  }
  let body = htmlToMarkdown(root.innerHTML);
  for (const note of notes) body = body.replace(note.token, `[^${note.label}]`);
  if (!notes.length) return body;
  const footnotes = notes.map(note => `[^${note.label}]: ${textToMarkdown(note.definition).replaceAll('\n', '\n    ')}`).join('\n\n');
  return body.trimEnd() + '\n\n' + footnotes + '\n';
}

export function markdownFilename(title: string): string {
  let name =
    trimTrailingDotsAndSpaces(
      Array.from(title)
        .slice(0, 80)
        .join("")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_"),
    ).trim() || "inkism";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + name;
  return name + ".md";
}

// Source editing is intentionally bounded; large HTML keeps the virtualized path.
// Admission refuses unknown tags/attributes (the rich editor's own lossless check)
// instead of silently dropping them through the Tiptap schema, and the Markdown
// round trip must give back the same document. Refused notes stay viewable in HTML.
export const MARKDOWN_UNSUPPORTED = t(
  "이 노트의 일부 서식은 Markdown으로 보여 줄 수 없습니다. 텍스트 화면에서 편집하거나 HTML 화면에서 원문을 확인해 주세요.",
);
// 편집기가 문서 끝에 붙이는 빈 문단(trailing node)은 Markdown에서 <p></p>로 보이므로 뺀다.
const withoutTrailing = (html: string) => html.replace(/(?:<p><\/p>)+$/, "");
const docJSON = (html: string) => normalized(generateJSON(sanitizeRichHtml(html), extensions));
export function editableMarkdown(html: string): string {
  html = withoutTrailing(html);
  if (new Blob([html]).size > 256 * 1024)
    throw new Error(t("Markdown 편집은 256KB까지 지원합니다. 텍스트 화면이나 HTML 화면에서 편집해 주세요."));
  if (!html) return "";
  let markdown: string;
  try {
    markdown = htmlToMarkdown(html);
  } catch {
    throw new Error(MARKDOWN_UNSUPPORTED);
  }
  const converted = withoutTrailing(markdownToHTML(markdown).content);
  // Compared as documents: whitespace HTML does not render (between blocks, at a block's
  // edges) is not a difference, but every node, mark and attribute is.
  if (!inspectRichHTML(html).editable || JSON.stringify(docJSON(html)) !== JSON.stringify(docJSON(converted)))
    throw new Error(MARKDOWN_UNSUPPORTED);
  return markdown;
}

export function markdownToEditableHTML(source: string) {
  if (new Blob([source]).size > 256 * 1024)
    throw new Error(t("Markdown 편집은 256KB까지 지원합니다. 원문을 파일로 보관하거나 내용을 줄여 주세요."));
  const tokens = manager.instance.lexer(source);
  manager.instance.walkTokens(tokens, (token) => {
    if (token.type !== "html") return;
    if (token.block) {
      editableMarkdown(token.text.trim());
      return;
    }
    // Inline HTML is deliberately narrow. Full rich blocks are validated by
    // schema round-trip above; unknown syntax is never silently discarded.
    if (!/^<\/?(?:u|mark|strong|em|s|b|i|code|br)\s*\/?>$/i.test(token.text.trim()))
      throw new Error(t("보존할 수 없는 인라인 HTML이 있습니다. 원문을 수정하거나 파일로 보관해 주세요."));
  });
  const result = markdownToHTML(source);
  if (new Blob([result.content]).size > 256 * 1024)
    throw new Error(t("변환된 HTML이 256KB를 넘습니다. 원문을 파일로 보관하거나 내용을 줄여 주세요."));
  return result;
}

/** Lossless publication import without falling back to raw HTML in Markdown. */
export function htmlToPureMarkdown(html: string): string {
  const markdown = editableMarkdown(html);
  manager.instance.walkTokens(manager.instance.lexer(markdown), token => {
    if (token.type === "html") throw new Error(t("서식을 보존할 수 없어 별도 사본으로 보관해야 합니다."));
  });
  return markdown;
}
