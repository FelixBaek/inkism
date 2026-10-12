import { modelSourceSegments } from "./source-segments";
import { t } from "../i18n";

/** Only admitted, bounded editor windows enter this scanner. Retain their raw
 * top-level blocks; never ask the browser to serialize untouched source. */
function blocks(source: string): string[] {
  const result: string[] = [];
  let pending = "";
  for (const piece of modelSourceSegments(source, 0)) {
    pending += piece.source;
    if (!piece.end_context.length && pending.trim()) {
      result.push(pending);
      pending = "";
    }
  }
  if (pending) {
    if (!result.length) throw new Error(t("문서 블록의 원문 경계를 찾지 못했습니다."));
    result[result.length - 1] += pending;
  }
  return result;
}

/** Canonical HTML identifies changed blocks, while the old raw spelling of
 * every unchanged leading/trailing block survives typing and formatting. */
export function projectWindowSource(raw: string, beforeHTML: string, afterHTML: string): string {
  if (beforeHTML === afterHTML) return raw;
  const original = blocks(raw),
    before = blocks(beforeHTML),
    after = blocks(afterHTML);
  if (original.length !== before.length)
    throw new Error(t("표시 블록과 원문 경계가 일치하지 않습니다. 원문을 유지합니다."));
  let prefix = 0,
    suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return (
    original.slice(0, prefix).join("") +
    after.slice(prefix, after.length - suffix).join("") +
    original.slice(original.length - suffix).join("")
  );
}
