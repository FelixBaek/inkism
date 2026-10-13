/**
 * 대용량 원문 저장 시 일반 텍스트 추출을 메인 스레드 밖에서 수행한다.
 * Worker에는 DOM이 없으므로 정규식/엔티티 맵으로 처리한다.
 * 디바운스된 저장 1회당 정확히 한 번 호출된다.
 */

// Line breaks are replaced before closing block tags; the two never overlap, so
// this matches the former single combined pattern.
const LINE_BREAK = /<br\s*\/?>/gi;
const BLOCK_TAGS =
  /<\/(p|div|h[1-6]|li|tr|td|th|blockquote|pre|table|section|article|header|footer|ul|ol|details|summary)>/gi;

/** Same as `.replace(/<[^>]+>/g, "")` in linear time. */
function removeTags(s: string): string {
  let out = "",
    i = 0;
  for (;;) {
    const open = s.indexOf("<", i);
    if (open === -1) break;
    const close = s.indexOf(">", open + 1);
    // No later ">" means no later tag can close either.
    if (close === -1) break;
    if (close === open + 1) {
      // "<>" is not a tag; keep it and keep scanning after "<".
      out += s.slice(i, open + 1);
      i = open + 1;
    } else {
      out += s.slice(i, open);
      i = close + 1;
    }
  }
  return out + s.slice(i);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&hellip;": "…",
};

self.onmessage = (ev: MessageEvent<{ id: number; html: string }>) => {
  const { id, html } = ev.data;
  let text = "";
  try {
    text = stripHtml(html);
  } catch (error) {
    self.postMessage({ id, error_code: "plaintext_extract_failed", error: error instanceof Error ? error.message : String(error) });
    return;
  }
  (self as unknown as Worker).postMessage({ id, text });
};

export function stripHtml(html: string): string {
  let s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(input|img|hr|embed|video|audio)\b[^>]*\/?>/gi, " ");
  s = s.replace(LINE_BREAK, "\n").replace(BLOCK_TAGS, "\n");
  s = removeTags(s);
  s = s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|mdash|hellip);/g, (m) => ENTITIES[m] ?? m);
  s = s.replace(/&#(\d+);/g, (_, n) => {
    try {
      return String.fromCodePoint(Number(n));
    } catch {
      return "";
    }
  });
  // 연속 공백 정리 + 앞뒤 빈 줄 제거
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
