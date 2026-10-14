/**
 * 서식 메뉴 항목에 마우스를 올리면 메뉴 옆에 뜨는 미리보기 카드: 적용 전→후 견본 + 한 줄 설명.
 * 견본은 그림 파일 없이 HTML·CSS로 그리고, 뒤쪽(후)이 반복해서 나타나 움직이는 그림처럼 보인다.
 */
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { t } from "../../i18n";

const W = "Ink";
const bars = (widths: number[]) => (
  <span className="fp-bars">
    {widths.map((w, i) => (
      <i key={i} className="bp-line" style={{ width: `${w}%` }} />
    ))}
  </span>
);
const word = (className: string, text: ReactNode = W) => <span className={`fp-word ${className}`}>{text}</span>;

const PREVIEWS: Record<string, { before: ReactNode; after: ReactNode; text: string }> = {
  color: { before: word(""), after: word("fp-ink"), text: t("글자에 색을 칠합니다. ▾로 색을 고릅니다.") },
  highlight: { before: word(""), after: word("fp-mark"), text: t("형광펜처럼 글자 뒤에 배경색을 칠합니다. ▾로 색을 고릅니다.") },
  bold: { before: word(""), after: word("fp-bold"), text: t("글자를 굵게 합니다.") },
  italic: { before: word(""), after: word("fp-italic"), text: t("글자를 기울입니다.") },
  underline: { before: word(""), after: word("fp-underline"), text: t("글자 아래에 밑줄을 긋습니다.") },
  clear: {
    before: word("fp-bold fp-italic fp-color"),
    after: word(""),
    text: t("굵게·색 같은 서식을 지우고 글자만 남깁니다."),
  },
  link: { before: word(""), after: word("fp-link"), text: t("눌러서 이동하는 링크를 겁니다.") },
  strike: { before: word(""), after: word("fp-strike"), text: t("글자 가운데에 줄을 긋습니다.") },
  code: { before: word(""), after: word("fp-code"), text: t("코드처럼 고정폭 글꼴로 표시합니다.") },
  inlineMath: {
    before: word("fp-mono", "x^2"),
    after: word("fp-math", "x²"),
    text: t("문장 안에 수식(LaTeX)을 넣습니다."),
  },
  subscript: { before: word("", "H2O"), after: word("", <>H<sub>2</sub>O</>), text: t("글자를 아래 첨자로 작게 내립니다.") },
  superscript: { before: word("", "x2"), after: word("", <>x<sup>2</sup></>), text: t("글자를 위 첨자로 작게 올립니다.") },
  fontSize: { before: word("fp-small"), after: word("fp-large"), text: t("−·+로 글자 크기를 한 단계씩 바꿉니다.") },
  font: { before: word(""), after: word("fp-serif"), text: t("글꼴을 고딕·명조·고정폭 등으로 바꿉니다.") },
  align: {
    before: bars([60, 40]),
    after: <span className="fp-bars fp-center">{bars([60, 40])}</span>,
    text: t("누를 때마다 왼쪽→가운데→오른쪽→양쪽으로 정렬을 바꿉니다."),
  },
  ol: {
    before: bars([70, 50]),
    after: (
      <span className="fp-bars fp-list">
        <span><em>1.</em><i className="bp-line" style={{ width: "70%" }} /></span>
        <span><em>2.</em><i className="bp-line" style={{ width: "50%" }} /></span>
      </span>
    ),
    text: t("번호 목록으로 바꿉니다. ▾로 번호 모양을 고릅니다."),
  },
  ul: {
    before: bars([70, 50]),
    after: (
      <span className="fp-bars fp-list">
        <span><em>•</em><i className="bp-line" style={{ width: "70%" }} /></span>
        <span><em>•</em><i className="bp-line" style={{ width: "50%" }} /></span>
      </span>
    ),
    text: t("글머리 목록으로 바꿉니다. ▾로 글머리 모양을 고릅니다."),
  },
  note: { before: word(""), after: word("fp-link"), text: t("다른 노트를 골라 링크로 잇습니다.") },
  emoji: { before: word(""), after: word("", "Ink 🙂"), text: t("커서 자리에 이모지를 넣습니다.") },
  term: { before: word(""), after: word("fp-term"), text: t("단어에 설명을 달아 올리면 보이게 합니다.") },
  extract: {
    before: word("fp-selected"),
    after: (
      <span className="fp-note">
        {word("fp-link")}
        <span className="fp-doc">{bars([90, 60])}</span>
      </span>
    ),
    text: t("고른 글을 새 노트로 옮기고 그 자리에 링크를 남깁니다."),
  },
  polish: { before: bars([92, 48, 78]), after: bars([100, 100, 70]), text: t("문장을 매끄럽게 다듬습니다.") },
  spelling: {
    before: <span className="fp-bars"><i className="bp-line fp-typo" style={{ width: "80%" }} /></span>,
    after: <span className="fp-bars"><i className="bp-line fp-fixed" style={{ width: "80%" }} /></span>,
    text: t("맞춤법과 띄어쓰기를 바로잡습니다."),
  },
  shorter: { before: bars([100, 100, 60]), after: bars([70]), text: t("뜻은 두고 글을 짧게 줄입니다.") },
  longer: { before: bars([70]), after: bars([100, 100, 60]), text: t("내용을 덧붙여 글을 늘립니다.") },
  summarize: {
    before: bars([100, 100, 100, 50]),
    after: (
      <span className="fp-bars fp-sum">
        <em>•</em>
        <i className="bp-line" style={{ width: "70%" }} />
      </span>
    ),
    text: t("핵심만 짧게 요약합니다."),
  },
  aiEdit: {
    before: bars([80, 60]),
    after: (
      <span className="fp-bars fp-ai">
        <i className="bp-line" style={{ width: "80%" }} />
        <i className="bp-line" style={{ width: "60%" }} />
      </span>
    ),
    text: t("원하는 바를 적어 AI에게 고쳐 달라고 합니다."),
  },
};

const CARD = 236;

/** 메뉴(menu) 오른쪽에, 자리가 없으면 왼쪽에 붙인다. 메뉴와 고른 글을 가리지 않는다. */
export function FormatPreview({ id, label, item, menu }: Readonly<{ id: string; label: string; item: HTMLElement; menu: HTMLElement }>) {
  const preview = PREVIEWS[id];
  const m = menu.getBoundingClientRect();
  if (!preview || !item.isConnected || !m.width) return null;
  const left = m.right + 8 + CARD <= innerWidth - 8 ? m.right + 8 : m.left - 8 - CARD;
  if (left < 8) return null;
  // shortcut: 카드 높이는 약 200px로 어림잡는다. 카드 내용이 크게 바뀌면 실제 높이를 재도록 바꾼다.
  const top = Math.max(8, Math.min(item.getBoundingClientRect().top - 8, innerHeight - 208));
  return createPortal(
    <div className="tb-pop fp-card" style={{ left, top, width: CARD }} aria-hidden>
      <div className="bp-sample fp-sample">
        <span className="fp-before">{preview.before}</span>
        <span className="fp-arrow">→</span>
        <span className="fp-after">{preview.after}</span>
      </div>
      <p className="bp-text">
        <strong>{label}</strong>
        {preview.text}
      </p>
    </div>,
    document.body,
  );
}
