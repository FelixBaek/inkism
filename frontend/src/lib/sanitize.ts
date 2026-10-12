import DOMPurify from "dompurify";

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
