import {cloneBlockIdentity,newBlockId} from "../lib/block-identity";
import React, { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { blockSpecificActions } from "../extensions/block-actions";
import { GripVertical, Plus, X } from "../icons";
import { useStore } from "../store";
import {
  BLOCK_ITEMS,
  blockKind,
  colorBlock,
  convertBlock,
  setBlockContext,
  type BlockItem,
  type RunOptions,
} from "../extensions/block-items";
import { BlockMenu } from "./blocks/BlockMenu";
import { BlockActionMenu, type BlockMenuAction } from "./blocks/BlockActionMenu";
import "./BlockTools.css";
import { t } from "../i18n";
import { MARKDOWN_BLOCKS } from "../lib/markdown-compatible";

const POSITION = { placement: "left-start" as const, strategy: "absolute" as const };
export type BlockAction = "up" | "down" | "duplicate" | "delete" | "insert";
export type DocumentBlockAction = (action: BlockAction, index: number, execute: boolean, anchored?: boolean) => boolean;
export type DocumentBlockDrag = (index: number, event: DragEvent) => void;
type Target = { node: PMNode; pos: number };

// A list, table or details section moves as one top-level block. A selection
// spanning multiple such blocks must never silently act on its first block.
function currentBlock(editor: Editor) {
  if (editor.isDestroyed || !editor.isEditable) return null;
  const { doc, selection } = editor.state;
  const index = selection.$from.index(0);
  if (index >= doc.childCount) return null;
  const end = selection.empty ? selection.from : selection.to - 1;
  if (doc.resolve(end).index(0) !== index) return null;
  const pos = selection.$from.depth ? selection.$from.before(1) : selection.from;
  return { index, pos, node: doc.child(index), count: doc.childCount };
}

type CurrentBlock = NonNullable<ReturnType<typeof currentBlock>>;

/** Applies a local block action to `tr`; returns the position to select, or null when nothing moves. */
function applyBlockAction(editor: Editor, tr: Transaction, action: BlockAction, target: CurrentBlock): number | null {
  const { pos, node, index, count } = target;
  const { state } = editor;
  if (action === "up") {
    if (index === 0) return null;
    const previous = state.doc.child(index - 1);
    const selectedPos = pos - previous.nodeSize;
    tr.replaceWith(selectedPos, pos + node.nodeSize, [node, previous]);
    return selectedPos;
  }
  if (action === "down") {
    if (index + 1 === count) return null;
    const next = state.doc.child(index + 1);
    tr.replaceWith(pos, pos + node.nodeSize + next.nodeSize, [next, node]);
    return pos + next.nodeSize;
  }
  if (action === "duplicate") {
    const selectedPos = pos + node.nodeSize;
    tr.insert(selectedPos, cloneBlockIdentity(node));
    return selectedPos;
  }
  if (action === "insert") {
    const selectedPos = pos + node.nodeSize;
    tr.insert(selectedPos, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, selectedPos + 1));
    return selectedPos;
  }
  if (count === 1) tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph.create());
  else tr.delete(pos, pos + node.nodeSize);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  return pos;
}

/** Whether a local (non-windowed) block can move in the given direction. */
function locallyAllowed(action: BlockAction, block: CurrentBlock) {
  if (action === "up") return block.index > 0;
  if (action === "down") return block.index + 1 < block.count;
  return true;
}

/** 단축키: Ctrl+D 블록 복제, Alt+Shift+↑/↓ 블록 이동. */
function shortcutAction(event: KeyboardEvent): BlockAction | null {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "d")
    return "duplicate";
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowUp") return "up";
  if (event.key === "ArrowDown") return "down";
  return null;
}

/** 메뉴를 손잡이 아래(공간이 모자라면 위)에 화면 안으로 띄운다. */
function popoverStyle(anchor: DOMRect, height: number): React.CSSProperties {
  const below = window.innerHeight - anchor.bottom - 12,
    above = anchor.top - 12;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 296));
  if (below >= Math.min(height, 320) || below >= above)
    return {
      position: "fixed",
      left,
      top: anchor.bottom + 4,
      ["--block-menu-max" as string]: `${Math.min(height, below)}px`,
    };
  return {
    position: "fixed",
    left,
    bottom: window.innerHeight - anchor.top + 4,
    ["--block-menu-max" as string]: `${Math.min(height, above)}px`,
  };
}

/**
 * 떠 있는 블록 손잡이 (Figma BlockHandle 48:6669): [+] 블록 넣기, [종류 아이콘 + ⋮⋮] 블록 메뉴·끌어서 이동.
 * 큰 문서(windowed) 편집기는 documentAction/documentDrag로 원문 단위 동작을 맡는다.
 */
export function BlockTools({
  editor,
  markdownCompatible = false,
  documentAction,
  documentDrag,
}: Readonly<{
  editor: Editor;
  markdownCompatible?: boolean;
  documentAction?: DocumentBlockAction;
  documentDrag?: DocumentBlockDrag;
}>) {
  const hover = useRef<Target | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [hoverKind, setHoverKind] = useState(() => blockKind(null));
  const [open, setOpen] = useState<{
    menu: "insert" | "action";
    target: Target;
    selection: Selection;
    style: React.CSSProperties;
  } | null>(null);
  const store = useStore();
  const { prompt, showError } = store;
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview) previewDialog.current?.showModal();
    else previewDialog.current?.close();
  }, [preview]);
  useEffect(() => {
    setBlockContext(editor, { prompt, showError });
    return () => setBlockContext(editor, null);
  }, [editor, prompt, showError]);
  const dragCallback = useRef(documentDrag);
  dragCallback.current = documentDrag;
  useEffect(() => {
    if (!documentDrag) return;
    const start = (event: DragEvent) => {
      const handle = event.target instanceof Element ? event.target.closest(".inkism-drag-handle") : null;
      if (!handle) {
        // Text dragging has no canonical range move yet. Do not let native DnD
        // silently move only a visible piece or normalize its neighbours.
        if (event.target instanceof Node && editor.view.dom.contains(event.target)) event.preventDefault();
        return;
      }
      if (!editor.view.dom.parentElement?.contains(handle)) return;
      // The owner moves canonical blocks. The native plugin would otherwise
      // put only this mounted piece in the transfer and delete its local slice.
      event.stopImmediatePropagation();
      const target = hover.current;
      if (
        !target ||
        editor.isDestroyed ||
        editor.view.composing ||
        editor.state.doc.nodeAt(target.pos) !== target.node
      ) {
        event.preventDefault();
        return;
      }
      dragCallback.current?.(editor.state.doc.resolve(target.pos).index(0), event);
    };
    document.addEventListener("dragstart", start, true);
    return () => document.removeEventListener("dragstart", start, true);
  }, [editor, Boolean(documentDrag)]);
  const [, setKey] = useReducer((_: string, next: string) => next, "");
  useEffect(() => {
    const update = () => {
      const block = currentBlock(editor);
      // Re-render only when action availability changes, not for every typed character.
      setKey(block ? `${block.index}:${block.count}` : "none");
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);
  const block = currentBlock(editor);
  const run = (action: BlockAction, anchoredTarget?: Target | null) => {
    if (editor.isDestroyed || editor.view.composing) return;
    // The handle menu is anchored to the hovered block, while windowed
    // editors may have a stale/virtualized text selection. Prefer that
    // canonical anchor when it is still present so menu actions cannot be
    // dropped after another async block action (for example copy-link).
    const menuTarget = anchoredTarget ?? open?.target;
    const currentMenuNode = menuTarget ? editor.state.doc.nodeAt(menuTarget.pos) : null;
    const target = menuTarget && currentMenuNode
      ? { ...menuTarget, node: currentMenuNode, index: editor.state.doc.resolve(menuTarget.pos).index(0), count: editor.state.doc.childCount }
      : currentBlock(editor);
    if (!target) return;
    if (documentAction) {
      documentAction(action, target.index, true, Boolean(anchoredTarget));
      return;
    }
    const tr = closeHistory(editor.state.tr);
    const selectedPos = applyBlockAction(editor, tr, action, target);
    if (selectedPos === null) return;
    if (action !== "delete" && action !== "insert") tr.setSelection(NodeSelection.create(tr.doc, selectedPos));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  };
  const allowed = (action: BlockAction) =>
    Boolean(block && (documentAction ? documentAction(action, block.index, false) : locallyAllowed(action, block)));
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const runRef = useRef(run);
  runRef.current = run;

  // 단축키: Ctrl+D 블록 복제, Alt+Shift+↑/↓ 블록 이동 (현재 커서가 있는 블록).
  useEffect(() => {
    const dom = editor.view.dom;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process" || editor.view.composing) return;
      const action = shortcutAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (allowedRef.current(action)) runRef.current(action);
    };
    dom.addEventListener("keydown", key, true);
    return () => dom.removeEventListener("keydown", key, true);
  }, [editor]);

  const lock = (locked: boolean) => {
    if (!editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta("lockDragHandle", locked).setMeta("addToHistory", false));
  };
  const valid = (target: Target | null): target is Target =>
    Boolean(target && !editor.isDestroyed && !editor.view.composing && editor.isEditable && (() => {
      const current = editor.state.doc.nodeAt(target.pos);
      return current && current.type === target.node.type;
    })());
  const openMenu = (menu: "insert" | "action") => {
    const target = hover.current;
    if (open?.menu === menu) {
      close();
      return;
    }
    if (!valid(target) || !handle.current) return;
    const selection = editor.state.selection;
    if (menu === "action") {
      const inTable =
        target.node.type.name === "table" &&
        selection.from > target.pos &&
        selection.to < target.pos + target.node.nodeSize;
      if (!inTable)
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target.pos)));
    }
    lock(true);
    setOpen({
      menu,
      target,
      selection,
      style: popoverStyle(handle.current.getBoundingClientRect(), menu === "insert" ? 881 : 520),
    });
  };
  const close = (refocus = false) => {
    setOpen(null);
    lock(false);
    if (refocus && !editor.isDestroyed) editor.view.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const node = event.target as Node;
      if (document.querySelector(".block-popover")?.contains(node) || handle.current?.contains(node)) return;
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", outside);
    };
  }, [open]);
  const isOpen = useRef(false);
  isOpen.current = Boolean(open);
  useEffect(
    () => () => {
      if (isOpen.current) lock(false);
    },
    [],
  );

  /** [+]: 손잡이 블록 아래에 빈 문단을 만들고(빈 문단이면 그 자리) 고른 블록으로 바꾼다. */
  const insert = (item: BlockItem, options?: RunOptions) => {
    const target = open?.target ?? null;
    close();
    if (!valid(target) || !item.available(editor)) return;
    const { node, pos } = target;
    const empty = node.type.name === "paragraph" && node.content.size === 0;
    // 큰 문서에서 "본문"은 예전 "아래에 문단 추가"처럼 원문 단위 삽입을 쓴다.
    if (documentAction && item.id === "paragraph" && !empty) {
      documentAction("insert", editor.state.doc.resolve(pos).index(0), true);
      return;
    }
    const tr = closeHistory(editor.state.tr);
    if (empty) tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    else {
      const at = pos + node.nodeSize;
      tr.insert(at, editor.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at + 1));
    }
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    void item.run(editor, options);
  };
  const act = (action: BlockMenuAction) => {
    const target = open?.target ?? null;
    close(true);
    if (!valid(target)) return;
    if(action==='copy-link') {
      const noteId=store.readDraft()?.id;if(!noteId||markdownCompatible||!Object.hasOwn(target.node.attrs,'id'))return;
      const id=target.node.attrs.id||newBlockId();
      if(!target.node.attrs.id)editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos,undefined,{...target.node.attrs,id}));
      void (async()=>{try{
        if(!await store.flushNow())throw new Error(t('먼저 노트를 저장해 주세요.'));
        await navigator.clipboard.writeText(`note://${noteId}#${encodeURIComponent('^'+id)}`);
      }catch(e){void showError(t("문단 링크 복사"),e instanceof Error?e.message:String(e));}})();return;
    }
    if (action === "copy") {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target.pos)));
      // 블록이 NodeSelection이므로 편집기의 복사(HTML+텍스트)를 그대로 쓴다.
      if (!document.execCommand("copy")) void navigator.clipboard?.writeText(target.node.textContent);
      return;
    }
    run(action, target);
  };
  const actionAllowed = (action: BlockMenuAction) => action === "copy-link" ? !markdownCompatible && Boolean(open?.target.node.attrs && Object.hasOwn(open.target.node.attrs,"id")) : action === "copy" || allowed(action);

  const Kind = open ? blockKind(open.target.node) : hoverKind;
  const KindIcon = Kind.icon;
  return (
    <>
      <DragHandle
        editor={editor}
        nested={false}
        className="inkism-drag-handle"
        computePositionConfig={POSITION}
        onNodeChange={({ node, pos }) => {
          hover.current = node && pos >= 0 ? { node, pos } : null;
          if (node) {
            const next = blockKind(node);
            setHoverKind((kind) => (kind.id === next.id ? kind : next));
          }
        }}
      >
        <div ref={handle} className="block-handle" data-open={open?.menu} data-kind={Kind.id}>
          <button
            type="button"
            className="block-handle__add"
            aria-label={t("블록 넣기")}
            title={t("아래에 블록 넣기")}
            draggable={false}
            aria-haspopup="listbox"
            aria-expanded={open?.menu === "insert"}
            onClick={() => openMenu("insert")}
          >
            <Plus size={14} aria-hidden />
          </button>
          <div className="block-handle__grip" data-open={open?.menu === "action" || undefined}>
            <button
              type="button"
              aria-label={t("블록 동작")}
              title={t("{label} · 블록 메뉴", { label: Kind.label })}
              aria-haspopup="menu"
              aria-expanded={open?.menu === "action"}
              onClick={() => openMenu("action")}
            >
              <KindIcon size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("블록 끌어서 이동")}
              title={t("끌어서 이동 · 클릭하여 블록 메뉴")}
              onClick={() => openMenu("action")}
            >
              <GripVertical size={14} aria-hidden />
            </button>
          </div>
        </div>
      </DragHandle>
      {open &&
        createPortal(
          <div className="block-popover">
            {open.menu === "insert" ? (
              <BlockMenu
                editor={editor}
                items={BLOCK_ITEMS.filter(item=>!markdownCompatible||MARKDOWN_BLOCKS.has(item.id))}
                style={open.style}
                onChoose={insert}
                onClose={() => close(true)}
              />
            ) : (
              <BlockActionMenu
                editor={editor}
                markdownCompatible={markdownCompatible}
                kind={Kind}
                node={open.target.node}
                actions={markdownCompatible ? [] : blockSpecificActions(
                  editor,
                  open.target.pos,
                  open.target.node,
                  { prompt, showError },
                  (src, alt) => {
                    setPreviewFailed(false);
                    setPreview({ src, alt });
                  },
                  open.selection,
                )}
                onSpecific={(action) => {
                  close();
                  void Promise.resolve()
                    .then(action.run)
                    .catch((error) => showError(action.label, error instanceof Error ? error.message : String(error)));
                }}
                style={open.style}
                allowed={actionAllowed}
                onAction={act}
                onStyle={(preset) => {
                  const target = open.target;
                  close();
                  if (!valid(target) || target.node.type.name !== preset.type) return;
                  const attrs = {...target.node.attrs};
                  for (const key of ["textAlign", "dir"] as const) {
                    if (Object.hasOwn(attrs,key)) attrs[key] = preset.attrs[key] ?? null;
                  }
                  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos,undefined,attrs));
                }}
                onClose={() => close(true)}
                onConvert={(id) => {
                  const target = open.target;
                  close();
                  if (valid(target)) convertBlock(editor, target.pos, id);
                }}
                onColor={(kind, color) => {
                  const target = open.target;
                  close();
                  if (valid(target)) colorBlock(editor, target.pos, kind, color);
                }}
              />
            )}
          </div>,
          document.body,
        )}
      {preview &&
        createPortal(
          <dialog
            ref={previewDialog}
            className="block-image-preview"
            aria-label={t("이미지 미리보기")}
            onCancel={() => setPreview(null)}
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreview(null);
            }}
          >
            <header>
              <span>{preview.alt}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("이미지 미리보기 닫기")}
                onClick={() => setPreview(null)}
              >
                <X size={16} />
              </button>
            </header>
            <img src={preview.src} alt={preview.alt} hidden={previewFailed} onError={() => setPreviewFailed(true)} />
            {previewFailed && <p>{t("미리보기를 표시할 수 없습니다. 이미지 다운로드로 원본을 확인해 주세요.")}</p>}
          </dialog>,
          document.body,
        )}
    </>
  );
}
