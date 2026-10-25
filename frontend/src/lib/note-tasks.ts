import { MarkdownManager } from '@tiptap/markdown';
import type { JSONContent } from '@tiptap/core';
import { contentExtensions } from '../extensions/content-schema';
import type { ContentFormat } from '../types';

/** A read projection. Never serialize this list back over a user's document. */
export interface NoteTask { ordinal: number; text: string; checked: boolean }
export const TASK_SCAN_BYTES = 8 * 1024 * 1024;
let markdown: MarkdownManager | undefined;

function inlineText(node: JSONContent): string {
  if (node.type === 'taskList' || node.type === 'bulletList' || node.type === 'orderedList') return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const value = (node.content ?? []).map(inlineText).join('');
  return ['paragraph', 'heading'].includes(node.type ?? '') ? value + '\n' : value;
}

/** Rich checklists and Markdown tasks; plain text is never reinterpreted as markup. */
export function noteTasks(source: string, format: ContentFormat, limit = Infinity): NoteTask[] {
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Invalid task limit');
  if (new TextEncoder().encode(source).length > TASK_SCAN_BYTES) throw new Error('TASK_SCAN_TOO_LARGE');
  if (format === 'text') return [];
  const tasks: NoteTask[] = [];
  if (format === 'markdown') {
    markdown ??= new MarkdownManager({ extensions: contentExtensions() });
    const visit = (node: JSONContent) => {
      if (tasks.length >= limit) return;
      if (node.type === 'taskItem') tasks.push({ ordinal: tasks.length, text: inlineText(node).trim(), checked: node.attrs?.checked === true });
      for (const child of node.content ?? []) visit(child);
    };
    visit(markdown.parse(source.replace(/^\uFEFF/, '')));
    return tasks;
  }
  // Template contents are inert: no script, resource loading or DOM insertion.
  const template = document.createElement('template');
  template.innerHTML = source;
  for (const node of template.content.querySelectorAll('script,style,textarea,title,pre,code,template')) node.remove();
  for (const item of template.content.querySelectorAll('li[data-type="taskItem"]')) {
    if (tasks.length >= limit) break;
    // Walk only this item's label. Cloning each subtree would be quadratic
    // for deeply nested lists, and child tasks have their own rows.
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => node instanceof Element && node.matches('ul,ol,li,label,input,button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let text = '', child: Node | null;
    while ((child = walker.nextNode())) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
      else if (child instanceof Element && child.matches('p,div,br')) text += '\n';
    }
    tasks.push({ ordinal: tasks.length, text: text.trim(), checked: item.getAttribute('data-checked') === 'true' });
  }
  return tasks;
}
