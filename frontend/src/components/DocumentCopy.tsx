import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { Draft } from "../types";
import { readPagedBody } from "../lib/paged-body";
import { deriveTextInWorker } from "../lib/plaintext-client";
import { plainTextOf } from "../lib/text";
import { t } from "../i18n";

// Shown as-is when thrown; must match the messages thrown here and by store.stageWholeBody.
const UNSUPPORTED = "이 환경에서 문서 복사를 지원하지 않습니다. Markdown 내보내기를 이용해 주세요.";
const CUT_CANCELED = "복사하는 동안 문서가 변경되어 잘라내기를 취소했습니다.";

/** Writes the draft's HTML and text to the clipboard; resolves to the captured HTML (still a promise). */
async function writeDraftToClipboard(draft: Draft) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error(t(UNSUPPORTED));
  }
  // Capture both representations before any asynchronous work. A later edit
  // must not mix new text with old HTML; copying also works after save failure.
  const html = draft.paged ? readPagedBody(draft.id, draft.paged) : Promise.resolve(draft.content);
  const text = draft.textDirty ? html.then(deriveTextInWorker) : Promise.resolve(plainTextOf(draft));
  const item = new ClipboardItem({
    "text/html": html.then((value) => new Blob([value], { type: "text/html" })),
    "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })),
  });
  // Start write in the click handler; do not lose user activation awaiting text.
  await navigator.clipboard.write([item]);
  return { html };
}

function copyFailureMessage(e: unknown) {
  return e instanceof Error && (e.message === t(UNSUPPORTED) || e.message === t(CUT_CANCELED))
    ? e.message
    : t("문서를 복사하지 못했습니다. 창을 활성화한 뒤 다시 시도해 주세요.");
}

/** Copy the draft snapshot without mounting the complete document or saving it. */
export function DocumentCopy({ readDraft }: Readonly<{ readDraft: () => Draft | null }>) {
  const store = useStore();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const copy = async (cut = false) => {
    if (running.current) return;
    window.dispatchEvent(new Event("inkism-flush-editor"));
    const draft = readDraft();
    if (!draft || busy) return;
    if (cut && draft.readonly) return;
    const revision = draft.revision,
      version = draft.paged?.version;
    running.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const { html } = await writeDraftToClipboard(draft);
      if (!alive.current) return;
      if (cut) store.stageWholeBody(draft, revision, version, "", await html, "cut");
      if (alive.current) setMessage(cut ? t("문서 전체를 잘라냈습니다.") : t("문서 전체를 복사했습니다."));
    } catch (e) {
      if (alive.current) {
        setFailed(true);
        setMessage(copyFailureMessage(e));
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="document-copy">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void copy(false)}>
        {busy ? t("복사 중…") : t("문서 전체 복사")}
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || store.draft?.readonly || store.saveState === "saving" || store.saveState === "conflict"}
        onClick={() => void copy(true)}
      >
        {t("문서 전체 잘라내기")}
      </button>
      {message && <span role={failed ? "alert" : "status"}>{message}</span>}
    </div>
  );
}
