import { t } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import type { Summary } from "../types";
import type { SearchDocument } from "../lib/search-document-core";
import type { SearchHit } from "../lib/global-search-core";
import { aiConfig, completeAI } from "../lib/ai-provider";
import { semanticHits } from "../lib/semantic-index";
import { answerParts, answerPrompt, candidateQuery, gatherEvidence, keywords, relatedNotes, type Evidence } from "../lib/note-answer";
import { knowledge } from "../lib/knowledge";
import { api } from "../api";

const relationLoaders = {
  relations: async (id: string, signal?: AbortSignal) => (await knowledge.relations({ id, limit: 20 }, signal)).items,
  summary: async (id: string) => (await api.documentInfo(id)).summary,
};

/** Reads each note body once per question, even when relation expansion revisits it. */
function cachedLoader(loadText: (note: Summary, signal?: AbortSignal) => Promise<string | SearchDocument>) {
  const texts = new Map<string, Promise<string | SearchDocument>>();
  return (note: Summary, signal?: AbortSignal) => {
    let text = texts.get(note.id);
    if (!text) {
      text = loadText(note, signal);
      texts.set(note.id, text);
    }
    return text;
  };
}

/** Keyword + semantic passages, then breadth-first typed hops (up to 2) from the best sources so the model can chain facts (책 —저자→ 사람 —소속→ 회사). */
async function retrieve(asked: string, loadCandidates: (query: string, signal: AbortSignal) => Promise<Summary[]>, loadText: (note: Summary, signal?: AbortSignal) => Promise<string | SearchDocument>, signal: AbortSignal) {
  const words = keywords(asked);
  const semantic = await semanticHits(asked, signal);
  if (!words.length && !semantic.length) throw new Error(t("질문에서 찾을 낱말을 고르지 못했습니다. 핵심 낱말을 넣어 주세요."));
  const notes = words.length ? await loadCandidates(candidateQuery(words), signal) : [];
  const load = cachedLoader(loadText);
  const evidence = await gatherEvidence(notes, words, load, { signal, semantic });
  const related = await relatedNotes(evidence, notes, relationLoaders, { signal });
  if (!related.notes.length) return { evidence, edges: related.edges };
  // Related notes are read on top of the keyword notes, not instead of them.
  const more = await gatherEvidence([...related.notes, ...notes], words, load, { signal, semantic, maxNotes: 20 + related.notes.length, related: related.hops });
  return { evidence: more, edges: related.edges };
}

/** Answers a question from retrieved note passages; every citation opens its source. */
export function NoteAnswer({ question, loadCandidates, loadText, onOpen }: Readonly<{ question: string; loadCandidates: (query: string, signal: AbortSignal) => Promise<Summary[]>; loadText: (note: Summary, signal?: AbortSignal) => Promise<string | SearchDocument>; onOpen?: (id: string, anchor?: string, hit?: SearchHit) => void }>) {
  const [state, setState] = useState<{ busy?: boolean; error?: string; answer?: string; evidence?: Evidence[]; asked?: string }>({});
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const cancel = () => { active.current?.abort(); active.current = null; setState(s => ({ ...s, busy: false })); };
  const ask = async () => {
    const asked = question.trim();
    if (!asked) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller;
    setState({ busy: true, asked });
    try {
      const { evidence, edges } = await retrieve(asked, loadCandidates, loadText, controller.signal);
      if (!current()) return;
      if (!evidence.length) { setState({ asked, evidence, error: t("근거가 될 노트를 찾지 못해 AI에 보내지 않았습니다.") }); return; }
      const prompt = answerPrompt(asked, evidence, edges);
      const answer = await completeAI(prompt.instruction, prompt.source, controller.signal);
      if (current()) setState({ asked, evidence, answer });
    } catch (e) {
      if (current() && !controller.signal.aborted) setState({ asked, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (current()) { active.current = null; setState(s => ({ ...s, busy: false })); }
    }
  };
  if (!aiConfig().enabled) return null;
  const { busy, error, answer, evidence = [], asked } = state;
  const cite = (e: Evidence) => <button type="button" className="note-answer-cite" key={`c${e.n}`} title={e.note.title} aria-label={t("근거 {n}: {title} 열기", { n: e.n, title: e.note.title })} onClick={() => onOpen?.(e.note.id, undefined, e.hit)}>[{e.n}]</button>;
  return <section className="note-answer" aria-label={t("내 노트에 묻기")}>
    <div className="note-answer-actions">
      <button type="button" onClick={() => void ask()} disabled={busy || !question.trim()}>{busy ? t("근거 찾는 중…") : t("내 노트에 묻기")}</button>
      {busy && <button type="button" onClick={cancel}>{t("취소")}</button>}
    </div>
    {error && <p role="alert" className="search-error">{error}</p>}
    {answer && <output className="note-answer-text" aria-label={t("답변: {question}", { question: asked ?? "" })}>{answerParts(answer, evidence).map(part => "cite" in part ? cite(part.cite) : <React.Fragment key={`t${part.at}`}>{part.text}</React.Fragment>)}</output>}
    {evidence.length > 0 && <details className="note-answer-sources"><summary>{t("AI에 보낸 근거 {count}개", { count: evidence.length })}</summary><ol className="global-search-results">{evidence.map(e => <li key={e.n} value={e.n}><button type="button" onClick={() => onOpen?.(e.note.id, undefined, e.hit)}><strong>{e.note.title}</strong><span>{e.text.slice(0, 240)}</span></button></li>)}</ol></details>}
  </section>;
}
