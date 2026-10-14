import { Mark } from '@tiptap/core';

export type TermDefinitionAttrs = { id: string; definition: string; glossaryId?: string | null; noteId?: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Reads the annotation attributes; missing ones are null like getAttribute. */
export function termAttrs(element: HTMLElement) {
  const d = element.dataset;
  return {id: d.termId ?? null, definition: d.termDefinition ?? null, glossaryId: d.termGlossaryId ?? null, noteId: d.termNoteId ?? null};
}

export function validTermDefinition(value: unknown): value is TermDefinitionAttrs {
  if (!value || typeof value !== 'object') return false;
  const a = value as TermDefinitionAttrs;
  return typeof a.id === 'string' && uuid.test(a.id) && typeof a.definition === 'string' &&
    a.definition.trim().length > 0 && Array.from(a.definition).length <= 2000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(a.definition) &&
    [a.glossaryId, a.noteId].every(id => id == null || (typeof id === 'string' && uuid.test(id)));
}

/** Definition text is document content, never HTML or a remote URL. */
export const TermDefinition = Mark.create({
  name: 'termDefinition',
  inclusive: false,
  addAttributes() {
    return Object.fromEntries(Object.entries({id:'data-term-id', definition:'data-term-definition', glossaryId:'data-term-glossary-id', noteId:'data-term-note-id'}).map(([name,attribute]) => [name, {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute(attribute),
      rendered: false,
    }]));
  },
  parseHTML() {
    return [{tag:'span[data-term-id][data-term-definition]', getAttrs: element => {
      const a = termAttrs(element);
      return validTermDefinition(a) ? a : false;
    }}];
  },
  renderHTML({mark}) {
    // DOMSerializer escapes attribute text, including quotes and angle brackets.
    if (!validTermDefinition(mark.attrs)) return ['span', {}, 0];
    const a = mark.attrs;
    return ['span', {'data-term-id':a.id, 'data-term-definition':a.definition,
      ...(a.glossaryId ? {'data-term-glossary-id':a.glossaryId} : {}),
      ...(a.noteId ? {'data-term-note-id':a.noteId} : {})}, 0];
  },
});
