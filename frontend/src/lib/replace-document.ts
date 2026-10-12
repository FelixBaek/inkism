import { elementFromString, getHTMLFromFragment, getSchema } from "@tiptap/core";
import { DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { searchDocument } from "@tiptap/extension-find-and-replace";
import { contentExtensions } from "../extensions/content-schema";
import { sanitizeRichHtml } from "./sanitize";
import { api } from "../api";
import { t } from "../i18n";
const schema = getSchema(contentExtensions()),
  parser = ProseMirrorParser.fromSchema(schema);

/** Same textblock matching as the interactive editor; never searches attributes. */
export function replaceBlock(html: string, query: string, replacement: string, sensitive: boolean) {
  const doc = parser.parse(elementFromString(sanitizeRichHtml(html)));
  const matches = searchDocument(doc, query, { caseSensitive: sensitive, useRegex: false, wholeWord: false });
  if (!matches.length) return { html, count: 0 };
  const tr = EditorState.create({ doc }).tr;
  for (const match of matches.slice().reverse()) tr.insertText(replacement, match.from, match.to);
  if (tr.doc.eq(doc)) return { html, count: 0 };
  return { html: getHTMLFromFragment(tr.doc.content, schema), count: matches.length };
}

interface ReplaceProgress {
  chunks: string[];
  original: string[];
  count: number;
  bytes: number;
  yieldAt: number;
}

/** Replaces inside each block of one page, enforcing the 20MB cap and yielding to input. */
async function replaceBlocks(
  blocks: { html: string }[],
  state: ReplaceProgress,
  query: string,
  replacement: string,
  sensitive: boolean,
  check: () => void,
) {
  for (const block of blocks) {
    check();
    const changed = replaceBlock(block.html, query, replacement, sensitive);
    state.original.push(block.html);
    state.chunks.push(changed.html);
    state.count += changed.count;
    state.bytes += new TextEncoder().encode(changed.html).length;
    if (state.bytes > 20 * 1024 * 1024) throw new Error(t("바꾼 문서가 최대 크기 20MB를 넘습니다."));
    // Yield between blocks, keeping cancellation and editor input responsive.
    if (performance.now() >= state.yieldAt) {
      await new Promise((r) => setTimeout(r, 0));
      state.yieldAt = performance.now() + 8;
    }
  }
}

export async function replaceDocument(
  id: string,
  revision: number,
  query: string,
  replacement: string,
  sensitive: boolean,
  check: () => void,
  progress: (done: number, total: number) => void,
) {
  if (!query) throw new Error(t("찾을 내용을 입력해 주세요."));
  const state: ReplaceProgress = { chunks: [], original: [], count: 0, bytes: 0, yieldAt: 0 };
  let offset = 0;
  const deadline = Date.now() + 60000;
  state.yieldAt = performance.now() + 8;
  for (;;) {
    check();
    // An explicit whole-document replacement retains its existing full-block
    // scan contract. Viewport loading and selection use bounded reads instead.
    const page = await api.documentBlocks(id, { revision, offset, limit: 128, bounded: false });
    check();
    if (!page.ready) {
      if (Date.now() > deadline) throw new Error(t("문서를 준비 중입니다. 잠시 후 다시 시도해 주세요."));
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    await replaceBlocks(page.blocks, state, query, replacement, sensitive, check);
    progress(offset + page.blocks.length, page.total_blocks ?? 0);
    if (page.next_offset === null) break;
    if (page.next_offset <= offset) throw new Error(t("문서 구간을 읽지 못했습니다."));
    offset = page.next_offset;
  }
  check();
  return { content: state.chunks.join(""), before: state.original.join(""), count: state.count };
}
