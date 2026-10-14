import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** 여는 버튼. 바깥 클릭 판정에서 빠지고 Escape로 닫으면 포커스가 돌아간다. */
  anchor: HTMLElement;
  /** 이 요소의 아래쪽 + 6px에 붙는다(도구줄 또는 부모 팝오버). */
  under: HTMLElement;
  /** 오른쪽이 이 요소를 넘지 않게 당긴다. */
  bounds: HTMLElement | null;
  label: string;
  onClose: () => void;
  /** 고정된 팔레트처럼 바깥 클릭에도 닫히지 않음 */
  keepOpen?: boolean;
  className?: string;
  role?: string;
  /** 아래 대신 여는 버튼 옆에 붙인다(하위 메뉴처럼). 오른쪽 자리가 없으면 왼쪽. */
  side?: boolean;
  children: ReactNode;
}

/** 도구줄 팝오버. body에 붙여 도구줄 overflow에 잘리지 않게 한다. 뒤에 열린 팝오버가 자식이다. */
export function Popover({
  anchor,
  under,
  bounds,
  label,
  onClose,
  keepOpen,
  className = "",
  role = "dialog",
  side = false,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      if (!anchor.isConnected) return;
      const a = anchor.getBoundingClientRect(),
        u = under.getBoundingClientRect();
      const right = Math.min(bounds?.getBoundingClientRect().right ?? innerWidth, innerWidth) - 8;
      const left = side
        ? a.right + 6 + el.offsetWidth <= right ? a.right + 6 : Math.max(8, a.left - 6 - el.offsetWidth)
        : Math.max(8, Math.min(a.left - 4, right - el.offsetWidth));
      const top = Math.max(8, Math.min(side ? a.top - 4 : u.bottom + 6, innerHeight - el.offsetHeight - 8));
      setPos((p) => (p?.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [anchor, under, bounds, side]);

  useEffect(() => {
    const el = ref.current!;
    // 입력칸이 있으면 그곳, 없으면 첫 버튼에 포커스(키보드로 바로 고를 수 있게).
    (
      el.querySelector<HTMLElement>("input:not([type=color]),[data-autofocus]") ??
      el.querySelector<HTMLElement>("button")
    )?.focus({ preventScroll: true });
    const stack = () => Array.from(document.querySelectorAll<HTMLElement>("[data-tb-popover]"));
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      const mine = stack().slice(stack().indexOf(el));
      if (keepOpen || anchor.contains(target) || mine.some((p) => p.contains(target))) return;
      close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stack().pop() !== el) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      anchor.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [anchor, keepOpen]);

  return createPortal(
    <div
      ref={ref}
      data-tb-popover=""
      role={role}
      aria-label={label}
      className={`tb-pop ${className}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
