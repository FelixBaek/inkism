import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { t } from "../i18n";
import { api } from "../api";
import type { useStore } from "../store";
import { openInNewTab } from "./NoteTabs";

// 떠 있는 서식 메뉴 설정. 렌더마다 새로 만들면 BubbleMenu가 매번 트랜잭션을 보내 다시 그리기가 끝없이 돈다.
export const FORMAT_MENU_HIDDEN = "inkism-format-menu-hidden";
export const FORMAT_MENU_OPTIONS = {
  placement: "top-start",
  offset: 8,
  flip: true,
  shift: { padding: 8 },
  // 위·아래 어느 쪽에도 다 들어가지 않으면 자리가 넓은 쪽(flip)에 두고, 그 높이만큼만 보이며 메뉴 안에서 스크롤한다.
  // 고른 글은 가리지 않는다. 평소엔 높이 제한이 없어 다 보인다.
  size: {
    padding: 8,
    apply: ({ availableHeight, elements }: { availableHeight: number; elements: { floating: HTMLElement } }) => {
      const menu = elements.floating.querySelector<HTMLElement>(".format-menu");
      if (menu) menu.style.maxHeight = `${Math.max(160, Math.floor(availableHeight))}px`;
    },
  },
  // 새로 뜰 때는 지난 높이 제한을 풀어 flip이 메뉴 전체 높이로 자리를 고르게 한다.
  onShow: () => document.querySelectorAll<HTMLElement>(".format-menu").forEach((menu) => (menu.style.maxHeight = "")),
  // 메뉴가 숨으면 메뉴에서 연 팝오버(색·목록·블록 바꾸기 등)도 닫게 알린다.
  onHide: () => document.dispatchEvent(new Event(FORMAT_MENU_HIDDEN)),
} as const;
/** 글자를 고를 때만. 블록 통째 선택(이미지·동영상·3D 등)에는 서식 메뉴를 띄우지 않는다. */
export const showFormatMenu = ({ editor, state }: { editor: Editor; state: EditorState }) =>
  editor.isEditable &&
  !state.selection.empty &&
  !(state.selection instanceof NodeSelection) &&
  state.doc.textBetween(state.selection.from, state.selection.to).length > 0;

/** 고른 글을 새 노트로 옮기고, 원래 자리의 글은 남긴 채 새 노트 링크로 바꾼 뒤 새 노트를 연다. */
export async function extractSelectionToNote(store: ReturnType<typeof useStore>, editor: Editor) {
  if (editor.state.selection.empty) return;
  const draft = store.readDraft();
  if (!draft || draft.readonly) return;
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, "\n", "\n").trim();
  if (!text) return;
  if (text.length > 100_000) {
    await store.showError(t("선택 영역 추출"), t("선택 영역은 100,000자 이하만 추출할 수 있습니다."));
    return;
  }
  const doc = editor.state.doc;
  try {
    // 새(저장 전) 노트도 여기서 먼저 저장된다.
    if (!(await store.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
    if (store.readDraft()?.id !== draft.id || editor.state.doc !== doc)
      throw new Error(t("문서가 변경되어 선택을 추출하지 못했습니다."));
    const serializer = (await import("@tiptap/pm/model")).DOMSerializer.fromSchema(editor.schema);
    const holder = document.createElement("div");
    holder.appendChild(serializer.serializeFragment(editor.state.doc.slice(from, to).content));
    // 한 문단 안에서 고르면 글만 나온다. 문단으로 감싸야 새 노트가 서식 편집 가능한 문서로 열린다.
    if ([...holder.childNodes].some((n) => !(n instanceof HTMLElement) || !/^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|DIV|DETAILS|FIGURE|ASIDE)$/.test(n.tagName)))
      holder.innerHTML = `<p>${holder.innerHTML}</p>`;
    const created = await api.save({
      id: crypto.randomUUID(),
      title: text.replace(/\s+/g, " ").slice(0, 48),
      content: holder.innerHTML,
      content_format: "html",
      text,
    });
    // Keep the selected text in place and make the new note immediately discoverable.
    editor.chain().focus().setTextSelection({ from, to }).setLink({ href: `note://${created.id}` }).run();
    store.refreshList();
    await store.refreshMeta();
    await openInNewTab(store, created.id);
  } catch (error) {
    await store.showError(t("선택 영역 추출"), error instanceof Error ? error.message : String(error));
  }
}
