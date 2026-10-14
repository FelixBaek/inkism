import { openTermDefinition, canDefineTerm } from "./TermDefinitionPopover";
import {CsvTools} from "./CsvTools";
import React, { useEffect, useReducer, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { Bold, Italic, Strikethrough, InlineCode, List, ListOrdered, TaskList, Link2 } from "../icons";
import { IconButton } from "./IconButton";
import { AttachmentButton } from "./AttachmentButton";
import { useStore } from "../store";
import { t } from "../i18n";
import "./toolbar/toolbar.css";

export function MarkdownToolbar({ editor, readOnly = false }: Readonly<{ editor: Editor | null; readOnly?: boolean }>) {
  const s = useStore(),
    [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const update = () => refresh();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  if (!editor) return null;
  const disabled = readOnly || !editor.isEditable;
  const link = async () => {
    const result = await s.prompt({
      title: t("링크"),
      message: t("웹 주소"),
      label: t("웹 주소"),
      initial: editor.getAttributes("link").href || "",
    });
    if (!result || editor.isDestroyed || !editor.isEditable) return;
    const href = result.value.trim();
    if (href && !/^(https?:\/\/|mailto:|note:)/i.test(href)) {
      void s.showError(t("링크"), t("웹 주소가 올바르지 않습니다."));
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    (href ? chain.setLink({ href }) : chain.unsetLink()).run();
  };
  return (
    <><div className="editor-toolbar" role="toolbar" aria-label={t("Markdown 서식 도구")}>
      <select
        className="settings-select"
        aria-label={t("문단 종류")}
        disabled={disabled}
        value={[1, 2, 3, 4, 5, 6].find((level) => editor.isActive("heading", { level })) || "paragraph"}
        onChange={(e) => {
          const level = Number(e.target.value);
          const c = editor.chain().focus();
          (level ? c.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }) : c.setParagraph()).run();
        }}
      >
        <option value="paragraph">{t("본문")}</option>
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <option key={level} value={level}>
            {t("제목 {level}", { level })}
          </option>
        ))}
      </select>
      <IconButton
        label={t("굵게")}
        disabled={disabled}
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={16} />
      </IconButton>
      <IconButton
        label={t("기울임")}
        disabled={disabled}
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={16} />
      </IconButton>
      <IconButton
        label={t("취소선")}
        disabled={disabled}
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={16} />
      </IconButton>
      <IconButton
        label={t("인라인 코드")}
        disabled={disabled}
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <InlineCode size={16} />
      </IconButton>
      <IconButton
        label={t("글머리 목록")}
        disabled={disabled}
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={16} />
      </IconButton>
      <IconButton
        label={t("번호 목록")}
        disabled={disabled}
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={16} />
      </IconButton>
      <IconButton
        label={t("할 일 목록")}
        disabled={disabled}
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <TaskList size={16} />
      </IconButton>
      <IconButton label={t("링크")} disabled={disabled} onClick={() => void link()}>
        <Link2 size={16} />
      </IconButton>
      <button type="button" className="btn btn-small" disabled={disabled || !canDefineTerm(editor)} onMouseDown={event => event.preventDefault()} onClick={() => openTermDefinition(editor)}>{t("용어 설명")}</button>
      <AttachmentButton editor={editor} markdownCompatible />
    </div><CsvTools editor={editor}/></>
  );
}
