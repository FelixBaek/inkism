import { t } from "../i18n";
/** 한국어 상대 시간 표시 (방금 전 / n분 전 / 어제 / 날짜) */
export function formatRelative(ms: number, now = Date.now()): string {
  if (!Number.isFinite(ms)) return "";
  const diff = now - ms;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return t("방금 전");
  if (diff < hour) return t("{n}분 전", { n: Math.floor(diff / min) });
  if (diff < day) return t("{n}시간 전", { n: Math.floor(diff / hour) });
  if (diff < 2 * day) return t("어제");
  const d = new Date(ms);
  const y = d.getFullYear();
  if (y !== new Date(now).getFullYear()) return `${y}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
