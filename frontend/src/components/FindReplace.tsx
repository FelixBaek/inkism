import { t } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { X, ChevronUp, ChevronDown } from "../icons";
import { IconButton } from "./IconButton";

export function FindReplace({ editor, readOnly = false }: Readonly<{ editor: Editor; readOnly?: boolean }>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const s = editor.storage.findAndReplace;
      return { count: s.results.length, index: s.currentIndex, query: s.searchTerm, caseSensitive: s.caseSensitive };
    },
  });
  useEffect(() => {
    const show = () => {
      setOpen(true);
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("inkism-find-in-note", show);
    return () => window.removeEventListener("inkism-find-in-note", show);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open || editor.isDestroyed || state.index === null) return;
    const result = editor.storage.findAndReplace.results[state.index];
    if (!result) return;
    const tr = editor.state.tr;
    const position = tr.doc.resolve(result.from);
    for (let depth = 1; depth <= position.depth; depth++) {
      const node = position.node(depth);
      if (node.type.name === "details" && !node.attrs.open) {
        tr.setNodeMarkup(position.before(depth), undefined, { ...node.attrs, open: true });
      }
    }
    if (!tr.docChanged) return;
    // Reveal nested results without making search navigation a text undo step.
    editor.view.dispatch(tr.setMeta("addToHistory", false));
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed)
        editor.view.dom.querySelector(".find-and-replace-result-current")?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, open, state.index, state.query, state.count]);
  if (!open) return null;
  const busy = query !== state.query;
  const disabled = busy || state.count === 0;
  const position = state.index === null ? 0 : state.index + 1;
  const countLabel = busy ? t("찾는 중…") : `${position} / ${state.count}`;
  const close = () => {
    editor.commands.clearSearch();
    setQuery("");
    setOpen(false);
    editor.commands.focus();
  };
  const replace = (all: boolean) => {
    if (readOnly || !editor.isEditable) return;
    const chain = editor.chain().command(({ tr }) => {
      closeHistory(tr);
      return true;
    });
    (all ? chain.replaceAll() : chain.replace()).run();
    editor.commands.command(({ tr }) => {
      closeHistory(tr);
      return true;
    });
    // 마지막 결과를 바꾸면 누른 버튼이 비활성화되어 포커스가 창 밖으로 빠지고 Esc가 닿지 않는다.
    if (all || state.count <= 1) input.current?.focus();
  };
  return (
    <section
      className="find-replace"
      aria-label={t("문서에서 찾기 및 바꾸기")}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.key === "Process") return;
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "Enter" && !disabled) {
          e.preventDefault();
          if (e.shiftKey) editor.commands.goToPreviousResult();
          else editor.commands.goToNextResult();
        }
      }}
    >
      <div className="find-row">
        <input
          ref={input}
          aria-label={t("문서에서 찾을 내용")}
          placeholder={t("찾을 내용")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            editor.commands.setSearchTerm(e.target.value);
          }}
        />
        <output className="find-count">{countLabel}</output>
        <IconButton
          label={t("이전 검색 결과")}
          disabled={disabled}
          onClick={() => editor.commands.goToPreviousResult()}
        >
          <ChevronUp size={16} />
        </IconButton>
        <IconButton label={t("다음 검색 결과")} disabled={disabled} onClick={() => editor.commands.goToNextResult()}>
          <ChevronDown size={16} />
        </IconButton>
        <IconButton label={t("문서 검색 닫기")} onClick={close}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="find-row">
        <input
          aria-label={t("바꿀 내용")}
          placeholder={t("바꿀 내용 (비우면 삭제)")}
          value={replacement}
          onChange={(e) => {
            setReplacement(e.target.value);
            editor.commands.setReplaceTerm(e.target.value);
          }}
        />
        <button className="btn btn-secondary" disabled={disabled || readOnly} onClick={() => replace(false)}>
          {t("바꾸기")}
        </button>
        <button className="btn btn-secondary" disabled={disabled || readOnly} onClick={() => replace(true)}>
          {t("모두 바꾸기")}
        </button>
        <label className="find-case">
          <input
            type="checkbox"
            checked={state.caseSensitive}
            onChange={(e) => editor.commands.setCaseSensitive(e.target.checked)}
          />
          {t("대소문자 구분")}
        </label>
      </div>
    </section>
  );
}
