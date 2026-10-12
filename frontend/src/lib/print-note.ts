/** 노트 인쇄: 셸의 서식 HTML 내보내기(/api/export/html: 정리된 본문 + 밝은 인쇄 CSS + 제목)를
 *  숨은 iframe에 넣고 그 창만 인쇄한다. 앱 화면(사이드바·도구줄)은 인쇄되지 않는다. */
import { t } from "../i18n";
export async function printNote(id: string, revision: number) {
  const response = await fetch("/api/export/html", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, revision }),
  });
  if (!response.ok) {
    let message = t("인쇄할 문서를 준비하지 못했습니다.");
    try {
      const data = await response.json();
      if (typeof data.error === "string") message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  const html = await response.text();
  document.querySelector("iframe.print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.title = t("인쇄용 문서");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // 크기 0·화면 밖: visibility:hidden이면 일부 엔진이 빈 쪽을 인쇄한다.
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  frame.srcdoc = html;
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  document.body.appendChild(frame);
  await loaded;
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error(t("인쇄 창을 열지 못했습니다."));
  }
  const remove = () => frame.remove();
  win.addEventListener("afterprint", remove, { once: true });
  setTimeout(remove, 10 * 60_000); // afterprint가 오지 않는 환경 대비
  win.focus();
  win.print();
}
