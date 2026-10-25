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
export function noteTasks(source: string, format: ContentFormat): NoteTask[] {
  if (new TextEncoder().encode(source).length > TASK_SCAN_BYTES) throw new Error('TASK_SCAN_TOO_LARGE');
  if (format === 'text') return [];
  const tasks: NoteTask[] = [];
  if (format === 'markdown') {
    markdown ??= new MarkdownManager({ extensions: contentExtensions() });
    const visit = (node: JSONContent) => {
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
    const copy = item.cloneNode(true) as HTMLElement;
    for (const nested of copy.querySelectorAll('ul,ol,label,input,button')) nested.remove();
    for (const br of copy.querySelectorAll('br')) br.replaceWith('\n');
    for (const block of copy.querySelectorAll('p,div')) block.append('\n');
    tasks.push({ ordinal: tasks.length, text: (copy.textContent ?? '').trim(), checked: item.getAttribute('data-checked') === 'true' });
  }
  return tasks;
}
