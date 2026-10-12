/** 노트 목록 정렬·묶기. 보기마다 localStorage에 저장한다.
 *  정렬은 엔진 list(sort_by/sort_direction)가 하고, 묶기는 지금 페이지 안에서만 나눈다. */
import { t } from "../i18n";
export type SortBy = "updated_at" | "created_at" | "title";
export type GroupBy = "none" | "default" | "year" | "month" | "week" | "abc";
export interface ListSort {
  sortBy: SortBy;
  sortDirection: "asc" | "desc";
  groupBy: GroupBy;
}
export const DEFAULT_SORT: ListSort = { sortBy: "updated_at", sortDirection: "desc", groupBy: "default" };

type ViewLike = { type: string; id?: string; name?: string };
function viewKey(view: ViewLike) {
  if (view.type === "notebook") return "notebook:" + view.id;
  if (view.type === "tag") return "tag:" + view.name;
  return view.type;
}
export const sortKey = (view: ViewLike) => "inkism.listSort." + viewKey(view);

const SORTS = new Set<SortBy>(["updated_at", "created_at", "title"]);
const GROUPS = new Set<GroupBy>(["none", "default", "year", "month", "week", "abc"]);

export function readSort(view: ViewLike): ListSort {
  try {
    const raw = JSON.parse(localStorage.getItem(sortKey(view)) || "null");
    if (
      raw &&
      SORTS.has(raw.sortBy) &&
      (raw.sortDirection === "asc" || raw.sortDirection === "desc") &&
      GROUPS.has(raw.groupBy)
    )
      return raw;
  } catch {
    /* 저장소 없음·깨진 값 → 기본값 */
  }
  return DEFAULT_SORT;
}
export function writeSort(view: ViewLike, sort: ListSort) {
  try {
    localStorage.setItem(sortKey(view), JSON.stringify(sort));
  } catch {
    /* 이번 실행 동안만 유지 */
  }
}

const DAY = 86400000,
  WEEK = DAY * 7;
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

function initialGroup(title: string) {
  const ch = (title || "").trim().charAt(0);
  if (!ch) return "-";
  const code = ch.codePointAt(0)! - 0xac00;
  return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch.toUpperCase();
}
function weekGroup(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const md = (d: Date) => t("{month}월 {day}일", { month: d.getMonth() + 1, day: d.getDate() });
  const yr = (d: Date) => t("{year}년", { year: d.getFullYear() });
  return `${start.getFullYear() !== end.getFullYear() ? yr(start) + " " : ""}${md(start)} – ${yr(end)} ${md(end)}`;
}
function recencyGroup(value: number, now: number) {
  if (value > now - WEEK) return t("최근");
  return value > now - WEEK * 2 ? t("지난주") : t("이전");
}

/** 한 노트가 들어갈 묶음 이름. 고정 노트는 엔진이 항상 맨 앞에 둔다. */
export function groupTitle(
  item: { pinned: boolean; title: string; created_at: number; updated_at: number },
  sort: ListSort,
  now = Date.now(),
): string {
  if (item.pinned) return t("고정됨");
  if (sort.groupBy === "none") return t("전체");
  if (sort.groupBy === "abc") return initialGroup(item.title);
  // 제목 정렬이면 만든 날짜로 묶는다.
  const value = sort.sortBy === "updated_at" ? item.updated_at : item.created_at;
  const date = new Date(value);
  switch (sort.groupBy) {
    case "year":
      return t("{year}년", { year: date.getFullYear() });
    case "month":
      return t("{year}년 {month}월", { year: date.getFullYear(), month: date.getMonth() + 1 });
    case "week":
      return weekGroup(date);
    default:
      return recencyGroup(value, now);
  }
}

/** 이어지는 같은 묶음끼리 모은다(목록 순서 유지). */
export function groupItems<T extends Parameters<typeof groupTitle>[0]>(items: T[], sort: ListSort, now = Date.now()) {
  const groups: { title: string; items: T[] }[] = [];
  for (const item of items) {
    const title = groupTitle(item, sort, now);
    if (groups.at(-1)?.title === title) groups.at(-1)!.items.push(item);
    else groups.push({ title, items: [item] });
  }
  return groups;
}
