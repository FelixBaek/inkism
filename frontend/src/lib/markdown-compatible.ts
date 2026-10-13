import { generateHTML, getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { DOMParser as SchemaDOMParser } from "@tiptap/pm/model";
import {canonicalRichHTML,inspectRichHTML} from "./rich-document";
import { editableMarkdown } from "./markdown";
import { sanitizeRichHtml } from "./sanitize";
import {TermDefinition, validTermDefinition} from "../extensions/term-definition";
import { t } from "../i18n";

// A single audited inline extension; arbitrary HTML remains outside the GFM editor.
const MarkdownTermDefinition = TermDefinition.extend({
  markdownTokenName: 'termDefinition',
  markdownTokenizer: {
    name: 'termDefinition', level: 'inline', start: '<span',
    tokenize(source, _tokens, lexer) {
      const match = /^<span\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/span\s*>/i.exec(source);
      if (!match || /(^|[^\\])<\/?[a-z!]/i.test(match[2]) || /\n\s*\n/.test(match[2])) return undefined;
      const template = document.createElement('template'); template.innerHTML = match[0];
      const span = template.content.firstElementChild;
      if (!span || template.content.childNodes.length !== 1 || span.tagName !== 'SPAN') return undefined;
      const allowed = ['data-term-id','data-term-definition','data-term-glossary-id','data-term-note-id'];
      if (Array.from(span.attributes).some(a => !allowed.includes(a.name))) return undefined;
      // Reject duplicate attributes before the DOM parser can normalize them away.
      const names = Array.from(match[1].matchAll(/([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g), a => a[1].toLowerCase());
      if (new Set(names).size !== names.length || names.length !== span.attributes.length) return undefined;
      const attrs = {id:span.getAttribute('data-term-id'),definition:span.getAttribute('data-term-definition'),glossaryId:span.getAttribute('data-term-glossary-id'),noteId:span.getAttribute('data-term-note-id')};
      if (!validTermDefinition(attrs)) return undefined;
      return {type:'termDefinition',raw:match[0],attrs,tokens:lexer.inlineTokens(match[2])};
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark('termDefinition', helpers.parseInline(token.tokens || []), token.attrs);
  },
  renderMarkdown(node, helpers) {
    if (!validTermDefinition(node.attrs)) throw compatibilityError();
    const span = document.createElement('span'),a=node.attrs;
    span.setAttribute('data-term-id',a.id);span.setAttribute('data-term-definition',a.definition);
    if(a.glossaryId)span.setAttribute('data-term-glossary-id',a.glossaryId);
    if(a.noteId)span.setAttribute('data-term-note-id',a.noteId);
    return span.outerHTML.replace('</span>',helpers.renderChildren(node)+'</span>');
  },
});

// Markdown with tables/checklists and validated inline term definitions.
export const markdownContentExtensions = () => [
  MarkdownTermDefinition,
  StarterKit.configure({
    trailingNode: false,
    underline: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "note"] },
  }),
  Image.configure({ inline: false, allowBase64: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];
const extensions = markdownContentExtensions(),
  schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });
export const MARKDOWN_COMPATIBLE_LIMIT = 256 * 1024;
const normalize = (doc: JSONContent) => {
  // Empty visual paragraphs are writing space, not Markdown blocks. They
  // have no Markdown representation; keep Enter/blank lines saveable while
  // preserving actual text, hard breaks and empty list items.
  const content = doc.content?.filter(node => node.type !== "paragraph" || Boolean(node.content?.length));
  const node = schema.nodeFromJSON({ ...doc, content });
  return (node.childCount ? node : schema.topNodeType.createAndFill()!).toJSON();
};
const same = (a: JSONContent, b: JSONContent) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
export const compatibilityError = () =>
  new Error(t("이 서식은 Markdown 에디터에서 보존할 수 없습니다. HTML 에디터나 원문 편집을 이용해 주세요."));
function checkSyntax(source: string) {
  const tokens = manager.instance.lexer(source);
  manager.instance.walkTokens(tokens, (token) => {
    if (token.type === "html" || (token.type === "def" && String(token.tag).startsWith("^")))
      throw compatibilityError();
  });
}
export function markdownDefinitions(source: string): string[] {
  const definitions: string[] = [];
  manager.instance.walkTokens(manager.instance.lexer(source.replace(/^\uFEFF/, "")), (token) => {
    if (token.type === "def") definitions.push(token.raw);
  });
  return definitions;
}
export function serializeCompatibleMarkdown(doc: JSONContent, definitions: readonly string[] = []): string {
  const body = manager.serialize(normalize(doc));
  // Reference definitions may not appear in the rendered document. Retain
  // them instead of silently deleting unused source data on the first edit.
  const source = definitions.length ? body + "\n\n" + definitions.join("\n") : body;
  if (new Blob([source]).size > MARKDOWN_COMPATIBLE_LIMIT)
    throw new Error(t("Markdown 서식 편집은 256KB까지 지원합니다. 원문 편집을 이용해 주세요."));
  checkSyntax(source);
  if (!same(doc, manager.parse(source))) throw compatibilityError();
  return source;
}
export function compatibleMarkdownHTML(source: string): string {
  if (new Blob([source]).size > MARKDOWN_COMPATIBLE_LIMIT)
    throw new Error(t("Markdown 서식 편집은 256KB까지 지원합니다. 원문 편집을 이용해 주세요."));
  // A leading BOM is an encoding marker. Projection does not rewrite storage.
  const input = source.replace(/^\uFEFF/, "");
  checkSyntax(input);
  const doc = manager.parse(input);
  serializeCompatibleMarkdown(doc);
  const html = generateHTML(doc, extensions);
  const inputDOM = document.createElement("template");
  inputDOM.innerHTML = sanitizeRichHtml(html);
  const restored = SchemaDOMParser.fromSchema(schema).parse(inputDOM.content, { preserveWhitespace: "full" });
  if (!same(doc, restored.toJSON())) throw compatibilityError();
  return html;
}
export function compatibleHTMLMarkdown(html: string): string {
  if (html.includes('data-term-id')) {
    if (!inspectRichHTML(html).editable) throw compatibilityError();
    const template = document.createElement('template'); template.innerHTML = sanitizeRichHtml(html);
    const doc = SchemaDOMParser.fromSchema(schema).parse(template.content, {preserveWhitespace:'full'}).toJSON();
    if (canonicalRichHTML(html) !== canonicalRichHTML(generateHTML(doc,extensions))) throw compatibilityError();
    return serializeCompatibleMarkdown(doc);
  }
  const source = editableMarkdown(html);
  compatibleMarkdownHTML(source); // refuses HTML fallbacks rather than dropping them
  return source;
}
export const MARKDOWN_BLOCKS = new Set([
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "taskList",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "image",
]);
