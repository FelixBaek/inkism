// 태그 색·폴더 색·폴더 아이콘. 태그 색과 폴더 아이콘은 엔진의 동기화 settings(tag_color:·notebook_icon:), 폴더 색은 폴더의 color 칸에 있다.
import {
  AirplaneIcon,
  ArchiveIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  CameraIcon,
  ChatCircleIcon,
  CodeIcon,
  CoffeeIcon,
  FlagIcon,
  FlaskIcon,
  FolderIcon,
  GameControllerIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  HouseIcon,
  ImageIcon,
  LeafIcon,
  LightbulbIcon,
  LockKeyIcon,
  MusicNotesIcon,
  PaletteIcon,
  RocketIcon,
  StarIcon,
  UserIcon,
  WalletIcon,
  type IconProps,
} from "@phosphor-icons/react";
import type React from "react";
import type { ComponentType } from "react";
import { t } from "../i18n";
import { NoColor } from "../icons";
import type { MenuItemSpec } from "./Menu";
import type { Notebook, TagCount } from "../types";
import { TEXT_COLORS } from "./toolbar/Panels";

export const FOLDER_ICONS: [string, ComponentType<IconProps>, string][] = [
  ["folder", FolderIcon, t("폴더")],
  ["book-open", BookOpenIcon, t("책")],
  ["briefcase", BriefcaseIcon, t("서류 가방")],
  ["star", StarIcon, t("별")],
  ["heart", HeartIcon, t("하트")],
  ["code", CodeIcon, t("코드")],
  ["music-notes", MusicNotesIcon, t("음악")],
  ["image", ImageIcon, t("이미지")],
  ["house", HouseIcon, t("집")],
  ["graduation-cap", GraduationCapIcon, t("학교")],
  ["lightbulb", LightbulbIcon, t("아이디어")],
  ["flask", FlaskIcon, t("실험")],
  ["camera", CameraIcon, t("카메라")],
  ["airplane", AirplaneIcon, t("여행")],
  ["calendar", CalendarBlankIcon, t("일정")],
  ["chat", ChatCircleIcon, t("대화")],
  ["globe", GlobeIcon, t("세계")],
  ["lock", LockKeyIcon, t("자물쇠")],
  ["archive", ArchiveIcon, t("보관")],
  ["rocket", RocketIcon, t("로켓")],
  ["palette", PaletteIcon, t("팔레트")],
  ["game", GameControllerIcon, t("게임")],
  ["coffee", CoffeeIcon, t("커피")],
  ["leaf", LeafIcon, t("잎")],
  ["wallet", WalletIcon, t("지갑")],
  ["user", UserIcon, t("사람")],
  ["flag", FlagIcon, t("깃발")],
];

/** 폴더 아이콘(없으면 기본 폴더)에 폴더 색을 입힌다. 모르는 이름(새 버전에서 온 값)도 기본으로 그린다. */
export function NotebookGlyph({ nb, size = 16 }: Readonly<{ nb?: { color?: string | null; icon?: string | null } | null; size?: number }>) {
  const Icon = FOLDER_ICONS.find(([name]) => name === nb?.icon)?.[1] ?? FolderIcon;
  return <Icon size={size} aria-hidden style={nb?.color ? { color: nb.color } : undefined} />;
}

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

export function iconMenu(nb: Notebook, onPick: (icon: string | null) => void): MenuItemSpec {
  return {
    label: t("아이콘 변경"),
    icon: <NotebookGlyph nb={{ color: null, icon: nb.icon }} size={14} />,
    items: [
      { label: t("기본"), icon: <FolderIcon size={14} aria-hidden />, checked: !nb.icon, onSelect: () => onPick(null) },
      ...FOLDER_ICONS.slice(1).map(([name, Icon, label]) => ({
        label,
        icon: <Icon size={14} aria-hidden />,
        checked: nb.icon === name,
        onSelect: () => onPick(name),
      })),
    ],
  };
}
