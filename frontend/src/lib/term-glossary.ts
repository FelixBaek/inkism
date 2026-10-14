import { rpc } from '../api';
import { knowledge, type KnowledgeSettings } from './knowledge';

export type TermGlossaryEntry = {
  id: string;
  term: string;
  definition: string;
  noteId?: string;
  type?: string;
  lang?: string;
};
export type TermGlossaryInput = Omit<TermGlossaryEntry, 'id'> & { id?: string };
const normalize = (text: string) => text.trim().normalize('NFC').toLowerCase();

/** Suggestions only: equal labels may have different meanings and never imply identity. */
export function findGlossaryEntry(entries: TermGlossaryEntry[], term: string, lang = '') {
  return entries.find(entry => normalize(entry.term) === normalize(term) && normalize(entry.lang ?? '') === normalize(lang));
}

/** Only the glossary field is written. The settings version prevents lost updates across windows. */
async function persist(settings: KnowledgeSettings, glossary: TermGlossaryEntry[]) {
  return rpc<KnowledgeSettings>('knowledge_settings_set', { version: settings.version, glossary });
}
export const termGlossary = {
  async list(): Promise<TermGlossaryEntry[]> {
    return (await knowledge.settings()).glossary ?? [];
  },
  async save(input: TermGlossaryInput): Promise<TermGlossaryEntry> {
    const settings = await knowledge.settings();
    const entries = settings.glossary ?? [];
    const entry: TermGlossaryEntry = {
      id: input.id ?? crypto.randomUUID(),
      term: input.term.trim(), definition: input.definition.trim(),
      ...(input.noteId ? { noteId: input.noteId } : {}),
      ...(input.type?.trim() ? { type: input.type.trim() } : {}),
      ...(input.lang?.trim() ? { lang: input.lang.trim() } : {}),
    };
    const next = entries.filter(item => item.id !== entry.id);
    next.push(entry);
    await persist(settings, next);
    return entry;
  },
  async remove(id: string): Promise<void> {
    const settings = await knowledge.settings();
    const entries = settings.glossary ?? [];
    if (entries.some(entry => entry.id === id)) await persist(settings, entries.filter(entry => entry.id !== id));
  },
};
