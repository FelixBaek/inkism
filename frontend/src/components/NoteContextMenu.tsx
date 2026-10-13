import { t } from "../i18n";
import React from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Summary } from "../types";
import { sourceFilename } from "../lib/source-format";
import { plainTextOf } from "../lib/text";
import { openInNewTab } from "./NoteTabs";
import { ContextMenu, type MenuItemSpec } from "./Menu";
import { printNote } from "../lib/print-note";
import { PREVIEW_EVENT } from "./PreviewExport";
import {
  Printer,
  ExternalLink,
  Pin,
  PencilOff,
  Star,
  Bell,
  Archive,
  Folder,
  Palette,
  Hash,
  CloudUpload,
  ShareExport,
  Copy,
  Link2,
  CopyNote,
  Trash2,
  RotateCcw,
  Circle,
} from "../icons";

/** 노트 색(엔진은 임의 문자열을 저장한다). 목록 행에 점으로 표시한다. */
export const NOTE_COLORS: { label: string; value: string }[] = [
  { label: t("빨강"), value: "#e5484d" },
  { label: t("주황"), value: "#f76b15" },
  { label: t("노랑"), value: "#ffc53d" },
  { label: t("초록"), value: "#30a46c" },
  { label: t("파랑"), value: "#0090ff" },
  { label: t("보라"), value: "#8e4ec6" },
  { label: t("회색"), value: "#8b8d98" },
];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export type NoteMenuTarget = { item: Summary; x: number; y: number };

/** 노트 메뉴. 이 앱에 실제 기능이 있는 항목만 둔다(잠금 없음). */
export function useNoteCommands(item: Summary, onReminder: () => void, onPublish: () => void): MenuItemSpec[] {
  const s = useStore();
  const selected = s.selectedId === item.id;
  const icon = (node: React.ReactElement) => React.cloneElement(node, { size: 15, "aria-hidden": true });
  const run = (title: string, fn: () => Promise<unknown>) =>
    void fn().catch((e) => s.showError(title, e instanceof Error ? e.message : String(e)));
  const patch = (changes: Record<string, unknown>) => void s.patchNoteById(item.id, changes, item.revision);
  /** 열린 노트는 편집 중인 내용을 먼저 저장한 뒤 읽는다. */
  const saved = async () => {
    if (selected && !(await s.flushNow()))
      throw new Error(t("편집 중인 내용을 저장하지 못했습니다. 저장 상태를 확인해 주세요."));
    return api.get(item.id);
  };

  if (item.trashed) {
    const items: MenuItemSpec[] = [
      { commandId: "context.note.restore", label: t("복원"), icon: icon(<RotateCcw />), onSelect: () => void s.quickRestore(item.id) },
      {
        commandId: "context.note.delete", label: t("영구 삭제"),
        icon: icon(<Trash2 />),
        danger: true,
        separatorBefore: true,
        shortcut: "Del",
        onSelect: () => void s.quickDelete(item.id),
      },
    ];
    return items;
  }

  const notebookIds = item.notebook_ids ?? (item.notebook_id ? [item.notebook_id] : []);
  const exportAs = (kind: "source" | "html" | "pdf" | "markdown") =>
    run(t("내보내기 실패"), async () => {
      const note = await saved();
      if (kind === "source") {
        const extension = { text: "txt", html: "html", markdown: "md" }[note.content_format ?? "html"];
        download(new Blob([note.content], { type: "text/plain;charset=utf-8" }), sourceFilename(note.title, extension));
        return;
      }
      const markdown = kind === "markdown"
        ? (await import("../lib/markdown")).sourceToMarkdown(note.content, note.content_format)
        : undefined;
      const response = await fetch("/api/export/" + kind, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id, revision: note.revision,
          ...(kind === "markdown" ? { source: note.content, markdown } : {}) }),
      });
      if (!response.ok) {
        let message = t("내보내기에 실패했습니다.");
        try {
          const data = await response.json();
          if (typeof data.error === "string") message = data.error;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }
      download(await response.blob(), sourceFilename(note.title, kind === "markdown" ? "zip" : kind));
    });
  const copyAs = (kind: "text" | "markdown") =>
    run(t("복사 실패"), async () => {
      const note = await saved();
      let value = plainTextOf(note);
      if (kind === "markdown")
        value = (await import("../lib/markdown")).sourceToMarkdown(note.content, note.content_format);
      await navigator.clipboard.writeText(value);
    });
  const duplicate = () =>
    run(t("복제 실패"), async () => {
      const note = await saved();
      await api.save({
        id: crypto.randomUUID(),
        title: (note.title || "제목 없음") + " (사본)",
        content: note.content,
        text: note.text,
        // Explicit "html" makes the engine treat the body as source text; omit it so text stays plain.
        content_format: note.content_format === "html" ? undefined : note.content_format,
        notebook_id: note.notebook_id,
        tags: note.tags,
      });
      s.refreshList();
      await s.refreshMeta();
    });

  const items: MenuItemSpec[] = [
    { commandId: "context.note.open-tab", label: t("새 탭에서 열기"), icon: icon(<ExternalLink />), onSelect: () => void openInNewTab(s, item.id) },
    { commandId: "context.note.pin", separatorBefore: true, label: t("고정"), icon: icon(<Pin />), checked: item.pinned, onSelect: () => patch({ pinned: !item.pinned }) },
    {
      commandId: "context.note.favorite", label: t("즐겨찾기"),
      icon: icon(<Star />),
      checked: item.favorite,
      onSelect: () => patch({ favorite: !item.favorite }),
    },
    {
      commandId: "context.note.readonly", label: t("읽기 전용"),
      icon: icon(<PencilOff />),
      checked: Boolean(item.readonly),
      onSelect: () => patch({ readonly: !item.readonly }),
    },
    {
      commandId: "context.note.notebooks", label: t("폴더에 넣기"),
      separatorBefore: true,
      icon: icon(<Folder />),
      items: [
        ...(s.notebooks.length
          ? s.notebooks.map((nb) => ({
              commandId: "context.note.notebook:"+nb.id, label: nb.name,
              icon: icon(<Folder />),
              checked: notebookIds.includes(nb.id),
              onSelect: () =>
                patch({
                  notebook_ids: notebookIds.includes(nb.id)
                    ? notebookIds.filter((id) => id !== nb.id)
                    : [...notebookIds, nb.id],
                }),
            }))
          : [{ label: t("폴더가 없습니다"), disabled: true }]),
        {
          commandId: "context.note.notebook-remove", label: t("폴더에서 빼기"),
          separatorBefore: true,
          disabled: notebookIds.length === 0,
          onSelect: () => patch({ notebook_ids: [] }),
        },
      ],
    },
    {
      commandId: "context.note.tags", label: t("태그 지정"),
      icon: icon(<Hash />),
      items: s.tags.length
        ? s.tags.map((tag) => ({
            commandId: "context.note.tag:"+tag.name, label: tag.name,
            icon: icon(<Hash />),
            checked: item.tags.includes(tag.name),
            onSelect: () =>
              patch({
                tags: item.tags.includes(tag.name) ? item.tags.filter((x) => x !== tag.name) : [...item.tags, tag.name],
              }),
          }))
        : [{ label: t("태그가 없습니다"), disabled: true }],
    },
    {
      commandId: "context.note.color", label: t("색 지정"),
      icon: icon(<Palette />),
      items: [
        ...NOTE_COLORS.map((c) => ({
          commandId: "context.note.color:"+c.value, label: c.label,
          icon: <Circle size={14} weight="fill" color={c.value} aria-hidden />,
          checked: item.color === c.value,
          onSelect: () => patch({ color: item.color === c.value ? null : c.value }),
        })),
        { commandId: "context.note.color-clear", label: t("색 지우기"), separatorBefore: true, disabled: !item.color, onSelect: () => patch({ color: null }) },
      ],
    },
    {
      commandId: "context.note.copy-link", label: t("링크 복사"),
      separatorBefore: true,
      icon: icon(<Link2 />),
      onSelect: () => run(t("복사 실패"), () => navigator.clipboard.writeText("note://" + item.id)),
    },
    { commandId: "context.note.duplicate", label: t("복제"), icon: icon(<CopyNote />), onSelect: duplicate },
    {
      commandId: "context.note.archive", label: t("보관"),
      icon: icon(<Archive />),
      checked: item.archived,
      onSelect: () => patch({ archived: !item.archived }),
    },
    { commandId: "context.note.reminder", separatorBefore: true, label: t("알림 설정"), icon: icon(<Bell />), onSelect: onReminder },
    { commandId: "context.note.publish", label: t("게시"), icon: icon(<CloudUpload />), onSelect: onPublish },
    {
      commandId: "context.note.export", label: t("내보내기"),
      separatorBefore: true,
      icon: icon(<ShareExport />),
      // 열린 노트는 형식을 고르는 내보내기 창으로, 목록의 다른 노트는 바로 형식을 고른다.
      ...(s.draft?.id === item.id ? { onSelect: () => window.dispatchEvent(new Event(PREVIEW_EVENT)) } : {}),
      items: s.draft?.id === item.id ? undefined : [
        { commandId: "context.note.export-source", label: t("원문"), onSelect: () => exportAs("source") },
        { commandId: "context.note.export-markdown", label: t("Markdown + 첨부파일 (ZIP)"), onSelect: () => exportAs("markdown") },
        { commandId: "context.note.export-html", label: t("서식 HTML"), onSelect: () => exportAs("html") },
        { commandId: "context.note.export-pdf", label: "PDF", onSelect: () => exportAs("pdf") },
      ],
    },
    {
      commandId: "context.note.copy", label: t("다른 형식으로 복사"),
      icon: icon(<Copy />),
      items: [
        { commandId: "context.note.copy-text", label: t("텍스트"), onSelect: () => copyAs("text") },
        { commandId: "context.note.copy-markdown", label: "Markdown", onSelect: () => copyAs("markdown") },
      ],
    },
    {
      commandId: "context.note.print", label: t("인쇄"),
      icon: icon(<Printer />),
      onSelect: () =>
        run(t("인쇄 실패"), async () => {
          const note = await saved();
          await printNote(note.id, note.revision);
        }),
    },
    {
      commandId: "context.note.trash", label: t("삭제"),
      separatorBefore: true,
      shortcut: "Del",
      icon: icon(<Trash2 />),
      danger: true,
      onSelect: () => patch({ trashed: true }),
    },
  ];
  return items;
}

export function NoteContextMenu({
  item,
  x,
  y,
  onClose,
  onReminder,
  onPublish,
}: NoteMenuTarget & { onClose: () => void; onReminder: () => void; onPublish: () => void }) {
  const items = useNoteCommands(item, onReminder, onPublish);
  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      label={t("노트 메뉴: {title}", { title: item.title || t("제목 없음") })}
      onClose={onClose}
    />
  );
}
