import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Selection, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { Paperclip } from "../icons";
import { api } from "../api";
import { useStore } from "../store";
import { IconButton } from "./IconButton";
import { t } from "../i18n";

type UploadedAttachment = Awaited<ReturnType<typeof api.uploadAttachment>>;

function uploadStopped(controller: AbortController, editor: Editor) {
  return controller.signal.aborted || editor.isDestroyed || !editor.isEditable;
}

function insertAttachmentCard(editor: Editor, position: number, asset: UploadedAttachment, markdownCompatible = false) {
  if (markdownCompatible) {
    const url = "/api/attachments/" + asset.id;
    const image = /^(image\/(png|jpeg|gif|webp))$/.test(asset.media_type) && asset.size <= 32 * 1024 * 1024;
    return editor.chain().focus().insertContentAt(position, image
      ? { type:"image", attrs:{src:url+"?preview=1",alt:asset.name} }
      : { type:"text", text:asset.name, marks:[{type:"link",attrs:{href:url}}] }).run();
  }
  return editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .insertContentAt(position, {
      type: "attachment",
      attrs: {
        url: "/api/attachments/" + asset.id,
        name: asset.name,
        size: asset.size,
        mediaType: asset.media_type,
      },
    })
    .run();
}

/** Uploads and inserts one file. `stop` means the batch must end without counting this file. */
async function attachFile(
  editor: Editor,
  file: File,
  controller: AbortController,
  position: () => number,
  markdownCompatible = false,
): Promise<{ stop: boolean; error?: string }> {
  try {
    const asset = await api.uploadAttachment(file, controller.signal);
    // A read-only flip between awaits must cancel the remaining files
    // before anything else is inserted.
    if (uploadStopped(controller, editor)) return { stop: true };
    if (!insertAttachmentCard(editor, position(), asset, markdownCompatible)) throw new Error(t("이 위치에 파일을 삽입하지 못했습니다."));
  } catch (error) {
    if (!controller.signal.aborted && !editor.isDestroyed) {
      return { stop: false, error: file.name + ": " + (error instanceof Error ? error.message : t("첨부 실패")) };
    }
  }
  return { stop: false };
}

export function AttachmentButton({ editor, markdownCompatible = false }: Readonly<{ editor: Editor; markdownCompatible?: boolean }>) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Mirrors editor.isEditable so the button disables as soon as the editor
  // turns read-only (Tiptap does not re-render React consumers by itself).
  const [editable, setEditable] = useState(editor.isEditable);
  const { showError } = useStore();
  const attach = useCallback(
    async (files: File[], insertion?: SelectionBookmark) => {
      if (!files.length || editor.isDestroyed || !editor.isEditable) return;
      if (active.current) {
        void showError(t("첨부 진행 중"), t("현재 첨부가 끝난 뒤 파일을 다시 추가해 주세요."));
        return;
      }
      const controller = new AbortController();
      active.current = controller;
      setProgress({ done: 0, total: files.length });
      // Track the insertion boundary with forward affinity, including when a
      // file card (NodeSelection) is selected. A node bookmark would keep
      // pointing before the newly inserted cards and reverse batch order.
      let position = (insertion || editor.state.selection.getBookmark()).resolve(editor.state.doc).to;
      const mapPosition = ({ transaction }: { transaction: Transaction }) => {
        position = transaction.mapping.map(position, 1);
      };
      const currentPosition = () => position;
      editor.on("transaction", mapPosition);
      const errors: string[] = [];
      try {
        // One request at a time bounds memory and keeps batch order stable.
        for (let index = 0; index < files.length; index++) {
          if (uploadStopped(controller, editor)) break;
          const result = await attachFile(editor, files[index], controller, currentPosition, markdownCompatible);
          if (result.stop) break;
          if (result.error) errors.push(result.error);
          if (mounted.current) setProgress({ done: index + 1, total: files.length });
        }
        if (errors.length && !controller.signal.aborted && !editor.isDestroyed) {
          void showError(t("첨부하지 못한 파일"), errors.join("\n"));
        }
      } finally {
        editor.off("transaction", mapPosition);
        if (active.current === controller) active.current = null;
        if (mounted.current) setProgress(null);
      }
    },
    [editor, showError, markdownCompatible],
  );

  // The main layer switches read-only with editor.setEditable(flag, false)
  // followed by a transaction without docChanged. Detect the editable change
  // on that transaction to cancel an in-flight upload and refresh the button.
  useEffect(() => {
    if (editor.isDestroyed) return;
    let previous = editor.isEditable;
    const onTransaction = () => {
      if (editor.isEditable === previous) return;
      previous = editor.isEditable;
      setEditable(previous);
      if (!previous) active.current?.abort();
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    mounted.current = true;
    const dom = editor.view.dom;
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []);
      // Text paste is handled by the editor's permission guard.
      if (!files.length || !editor.isEditable) return;
      event.preventDefault();
      event.stopPropagation();
      void attach(files);
    };
    const dragover = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      // Stay intercepting so the browser never opens the dropped file; a
      // read-only editor only signals that dropping is not allowed.
      if (event.dataTransfer) event.dataTransfer.dropEffect = editor.isEditable ? "copy" : "none";
      event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!editor.isEditable) return;
      if (Array.from(event.dataTransfer?.items || []).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
        void showError(t("폴더는 첨부할 수 없습니다"), t("폴더 안의 파일을 선택해서 추가해 주세요."));
        return;
      }
      const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      const bookmark = at ? Selection.near(editor.state.doc.resolve(at.pos)).getBookmark() : undefined;
      void attach(Array.from(event.dataTransfer?.files || []), bookmark);
    };
    dom.addEventListener("paste", paste, true);
    dom.addEventListener("dragover", dragover, true);
    dom.addEventListener("drop", drop, true);
    return () => {
      mounted.current = false;
      active.current?.abort();
      dom.removeEventListener("paste", paste, true);
      dom.removeEventListener("dragover", dragover, true);
      dom.removeEventListener("drop", drop, true);
    };
  }, [editor, attach, showError]);

  return (
    <>
      <IconButton
        label={t("파일 첨부")}
        size="sm"
        disabled={progress !== null || !editable}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={15} aria-hidden />
      </IconButton>
      <input
        ref={input}
        type="file"
        multiple
        aria-label={t("첨부할 파일 선택")}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void attach(files);
        }}
      />
      {progress && (
        <span className="attachment-progress">
          <output>{t("{done}/{total} 첨부 중…", { done: progress.done, total: progress.total })}</output>
          <button type="button" onClick={() => active.current?.abort()}>
            {t("첨부 취소")}
          </button>
        </span>
      )}
    </>
  );
}
