import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { SelectionBookmark, Transaction } from "@tiptap/pm/state";
import { Selection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Sigma, SquareSigma, Trash2 } from "../icons";
import { MATH_EVENT, MAX_MATH_LENGTH, renderMath, requestMath } from "../extensions/math";
import type { MathDiagnostic } from "../lib/math-diagnostics";
import type { MathKind, MathRequest } from "../extensions/math";
import { useStore } from "../store";
import { IconButton } from "./IconButton";
import "./MathTools.css";
import { t } from "../i18n";

/** 열려 있는 편집 세션. target이 null이면 삽입, 아니면 기존 노드 편집. */
interface MathSession {
  kind: MathKind;
  target: { latex: string; node: PMNode } | null;
}

interface Props {
  editor: Editor;
}

/**
 * 수식 삽입/편집 도구.
 *
 * - 툴바 버튼은 requestMath(MATH_EVENT)로 요청하고, 이 컴포넌트가
 *   editor.view.dom의 MATH_EVENT를 받아 네이티브 <dialog>.showModal()으로 편집기를 연다.
 * - pos가 있으면 해당 atom 노드를 편집하고, 없으면 현재 selection bookmark 위치(선택 영역 뒤)에 삽입한다.
 * - 모달이 열려 있는 동안 노드 위치와 bookmark를 트랜잭션마다 매핑해
 *   문서가 움직여도 엉뚱한 노드를 수정하지 않도록 한다.
 */
export function MathTools({ editor }: Readonly<Props>) {
  const { selectedId } = useStore();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [session, setSession] = useState<MathSession | null>(null);
  const [value, setValue] = useState("");
  const [diagnostic,setDiagnostic]=useState<MathDiagnostic|null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const posRef = useRef<number | null>(null); // 편집 대상 노드 위치(트랜잭션에 따라 매핑)
  const bookmarkRef = useRef<SelectionBookmark | null>(null); // 삽입 위치(선택 영역 bookmark)

  const open = session !== null;
  const target = session?.target ?? null;
  const canApply = !editor.isDestroyed && editor.isEditable && value.trim().length > 0 && value.length <= MAX_MATH_LENGTH;

  // 편집 가능 여부가 바뀔 때 툴바 버튼 상태를 갱신한다.
  useEffect(() => {
    const refresh = () => force();
    editor.on("update", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("update", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  // 모달이 열려 있는 동안 위치를 트랜잭션에 따라 매핑하고, editor 해제 시 모달을 닫는다.
  useEffect(() => {
    const mapPosition = ({ transaction }: { transaction: Transaction }) => {
      if (!openRef.current) return;
      if (bookmarkRef.current) bookmarkRef.current = bookmarkRef.current.map(transaction.mapping);
      if (posRef.current !== null) {
        const mapped = transaction.mapping.mapResult(posRef.current, 1);
        posRef.current = mapped.deleted ? null : mapped.pos;
      }
    };
    const onEditorDestroy = () => {
      if (openRef.current) dialogRef.current?.close();
    };
    editor.on("transaction", mapPosition);
    editor.on("destroy", onEditorDestroy);
    return () => {
      editor.off("transaction", mapPosition);
      editor.off("destroy", onEditorDestroy);
    };
  }, [editor]);

  const dispose = useCallback(() => {
    openRef.current = false;
    posRef.current = null;
    bookmarkRef.current = null;
    setSession(null);
    setValue("");
    setFailure(null);
    setDiagnostic(null);
  }, []);

  // dialog의 close 이벤트(적용/취소/삭제 후, Esc 포함)에서 상태를 폐기하고 본문으로 돌아간다.
  const handleDialogClose = useCallback(() => {
    // A native close event may arrive after a new session has opened.
    if (dialogRef.current?.open) return;
    dispose();
  }, [dispose, editor]);

  const closeSession = useCallback(() => {
    dispose();
    dialogRef.current?.close();
    if (!editor.isDestroyed) editor.view.focus();
  }, [dispose, editor]);

  const openRequest = useCallback(
    (request: MathRequest) => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.open || editor.isDestroyed || !editor.isEditable) return;
      if (typeof request.pos === "number") {
        // 기존 노드 편집: 요청 위치가 해당 종류의 수식 노드일 때만 연다.
        const node = editor.state.doc.nodeAt(request.pos);
        if (node?.type.name !== request.kind) return;
        const latex = String(node.attrs.latex ?? "");
        posRef.current = request.pos;
        bookmarkRef.current = null;
        openRef.current = true;
        setSession({ kind: request.kind, target: { latex, node } });
        setValue(latex);
      } else {
        // 삽입: 현재 selection의 bookmark. resolve().to로 선택 영역 "뒤"에 삽입해 선택 텍스트를 보존한다.
        posRef.current = null;
        bookmarkRef.current = editor.state.selection.getBookmark();
        openRef.current = true;
        setSession({ kind: request.kind, target: null });
        setValue("");
      }
      dialog.showModal();
    },
    [editor],
  );

  // nodeView/툴바 모두 MATH_EVENT로 요청한다.
  useEffect(() => {
    const dom = editor.view.dom;
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<MathRequest>).detail;
      if (detail) openRequest(detail);
    };
    dom.addEventListener(MATH_EVENT, onRequest);
    return () => dom.removeEventListener(MATH_EVENT, onRequest);
  }, [editor, openRequest]);

  // 노트 전환 시 모달을 닫고 상태를 폐기한다(마운트가 유지되는 배치에 대비).
  const noteRef = useRef(selectedId);
  useEffect(() => {
    if (noteRef.current === selectedId) return;
    noteRef.current = selectedId;
    if (dialogRef.current?.open) dialogRef.current.close();
    else dispose();
  }, [selectedId, dispose]);

  // 언마운트 시 최상위 레이어의 modal을 정리한다.
  useEffect(
    () => () => {
      openRef.current = false;
      dialogRef.current?.close();
    },
    [],
  );

  // 실시간 미리보기. 잘못된 LaTeX은 renderMath가 원문을 그대로 보여 준다.
  useEffect(() => {
    const el = previewRef.current;
    if (!open || !el) return;
    if (!value.trim()) {
      el.textContent = "";
      setDiagnostic(null);
      return;
    }
    setDiagnostic(renderMath(value, el, session?.kind === "blockMath"));
  }, [open, session, value]);

  // 모달이 열리면 입력란으로 초점을 이동하고, 편집 모드에서는 기존 수식을 선택한다.
  useEffect(() => {
    if (!open) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    if (field.value) field.select();
  }, [open]);

  /** 기존 노드는 setNodeMarkup으로 latex만 바꾸고, 삽입은 bookmark 위치 뒤에 넣는다. */
  const apply = useCallback(() => {
    if (editor.isDestroyed || !editor.isEditable) return;
    if (!openRef.current || session === null) {
      dialogRef.current?.close();
      return;
    }
    const latex = value;
    if (!latex.trim() || latex.length > MAX_MATH_LENGTH) return;
    const kind = session.kind;
    const target = session.target;
    let ok = false;
    try {
      if (target) {
        const pos = posRef.current;
        ok =
          pos !== null &&
          editor
            .chain()
            .command(({ tr }) => {
              closeHistory(tr); // 이 변경만 별도의 실행 취소 단위로 분리
              const node = tr.doc.nodeAt(pos);
              if (node?.type.name !== kind) {
                setFailure(t("문서에서 해당 수식을 찾을 수 없습니다. 문서가 다른 곳에서 변경된 것 같습니다."));
                return false;
              }
              if (node !== target.node) {
                setFailure(t("수식이 이미 변경되어 안전하게 저장할 수 없습니다. 취소한 뒤 수식을 다시 열어 주세요."));
                return false;
              }
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex });
              return true;
            })
            .run();
        if (!ok) setFailure((prev) => prev ?? t("수식을 변경하지 못했습니다. 다시 시도해 주세요."));
      } else {
        const at = bookmarkRef.current?.resolve(editor.state.doc).to;
        if (typeof at !== "number") {
          setFailure(t("삽입 위치를 찾을 수 없습니다. 취소한 뒤 다시 시도해 주세요."));
        } else {
          ok = editor
            .chain()
            .command(({ tr }) => {
              closeHistory(tr); // 이 변경만 별도의 실행 취소 단위로 분리
              const node = editor.schema.nodes[kind].create({ latex });
              // Let ProseMirror fit a block at the boundary without extending
              // the deletion range into the existing paragraph/inline math.
              tr.replaceRangeWith(at, at, node);
              tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(at, 1))));
              return true;
            })
            .run();
          if (!ok) setFailure(t("이 위치에 수식을 삽입하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요."));
        }
      }
    } catch {
      ok = false;
      setFailure(t("수식을 저장하지 못했습니다. 다시 시도해 주세요."));
    }
    if (ok) closeSession();
  }, [editor, session, value, closeSession]);

  const remove = useCallback(() => {
    if (editor.isDestroyed || !editor.isEditable || !openRef.current || !session?.target) return;
    const pos = posRef.current;
    let ok = false;
    try {
      ok =
        pos !== null &&
        editor
          .chain()
          .command(({ tr }) => {
            closeHistory(tr);
            const node = tr.doc.nodeAt(pos);
            if (node?.type.name !== session.kind || node !== session.target!.node) {
              return false;
            }
            tr.delete(pos, pos + node.nodeSize);
            return true;
          })
          .run();
    } catch {
      ok = false;
    }
    if (!ok) {
      setFailure(t("문서에서 해당 수식을 찾을 수 없습니다. 이미 삭제되었거나 변경되었을 수 있습니다."));
      return;
    }
    closeSession();
  }, [editor, session, closeSession]);

  // Ctrl+Enter로 적용. Escape은 네이티브 cancel→close로 취소 처리되고, Enter는 입력란 줄바꿈을 유지한다.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (canApply) apply();
    }
  };

  const title = session?.kind === "blockMath" ? t("수식 블록") : t("본문 수식");

  return (
    <>
      <IconButton
        label={t("본문 수식 삽입")}
        size="sm"
        disabled={!editor.isEditable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => requestMath(editor, { kind: "inlineMath" })}
      >
        <Sigma size={15} aria-hidden />
      </IconButton>
      <IconButton
        label={t("수식 블록 삽입")}
        size="sm"
        disabled={!editor.isEditable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => requestMath(editor, { kind: "blockMath" })}
      >
        <SquareSigma size={15} aria-hidden />
      </IconButton>
      <dialog
        ref={dialogRef}
        className="math-dialog"
        aria-modal="true"
        aria-labelledby="math-dialog-title"
        onClose={handleDialogClose}
        onCancel={(event) => {
          event.preventDefault();
          closeSession();
        }}
        onKeyDown={handleKeyDown}
      >
        <h2 id="math-dialog-title" className="math-dialog-title">
          {target ? t("{title} 편집", { title }) : t("{title} 삽입", { title })}
        </h2>
        <label className="math-field-label" htmlFor="math-latex-field">
          {t("수식 (LaTeX)")}
        </label>
        <textarea
          id="math-latex-field"
          ref={fieldRef}
          className="math-field"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setFailure(null);
          }}
          maxLength={MAX_MATH_LENGTH}
          rows={4}
          spellCheck={false}
          placeholder={t("예: \\frac{1}{2}, e^{i\\pi} = -1")}
          aria-describedby="math-dialog-hint"
        />
        <p id="math-dialog-hint" className="math-hint">
          {t("잘못된 LaTeX도 원문 그대로 저장할 수 있습니다. Ctrl+Enter로 적용, Esc로 취소합니다.")}
        </p>
        <div className="math-meta">
          <span>{t("미리보기")}</span>
          <span id="math-dialog-counter" className={`math-counter${value.length > MAX_MATH_LENGTH ? " over" : ""}`}>
            {value.length} / {MAX_MATH_LENGTH}
          </span>
        </div>
        <div ref={previewRef} className={`math-preview${session?.kind === "blockMath" ? " is-block" : ""}`} />
        {diagnostic&&<div className="math-failure" role="status"><p>{t('수식을 표시하지 못했습니다. 원문은 그대로 유지됩니다.')}</p><p>{diagnostic.message}</p>{diagnostic.start!==null&&<button type="button" className="btn" onClick={()=>{fieldRef.current?.focus();fieldRef.current?.setSelectionRange(diagnostic.start!,diagnostic.end!);}}>{t('수식 오류 위치: {line}행 {column}열',{line:diagnostic.line!,column:diagnostic.column!})}</button>}</div>}
        {failure !== null && (
          <p className="math-failure" role="alert">
            {failure}
          </p>
        )}
        <div className="math-actions">
          {target !== null && (
            <button type="button" className="btn btn-danger" disabled={!editor.isEditable} onClick={remove}>
              <Trash2 size={14} aria-hidden />
              {t("수식 삭제")}
            </button>
          )}
          <span className="math-actions-spacer" />
          <button type="button" className="btn" onClick={closeSession}>
            {t("취소")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canApply}
            aria-keyshortcuts="Control+Enter"
            onClick={apply}
          >
            {t("적용")}
          </button>
        </div>
      </dialog>
    </>
  );
}
