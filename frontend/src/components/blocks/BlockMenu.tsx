/**
 * 블록 넣기 메뉴 (Figma 27:3903 + 하위 메뉴 27:3996 · 27:4053 · 27:4070 · 51:6764 · 51:6780).
 * 블록 손잡이의 [+] 팝오버와 "/" 메뉴가 같은 컴포넌트를 쓴다.
 * 마우스를 올리면 옆에 미리보기 카드, 누르면 하위 메뉴. 키보드: ↑↓ 이동, → 하위 메뉴, ← / Esc 하위 메뉴 닫기, Enter 실행. 한글 조합 중 키는 무시.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { ChevronRight } from "../../icons";
import { BLOCK_DESCRIPTIONS, SUBMENUS, type BlockItem, type RunOptions } from "../../extensions/block-items";
import { t } from "../../i18n";
import { BlockPreview } from "./BlockPreview";
import "./BlockMenu.css";

export interface BlockMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}
interface Props {
  editor: Editor;
  items: readonly BlockItem[];
  onChoose: (item: BlockItem, options?: RunOptions) => void;
  /** [+] 팝오버: 메뉴가 스스로 포커스를 받고 Esc로 닫힌다. */
  onClose?: () => void;
  style?: React.CSSProperties;
  /** "/" 메뉴: 이름 아래 짧은 설명, 아이콘은 한 색(Figma Slash menu). */
  described?: boolean;
}
/** 하위 메뉴는 항목 id로 기억한다 — "/" 메뉴는 입력마다 새 목록을 넘긴다.
 * 마우스 강조는 mouseenter가 아니라 mousemove로 바꾼다: 메뉴가 멈춰 있는 커서 아래에 열리면
 * 브라우저가 mouseenter만 보내서, 키보드로 연 하위 메뉴의 강조가 커서 아래 항목으로 옮겨 갔다. */
interface Sub {
  id: string;
  focus: boolean;
  active: number;
}
const GRID_COLS = 10,
  GRID_ROWS = 6;

export const BlockMenu = forwardRef<BlockMenuHandle, Props>(function BlockMenu(
  { editor, items, onChoose, onClose, style, described },
  ref,
) {
  const enabled = items.map((item) => item.available(editor));
  const first = enabled.indexOf(true);
  const [active, setActive] = useState(first);
  const [sub, setSub] = useState<Sub | null>(null);
  const [grid, setGrid] = useState({ rows: 0, cols: 0 });
  const list = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    wrap = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLDivElement>(null);
  const [previewPos, setPreviewPos] = useState<{ top: number; flip: boolean }>({ top: 0, flip: false });
  const [subPos, setSubPos] = useState<{ top: number; flip: boolean }>({ top: 0, flip: false });

  // 같은 항목 목록이면 다시 그려도(손잡이 hover, "/" onUpdate) 활성 항목·하위 메뉴를 유지한다.
  const itemsKey = items.map((item) => item.id).join("|");
  useEffect(() => {
    setActive(first);
    setSub(null);
  }, [itemsKey]);
  const subIndex = sub ? items.findIndex((item) => item.id === sub.id) : -1;
  useEffect(() => {
    if (onClose) list.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useLayoutEffect(() => {
    if (!sub || !list.current || !wrap.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-index="${subIndex}"]`);
    if (!row) return;
    let top = list.current.offsetTop + row.offsetTop - list.current.scrollTop - 7;
    const box = wrap.current.getBoundingClientRect(),
      height = panel.current?.offsetHeight ?? 0,
      width = panel.current?.offsetWidth ?? 0;
    top = Math.max(-box.top + 8, Math.min(top, window.innerHeight - box.top - height - 8));
    setSubPos({ top, flip: box.right + width + 12 > window.innerWidth });
  }, [subIndex, itemsKey]);

  // 미리보기 카드는 고른 항목 줄 높이에 맞춰 옆에 붙인다(하위 메뉴가 열리면 감춘다).
  useLayoutEffect(() => {
    if (sub || active < 0 || !list.current || !wrap.current || !preview.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!row) return;
    const box = wrap.current.getBoundingClientRect(),
      height = preview.current.offsetHeight,
      width = preview.current.offsetWidth;
    let top = list.current.offsetTop + row.offsetTop - list.current.scrollTop - 7;
    top = Math.max(-box.top + 8, Math.min(top, window.innerHeight - box.top - height - 8));
    setPreviewPos({ top, flip: box.right + width + 12 > window.innerWidth });
  }, [active, sub, itemsKey]);

  const move = (delta: number) => {
    if (first < 0) return;
    let next = active;
    for (let left = items.length; left > 0; left--) {
      next = (next + delta + items.length) % items.length;
      if (enabled[next]) break;
    }
    setActive(next);
    setSub(null);
  };
  const subItem = subIndex >= 0 ? items[subIndex] : null;
  const entries = subItem?.submenu ? SUBMENUS[subItem.submenu] : [];
  const choose = (index: number, options?: RunOptions) => {
    const item = items[index];
    if (item && enabled[index]) onChoose(item, options);
  };
  const openSub = (index: number, focus: boolean) => {
    if (!items[index]?.submenu || !enabled[index]) {
      setSub(null);
      return;
    }
    setSub({ id: items[index].id, focus, active: focus ? 0 : -1 });
    setGrid({ rows: 0, cols: 0 });
  };

  /** 표 크기 격자에 초점이 있을 때의 키. */
  const onGridKey = (key: string, current: Sub): boolean => {
    if (key === "ArrowRight") setGrid((g) => ({ ...g, cols: Math.min(GRID_COLS, g.cols + 1) }));
    else if (key === "ArrowLeft") setGrid((g) => ({ ...g, cols: g.cols - 1 }));
    else if (key === "ArrowDown") setGrid((g) => ({ ...g, rows: Math.min(GRID_ROWS, g.rows + 1) }));
    else if (key === "ArrowUp") {
      if (grid.rows > 1) setGrid((g) => ({ ...g, rows: g.rows - 1 }));
      else {
        setSub({ ...current, active: entries.length - 1 });
        setGrid({ rows: 0, cols: 0 });
      }
    } else if (key === "Enter") choose(subIndex, { rows: grid.rows, cols: grid.cols });
    else return false;
    return true;
  };
  /** 하위 메뉴에 초점이 있을 때의 키. */
  const onSubKey = (key: string, current: Sub, table: boolean): boolean => {
    const onGrid = table && current.active === entries.length;
    if (key === "Escape" || (key === "ArrowLeft" && !(onGrid && grid.cols > 1))) {
      setSub(null);
      return true;
    }
    if (onGrid) return onGridKey(key, current);
    const count = entries.length + (table ? 1 : 0);
    if (key === "ArrowDown" || key === "ArrowUp") {
      const next = (current.active + (key === "ArrowDown" ? 1 : count - 1)) % count;
      setSub({ ...current, active: next });
      if (table && next === entries.length) setGrid({ rows: 1, cols: 1 });
      return true;
    }
    if (key === "Enter") {
      choose(subIndex, { choice: entries[current.active]?.id });
      return true;
    }
    return false;
  };
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || event.key === "Process") return false;
    const key = event.key;
    if (sub?.focus && subItem) return onSubKey(key, sub, subItem.submenu === "table");
    if (key === "ArrowDown" || key === "ArrowUp") {
      move(key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (key === "ArrowRight" && items[active]?.submenu) {
      openSub(active, true);
      return true;
    }
    if (key === "Enter") {
      if (active < 0) return false;
      choose(active);
      return true;
    }
    if (key === "Escape" && onClose) {
      onClose();
      return true;
    }
    return false;
  };
  useImperativeHandle(ref, () => ({ onKeyDown }));

  const rows: React.ReactNode[] = [];
  let group: string | undefined;
  items.forEach((item, index) => {
    if (item.group !== group) {
      if (group !== undefined) rows.push(<hr key={"sep" + index} className="block-menu__sep" style={{ border: 0 }} />);
      rows.push(
        <div key={"group" + index} className="block-menu__section" aria-hidden>
          {t(item.group)}
        </div>,
      );
      group = item.group;
    }
    const Icon = item.icon,
      on = index === active;
    rows.push(
      <button
        key={item.id}
        type="button"
        role="option"
        data-index={index}
        data-active={on || undefined}
        aria-label={t("블록 삽입: {label}", { label: item.label })}
        aria-selected={on}
        aria-disabled={!enabled[index] || undefined}
        title={enabled[index] ? undefined : t("준비 중")}
        tabIndex={-1}
        className={"block-menu__item" + (on ? " is-active" : "")}
        // 마우스를 올리면 미리보기만 보이고, 하위 메뉴는 눌러야 열린다.
        onMouseMove={() => {
          if (!enabled[index] || index === active) return;
          setActive(index);
          setSub(null);
        }}
        onClick={() => (item.submenu ? openSub(index, false) : choose(index))}
      >
        <Icon
          size={16}
          className="block-menu__icon"
          style={described ? undefined : { color: item.color }}
          aria-hidden
        />
        {described && BLOCK_DESCRIPTIONS[item.id] ? (
          <span className="block-menu__text">
            <span className="block-menu__label">{item.label}</span>
            <span className="block-menu__desc">{BLOCK_DESCRIPTIONS[item.id]}</span>
          </span>
        ) : (
          <span className="block-menu__label">{item.label}</span>
        )}
        {item.hint && <span className="block-menu__hint">{item.hint}</span>}
        {item.submenu && <ChevronRight size={12} className="block-menu__chevron" aria-hidden />}
      </button>,
    );
  });

  return (
    <div className="block-menu-wrap" ref={wrap} style={style} onMouseDown={(event) => event.preventDefault()}>
      <div
        ref={list}
        className="block-menu"
        role="listbox"
        aria-label={t("블록 삽입 메뉴")}
        tabIndex={-1}
        onKeyDown={
          onClose
            ? (event) => {
                if (onKeyDown(event.nativeEvent)) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }
            : undefined
        }
      >
        {items.length ? rows : <div className="block-menu__empty">{t("결과 없음")}</div>}
      </div>
      {!subItem && active >= 0 && enabled[active] && items[active] && (
        <div
          ref={preview}
          className={"block-menu block-preview" + (previewPos.flip ? " is-flipped" : "")}
          style={{ top: previewPos.top }}
        >
          <BlockPreview id={items[active].id} label={items[active].label} icon={items[active].icon} />
        </div>
      )}
      {subItem && (
        <div
          ref={panel}
          className={"block-menu block-menu__sub" + (subPos.flip ? " is-flipped" : "")}
          style={{ top: subPos.top }}
          role="menu"
          aria-label={t("{label} 종류", { label: subItem.label })}
        >
          {entries.map((entry, i) => {
            const Icon = entry.icon,
              on = sub!.active === i;
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={"block-menu__item" + (on ? " is-active" : "")}
                onMouseMove={() => {
                  if (sub!.active !== i) setSub({ ...sub!, active: i });
                }}
                onClick={() => choose(subIndex, { choice: entry.id })}
              >
                {Icon && <Icon size={16} className="block-menu__icon" aria-hidden />}
                <span className="block-menu__label">{entry.label}</span>
              </button>
            );
          })}
          {subItem.submenu === "table" && (
            <>
              <div className="block-menu__rule" />
              <div
                className="block-table-grid"
                role="grid"
                tabIndex={-1}
                aria-label={t("표 크기 고르기")}
                onMouseLeave={() => setGrid({ rows: 0, cols: 0 })}
              >
                {Array.from({ length: GRID_ROWS }, (_, r) => (
                  <div key={r} role="row" className="block-table-grid__row">
                    {Array.from({ length: GRID_COLS }, (_, c) => (
                      <button
                        key={c}
                        type="button"
                        role="gridcell"
                        tabIndex={-1}
                        aria-label={t("{cols}열 × {rows}행 표 넣기", { cols: c + 1, rows: r + 1 })}
                        data-on={(r < grid.rows && c < grid.cols) || undefined}
                        onMouseMove={() => {
                          if (grid.rows !== r + 1 || grid.cols !== c + 1) setGrid({ rows: r + 1, cols: c + 1 });
                        }}
                        onClick={() => choose(subIndex, { rows: r + 1, cols: c + 1 })}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="block-table-grid__size" aria-live="polite">
                {grid.rows ? `${grid.cols} × ${grid.rows}` : t("열 × 행")}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});
