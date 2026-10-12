import React, { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { api } from "../../api";
import { attachmentURL } from "../attachment";
import { t } from "../../i18n";

/** Stored media sources: an app attachment or a plain http(s) URL. Anything else is dropped. */
export function safeSrc(value: unknown): string {
  const src = typeof value === "string" ? value.trim() : "";
  if (attachmentURL.test(src)) return src;
  if (!/^https?:\/\//i.test(src) || src.length > 2048) return "";
  try {
    return new URL(src).href;
  } catch {
    return "";
  }
}

export function hostOf(src: string): string {
  if (attachmentURL.test(src)) return t("첨부 파일");
  try {
    return new URL(src).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0"),
    ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Mirrors editor.isEditable (read-only flips arrive as a transaction without doc change). */
export function useEditable(editor: Editor): boolean {
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);
  return editable;
}

/** Upload one file to the attachment store, aborted when the node view unmounts. */
export function useUpload() {
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  useEffect(() => () => controller.current?.abort(), []);
  const upload = async (file: File) => {
    controller.current?.abort();
    const current = (controller.current = new AbortController());
    setState({ busy: true, error: "" });
    try {
      const asset = await api.uploadAttachment(file, current.signal);
      if (current.signal.aborted) return null;
      setState({ busy: false, error: "" });
      return { src: "/api/attachments/" + asset.id, name: asset.name, size: asset.size };
    } catch (error) {
      if (!current.signal.aborted)
        setState({ busy: false, error: error instanceof Error ? error.message : t("업로드에 실패했습니다.") });
      return null;
    }
  };
  return { ...state, upload, fail: (error: string) => setState({ busy: false, error }) };
}

export function FilePick({
  accept,
  label,
  disabled,
  onFile,
}: Readonly<{
  accept: string;
  label: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}>) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="media-action" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

/** Bottom caption row (icon · title · source), title editable in place. */
export function Caption({
  icon,
  title,
  fallback,
  meta,
  editable,
  onTitle,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  fallback: string;
  meta: string;
  editable: boolean;
  onTitle: (title: string) => void;
}>) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  return (
    <div className="media-caption">
      <span className="media-caption-icon" aria-hidden>
        {icon}
      </span>
      {editable ? (
        <input
          className="media-caption-title"
          value={draft}
          placeholder={fallback}
          aria-label={t("제목")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== title) onTitle(draft.slice(0, 200));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <span className="media-caption-title">{title || fallback}</span>
      )}
      <span className="media-caption-meta">{meta}</span>
    </div>
  );
}

/** Attribute helper for atom nodes stored as a div with data-* attributes plus a portable link. */
export function linkChild(src: string, text: string): ["a", Record<string, string>, string][] {
  return src ? [["a", { href: src, class: "media-fallback-link" }, text || src]] : [];
}
