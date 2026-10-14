// 태그 색. 값은 엔진의 동기화 settings(tag_color:)에 있다.
import { PaletteIcon } from "@phosphor-icons/react";
import type React from "react";
import { t } from "../i18n";
import { NoColor } from "../icons";
import type { MenuItemSpec } from "./Menu";
import type { TagCount } from "../types";
import { TEXT_COLORS } from "./toolbar/Panels";

export const tagColor = (tags: readonly TagCount[], name: string) => tags.find((x) => x.name === name)?.color ?? undefined;

/** 태그 칩: # 글자에 색, 바탕은 옅게. 글자는 기본 색이라 두 테마 모두 읽힌다. */
export const tagChipStyle = (color?: string | null) =>
  color ? ({ "--tag-color": color } as React.CSSProperties) : undefined;

/** "색 변경" 하위 메뉴: 색 없음 + 편집기 글자색. */
export function colorMenu(current: string | null | undefined, onPick: (color: string | null) => void): MenuItemSpec {
  const now = current?.toLowerCase() ?? null;
  return {
    label: t("색 변경"),
    icon: <PaletteIcon size={14} aria-hidden />,
    items: [
      { label: t("색 없음"), icon: <NoColor size={14} aria-hidden />, checked: !now, onSelect: () => onPick(null) },
      ...TEXT_COLORS.map(([label, value]) => ({
        label,
        icon: <span className="menu-swatch" style={{ backgroundColor: value }} />,
        checked: now === value,
        onSelect: () => onPick(value),
      })),
    ],
  };
}
