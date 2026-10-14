import {BlockStyleMenu} from "./BlockStyleMenu";
import type {BlockStyle} from "../../lib/knowledge";
/**
 * 블록 메뉴 (Figma BlockActionMenu 49:6961): 손잡이의 블록 아이콘을 누르면 열린다.
 * 바꾸기(현재 종류 강조) · 색 › · 복제 · 복사 · 삭제.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { BlockSpecificAction } from "../../extensions/block-actions";
import type { Editor } from "@tiptap/core";
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, Files, Palette, Trash2, X } from "../../icons";
import {
  TURN_INTO,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  canColor,
  canConvertBlock,
  contentHex,
  type BlockKind,
} from "../../extensions/block-items";
import "./BlockMenu.css";
import { t } from "../../i18n";
import { MARKDOWN_BLOCKS } from "../../lib/markdown-compatible";

const COLOR_NAMES: Record<string, string> = {
  pink: t("분홍"),
  purple: t("보라"),
  "deep-purple": t("진보라"),
  indigo: t("남색"),
  blue: t("파랑"),
  "light-blue": t("하늘"),
  cyan: t("청록"),
  teal: t("짙은 청록"),
  green: t("초록"),
  "light-green": t("연두"),
  lime: t("라임"),
  amber: t("호박"),
  red: t("빨강"),
  grey: t("회색"),
  brown: t("갈색"),
  yellow: t("노랑"),
};
export type BlockMenuAction = "up" | "down" | "duplicate" | "copy" | "delete" | "copy-link";
interface Props {
  markdownCompatible?: boolean;
  editor: Editor;
  kind: BlockKind;
  node: PMNode;
  actions: BlockSpecificAction[];
  onSpecific: (action: BlockSpecificAction) => void;
  allowed: (action: BlockMenuAction) => boolean;
  onAction: (action: BlockMenuAction) => void;
  onConvert: (id: string) => void;
  onColor: (kind: "text" | "background", color: string | null) => void;
  onStyle: (style: BlockStyle) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

/** 열린 메뉴 안에서 ↑↓(바꾸기 칸은 ←→도)로 버튼 사이를 옮긴다. */
function moveFocus(container: HTMLElement, event: React.KeyboardEvent) {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const visibleButtons = buttons.filter((button) => button.getClientRects().length);
  const index = visibleButtons.indexOf(document.activeElement as HTMLButtonElement);
  const grid = (document.activeElement as HTMLElement | null)?.closest(".block-turn-into, .block-swatches");
  let step: number;
  if (event.key === "ArrowDown" || (grid && event.key === "ArrowRight")) step = 1;
  else if (event.key === "ArrowUp" || (grid && event.key === "ArrowLeft")) step = -1;
  else return false;
  visibleButtons[(index + step + visibleButtons.length) % visibleButtons.length]?.focus();
  return true;
}

export function BlockActionMenu({
  markdownCompatible = false,
  editor,
  kind,
  node,
  actions,
  onSpecific,
  allowed,
  onAction,
  onConvert,
  onColor,
  onClose,
  onStyle,
  style,
}: Readonly<Props>) {
  const root = useRef<HTMLDivElement>(null),
    colorRow = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<string | null>(null);
  const [colors, setColors] = useState<false | "hover" | "focus">(false);
  const convertible = canConvertBlock(node);
  const text = !node.isAtom && !["codeBlock", "table"].includes(node.type.name) && canColor(editor, "text"),
    background = !node.isAtom && !["codeBlock", "table"].includes(node.type.name) && canColor(editor, "background");
  useLayoutEffect(() => {
    const el = panel.current,
      wrap = root.current;
    if (!colors || !el || !wrap) return;
    const box = wrap.getBoundingClientRect();
    el.classList.toggle("is-flipped", box.right + el.offsetWidth + 12 > innerWidth);
    el.style.top = `${Math.max(8 - box.top, Math.min((colorRow.current?.offsetTop ?? 0) - 7, innerHeight - box.top - el.offsetHeight - 8))}px`;
  }, [colors]);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"], button')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (colors === "focus") panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [colors]);

  /** Color submenu entry and Ctrl+D/C, Delete shortcuts; false when the key is not ours. */
  const runShortcut = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "ArrowRight" && document.activeElement === colorRow.current && (text || background))
      setColors("focus");
    else if (mod && event.key.toLowerCase() === "d" && allowed("duplicate")) onAction("duplicate");
    else if (mod && event.key.toLowerCase() === "c") onAction("copy");
    else if ((event.key === "Delete" || event.key === "Backspace") && allowed("delete")) onAction("delete");
    else return false;
    return true;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest("input,select,textarea") && event.key !== "Escape") return;
    const inPanel = panel.current?.contains(document.activeElement);
    let handled = true;
    if (
      event.key === "Escape" ||
      (inPanel && event.key === "ArrowLeft" && document.activeElement === panel.current?.querySelector("button"))
    ) {
      if (inPanel || colors) {
        setColors(false);
        colorRow.current?.focus();
      } else onClose();
    } else if (!moveFocus(inPanel ? panel.current! : root.current!, event)) handled = runShortcut(event);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const row = (
    action: BlockMenuAction,
    label: string,
    Icon: typeof Copy,
    color: string,
    shortcut: string,
    danger = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      className={"block-menu__item" + (danger ? " is-danger" : "")}
      disabled={!allowed(action)}
      onMouseEnter={() => setColors(false)}
      onClick={() => onAction(action)}
    >
      <Icon size={16} className="block-menu__icon" style={{ color }} aria-hidden />
      <span className="block-menu__label">{label}</span>
      <span className="block-menu__shortcut" aria-hidden>
        {shortcut}
      </span>
    </button>
  );

  const swatch = (type: "text" | "background", name: string | null, enabled: boolean) => {
    const variable = name && (type === "text" ? "text-color-" : "highlight-") + name;
    const color = name ? COLOR_NAMES[name] : t("없음");
    const label = type === "text" ? t("글자색 {color}", { color }) : t("배경색 {color}", { color });
    return (
      <button
        key={type + name}
        type="button"
        aria-label={label}
        title={enabled ? label : t("준비 중")}
        disabled={!enabled}
        style={variable ? { background: `var(--${variable})`, borderColor: `var(--${variable})` } : undefined}
        onClick={() => onColor(type, variable ? contentHex(variable) : null)}
      >
        {!name && <X size={14} aria-hidden />}
      </button>
    );
  };

  return (
    <div
      className="block-menu-wrap"
      style={style}
      ref={root}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest("button,input,select,textarea")) event.preventDefault();
      }}
    >
      <div className="block-menu block-action-menu" role="menu" aria-label={t("{label} 메뉴", { label: kind.label })}>
        {convertible && (
          <>
            <div className="block-menu__section" aria-hidden>
              {t("바꾸기")}
            </div>
            <fieldset
              className="block-turn-into"
              aria-label={t("블록 종류 바꾸기")}
              onMouseEnter={() => setColors(false)}
            >
              {TURN_INTO.filter(item=>!markdownCompatible||MARKDOWN_BLOCKS.has(item.id)).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={t("{label}(으)로 바꾸기", { label: item.label })}
                    title={item.label}
                    aria-pressed={item.id === kind.id}
                    onClick={() => onConvert(item.id)}
                  >
                    <Icon size={16} aria-hidden />
                  </button>
                );
              })}
            </fieldset>
            <hr className="block-menu__sep" />
          </>
        )}
        <div className="block-menu__section" aria-hidden>
          {kind.label}
        </div>
        {actions
          .filter((action) => !action.group && !action.section)
          .map((action) =>
            action.info ? (
              <p key={action.label} className="block-selection-info">
                <output>{action.label}</output>
              </p>
            ) : (
              <button
                key={action.label}
                type="button"
                role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={action.checked}
                disabled={action.disabled}
                className="block-menu__item"
                onMouseEnter={() => setColors(false)}
                onClick={() => onSpecific(action)}
              >
                <action.icon size={16} className="block-menu__icon" aria-hidden />
                <span className="block-menu__label">{action.label}</span>
                {action.checked && <Check size={14} aria-hidden />}
              </button>
            ),
          )}
        {[...new Set(actions.flatMap((a) => (a.section ? [a.section] : [])))].map((name) => (
          <React.Fragment key={name}>
            <button
              type="button"
              role="menuitem"
              className="block-menu__item"
              aria-expanded={section === name}
              onClick={() => {
                setColors(false);
                setSection(section === name ? null : name);
              }}
            >
              <span className="block-menu__label">{name}</span>
              <ChevronRight size={14} style={{ transform: section === name ? "rotate(90deg)" : undefined }} />
            </button>
            <div hidden={section !== name} data-action-section={name} className="block-action-section">
              {actions
                .filter((a) => a.section === name)
                .map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={action.checked}
                    disabled={action.disabled}
                    className="block-menu__item"
                    onClick={() => onSpecific(action)}
                  >
                    <span className="block-menu__label">{action.label}</span>
                    {action.checked && <Check size={14} aria-hidden />}
                  </button>
                ))}
            </div>
          </React.Fragment>
        ))}
        {(["size", "align"] as const).map(
          (group) =>
            actions.some((a) => a.group === group) && (
              <fieldset
                key={group}
                className="block-action-options"
                aria-label={group === "size" ? t("이미지 크기") : t("정렬")}
              >
                <span>{group === "size" ? t("크기") : t("정렬")}</span>
                {actions
                  .filter((a) => a.group === group)
                  .map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      aria-label={action.label}
                      title={action.label}
                      aria-pressed={!!action.checked}
                      onClick={() => onSpecific(action)}
                    >
                      {group === "size" ? /(?<!\d)\d+%/.exec(action.label)?.[0] : <action.icon size={16} />}
                    </button>
                  ))}
              </fieldset>
            ),
        )}
        {(text || background) && (
          <button
            ref={colorRow}
            type="button"
            role="menuitem"
            className={"block-menu__item" + (colors ? " is-active" : "")}
            aria-haspopup="menu"
            aria-expanded={Boolean(colors)}
            aria-disabled={!(text || background) || undefined}
            title={text || background ? undefined : t("준비 중")}
            onMouseEnter={() => (text || background) && setColors("hover")}
            onClick={() => (text || background) && setColors("focus")}
          >
            <Palette size={16} className="block-menu__icon" style={{ color: "var(--text-color-pink)" }} aria-hidden />
            <span className="block-menu__label">{t("색")}</span>
            <ChevronRight size={12} className="block-menu__chevron" aria-hidden />
          </button>
        )}
        <hr className="block-menu__sep" />
        <div className="block-menu__section" aria-hidden>
          {t("자주 쓰는 것")}
        </div>
        {!markdownCompatible && <BlockStyleMenu node={node} onApply={onStyle} />}
        {row("up", t("위로 이동"), ArrowUp, "var(--text)", "Alt+Shift+↑")}
        {row("down", t("아래로 이동"), ArrowDown, "var(--text)", "Alt+Shift+↓")}
        {row("duplicate", t("복제"), Copy, "var(--text-color-blue)", "Ctrl+D")}
        {!markdownCompatible&&row("copy-link", t("문단 링크 복사"), Files, "var(--text)", "")}
        {row("copy", t("복사"), Files, "var(--text-color-light-blue)", "Ctrl+C")}
        {row("delete", t("삭제"), Trash2, "var(--text-color-red)", "Del", true)}
      </div>
      {colors && (
        <div
          ref={panel}
          className="block-menu block-menu__sub block-color-panel"
          role="menu"
          aria-label={t("색")}
          style={{ top: (colorRow.current?.offsetTop ?? 0) - 7 }}
        >
          <div className="block-menu__section" aria-hidden>
            {t("글자색")}
          </div>
          <div className="block-swatches">{[null, ...TEXT_COLORS].map((name) => swatch("text", name, text))}</div>
          <div className="block-menu__section" aria-hidden>
            {t("배경색")}
          </div>
          <div className="block-swatches">
            {[null, ...HIGHLIGHT_COLORS].map((name) => swatch("background", name, background))}
          </div>
        </div>
      )}
    </div>
  );
}
