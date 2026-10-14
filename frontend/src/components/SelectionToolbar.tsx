import React from "react";
import { openTermDefinition, canDefineTerm } from "./TermDefinitionPopover";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection } from "@tiptap/pm/state";
import { Bold, Italic, Underline, Strikethrough, Highlighter, Code } from "../icons";
import { IconButton } from "./IconButton";
import { t } from "../i18n";
import { api } from "../api";
import { useStore } from "../store";

/** 글자를 고르면 위에 뜨는 서식 막대(굵게·기울임 등). */
export function SelectionToolbar({ editor }: Readonly<{ editor: Editor }>) {
  const store = useStore();
  const [extracting, setExtracting] = React.useState(false);
  const marks = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      highlight: editor.isActive("highlight"),
      code: editor.isActive("code"),
    }),
  });
  const items = [
    { mark: "bold", label: t("굵게"), Icon: Bold, run: () => editor.chain().focus().toggleBold().run() },
    { mark: "italic", label: t("기울임"), Icon: Italic, run: () => editor.chain().focus().toggleItalic().run() },
    { mark: "underline", label: t("밑줄"), Icon: Underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { mark: "strike", label: t("취소선"), Icon: Strikethrough, run: () => editor.chain().focus().toggleStrike().run() },
    {
      mark: "highlight",
      label: t("형광펜"),
      Icon: Highlighter,
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
    { mark: "code", label: t("인라인 코드"), Icon: Code, run: () => editor.chain().focus().toggleCode().run() },
  ] as const;
  const extractSelection = async () => {
    if (extracting || editor.state.selection.empty) return;
    const draft = store.readDraft();
    if (!draft || draft.readonly || draft.isNew) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n", "\n").trim();
    if (!text) return;
    if (text.length > 100_000) {
      await store.showError(t("선택 영역 추출"), t("선택 영역은 100,000자 이하만 추출할 수 있습니다."));
      return;
    }
    setExtracting(true);
    try {
      if (!(await store.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
      const saved = store.readDraft();
      if (saved?.id !== draft.id || saved.revision !== draft.revision)
        throw new Error(t("문서가 변경되어 선택을 추출하지 못했습니다."));
      const title = await store.prompt({
        title: t("선택 영역을 새 노트로 추출"),
        message: t("새 노트의 제목을 입력하세요."),
        label: t("노트 제목"),
        initial: text.replace(/\s+/g, " ").slice(0, 48),
      });
      if (!title) return;
      const serializer = (await import("@tiptap/pm/model")).DOMSerializer.fromSchema(editor.schema);
      const holder = document.createElement("div");
      holder.appendChild(serializer.serializeFragment(editor.state.doc.slice(from, to).content));
      const created = await api.save({
        id: crypto.randomUUID(),
        title: title.value,
        content: holder.innerHTML,
        content_format: "html",
        text,
      });
      // Keep the selected text in place and make the new note immediately discoverable.
      editor.chain().focus().setTextSelection({ from, to }).setLink({ href: `note://${created.id}` }).run();
      store.refreshList();
      await store.refreshMeta();
    } catch (error) {
      await store.showError(t("선택 영역 추출"), error instanceof Error ? error.message : String(error));
    } finally {
      setExtracting(false);
    }
  };
  return (
    <BubbleMenu
      className="selection-bubble"
      editor={editor}
      pluginKey="inkism-selection-tools"
      options={{ placement: "top", offset: 8 }}
      // 글자를 고를 때만. 블록 통째 선택(이미지·동영상·3D 등)에는 서식 막대를 띄우지 않는다.
      shouldShow={({ editor, state }) =>
        editor.isEditable &&
        !state.selection.empty &&
        !(state.selection instanceof NodeSelection) &&
        state.doc.textBetween(state.selection.from, state.selection.to).length > 0
      }
    >
      <div
        className="selection-toolbar"
        role="toolbar"
        aria-label={t("선택한 글자 서식")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            editor.commands.focus();
            editor.commands.setTextSelection(editor.state.selection.to);
          }
        }}
      >
        {items.map(({ mark, label, Icon, run }) => (
          <IconButton
            key={mark}
            label={t("선택 글자 {label}", { label })}
            active={marks[mark]}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
          >
            <Icon size={16} aria-hidden />
          </IconButton>
        ))}
        <button type="button" disabled={!canDefineTerm(editor)} onMouseDown={event => event.preventDefault()} onClick={() => openTermDefinition(editor)} title={t("용어 설명 (Ctrl/⌘+G)")}>{t("용어 설명")}</button>
        <button
          type="button"
          className="selection-extract-btn"
          disabled={extracting}
          aria-label={t("선택 영역을 새 노트로 추출")}
          title={t("선택 영역을 새 노트로 추출")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void extractSelection()}
        >
          {extracting ? t("추출 중…") : t("새 노트로 추출")}
        </button>
      </div>
    </BubbleMenu>
  );
}
