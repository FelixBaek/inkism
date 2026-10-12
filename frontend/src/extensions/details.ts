/** 접기 블록: Tiptap details 확장에 열림 상태 저장과 접근성 라벨을 더한다. */
import { Details } from "@tiptap/extension-details";
import "./details.css";
import { t } from "../i18n";

export const InkismDetails = Details.extend({ draggable: true }).configure({
  persist: true,
  HTMLAttributes: { class: "inkism-details" },
  renderToggleButton: ({ element, isOpen }) => {
    element.setAttribute("aria-label", isOpen ? t("내용 접기") : t("내용 펼치기"));
    element.setAttribute("aria-expanded", String(isOpen));
    element.textContent = isOpen ? "▾" : "▸";
  },
});
export { DetailsContent, DetailsSummary } from "@tiptap/extension-details";
