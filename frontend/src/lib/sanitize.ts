import DOMPurify from "dompurify";

// This inert metadata is plain text. DOMPurify otherwise removes literal HTML
// examples inside attribute values; it is never inserted as innerHTML.
// AI 블록 대화(data-chat)도 같은 일반 글자 JSON이다.
const KEPT: Record<string, [string, number]> = { SPAN: ["termDefinition", 2000], DIV: ["chat", 120000] };
const keptText = new WeakMap<Node, [string, string]>();
DOMPurify.addHook('beforeSanitizeAttributes', node => {
  if (!(node instanceof HTMLElement) || !KEPT[node.tagName]) return;
  const [key, max] = KEPT[node.tagName];
  const value = node.dataset[key];
  if (value?.trim() && Array.from(value).length <= max &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) keptText.set(node, [key, value]);
});
DOMPurify.addHook('afterSanitizeAttributes', node => {
  const kept = keptText.get(node);
  if (kept !== undefined && node instanceof HTMLElement) {
    node.dataset[kept[0]] = kept[1];
    keptText.delete(node);
  }
});

/**
 * 리치 텍스트 모드에서 Tiptap에 넣기 전에 가져온/저장된 HTML을 정화한다.
 * 대용량 문서(원문 모드)는 이 경로를 지나지 않는다 — 메인 스레드 DOM 파싱을
 * 피하기 위해 원문 모드에서는 CodeMirror에 원본 문자열을 곧장 넣는다.
 */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // note://<id>는 엔진이 역링크로 인식하는 노트 연결 주소다(DOMPurify 기본 URI 정규식 + note).
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|note):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    ADD_ATTR: [
      "dir",
      "data-color",
      "type",
      "checked",
      "disabled",
      "colwidth",
      "target",
      "rel",
      "icon",
      "bordercolor",
      "bordercolordark",
      "backcolor",
      "backcolordark",
    ],
  });
}
