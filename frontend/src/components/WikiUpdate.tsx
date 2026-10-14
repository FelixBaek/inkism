import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Note } from "../types";
import { t } from "../i18n";
import { aiConfig, completeAI } from "../lib/ai-provider";
import { diffLines, toLines } from "../lib/version-diff";
import { sanitizeRichHtml } from "../lib/sanitize";
import { htmlBlocks, plainTextOf, errorText } from "../lib/text";
import { formatDateTime } from "../lib/date";
import { cleanOutput, wiki, wikiPassages, wikiPrompt, type WikiChange, type WikiProposal, type WikiSource } from "../lib/wiki-update";
import { DiffCell } from "./DialogHost";

function statusLabel(status: WikiProposal["status"]) {
  if (status === "applied") return t("반영됨");
  if (status === "rejected") return t("거절함");
  if (status === "undone") return t("되돌림");
  return t("검토 대기");
}

/** Readable linked sources; notes locked, trashed or changed since listing are left out. */
async function readSources(listed: WikiSource[]) {
  const texts = new Map<string, string>();
  const usable: WikiSource[] = [];
  for (const s of listed) {
    const note = await api.get(s.id).catch(() => null); // NOSONAR: sequential keeps reads bounded
    if (!note || note.trashed || ("locked" in note && note.locked) || note.revision !== s.revision) continue;
    usable.push(s);
    texts.set(s.id, plainTextOf(note));
  }
  return { usable, texts };
}

async function editableNote(id: string): Promise<Note> {
  const note = await api.get(id);
  if (note.trashed || note.readonly || ("locked" in note && note.locked)) throw new Error(t("현재 노트를 편집할 수 없습니다."));
  return note;
}

/** One AI call for a new key; earlier identical inputs return their stored result. */
async function propose(id: string): Promise<{ proposal?: WikiProposal; message?: string }> {
  const { enabled, model } = aiConfig();
  if (!enabled || !model) throw new Error(t("설정의 AI 연결에서 서버와 모델을 등록해 주세요."));
  const note = await editableNote(id);
  const { usable, texts } = await readSources((await wiki.sources(id)).items);
  if (!usable.length) return { message: t("연결된 노트가 없어 AI에 보내지 않았습니다.") };
  const check = await wiki.check(id, usable, model);
  const existing = check.existing;
  if (existing?.status === "applied" || existing?.status === "rejected") return { message: t("새로 반영할 변경이 없습니다.") };
  if (existing) return { proposal: existing };
  const prompt = wikiPrompt(note, wikiPassages(check.sources, texts));
  const html = (note.content_format ?? "html") === "html";
  const output = cleanOutput(await completeAI(prompt.instruction, prompt.source), note.content);
  const after = html ? sanitizeRichHtml(output) : output;
  if (after.trim() === note.content.trim()) return { message: t("AI 결과가 지금 본문과 같아 바꿀 것이 없습니다.") };
  const proposal = await wiki.record({ note_id: id, revision: note.revision, sources: check.sources, model, after, after_text: html ? htmlBlocks(after).join("\n") : undefined });
  return { proposal };
}

function ProposalView({ proposal, busy, onApprove, onReject }: Readonly<{ proposal: WikiProposal; busy: boolean; onApprove: () => void; onReject: () => void }>) {
  const diff = diffLines(toLines(proposal.before ?? "", proposal.content_format), toLines(proposal.after ?? "", proposal.content_format));
  return (
    <section className="wiki-proposal" aria-label={t("위키 갱신 제안 내용")}>
      <h3>{t("AI가 쓴 제안 · 근거 {count}개", { count: proposal.sources.length })}</h3>
      <ol className="wiki-evidence" aria-label={t("근거 노트")}>
        {proposal.sources.map((s) => (
          <li key={s.id}>
            {s.title || t("제목 없음")} <small>{t("버전 {revision}", { revision: s.revision })}</small>
          </li>
        ))}
      </ol>
      <div className="history-diff" aria-label={t("지금 본문과 제안 비교")}>
        {"tooLarge" in diff ? (
          <p className="dialog-message">{t("노트가 커서 문단 비교를 생략했어요.")}</p>
        ) : (
          <div className="history-diff-rows">
            {diff.rows.map((r, i) => (
              <div key={i} className="diff-row">
                <DiffCell text={r.left} kind={r.kind === "same" ? "same" : "del"} />
                <DiffCell text={r.right} kind={r.kind === "same" ? "same" : "add"} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="writing-tools-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onApprove}>
          {t("제안 승인")}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onReject}>
          {t("제안 거절")}
        </button>
      </div>
    </section>
  );
}

function ChangeRow({ item, busy, onUndo }: Readonly<{ item: WikiChange; busy: boolean; onUndo: () => void }>) {
  return (
    <li className="wiki-change">
      <span>
        {formatDateTime(item.created_at)} · {statusLabel(item.status)} · {item.sources.map((s) => s.title).join(", ")}
      </span>
      {item.stale && <span className="wiki-stale">{t("근거 변경됨")}</span>}
      {item.can_undo && (
        <button type="button" className="btn btn-small" disabled={busy} onClick={onUndo}>
          {t("반영 되돌리기")}
        </button>
      )}
    </li>
  );
}

/** "위키 갱신 제안": evidence, line diff, Approve/Reject and an undoable history for the open note. */
export function WikiUpdate() {
  const s = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<WikiProposal | null>(null);
  const [changes, setChanges] = useState<WikiChange[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (noteId) dialog.current?.showModal();
    else dialog.current?.close();
  }, [noteId]);
  const refresh = async (id: string) => setChanges((await wiki.changes(id).catch(() => ({ items: [] }))).items);
  const run = async (id: string, task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!(await s.flushNow())) throw new Error(t("저장을 완료한 뒤 다시 시도해 주세요."));
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      await refresh(id);
      setBusy(false);
    }
  };
  const open = () => {
    const id = s.note?.id;
    if (!id) return;
    setNoteId(id);
    setProposal(null);
    setMessage("");
    setError("");
    void refresh(id);
  };
  const close = () => {
    if (!busy) setNoteId(null);
  };
  const change = (id: string, action: () => Promise<WikiProposal>, done: string) =>
    void run(id, async () => {
      const result = await action();
      setProposal(null);
      if (result.status !== "rejected") await s.reloadCurrentNote(id);
      setMessage(done);
    });
  const id = noteId ?? "";
  return (
    <>
      <div className="writing-tools">
        <button type="button" className="btn btn-secondary" disabled={!s.note} onClick={open}>
          <span>{t("위키 갱신 제안")}</span>
        </button>
      </div>
      <dialog ref={dialog} className="writing-tools-dialog wiki-update-dialog" aria-label={t("위키 갱신 제안")} onCancel={(e) => {
        e.preventDefault();
        close();
      }}>
        <header>
          <strong>{t("위키 갱신 제안")}</strong>
          <button type="button" className="btn" onClick={close} disabled={busy} aria-label={t("닫기")}>
            ×
          </button>
        </header>
        <p className="writing-tools-hint">{t("연결된 노트(역링크·나가는 링크)의 내용을 근거로 AI가 이 노트의 갱신안을 씁니다. 잠긴 노트와 휴지통의 노트는 보내지 않습니다.")}</p>
        <button type="button" className="btn" disabled={busy || !noteId} onClick={() => void run(id, async () => {
          const result = await propose(id);
          setProposal(result.proposal ?? null);
          setMessage(result.message ?? "");
        })}>
          {busy ? t("처리 중…") : t("갱신안 만들기")}
        </button>
        {message && <output className="writing-tools-hint">{message}</output>}
        {error && <p role="alert" className="writing-tools-error">{error}</p>}
        {proposal && <ProposalView proposal={proposal} busy={busy} onApprove={() => change(id, () => wiki.apply(proposal.id), t("제안을 반영했습니다."))} onReject={() => change(id, () => wiki.reject(proposal.id), t("제안을 거절했습니다."))} />}
        <section className="writing-tools-divided" aria-label={t("위키 갱신 기록")}>
          <h3>{t("위키 갱신 기록")}</h3>
          {changes.length === 0 ? <p className="writing-tools-hint">{t("아직 기록이 없습니다.")}</p> : (
            <ul className="wiki-changes">
              {changes.map((item) => <ChangeRow key={item.id} item={item} busy={busy} onUndo={() => change(id, () => wiki.undo(item.id), t("반영을 되돌렸습니다."))} />)}
            </ul>
          )}
        </section>
      </dialog>
    </>
  );
}
