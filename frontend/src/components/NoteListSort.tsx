import { t } from "../i18n";
import React, { useState } from "react";
import { DotsThreeIcon as DotsThree } from "@phosphor-icons/react";
import { readSort, sortKey, writeSort, type GroupBy, type ListSort, type SortBy } from "../lib/list-sort";
import type { View } from "../types";
import { IconButton } from "./IconButton";
import { ContextMenu, type MenuItemSpec } from "./Menu";
import "./NoteListSort.css";

/** 보기별 정렬·묶기 설정(localStorage). 보기가 바뀌면 그 보기의 값을 읽는다. */
export function useListSort(view: View): [ListSort, (next: ListSort) => void] {
  const key = sortKey(view);
  const [state, setState] = useState(() => ({ key, sort: readSort(view) }));
  const sort = state.key === key ? state.sort : readSort(view);
  return [
    sort,
    (next) => {
      writeSort(view, next);
      setState({ key, sort: next });
    },
  ];
}

const SORT_LABELS: [SortBy, string][] = [
  ["updated_at", t("수정한 날짜")],
  ["created_at", t("만든 날짜")],
  ["title", t("제목")],
];
const GROUP_LABELS: [GroupBy, string][] = [
  ["none", t("없음")],
  ["default", t("기본")],
  ["year", t("년")],
  ["month", t("월")],
  ["week", t("주")],
  ["abc", t("가나다")],
];

/** 목록 정보 줄의 "최근 수정 순" 같은 정렬 이름. */
export function sortLabel(sort: ListSort): string {
  const desc = sort.sortDirection === "desc";
  if (sort.sortBy === "title") return desc ? t("제목 역순") : t("제목 순");
  if (sort.sortBy === "created_at") return desc ? t("최근 만든 순") : t("먼저 만든 순");
  return desc ? t("최근 수정 순") : t("오래된 수정 순");
}

/** 목록 머리 오른쪽의 정렬·묶기(더보기) 메뉴. 목록이 스크롤 영역이라 고정 위치 메뉴로 띄운다. */
export function GroupHeader({
  title,
  sort,
  onSort,
  extra = [],
}: Readonly<{
  title: string;
  sort?: ListSort;
  onSort?: (next: ListSort) => void;
  /** 정렬 메뉴 뒤에 붙는 보기별 항목(예: 폴더 고치기). */
  extra?: MenuItemSpec[];
}>) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const items = (): MenuItemSpec[] => {
    if (!sort || !onSort) return [];
    const byTitle = sort.sortBy === "title";
    return [
      {
        label: t("정렬 기준"),
        items: SORT_LABELS.map(([value, label]) => ({
          label,
          checked: sort.sortBy === value,
          onSelect: () => onSort({ ...sort, sortBy: value }),
        })),
      },
      {
        label: t("순서"),
        items: [
          {
            label: byTitle ? t("오름차순 (ㄱ→ㅎ)") : t("오름차순 (오래된 것부터)"),
            checked: sort.sortDirection === "asc",
            onSelect: () => onSort({ ...sort, sortDirection: "asc" }),
          },
          {
            label: byTitle ? t("내림차순 (ㅎ→ㄱ)") : t("내림차순 (최근 것부터)"),
            checked: sort.sortDirection === "desc",
            onSelect: () => onSort({ ...sort, sortDirection: "desc" }),
          },
        ],
      },
      {
        label: t("묶기"),
        items: GROUP_LABELS.map(([value, label]) => ({
          label,
          checked: sort.groupBy === value,
          onSelect: () => onSort({ ...sort, groupBy: value }),
        })),
      },
      ...extra.map((item, i) => (i === 0 ? { ...item, separatorBefore: true } : item)),
    ];
  };
  return (
    <div className="group-header">
      <span className="group-label">{title}</span>
      {sort && onSort && (
        <IconButton
          label={t("정렬·묶기")}
          aria-haspopup="menu"
          aria-expanded={!!at}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAt({ x: r.right - 220, y: r.bottom + 4 });
          }}
        >
          <DotsThree size={16} aria-hidden />
        </IconButton>
      )}
      {at && <ContextMenu x={at.x} y={at.y} items={items()} label={t("정렬·묶기")} onClose={() => setAt(null)} />}
    </div>
  );
}
