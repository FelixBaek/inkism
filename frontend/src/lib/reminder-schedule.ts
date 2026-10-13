/** 알림 처리: 반복 알림은 지금 이후 첫 회차로 넘기고, 한 번짜리는 해제(null)한다. */
export function nextOccurrence(at: number, hours: number | null | undefined, now = Date.now()): number | null {
  if (!hours) return null;
  const step = hours * 3_600_000;
  return at + (Math.floor((now - at) / step) + 1) * step;
}
