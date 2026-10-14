import { rpc } from "../api";
/** Wiki update proposals: the AI sees only the wiki body and numbered passages from linked, unlocked notes. */
export type WikiSource = { id: string; title: string; revision: number };
export type WikiPassage = WikiSource & { n: number; text: string };
export type WikiProposal = { id: string; note_id: string; status: "proposed" | "applied" | "rejected" | "undone"; before: string | null; after: string | null; content_format: string; sources: WikiSource[]; model: string; created_at: number };
export type WikiChange = { id: string; status: WikiProposal["status"]; sources: WikiSource[]; model: string; created_at: number; stale: boolean; can_undo: boolean };

export const wiki = {
  sources: (note_id: string) => rpc<{ items: WikiSource[] }>("wiki_sources", { note_id }),
  check: (note_id: string, sources: WikiSource[], model: string) => rpc<{ existing: WikiProposal | null; sources: WikiSource[] }>("wiki_check", { note_id, sources: sources.map(({ id, revision }) => ({ id, revision })), model }),
  record: (args: { note_id: string; revision: number; sources: WikiSource[]; model: string; after: string; after_text?: string }) => rpc<WikiProposal>("wiki_propose_record", { ...args, sources: args.sources.map(({ id, revision }) => ({ id, revision })) }),
  apply: (id: string) => rpc<WikiProposal>("wiki_apply", { id }),
  reject: (id: string) => rpc<WikiProposal>("wiki_reject", { id }),
  undo: (id: string) => rpc<WikiProposal>("wiki_undo", { id }),
  changes: (note_id: string) => rpc<{ items: WikiChange[] }>("wiki_changes", { note_id }),
};

/** Numbers passages in the engine's source order and keeps each within a share of the budget. */
export function wikiPassages(sources: WikiSource[], texts: Map<string, string>, maxChars = 24000): WikiPassage[] {
  const each = Math.floor(maxChars / Math.max(1, sources.length));
  return sources.map((s, i) => ({ ...s, n: i + 1, text: (texts.get(s.id) ?? "").trim().slice(0, each) }));
}

export function wikiPrompt(current: { content: string; content_format?: string }, passages: WikiPassage[]) {
  const format = current.content_format === "html" || !current.content_format ? "HTML" : "Markdown";
  return {
    instruction: `Update the wiki note in <current> using only the numbered sources. Keep its structure, headings and anything the sources do not contradict. Add or correct facts from the sources and cite each added or changed fact with its source number like [1]. Return the complete updated note body as ${format}, with no explanation and no code fence.`,
    source: `<current>\n${current.content}\n</current>\n\n` + passages.map((p) => `[${p.n}] ${p.title}\n${p.text}`).join("\n\n"),
  };
}

/** The whole note comes back, so a proposal may take longer than a short answer (60s ran out in the live eval). */
export const WIKI_TIMEOUT = 180000;

function unfence(body: string): string | null {
  const open = body.indexOf("\n");
  return body.startsWith("```") && body.endsWith("```") && open > 0 && open < body.length - 3 ? body.slice(open + 1, -3).trim() : null;
}

/** Removes a whole-output code fence the model may add despite the instruction, with a one-line lead-in ("Here is the updated note:") before it. */
export function cleanOutput(output: string, current: string): string {
  const trimmed = output.trim();
  const lead = /^[^\n`]*[:：]\s*\n/.exec(trimmed);
  // The note's own first line ("Steps:" before a code block) is content, not a lead-in.
  const extra = lead && !current.trimStart().startsWith(lead[0].trim()) ? lead[0].length : 0;
  const body = unfence(trimmed) ?? (extra ? unfence(trimmed.slice(extra).trim()) : null) ?? trimmed;
  return current.endsWith("\n") ? body + "\n" : body;
}
