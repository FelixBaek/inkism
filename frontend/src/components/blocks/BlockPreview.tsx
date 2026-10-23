/**
 * 블록 넣기 메뉴 항목에 마우스를 올리면 옆에 뜨는 미리보기 카드: 넣으면 어떻게 보이는지 작은 견본 + 한 줄 설명.
 * 견본은 그림 파일 없이 HTML로 그려 밝은·어두운 화면을 따라간다.
 */
import React, { type ReactNode } from "react";
import type { LucideIcon } from "../../icons";
import { t } from "../../i18n";

const Line = ({ w = 100 }: { w?: number }) => <i className="bp-line" style={{ width: `${w}%` }} />;
const Lines = ({ n = 2 }: { n?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <Line key={i} w={i === n - 1 ? 60 : 100} />
    ))}
  </>
);
const heading = (level: number) => (
  <>
    <b className={`bp-h bp-h${level}`}>{t("제목 {level}", { level })}</b>
    <Lines />
  </>
);
const list = (marks: string[]) => (
  <>
    {marks.map((mark, i) => (
      <span key={i} className="bp-li">
        <em>{mark}</em>
        <Line w={[80, 64, 72][i]} />
      </span>
    ))}
  </>
);
/** 미디어는 견본 대신 항목 아이콘을 크게 그린다(이모지 글꼴이 없는 환경에서 깨지지 않게). */
const media = (Icon: LucideIcon) => (
  <span className="bp-media">
    <Icon size={32} aria-hidden />
  </span>
);

const PREVIEWS: Record<string, { sample: ReactNode | ((Icon: LucideIcon) => ReactNode); text: string }> = {
  paragraph: { sample: <Lines n={3} />, text: t("일반 글을 씁니다.") },
  heading1: { sample: heading(1), text: t("큰 제목으로 구역을 나눕니다.") },
  heading2: { sample: heading(2), text: t("중간 제목으로 구역을 나눕니다.") },
  heading3: { sample: heading(3), text: t("작은 제목으로 구역을 나눕니다.") },
  taskList: { sample: list(["☑", "☐", "☐"]), text: t("체크할 수 있는 할 일 목록을 만듭니다.") },
  bulletList: { sample: list(["•", "•", "•"]), text: t("글머리 기호 목록을 만듭니다.") },
  orderedList: { sample: list(["1.", "2.", "3."]), text: t("번호가 매겨진 목록을 만듭니다.") },
  blockquote: {
    sample: (
      <span className="bp-quote">
        <Lines />
      </span>
    ),
    text: t("인용한 글을 돋보이게 합니다."),
  },
  details: {
    sample: list(["▸", "▸"]),
    text: t("눌러서 펼치고 접는 토글을 만듭니다."),
  },
  codeBlock: {
    sample: (
      <code className="bp-code">
        {"const note = ink();"}
        <br />
        {"note.save();"}
      </code>
    ),
    text: t("코드를 고정폭 글꼴로 적습니다."),
  },
  horizontalRule: {
    sample: (
      <>
        <Line />
        <hr className="bp-hr" />
        <Line w={60} />
      </>
    ),
    text: t("구역 사이에 가로줄을 긋습니다."),
  },
  aiBlock: { sample: (Icon: LucideIcon) => <span className="bp-callout"><Icon size={16} aria-hidden /><Line w={70} /></span>, text: t("AI에게 글을 써 달라고 요청합니다.") },
  callout: { sample: (Icon: LucideIcon) => <span className="bp-callout"><Icon size={16} aria-hidden /><Line w={70} /></span>, text: t("아이콘과 배경으로 눈에 띄는 메모를 만듭니다.") },
  table: {
    sample: (
      <span className="bp-table">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
    ),
    text: t("행과 열이 있는 표를 넣습니다."),
  },
  blockMath: { sample: <span className="bp-math">E = mc²</span>, text: t("수식 블록을 넣습니다(LaTeX).") },
  emoji: { sample: media, text: t("이모지를 골라 넣습니다.") },
  diagram: {
    sample: (
      <span className="bp-diagram">
        <i />→<i />→<i />
      </span>
    ),
    text: t("글로 적어 다이어그램(Mermaid)을 그립니다."),
  },
  image: { sample: media, text: t("이미지를 올리거나 주소로 넣습니다.") },
  video: { sample: media, text: t("동영상을 올리거나 YouTube 주소로 넣습니다.") },
  audio: { sample: media, text: t("소리 파일을 올리거나 바로 녹음합니다.") },
  model3d: { sample: media, text: t("3D 모델 파일을 넣습니다.") },
  attachment: { sample: media, text: t("파일을 첨부합니다.") },
  embed: { sample: media, text: t("웹 페이지를 주소로 임베드합니다.") },
};

export function BlockPreview({ id, label, icon }: Readonly<{ id: string; label: string; icon: LucideIcon }>) {
  const preview = PREVIEWS[id];
  if (!preview) return null;
  return (
    <>
      <div className="bp-sample" aria-hidden>
        {typeof preview.sample === "function" ? preview.sample(icon) : preview.sample}
      </div>
      <p className="bp-text">
        <strong>{label}</strong>
        {preview.text}
      </p>
    </>
  );
}
