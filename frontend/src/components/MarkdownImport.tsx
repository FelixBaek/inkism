import React, { useRef, useState } from "react";
import { FileUp } from "../icons";
import { rpc } from "../api";
import type { Note } from "../types";
import { useStore } from "../store";
import { t } from "../i18n";

export function MarkdownImport({ className = "btn btn-primary" }: Readonly<{ className?: string }>) {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const importing = useRef(false);
  const importFile = async (file: File) => {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    try {
      if (!(await s.flushNow())) return;
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      const title = file.name.replace(/\.(md|markdown)$/i, "").trim() || "Markdown 노트";
      const note = await rpc<Note>("save", { note: { title, content, content_format: "markdown", tags: [] } });
      s.setView({ type: "all" });
      s.refreshList();
      await s.refreshMeta();
      await s.selectNote(note.id);
    } catch (error) {
      await s.showError(t("Markdown 가져오기 실패"), error instanceof Error ? error.message : String(error));
    } finally {
      importing.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => input.current?.click()}
        title={t("UTF-8 Markdown 파일을 새 노트로 가져옵니다. 첨부파일 원본은 ZIP 백업으로 옮겨 주세요.")}
      >
        <FileUp size={14} aria-hidden />
        {busy ? t("Markdown 가져오는 중…") : t("Markdown 가져오기")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,text/markdown"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </>
  );
}
