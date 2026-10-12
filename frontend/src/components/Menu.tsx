import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "../icons";
import "./Menu.css";

export interface MenuItemSpec {
  label: string;
  commandId?: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 켜짐/꺼짐 항목. 정의되면 menuitemcheckbox로 그리고 켜졌을 때 오른쪽에 ✓를 표시한다. */
  checked?: boolean;
  /** 하위 메뉴. 있으면 onSelect 대신 오른쪽으로 펼친다. */
  items?: MenuItemSpec[];
  /** 이 항목 앞에 구분선을 그린다. */
  separatorBefore?: boolean;
}

const ITEM = ':scope > [role^="menuitem"]:not(:disabled)';

/** 키보드로 다룰 수 있는 메뉴 목록. 하위 메뉴도 같은 컴포넌트로 그린다. */
function MenuList({
  items,
  id,
  className = "",
  style,
  focus = "first",
  onDone,
  onBack,
  onTab,
  label,
}: Readonly<{
  items: MenuItemSpec[];
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  focus?: "first" | "last" | "none";
  /** 항목을 실행했을 때(메뉴 전체 닫기). */
  onDone: () => void;
  /** 하위 메뉴에서 왼쪽 화살표·Escape로 돌아갈 때. */
  onBack?: () => void;
  onTab?: () => void;
  label?: string;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<number | null>(null);
  const [subTop, setSubTop] = useState(0);
  const [subFocus, setSubFocus] = useState(false);
  const enabled = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(ITEM) ?? []);
  useEffect(() => {
    if (focus === "none") return;
    const list = enabled();
    (focus === "last" ? list.at(-1) : list[0])?.focus();
  }, []);
  // 화면 밖으로 나가는 하위 메뉴는 반대쪽으로 펼치고 위로 올린다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onBack) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth - 4) el.classList.add("flip");
    const placed = el.getBoundingClientRect();
    if (placed.left < 8) {
      el.style.right = "auto";
      el.style.left = `${el.offsetLeft + 8 - placed.left}px`;
    }
    if (rect.bottom > innerHeight - 4) el.style.top = `${el.offsetTop - (rect.bottom - innerHeight + 8)}px`;
  }, []);
  const openSub = (index: number, button: HTMLElement, focusSub: boolean) => {
    if (sub === index) {
      if (focusSub)
        ref.current
          ?.querySelector<HTMLButtonElement>(':scope > .menu-sub > [role^="menuitem"]:not(:disabled)')
          ?.focus();
      return;
    }
    setSubTop(button.offsetTop - 5);
    setSubFocus(focusSub);
    setSub(index);
  };
  const back = () => {
    const index = sub;
    setSub(null);
    if (index !== null) ref.current?.querySelector<HTMLButtonElement>(`:scope > [data-index="${index}"]`)?.focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      id={id}
      aria-label={label}
      className={`menu-popup ${className}`}
      style={style}
      onKeyDown={(event) => {
        // 하위 메뉴의 키 입력이 바깥 메뉴로 번지지 않게 한다.
        if ((event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget) return;
        const list = enabled();
        const index = list.indexOf(document.activeElement as HTMLButtonElement);
        const current = list[index];
        let next: number | undefined;
        if (event.key === "ArrowDown") next = (index + 1) % list.length;
        else if (event.key === "ArrowUp") next = (index + list.length - 1) % list.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = list.length - 1;
        else if (event.key === "ArrowRight" && current?.dataset.sub) {
          event.preventDefault();
          openSub(Number(current.dataset.index), current, true);
        } else if ((event.key === "ArrowLeft" || event.key === "Escape") && onBack) {
          event.preventDefault();
          event.stopPropagation();
          onBack();
        } else if (event.key === "Tab") onTab?.();
        if (next !== undefined) {
          event.preventDefault();
          list[next]?.focus();
        }
      }}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.separatorBefore && <hr className="menu-separator" style={{ border: 0 }} />}
          <button
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            aria-haspopup={item.items ? "menu" : undefined}
            aria-expanded={item.items ? sub === i : undefined}
            data-index={i}
            data-sub={item.items ? "1" : undefined}
            className={`menu-item ${item.danger ? "danger" : ""} ${sub === i ? "is-open" : ""}`}
            disabled={item.disabled}
            onMouseEnter={(event) => {
              if (item.items) openSub(i, event.currentTarget, false);
              else if (sub !== null) setSub(null);
            }}
            onClick={(event) => {
              if (item.items) {
                openSub(i, event.currentTarget, true);
                return;
              }
              onDone();
              item.onSelect?.();
            }}
          >
            {item.icon && <span className="menu-item-icon">{item.icon}</span>}
            <span className="menu-item-label">{item.label}</span>
            {item.checked && <Check size={14} className="menu-item-end" aria-hidden />}
            {item.items && <ChevronRight size={13} className="menu-item-end" aria-hidden />}
          </button>
          {item.items && sub === i && (
            <MenuList
              items={item.items}
              label={item.label}
              className="menu-sub"
              style={{ top: subTop }}
              focus={subFocus ? "first" : "none"}
              onDone={onDone}
              onBack={back}
              onTab={onTab}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/** 키보드 접근 가능한 드롭다운 메뉴. */
export function Menu({
  buttonLabel,
  icon,
  items,
  align = "right",
}: Readonly<{
  buttonLabel: string;
  icon: React.ReactNode;
  items: MenuItemSpec[];
  align?: "left" | "right";
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusLast = useRef(false);
  const trigger = () => rootRef.current?.querySelector("button") as HTMLButtonElement | null;

  useEffect(() => {
    if (!open) return;
    focusLast.current = false;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger()?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label={buttonLabel}
        title={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusLast.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}
      >
        {icon}
      </button>
      {open && (
        <MenuList
          items={items}
          id={menuId}
          className={align === "right" ? "align-right" : "align-left"}
          focus={focusLast.current ? "last" : "first"}
          onDone={() => {
            setOpen(false);
            trigger()?.focus();
          }}
          onTab={() => {
            setOpen(false);
            trigger()?.focus();
          }}
        />
      )}
    </div>
  );
}

/** 포인터 위치(또는 키보드로 연 요소 옆)에 뜨는 메뉴. 닫히면 연 요소로 초점을 돌려준다. */
export function ContextMenu({
  x,
  y,
  items,
  label,
  onClose,
}: Readonly<{
  x: number;
  y: number;
  items: MenuItemSpec[];
  label: string;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const close = (restore = true) => {
    onClose();
    if (restore && opener.current instanceof HTMLElement && opener.current.isConnected)
      opener.current.focus({ preventScroll: true });
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    const menu = ref.current?.firstElementChild as HTMLElement | null;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, innerHeight - height - 4)),
    });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
    };
    const onBlur = () => closeRef.current(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onBlur);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onBlur);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return (
    <div ref={ref} className="context-menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} label={label} onDone={() => close()} onTab={() => close()} />
    </div>
  );
}
