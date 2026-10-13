import { ANCHOR_EVENT, textOccurrence, type AnchorRequest } from "../lib/note-anchor";
import { markdownToHTML } from "../lib/markdown";
import {
  acquireRichHistory,
  releaseRichHistory,
  restoreRichHistory,
  observeRichHistory,
} from "../lib/rich-history-cache";
import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { joinBackward, joinForward } from "@tiptap/pm/commands";
import { undoDepth } from "@tiptap/pm/history";
import type { Node as PMNode, Slice } from "@tiptap/pm/model";
import { Selection, TextSelection, Plugin, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension, type Editor } from "@tiptap/core";
import { windowSelection, type DocumentSelection, type BlockFormatOperation } from "../lib/document-selection";
import { normalizeBlockquoteSelection } from "../lib/native-block-format";
import { BlockTools, type DocumentBlockAction, type DocumentBlockDrag } from "./BlockTools";
import { contentExtensions } from "../extensions/content-schema";
import { markdownContentExtensions } from "../lib/markdown-compatible";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { NoteEmbeds } from "../extensions/note-embeds";
import { SlashMenu } from "../extensions/slash-menu";
import FindAndReplace, { searchDocument } from "@tiptap/extension-find-and-replace";
import { FindReplace } from "./FindReplace";
import { SelectionToolbar } from "./SelectionToolbar";
import { TermDefinitionPopover } from "./TermDefinitionPopover";
import { EditorToolbar, type HistoryControls } from "./EditorToolbar";
import { EditorContent, useEditor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { sanitizeRichHtml } from "../lib/sanitize";
import { readClipboard, type NativeClipboard } from "../lib/native-clipboard";
import { moveVisualCursor } from "../lib/visual-cursor";
import { t } from "../i18n";

export interface RichChange {
  group: number;
  count: number;
  beforeSelection?: Record<string, unknown>;
  afterSelection?: Record<string, unknown>;
}

interface Props {
  markdownCompatible?: boolean;
  editable?: boolean;
  readOnly?: boolean;
  documentSelection?: { selection: DocumentSelection; offset: number; source?: import("../types").DocumentSegment };
  onEditor?: (editor: Editor | null) => void;
  onDocumentTransaction?: (transaction: Transaction) => boolean;
  onDocumentBlockFormat?: (operation: BlockFormatOperation, execute: boolean) => boolean;
  onDocumentPaste?: (slice: Slice) => boolean;
  onDocumentClipboard?: (input: NativeClipboard) => boolean;
  onDocumentBlockAction?: DocumentBlockAction;
  onDocumentBlockDrag?: DocumentBlockDrag;
  noteIdentity?: { id: string; revision: number };
  navigationIdentity?: { id: string; revision: number };
  findTarget?: { query: string; sensitive: boolean; request: number; occurrence?:number };
  history?: HistoryControls;
  onSelection?: (selection: Record<string, unknown>) => void;
  initialSelection?: Record<string, unknown>;
  initialProjection?: boolean;
  initialEdge?: "start" | "end";
  initialColumn?: number;
  verticalColumn?: React.MutableRefObject<number | undefined>;
  initialVerticalStep?: { up: boolean; freshColumn: boolean; extend: boolean };
  initialJoin?: "backward" | "forward";
  onBoundary?: (direction: "previous" | "next" | "first" | "last" | "backward" | "forward" | "up" | "down") => boolean;
  initialContent: string;
  embedded?: boolean;
  /** Internal source spans must not acquire an artificial trailing paragraph. */
  internalWindow?: boolean;
  onChange: (content: string, text: string, change: RichChange) => void;
}

type BoundaryCallback = NonNullable<Props["onBoundary"]>;

/** Ctrl/⌘+Home/End: move to the document (or window) edge. */
function handleDocumentEdgeKey(view: EditorView, event: KeyboardEvent, onBoundary: Props["onBoundary"]) {
  if (event.key !== "Home" && event.key !== "End") return false;
  const { selection, doc } = view.state;
  if (onBoundary) {
    if (event.shiftKey) return false;
    if (onBoundary(event.key === "Home" ? "first" : "last")) return true;
  }
  // Commit keyboard navigation before ProseMirror's deferred focus
  // reconciliation can restore the old caret from editor state.
  const selected = event.key === "Home" ? Selection.atStart(doc) : Selection.atEnd(doc);
  const next = event.shiftKey ? TextSelection.between(doc.resolve(selection.anchor), selected.$head) : selected;
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  // A recent mouse click can leave DOM selection ahead of editor state.
  view.focus();
  return true;
}

/** ArrowUp/ArrowDown in a text selection keeps the visual column across windows. */
function handleVerticalKey(
  view: EditorView,
  event: KeyboardEvent,
  onBoundary: BoundaryCallback,
  verticalColumn: React.MutableRefObject<number | undefined>,
) {
  const { selection, doc } = view.state;
  const up = event.key === "ArrowUp";
  verticalColumn.current ??= view.coordsAtPos(selection.head).left;
  const edge = up ? Selection.atStart(doc) : Selection.atEnd(doc);
  const headState = view.state.apply(view.state.tr.setSelection(TextSelection.create(doc, selection.head)));
  if (selection.$head.sameParent(edge.$head) && view.endOfTextblock(up ? "up" : "down", headState)) {
    // Shift boundary selection is coordinated by the document owner.
    if (event.shiftKey) return false;
    if (onBoundary(up ? "up" : "down")) return true;
  }
  return moveVisualCursor(view, up, verticalColumn.current, event.shiftKey);
}

/** Backspace/Delete/ArrowLeft/ArrowRight at the window edge hand off to the document owner. */
function handleBoundaryKey(
  view: EditorView,
  event: KeyboardEvent,
  onBoundary: Props["onBoundary"],
  internalWindow: boolean,
) {
  const { selection, doc } = view.state;
  if (event.shiftKey || !onBoundary || !selection.empty) return false;
  const atStart = selection.eq(Selection.atStart(doc)),
    atEnd = selection.eq(Selection.atEnd(doc));
  if ((internalWindow || selection.$from.depth === 1) && selection.$from.parent.isTextblock) {
    if (event.key === "Backspace" && atStart) return onBoundary("backward");
    if (event.key === "Delete" && atEnd) return onBoundary("forward");
  }
  if (event.key === "ArrowLeft" && atStart) return onBoundary("previous");
  if (event.key === "ArrowRight" && atEnd) return onBoundary("next");
  return false;
}

type InitialCaret = Pick<
  Props,
  | "initialSelection"
  | "initialProjection"
  | "initialEdge"
  | "initialColumn"
  | "initialVerticalStep"
  | "initialJoin"
  | "documentSelection"
>;
type CaretRefs = {
  projecting: React.MutableRefObject<boolean>;
  verticalColumn?: React.MutableRefObject<number | undefined>;
  beforeSelection: React.MutableRefObject<Record<string, unknown> | undefined>;
};

function initialSelectionOf(doc: PMNode, { initialEdge, initialSelection }: InitialCaret) {
  if (initialEdge) return initialEdge === "start" ? Selection.atStart(doc) : Selection.atEnd(doc);
  if (initialSelection) return Selection.fromJSON(doc, initialSelection);
  return Selection.atStart(doc);
}

/** Keeps the caret on the same visual column after mounting a new window. */
function restoreInitialColumn(editor: Editor, selected: Selection, initialColumn: number) {
  const doc = editor.state.doc;
  const line = editor.view.coordsAtPos(selected.head);
  const located = editor.view.posAtCoords({ left: initialColumn, top: (line.top + line.bottom) / 2 });
  if (located && doc.resolve(located.pos).sameParent(selected.$head)) {
    const column = TextSelection.near(doc.resolve(located.pos));
    editor.view.dispatch(editor.state.tr.setSelection(column).setMeta("addToHistory", false));
  }
}

/** Restores the caret, column, vertical step or pending join on first mount. Throws on invalid positions. */
function placeInitialCaret(editor: Editor, caret: InitialCaret, refs: CaretRefs) {
  const { initialProjection, initialColumn, initialVerticalStep, initialJoin, documentSelection } = caret;
  const { projecting, verticalColumn, beforeSelection } = refs;
  const doc = editor.state.doc;
  const joinDirection = initialJoin === "backward" ? 1 : -1;
  const boundary =
    initialJoin && doc.childCount > 1
      ? Selection.findFrom(doc.resolve(doc.firstChild!.nodeSize), joinDirection, true)
      : null;
  const selected = boundary ?? initialSelectionOf(doc, caret);
  // A bounded node view represents a whole source block selected by its
  // document owner. Restoring that node must not shrink the global range
  // to the few visible source bytes.
  projecting.current = Boolean(documentSelection && (initialProjection || selected.toJSON().type === "node"));
  try {
    editor.view.dispatch(editor.state.tr.setSelection(selected));
  } finally {
    projecting.current = false;
  }
  if (!initialVerticalStep && initialColumn !== undefined && Number.isFinite(initialColumn))
    restoreInitialColumn(editor, selected, initialColumn);
  if (initialVerticalStep && verticalColumn) {
    if (initialVerticalStep.freshColumn || verticalColumn.current === undefined)
      verticalColumn.current = editor.view.coordsAtPos(selected.head).left;
    moveVisualCursor(editor.view, initialVerticalStep.up, verticalColumn.current, initialVerticalStep.extend);
  }
  if (boundary && initialJoin) {
    beforeSelection.current = selected.toJSON();
    const join = initialJoin === "backward" ? joinBackward : joinForward;
    join(editor.state, editor.view.dispatch, editor.view);
  }
}

/** 일반 크기 문서용 리치 텍스트 편집기 (Tiptap). */
export function RichEditor({
  markdownCompatible = false,
  noteIdentity,
  navigationIdentity,
  initialContent,
  onChange,
  embedded = false,
  internalWindow = false,
  editable = true,
  readOnly = false,
  history,
  initialSelection,
  initialProjection,
  initialEdge,
  initialColumn,
  verticalColumn,
  initialVerticalStep,
  initialJoin,
  onBoundary,
  findTarget,
  onSelection,
  documentSelection,
  onEditor,
  onDocumentTransaction,
  onDocumentBlockFormat,
  onDocumentPaste,
  onDocumentClipboard,
  onDocumentBlockAction,
  onDocumentBlockDrag,
}: Readonly<Props>) {
  // initialContent belongs to this editor instance. Parent renders and revision
  // updates must not reparse its full HTML; a different document mounts a new key.
  const [initialHTML] = useState(() => sanitizeRichHtml(initialContent));
  const changeCallback = useRef(onChange);
  changeCallback.current = onChange;
  const pending = useRef<{ editor: Editor; change: RichChange } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const snapshot = pending.current;
    if (!snapshot || snapshot.editor.isDestroyed) return;
    // Clear before calling the parent: saving can dispatch another flush, or
    // synchronously edit the document again. A newer pending edit must survive.
    pending.current = null;
    try {
      changeCallback.current(snapshot.editor.getHTML(), snapshot.editor.getText(), snapshot.change);
    } catch (error) {
      pending.current ??= snapshot;
      throw error;
    }
  };
  const scheduleFlush = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const snapshot = pending.current;
      if (snapshot && !snapshot.editor.isDestroyed && snapshot.editor.view.composing) {
        scheduleFlush();
        return;
      }
      flush();
    }, 300);
  };
  const cached = useRef<ReturnType<typeof acquireRichHistory>>();
  const selectionCallback = useRef(onSelection);
  selectionCallback.current = onSelection;
  const beforeSelection = useRef<Record<string, unknown>>();
  const projecting = useRef(false);
  const documentTransaction = useRef(onDocumentTransaction);
  documentTransaction.current = onDocumentTransaction;
  const blockFormat = useRef(onDocumentBlockFormat);
  blockFormat.current = onDocumentBlockFormat;
  const pasteCallback = useRef(onDocumentPaste);
  pasteCallback.current = onDocumentPaste;
  const clipboardCallback = useRef(onDocumentClipboard);
  clipboardCallback.current = onDocumentClipboard;
  const plainPaste = useRef(false);
  const canEdit = useRef(editable && !readOnly);
  canEdit.current = editable && !readOnly;

  const editor = useEditor({
    // Create after React commits. Render-time construction starts Tiptap's
    // destruction timer before passive effects can claim the editor; slower
    // WebView2 scheduling can otherwise destroy it during the first mount.
    immediatelyRender: false,
    editable: editable && !readOnly,
    extensions: [
      NoteEmbeds.configure({ noteId: noteIdentity?.id ?? "" }),
      // Capture the command's intent before it is reduced to steps on just the
      // mounted window. Toggle decisions belong to the complete selection.
      // Command definitions are merged in extension order (lower priority
      // comes last), unlike ProseMirror plugin priority.
      Extension.create({
        name: "documentBlockCommands",
        priority: 50,
        addCommands() {
          const intercept = (operation: BlockFormatOperation, props: import("@tiptap/core").CommandProps) => {
            if (!canEdit.current || !blockFormat.current?.(operation, !!props.dispatch)) return false;
            if (props.dispatch) props.tr.setMeta("preventDispatch", true);
            return true;
          };
          return {
            setHeading: (attributes) => (props) => {
              if (!(markdownCompatible ? [1,2,3,4,5,6] : [1,2,3]).includes(attributes.level)) return false;
              return (
                intercept(
                  { kind: "block", type: "heading", level: attributes.level as 1 | 2 | 3, toggle: false },
                  props,
                ) || props.commands.setNode("heading", attributes)
              );
            },
            toggleHeading: (attributes) => (props) => {
              if (!(markdownCompatible ? [1,2,3,4,5,6] : [1,2,3]).includes(attributes.level)) return false;
              return (
                intercept(
                  { kind: "block", type: "heading", level: attributes.level as 1 | 2 | 3, toggle: true },
                  props,
                ) || props.commands.toggleNode("heading", "paragraph", attributes)
              );
            },
            setParagraph: () => (props) =>
              intercept({ kind: "block", type: "paragraph" }, props) || props.commands.setNode("paragraph"),
            toggleBulletList: () => (props) =>
              intercept({ kind: "block", type: "bulletList" }, props) ||
              props.commands.toggleList("bulletList", "listItem"),
            toggleOrderedList: () => (props) =>
              intercept({ kind: "block", type: "orderedList" }, props) ||
              props.commands.toggleList("orderedList", "listItem"),
            toggleTaskList: () => (props) =>
              intercept({ kind: "block", type: "taskList" }, props) ||
              props.commands.toggleList("taskList", "taskItem"),
            toggleBlockquote: () => (props) =>
              intercept({ kind: "block", type: "blockquote" }, props) ||
              props
                .chain()
                .command(({ tr }) => {
                  normalizeBlockquoteSelection(tr);
                  return true;
                })
                .toggleWrap("blockquote")
                .run(),
            toggleCodeBlock: (attributes) => (props) =>
              intercept({ kind: "block", type: "codeBlock", language: attributes?.language }, props) ||
              props.commands.toggleNode("codeBlock", "paragraph", attributes),
          };
        },
      }),
      Extension.create({
        name: "documentSelectionGuard",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction(tr) {
                return !tr.docChanged || (canEdit.current && !documentTransaction.current?.(tr));
              },
            }),
          ];
        },
      }),
      ...(markdownCompatible ? markdownContentExtensions() : contentExtensions({ trailingNode: !(internalWindow || embedded), automaticIds: !internalWindow })),
      SlashMenu.configure({ markdownCompatible }),
      FindAndReplace.configure({ injectCSS: false }),
      Placeholder.configure({ placeholder: t("내용을 입력하세요…") }),
    ],
    content: initialHTML,
    // Saved editor HTML must round-trip without shifting history positions.
    parseOptions: { preserveWhitespace: "full" },
    editorProps: {
      handleDOMEvents: {
        keydown: (_view, event) => {
          plainPaste.current = event.shiftKey && event.key !== "Insert";
          return false;
        },
        keyup: (_view, event) => {
          if (!event.shiftKey) plainPaste.current = false;
          return false;
        },
        paste: (view, event) => {
          if (!canEdit.current) {
            event.preventDefault();
            return true;
          }
          if (!clipboardCallback.current || view.composing) return false;
          const input = readClipboard(event, plainPaste.current);
          if (input && clipboardCallback.current(input)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      handlePaste: (_view, _event, slice) => !canEdit.current || (pasteCallback.current?.(slice) ?? false),
      handleKeyDown: (view, event) => {
        if (event.isComposing || event.key === "Process" || view.composing || event.altKey) return false;
        if (event.ctrlKey || event.metaKey) return handleDocumentEdgeKey(view, event, onBoundary);
        if (
          onBoundary &&
          verticalColumn &&
          view.state.selection instanceof TextSelection &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        )
          return handleVerticalKey(view, event, onBoundary, verticalColumn);
        return handleBoundaryKey(view, event, onBoundary, internalWindow);
      },
      attributes: {
        class: "tiptap-prose",
        "aria-label": t("노트 본문 (리치 텍스트 편집기)"),
        "aria-readonly": String(readOnly || !editable),
        spellcheck: "true",
      },
    },
    onSelectionUpdate: ({ editor }) => {
      if (!projecting.current) selectionCallback.current?.(editor.state.selection.toJSON());
    },
    onUpdate: ({ editor, transaction }) => {
      // A selection/initialization transaction can append Tiptap's trailing
      // paragraph. Keep that editor scaffold out of storage until an edit.
      if (!canEdit.current || !transaction.docChanged) return;
      const change: RichChange = {
        group: undoDepth(editor.state),
        count: editor.state.doc.childCount,
        beforeSelection: beforeSelection.current,
        afterSelection: editor.state.selection.toJSON(),
      };
      // A window is a bounded chunk. Its range/history queue needs each change
      // synchronously, including undo boundaries; never coalesce that protocol.
      if (embedded) {
        changeCallback.current(editor.getHTML(), editor.getText(), change);
        return;
      }
      if (pending.current) change.beforeSelection = pending.current.change.beforeSelection;
      pending.current = { editor, change };
      scheduleFlush();
      // Protect close/navigation before the delayed string reaches the store.
      window.dispatchEvent(new Event("inkism-editor-dirty"));
    },
  });
  useLayoutEffect(() => {
    window.addEventListener("inkism-flush-editor", flush);
    return () => {
      window.removeEventListener("inkism-flush-editor", flush);
      flush();
    };
  }, [editor]);
  useLayoutEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor]);
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || !documentSelection) return;
    const selected = windowSelection(
      editor.state.doc,
      documentSelection.offset,
      documentSelection.selection,
      documentSelection.source,
    );
    if (!selected) return;
    projecting.current = true;
    try {
      editor.view.dispatch(editor.state.tr.setSelection(selected).setMeta("addToHistory", false));
    } finally {
      projecting.current = false;
    }
  }, [editor, documentSelection]);

  const initializedEditor = useRef<typeof editor | null>(null);
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === (editable && !readOnly)) return;
    editor.setEditable(editable && !readOnly, false);
    // Refresh existing tool permissions without a content update or undo step.
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  }, [editor, editable, readOnly]);
  // Tiptap's create event is deferred. Restore before paint so input and a
  // rapid tab switch cannot precede history acquisition or caret restoration.
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const firstMount = initializedEditor.current !== editor;
    initializedEditor.current = editor;
    if (noteIdentity) {
      cached.current = acquireRichHistory(noteIdentity.id, noteIdentity.revision);
      if (cached.current.value) editor.view.updateState(restoreRichHistory(editor.state, cached.current.value));
      cached.current.value = undefined;
      observeRichHistory(cached.current.handle, () => editor.state);
    }
    if (firstMount && (initialSelection || initialEdge || initialJoin)) {
      try {
        placeInitialCaret(
          editor,
          {
            initialSelection,
            initialProjection,
            initialEdge,
            initialColumn,
            initialVerticalStep,
            initialJoin,
            documentSelection,
          },
          { projecting, verticalColumn, beforeSelection },
        );
      } catch {
        /* Imported markup can normalize positions; keep a valid selection. */
      }
      editor.commands.focus(undefined, { scrollIntoView: Boolean(initialEdge || initialJoin || initialVerticalStep) });
    }
    return () => {
      if (noteIdentity && cached.current && !editor.isDestroyed)
        releaseRichHistory(noteIdentity.id, cached.current.handle, editor.state);
    };
  }, [editor]);

  useEffect(() => {
    const identity=navigationIdentity??noteIdentity;
    if (!editor || embedded || !identity) return;
    const navigate = (event: Event) => {
      const request = (event as CustomEvent<AnchorRequest>).detail;
      if (identity.id !== request.note.id || editor.isDestroyed) return;
      if (identity.revision !== request.note.revision) {
        request.accept(Promise.reject(new Error(t("문서가 변경되었습니다. 다시 시도해 주세요.")))); return;
      }
      const { anchor } = request;
      if(anchor.byteOffset!==undefined&&!request.note.content)return;
      if(anchor.searchText){
        let occurrence=anchor.searchOccurrence;
        // Markdown byte anchors arrive without a visual occurrence; the
        // renderer that produced this document resolves it here.
        if(occurrence===undefined&&anchor.byteOffset!==undefined&&request.note.content_format==="markdown"){
          const prefix=document.createElement("template");prefix.innerHTML=markdownToHTML(request.note.content.slice(0,anchor.sourceOffset)).content;
          occurrence=textOccurrence((prefix.content.textContent??"").trim(),anchor.searchText);
        }
        const found=searchDocument(editor.state.doc,anchor.searchText,{caseSensitive:true,useRegex:false,wholeWord:false})[occurrence??0];
        if(found){
          editor.commands.setTextSelection({from:found.from,to:found.to});
          if(editor.isEditable)editor.commands.focus();
          editor.commands.scrollIntoView();
          // A non-editable ProseMirror does not synchronize its text selection
          // to the browser. Reading/navigation must still reveal the match.
          if(!editor.isEditable){
            const start=editor.view.domAtPos(found.from),end=editor.view.domAtPos(found.to);
            const element=start.node instanceof Element?start.node:start.node.parentElement;
            for(let ancestor=element;ancestor&&ancestor!==editor.view.dom;ancestor=ancestor.parentElement)
              if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;
            const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
            window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);
            element?.scrollIntoView({block:'center'});
          }
          request.accept();return;
        }
      }
      const element = anchor.kind === "heading"
        ? editor.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")[anchor.index]
        : anchor.id ? editor.view.dom.querySelector<HTMLElement>(`[id="${CSS.escape(anchor.id)}"]`) : null;
      if (!element) {
        // Native Markdown keeps block labels as source text; locate the
        // matching text block even though its HTML projection has no ID.
        if (anchor.kind === "block" && anchor.id && markdownCompatible) {
          let found: number | undefined;
          editor.state.doc.descendants((node, pos) => {
            if (found === undefined && node.isTextblock && node.textContent.trimEnd().endsWith("^" + anchor.id)) found = pos + 1;
          });
          if (found !== undefined) { editor.commands.setTextSelection(found); editor.commands.focus(); editor.commands.scrollIntoView(); request.accept(); }
        }
        return;
      }
      for (let ancestor = element.parentElement; ancestor && ancestor !== editor.view.dom; ancestor = ancestor.parentElement)
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      element.scrollIntoView({ block: "center" });
      editor.commands.setTextSelection(Math.min(editor.view.posAtDOM(element, 0), editor.state.doc.content.size));
      editor.view.focus(); request.accept();
    };
    window.addEventListener(ANCHOR_EVENT, navigate);
    return () => window.removeEventListener(ANCHOR_EVENT, navigate);
  }, [editor, embedded, markdownCompatible, noteIdentity?.id, noteIdentity?.revision, navigationIdentity?.id, navigationIdentity?.revision]);
  useEffect(() => {
    if (!editor) return;
    const before = () => {
      beforeSelection.current = editor.state.selection.toJSON();
    };
    editor.on("beforeTransaction", before);
    return () => {
      editor.off("beforeTransaction", before);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !findTarget || editor.isDestroyed) return;
    const { query, sensitive } = findTarget;
    const result = searchDocument(editor.state.doc, query, {
      caseSensitive: sensitive,
      useRegex: false,
      wholeWord: false,
    })[findTarget.occurrence??0];
    if (!result) return;
    editor.commands.setCaseSensitive(sensitive);
    editor.commands.setSearchTerm(query);
    const tr = editor.state.tr;
    const position = tr.doc.resolve(result.from);
    for (let depth = 1; depth <= position.depth; depth++) {
      const node = position.node(depth);
      if (node.type.name === "details" && !node.attrs.open)
        tr.setNodeMarkup(position.before(depth), undefined, { ...node.attrs, open: true });
    }
    tr.setSelection(TextSelection.create(tr.doc, result.from, result.to));
    editor.view.dispatch(tr.setMeta("addToHistory", false));
    editor.view.focus();
    // Keep the selected block mounted; scrolling an inner result into view is
    // left to the window position rather than triggering another window switch.
  }, [editor, findTarget]);

  return (
    <>
      {editable && (markdownCompatible ? <MarkdownToolbar editor={editor} readOnly={readOnly} /> : <EditorToolbar editor={editor} history={history} readOnly={readOnly} />)}
      {editable && editor && (
        <BlockTools editor={editor} markdownCompatible={markdownCompatible} documentAction={onDocumentBlockAction} documentDrag={onDocumentBlockDrag} />
      )}
      {editable && editor && <FindReplace editor={editor} readOnly={readOnly} />}
      {editable && editor && !markdownCompatible && <SelectionToolbar editor={editor} />}
      {editor && <TermDefinitionPopover editor={editor} readOnly={readOnly || !editable} disabled={markdownCompatible} />}
      <div className={(embedded ? "rich-window-content" : "editor-scroll") + (editable ? " block-gutter" : "")}>
        <EditorContent editor={editor} className="rich-editor" />
      </div>
    </>
  );
}
