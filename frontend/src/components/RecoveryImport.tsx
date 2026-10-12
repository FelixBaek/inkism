import React, { useRef, useState } from "react";
import { FileUp } from "../icons";
import type { Note } from "../types";
import { api, rpc, RpcError } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import { parseDraftRecovery, RECOVERY_FILE_LIMIT } from "../lib/draft-recovery";
import { applyHtmlEdits } from "../lib/paged-body";
import { sanitizeRichHtml } from "../lib/sanitize";

type Recovery = ReturnType<typeof parseDraftRecovery>;
type Edits = Extract<Recovery["body"], { kind: "partial" }>["edits"];

function partialRecoveryHtml(edits: Edits) {
  return (
    "<p>기준 본문이 없어 편집한 구간만 복구했습니다. 아래 구간은 변경 순서이며 서로 겹칠 수 있습니다.</p>" +
    edits
      .map(
        (edit, i) =>
          "<h2>편집 구간 " +
          (i + 1) +
          "</h2>" +
          (edit.replacement ? sanitizeRichHtml(edit.replacement) : "<p>이 구간을 삭제했습니다.</p>"),
      )
      .join("")
  );
}

/** Rebuilds the note body; null means the user declined a partial recovery. */
async function recoverContent(
  recovery: Recovery,
  confirm: ReturnType<typeof useStore>["confirm"],
): Promise<{ content: string; partial: boolean } | null> {
  const body = recovery.body;
  if (body.kind === "complete") return { content: body.content, partial: false };
  try {
    const base = await api.revisionBody(recovery.note.id, body.revision);
    return { content: applyHtmlEdits(base.content, body.edits), partial: false };
  } catch (error) {
    // Network, permission and database failures must not masquerade as a missing baseline.
    if (!(error instanceof RpcError && error.message.startsWith("not_found:"))) throw error;
    const accepted = await confirm({
      title: t("편집 구간 복구"),
      message: t(
        "기준 본문이 없어 문서 전체를 복구할 수 없습니다. 파일에 남은 편집 구간을 변경 순서대로 새 노트에 담을까요? 삭제한 구간도 별도로 표시합니다.",
      ),
      confirmLabel: t("편집 구간 복구"),
    });
    if (!accepted) return null;
    return { content: partialRecoveryHtml(body.edits), partial: true };
  }
}

export function RecoveryImport() {
  const s = useStore(),
    input = useRef<HTMLInputElement>(null),
    running = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const importFile = async (file: File) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > RECOVERY_FILE_LIMIT) throw new Error(t("편집 보관 파일은 128MB까지 가져올 수 있습니다."));
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const recovery = parseDraftRecovery(raw);
      const recovered = await recoverContent(recovery, s.confirm);
      if (!recovered) return;
      const { content, partial } = recovered;
      const title =
        Array.from(recovery.note.title).slice(0, 1980).join("") + (partial ? " (편집 구간 복구)" : " (편집 복구)");
      // No original id/revision is passed: import always creates a separate note.
      const note = await rpc<Note>("save", {
        note: {
          title,
          content,
          content_format: partial ? "html" : recovery.note.content_format,
          tags: recovery.note.tags,
          notebook_id: s.notebooks.some((nb) => nb.id === recovery.note.notebook_id) ? recovery.note.notebook_id : null,
        },
      });
      s.refreshList();
      await s.refreshMeta();
      setMessage(t("새 노트로 복구했습니다: {title}", { title }));
      // Keep an unresolved or newly edited draft visible; importing must not discard it.
      if (!s.readDraft()) {
        s.setView({ type: "all" });
        await s.selectNote(note.id);
      }
    } catch (error) {
      await s.showError(t("편집 보관 파일 가져오기 실패"), error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="side-item" disabled={busy} onClick={() => input.current?.click()}>
        <span className="side-icon" aria-hidden>
          <FileUp size={15} />
        </span>
        <span className="side-label">{busy ? t("편집 복구 중…") : t("편집 보관 파일 가져오기")}</span>
      </button>
      {message && (
        <p>
          <output>{message}</output>
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label={t("편집 보관 파일")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </>
  );
}
