import React, { useEffect, useRef, useState } from "react";
import { Download, X } from "../icons";
import { printNote } from "../lib/print-note";
import { useStore } from "../store";
import { flushEditors } from "../lib/editor-flush";
import { readPagedBody } from "../lib/paged-body";
import type { Draft } from "../types";
import "./PreviewExport.css";
import { t } from "../i18n";

/** Drops trailing dots and spaces (Windows rejects them) without a backtracking regex. */
function trimDotsAndSpacesEnd(text: string) {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === " ")) end--;
  return text.slice(0, end);
}
function filename(title: string, extension: string) {
  let name = trimDotsAndSpacesEnd(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim()).slice(0, 100) || "inkism";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + name;
  return name + "." + extension;
}
function sourceExtension(format: string) {
  if (format === "markdown") return "md";
  return format === "text" ? "txt" : "html";
}
/** The draft still matches the saved revision the export was made from. */
function sameSaved(current: Draft | null, note: Draft) {
  return current?.id === note.id && current.revision === note.revision && current.content === note.content;
}
type SavedKind = "preview" | "html" | "pdf" | "markdown";
async function requestExport(kind: SavedKind, note: Draft, signal: AbortSignal) {
  const markdown =
    kind === "markdown"
      ? (await import("../lib/markdown")).sourceToMarkdown(note.content, note.content_format)
      : undefined;
  const response = await fetch("/api/export/" + (kind === "preview" ? "html" : kind), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: note.id, revision: note.revision, ...(markdown === undefined ? {} : { source: note.content, markdown }) }),
    signal,
  });
  if (!response.ok) {
    let message = t("미리보기 또는 내보내기에 실패했습니다.");
    try {
      const data = await response.json();
      if (typeof data.error === "string") message = data.error;
    } catch {}
    throw new Error(message);
  }
  return response.blob();
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const PREVIEW_EVENT = "inkism-open-preview";
type ExportFormat = "pdf" | "source" | "html" | "markdown";
const EXPORT_FORMATS: [ExportFormat, string][] = [
  ["pdf", "PDF"],
  ["source", "원문"],
  ["html", "서식 HTML"],
  ["markdown", "Markdown + 첨부 ZIP"],
];
const ABORTED_MESSAGE = t("작업을 취소했거나 제한 시간을 초과했습니다. 원문은 그대로입니다.");
function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** All rendering is explicitly requested. Editing never calls these endpoints. */
export function PreviewExport({
  iconOnly = false,
  hiddenTrigger = false,
}: Readonly<{
  iconOnly?: boolean;
  hiddenTrigger?: boolean;
}>) {
  const store = useStore();
  const dialog = useRef<HTMLDialogElement>(null),
    request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [html, setHTML] = useState(""),
    [snapshot, setSnapshot] = useState(""),
    [format, setFormat] = useState<ExportFormat>("pdf");
  const id = store.draft?.id;
  const cancel = () => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setBusy(false);
  };
  useEffect(() => {
    cancel();
    dialog.current?.close();
    setHTML("");
    setError("");
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [id]);
  const exportSource = async (before: Draft, ticket: number, signal: AbortSignal) => {
    if (!(await flushEditors())) throw new Error(t("편집 중인 내용을 확인한 뒤 다시 시도해 주세요."));
    window.dispatchEvent(new Event("inkism-flush-editor"));
    const raw = store.readDraft();
    if (raw?.id !== before.id || ticket !== generation.current) return;
    const format = (raw as typeof raw & { content_format?: string }).content_format || "html";
    const name = filename(raw.title, sourceExtension(format));
    const content = raw.paged ? await readPagedBody(raw.id, raw.paged) : raw.content;
    if (ticket !== generation.current || signal.aborted || store.readDraft()?.id !== raw.id) return;
    download(new Blob([content], { type: "text/plain;charset=utf-8" }), name);
  };
  const exportSaved = async (kind: SavedKind, before: Draft, ticket: number, signal: AbortSignal) => {
    if (!(await store.flushNow())) throw new Error(t("저장하지 못했습니다. 원문을 확인한 뒤 다시 시도해 주세요."));
    const note = store.readDraft();
    if (note?.id !== before.id || ticket !== generation.current) return;
    const blob = await requestExport(kind, note, signal);
    if (ticket !== generation.current || !sameSaved(store.readDraft(), note))
      throw new Error(t("내용이 변경되어 이전 결과를 사용하지 않았습니다. 다시 시도해 주세요."));
    if (kind !== "preview") {
      download(blob, filename(note.title, kind === "markdown" ? "zip" : kind));
      return;
    }
    const document = await blob.text(),
      latest = store.readDraft();
    if (ticket !== generation.current || !sameSaved(latest, note)) return;
    setHTML(document);
    setSnapshot(t("{title} · 저장 버전 {revision}", { title: note.title || t("제목 없음"), revision: note.revision }));
  };
  const printSaved = async (before: Draft, ticket: number) => {
    if (!(await store.flushNow())) throw new Error(t("저장하지 못했습니다. 원문을 확인한 뒤 다시 시도해 주세요."));
    const note = store.readDraft();
    if (note?.id === before.id && ticket === generation.current) await printNote(note.id, note.revision);
  };
  const perform = async (kind: SavedKind | "source" | "print") => {
    if (request.current) return;
    const ticket = ++generation.current,
      controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(true);
    if (kind === "preview") setHTML("");
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const before = store.readDraft();
      if (!before) throw new Error(t("노트를 먼저 선택해 주세요."));
      if (kind === "source") {
        await exportSource(before, ticket, controller.signal);
        return;
      }
      if (kind === "print") {
        await printSaved(before, ticket);
        return;
      }
      await exportSaved(kind, before, ticket, controller.signal);
    } catch (e) {
      if (ticket === generation.current) setError(controller.signal.aborted ? ABORTED_MESSAGE : errorMessage(e));
    } finally {
      clearTimeout(timeout);
      if (ticket === generation.current) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  const performRef = useRef(perform);
  performRef.current = perform;
  // The note menus open the preview; the top row only keeps raw export.
  useEffect(() => {
    const open = () => {
      setHTML("");
      setError("");
      dialog.current?.showModal();
    };
    window.addEventListener(PREVIEW_EVENT, open);
    return () => window.removeEventListener(PREVIEW_EVENT, open);
  }, []);
  if (!store.draft) return null;
  return (
    <div className={"preview-export" + (hiddenTrigger ? " preview-hidden-trigger" : "")}>
      {!hiddenTrigger && (
        <button
          type="button"
          className={iconOnly ? "icon-btn" : "btn btn-small"}
          aria-label={t("원문 내보내기")}
          title={t("원문 내보내기")}
          disabled={busy}
          onClick={() => void perform("source")}
        >
          <Download size={15} aria-hidden />
          {!iconOnly && t("원문 내보내기")}
        </button>
      )}
      {busy && !dialog.current?.open && (
        <button type="button" className="btn btn-small" onClick={cancel}>
          {t("작업 취소")}
        </button>
      )}
      {error && !dialog.current?.open && (
        <span role="alert" className="preview-export-error" title={error}>
          {error}
        </span>
      )}
      <dialog
        ref={dialog}
        className={"preview-dialog" + (html ? " is-previewing" : "")}
        aria-labelledby="preview-title"
        onCancel={() => cancel()}
        onClose={() => {
          cancel();
          setHTML("");
          setError("");
        }}
      >
        <header className="dialog-title-row">
          <h2 id="preview-title" className="dialog-title">{t("내보내기")}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("미리보기 닫기")}
            onClick={() => dialog.current?.close()}
          >
            <X size={16} />
          </button>
        </header>
        <fieldset className="plain-fieldset export-formats" disabled={busy}>
          <legend className="field-label">{t("파일 형식")}</legend>
          {EXPORT_FORMATS.map(([value, label]) => (
            <label key={value} className="export-format">
              <input type="radio" name="export-format" value={value} checked={format === value} onChange={() => setFormat(value)} />
              {t(label)}
            </label>
          ))}
        </fieldset>
        <div className="export-tools">
          <button type="button" className="btn" disabled={busy} onClick={() => void perform("preview")}>
            {html ? t("미리보기 새로고침") : t("미리보기")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void perform("print")}>
            {t("인쇄")}
          </button>
        </div>
        {snapshot && html && <p className="preview-snapshot">{snapshot}</p>}
        {html && <iframe title={t("저장된 원문의 미리보기")} sandbox="" srcDoc={html} />}
        <p className="dialog-note">
          {t(
            "저장된 원문을 요청할 때만 표시합니다. 원문은 바꾸지 않습니다. 이미지는 대체 텍스트, 수식은 원문으로 표시하며 외부 리소스와 실행 코드는 포함하지 않습니다.",
          )}
        </p>
        {busy && <output className="preview-busy">{t("서식 문서를 준비하는 중…")}</output>}
        {error && <p role="alert">{error}</p>}
        <footer className="dialog-actions">
          <button type="button" className="btn" onClick={busy ? cancel : () => dialog.current?.close()}>
            {busy ? t("작업 취소") : t("닫기")}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void perform(format)}>
            {t("{format} 내보내기", { format: t(EXPORT_FORMATS.find(([v]) => v === format)![1]) })}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
