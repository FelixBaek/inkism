import {useDialogVisibility} from '../lib/dialog-visibility';
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "../icons";
import { t } from "../i18n";
import "./ShortcutsDialog.css";

export const SHORTCUTS_EVENT = "inkism-shortcuts";

/** 이 앱에 실제로 구현된 단축키만 적는다(store 전역 단축키, Tiptap 확장, BlockTools, callout, 슬래시 메뉴). */
export const SHORTCUT_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: t("전체"),
    rows: [
      ["Ctrl+N", t("새 노트")],
      ["Ctrl+S", t("지금 저장")],
      ["Ctrl+F", t("노트 안에서 찾기 (노트가 없으면 노트 검색)")],
      ["Ctrl+H", t("찾아 바꾸기")],
      ["Ctrl+/", t("단축키 안내")],
      ["Shift+F10", t("노트 목록에서 노트 메뉴 열기")],
      [t("Ctrl+클릭"), t("편집 중 노트 연결 열기")],
    ],
  },
  {
    title: t("편집"),
    rows: [
      ["Ctrl+Z", t("실행 취소")],
      ["Ctrl+Y · Ctrl+Shift+Z", t("다시 실행")],
      ["Ctrl+A", t("모두 선택")],
      ["Shift+Enter", t("줄바꿈 (같은 문단)")],
      ["Tab · Shift+Tab", t("목록 들여쓰기 · 내어쓰기")],
    ],
  },
  {
    title: t("글자 서식"),
    rows: [
      ["Ctrl+B", t("굵게")],
      ["Ctrl+I", t("기울임")],
      ["Ctrl+U", t("밑줄")],
      ["Ctrl+Shift+S", t("취소선")],
      ["Ctrl+E", t("인라인 코드")],
      ["Ctrl+Shift+H", t("형광펜")],
      ["Ctrl+,", t("아래 첨자")],
      ["Ctrl+.", t("위 첨자")],
    ],
  },
  {
    title: t("문단"),
    rows: [
      ["Ctrl+Alt+1 · 2 · 3", t("제목 1 · 2 · 3")],
      ["Ctrl+Shift+8", t("글머리 목록")],
      ["Ctrl+Shift+7", t("번호 목록")],
      ["Ctrl+Shift+9", t("할 일 목록")],
      ["Ctrl+Shift+B", t("인용")],
      ["Ctrl+Alt+C", t("코드 블록")],
      ["Ctrl+Shift+C", t("콜아웃")],
      ["Ctrl+Shift+L · E · R · J", t("왼쪽 · 가운데 · 오른쪽 · 양쪽 정렬")],
    ],
  },
  {
    title: t("블록"),
    rows: [
      ["/", t("블록 메뉴 (슬래시)")],
      ["Ctrl+D", t("블록 복제")],
      ["Alt+Shift+↑ · ↓", t("블록 위 · 아래로 이동")],
    ],
  },
  {
    title: t("입력하며 바꾸기 (Markdown)"),
    rows: [
      [t("# · ## · ### + 공백"), t("제목 1 · 2 · 3")],
      [t("- · * · + + 공백"), t("글머리 목록")],
      [t("1. + 공백"), t("번호 목록")],
      [t("[ ] + 공백"), t("할 일")],
      [t("> + 공백"), t("인용")],
      [t("? + 공백"), t("콜아웃")],
      [t("``` + 공백"), t("코드 블록")],
      ["---", t("구분선")],
      [t("**글자** · *글자*"), t("굵게 · 기울임")],
      [t("`글자` · ~~글자~~ · ==글자=="), t("코드 · 취소선 · 형광펜")],
    ],
  },
];

/** 단축키 안내 창. Ctrl+/ 또는 SHORTCUTS_EVENT로 연다. */
export function ShortcutsDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useDialogVisibility(dialog,open);
  useEffect(() => {
    const show = () => setOpen(true);
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process" || !(e.ctrlKey || e.metaKey) || e.altKey || e.key !== "/") return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener(SHORTCUTS_EVENT, show);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(SHORTCUTS_EVENT, show);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onClick={(e) => {
        if (e.target === dialog.current) setOpen(false);
      }}
    >
      {open && (
        <>
          <header className="shortcuts-head">
            <h2 id="shortcuts-title">
              <Keyboard size={18} aria-hidden /> {t("단축키")}
            </h2>
            <button
              type="button"
              className="settings-close"
              aria-label={t("단축키 안내 닫기")}
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="shortcuts-body">
            {SHORTCUT_GROUPS.map((g) => (
              <section key={g.title} className="shortcuts-group" aria-label={g.title}>
                <h3>{g.title}</h3>
                <dl>
                  {g.rows.map(([keys, label]) => (
                    <div key={keys} className="shortcuts-row">
                      <dt>{label}</dt>
                      <dd>
                        <kbd>{keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </dialog>, document.body
  );
}
