import React, { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { t } from "../i18n";
import { useStore } from "../store";
import { ContextMenu, type MenuItemSpec } from "./Menu";
import { canDefineTerm, openTermDefinition } from "./TermDefinitionPopover";
import { extractSelectionToNote } from "./SelectionToolbar";
import { BookOpenText, Clipboard, ClipboardText, Copy, NotePencil, Scissors, SelectAll, Table } from "../icons";

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

async function paste(editor: Editor, plain: boolean) {
  editor.view.focus();
  try {
    if (!plain && navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/html")) {
          editor.view.pasteHTML(await (await item.getType("text/html")).text());
          return;
        }
      }
    }
    editor.view.pasteText(await navigator.clipboard.readText());
  } catch {
    // 클립보드 읽기 권한이 없으면 브라우저 기본 붙여넣기를 시도한다.
    document.execCommand("paste");
  }
}

const TABLE_COMMANDS = [
  ["위에 행 추가", "addRowBefore"],
  ["아래에 행 추가", "addRowAfter"],
  ["왼쪽에 열 추가", "addColumnBefore"],
  ["오른쪽에 열 추가", "addColumnAfter"],
  ["행 삭제", "deleteRow"],
  ["열 삭제", "deleteColumn"],
  ["셀 병합", "mergeCells"],
  ["셀 분할", "splitCell"],
  ["표 삭제", "deleteTable"],
] as const;

/** 편집기 우클릭 메뉴: 브라우저 기본 메뉴 대신 앱 메뉴를 띄운다. Shift+우클릭은 기본 메뉴(맞춤법 제안 등). */
export function EditorContextMenu({ editor, readOnly = false }: Readonly<{ editor: Editor; readOnly?: boolean }>) {
  const store = useStore();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const dom = editor.view.dom;
    const onMenu = (e: MouseEvent) => {
      if (e.shiftKey) return;
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY });
    };
    dom.addEventListener("contextmenu", onMenu);
    return () => dom.removeEventListener("contextmenu", onMenu);
  }, [editor]);
  if (!at) return null;

  const editable = editor.isEditable && !readOnly;
  const hasText = !editor.state.selection.empty;
  const run = (fn: () => void) => () => {
    editor.view.focus();
    fn();
  };
  const items: MenuItemSpec[] = [
    { label: t("잘라내기"), icon: <Scissors size={16} />, shortcut: MOD + "X", disabled: !editable || !hasText, onSelect: run(() => document.execCommand("cut")) },
    { label: t("복사"), icon: <Copy size={16} />, shortcut: MOD + "C", disabled: !hasText, onSelect: run(() => document.execCommand("copy")) },
    { label: t("붙여넣기"), icon: <ClipboardText size={16} />, shortcut: MOD + "V", disabled: !editable, onSelect: () => void paste(editor, false) },
    { label: t("서식 없이 붙여넣기"), icon: <Clipboard size={16} />, shortcut: MOD + "Shift+V", disabled: !editable, onSelect: () => void paste(editor, true) },
    { label: t("모두 선택"), icon: <SelectAll size={16} />, shortcut: MOD + "A", onSelect: run(() => editor.commands.selectAll()) },
  ];
  if (editable && hasText) {
    items.push(
      { label: t("용어 설명"), icon: <BookOpenText size={16} />, shortcut: MOD + "G", separatorBefore: true, disabled: !canDefineTerm(editor), onSelect: () => openTermDefinition(editor) },
      { label: t("새 노트로 추출"), icon: <NotePencil size={16} />, onSelect: () => void extractSelectionToNote(store, editor) },
    );
  }
  if (editable && editor.isActive("table")) {
    items.push({
      label: t("표"),
      icon: <Table size={16} />,
      separatorBefore: true,
      items: TABLE_COMMANDS.map(([label, cmd]) => ({
        label: t(label),
        danger: cmd === "deleteTable",
        disabled: !editor.can()[cmd](),
        onSelect: run(() => editor.commands[cmd]()),
      })),
    });
  }
  return <ContextMenu x={at.x} y={at.y} items={items} label={t("편집기 메뉴")} onClose={() => setAt(null)} />;
}
