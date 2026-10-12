import "./SourceAttachments.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { api } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";

type Format = "text" | "html" | "markdown";
const urlPattern = "/api/attachments/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const escapeHTML = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function attachmentSource(format: Format, name: string, id: string) {
  const url = "/api/attachments/" + id;
  if (format === "html") return `<a href="${url}" download>${escapeHTML(name)}</a>`;
  if (format === "markdown") {
    const label = name.replace(/[\r\n]/g, " ").replace(/[\\`*_[\]<>!&]/g, String.raw`\$&`);
    return `[${label}](${url})`;
  }
  return url;
}
type Link = { from: number; to: number; raw: string; url: string };
function linksIn(source: string): Link[] {
  // Explicit user action only. No parsing/scanning on each source keystroke.
  const pattern = new RegExp(
    String.raw`<div\b[^>]*data-type="mindbox-attachment"[^>]*>[\s\S]*?<\/div>|<a\b[^>]*href="${urlPattern}"[^>]*>[\s\S]*?<\/a>|\[(?:\\.|[^\]\r\n])*\]\(${urlPattern}\)|${urlPattern}`,
    "g",
  );
  const links: Link[] = [];
  for (const match of source.matchAll(pattern)) {
    const url = new RegExp(urlPattern).exec(match[0])?.[0];
    if (url) links.push({ from: match.index!, to: match.index! + match[0].length, raw: match[0], url });
  }
  return links;
}

export function SourceAttachments({
  view,
  format,
  readOnly = false,
  controls,
}: Readonly<{
  view: EditorView;
  format: Format;
  readOnly?: boolean;
  controls?: React.ReactNode;
}>) {
  const { showError } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Permission is judged at call time: the React prop plus CodeMirror's own
  // view.state.readOnly, so either source alone blocks uploads.
  const blocked = useCallback(() => readOnlyRef.current || view.state.readOnly, [view]);
  const active = useRef<{ controller: AbortController; position: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [links, setLinks] = useState<Link[] | null>(null);
  const live = useRef(true);
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;
  const insert = useRef<(files: File[], position?: number) => Promise<void>>(async () => {});
  useEffect(() => {
    live.current = true;
    const events = new Compartment();
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        events.of([
          EditorView.updateListener.of((update) => {
            if (active.current) active.current.position = update.changes.mapPos(active.current.position, 1);
            if (update.docChanged) setLinks(null);
          }),
          EditorView.domEventHandlers({
            // Read-only notes still receive paste/drop, but never start an upload.
            // preventDefault stays, so the browser cannot open the dropped file.
            paste(event) {
              const files = Array.from(event.clipboardData?.files || []);
              if (!files.length) return false;
              event.preventDefault();
              if (blocked()) return true;
              void insert.current(files);
              return true;
            },
            dragover(event) {
              if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return false;
              if (blocked()) {
                if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
                event.preventDefault();
                return true;
              }
              event.preventDefault();
              return true;
            },
            drop(event) {
              if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return false;
              event.preventDefault();
              if (blocked()) return true;
              if (Array.from(event.dataTransfer?.items || []).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
                void showErrorRef.current(
                  t("폴더는 첨부할 수 없습니다"),
                  t("폴더 안의 파일을 선택해서 추가해 주세요."),
                );
                return true;
              }
              void insert.current(
                Array.from(event.dataTransfer?.files || []),
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined,
              );
              return true;
            },
          }),
        ]),
      ),
    });
    return () => {
      live.current = false;
      active.current?.controller.abort();
      active.current = null;
    };
  }, [view, blocked]);
  // Entering read-only cancels the in-flight upload; every await re-checks the
  // permission, so an already finished file is never inserted afterwards.
  useEffect(() => {
    if (readOnly) active.current?.controller.abort();
  }, [readOnly]);
  /** Uploads and inserts one file; returns its error line, or null when it succeeded or was cancelled. */
  const uploadOne = async (
    file: File,
    task: { controller: AbortController; position: number },
    stopped: () => boolean,
  ) => {
    try {
      const asset = await api.uploadAttachment(file, task.controller.signal);
      // Re-check the permission after every await: a read-only switch must
      // cancel before anything else is uploaded or inserted.
      if (stopped()) return null;
      const text = attachmentSource(format, asset.name, asset.id);
      // Insertion does not replace selected source. Mapping tracks concurrent
      // typing, while cancellation/navigation can never write into another note.
      view.dispatch({ changes: { from: task.position, insert: text }, annotations: isolateHistory.of("full") });
    } catch (error) {
      if (!stopped()) return file.name + ": " + (error instanceof Error ? error.message : t("첨부 실패"));
    }
    return null;
  };
  insert.current = async (files, position) => {
    if (!files.length || !live.current) return;
    if (blocked()) return;
    if (active.current) {
      void showError(t("첨부 진행 중"), t("현재 첨부가 끝난 뒤 파일을 다시 추가해 주세요."));
      return;
    }
    const task = { controller: new AbortController(), position: position ?? view.state.selection.main.to };
    active.current = task;
    const stopped = () => blocked() || task.controller.signal.aborted || !live.current;
    const errors: string[] = [];
    try {
      for (let index = 0; index < files.length; index++) {
        if (stopped()) break;
        const file = files[index];
        setProgress({ done: index, total: files.length, name: file.name });
        const failure = await uploadOne(file, task, stopped);
        if (failure) errors.push(failure);
      }
      if (errors.length && !stopped()) void showError(t("첨부하지 못한 파일"), errors.join("\n"));
    } finally {
      if (active.current === task) active.current = null;
      if (live.current) setProgress(null);
    }
  };
  return (
    <div className="source-attachments">
      <fieldset className="source-toolbar plain-fieldset" aria-label={t("원문 편집 도구")}>
        {controls}
        <button
          type="button"
          className="btn btn-small"
          disabled={!!progress || readOnly}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => input.current?.click()}
        >
          {t("파일 첨부")}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          aria-label={t("첨부할 파일 선택")}
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            void insert.current(files);
          }}
        />
        <button
          type="button"
          className="btn btn-small"
          aria-expanded={links !== null}
          onClick={() => setLinks(links === null ? linksIn(view.state.doc.toString()) : null)}
        >
          {t("첨부 링크 목록")}
        </button>
      </fieldset>
      {progress && (
        <output>
          <span>{t("{done}/{total} 첨부 중…", { done: progress.done, total: progress.total })}</span>
          <span className="attachment-progress-name" title={progress.name}>
            {progress.name}
          </span>
          <button type="button" onClick={() => active.current?.controller.abort()}>
            {t("첨부 취소")}
          </button>
        </output>
      )}
      {links && (
        <section aria-label={t("첨부 링크 목록")}>
          <p>{t("링크 제거는 원문에서 참조만 지웁니다. 파일은 다른 노트와 실행 취소를 위해 보존합니다.")}</p>
          {!links.length && <p>{t("첨부 링크가 없습니다.")}</p>}
          {links.map((link, index) => (
            <div key={link.from}>
              <a href={link.url} download aria-label={t("첨부파일 {n} 다운로드", { n: index + 1 })}>
                {t("첨부파일 {n} 다운로드", { n: index + 1 })}
              </a>{" "}
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (blocked()) return;
                  if (view.state.doc.sliceString(link.from, link.to) !== link.raw) {
                    setLinks(null);
                    return;
                  }
                  view.dispatch({ changes: { from: link.from, to: link.to }, annotations: isolateHistory.of("full") });
                  view.focus();
                }}
              >
                {t("첨부 링크 {n} 제거", { n: index + 1 })}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
