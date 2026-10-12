import React, { forwardRef } from "react";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
}

/** 모든 아이콘 버튼은 접근 가능한 이름(aria-label)을 반드시 갖는다. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, active, size = "md", className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`icon-btn ${size === "sm" ? "icon-btn-sm" : ""} ${active ? "is-active" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
