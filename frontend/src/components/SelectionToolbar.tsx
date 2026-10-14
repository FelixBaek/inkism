import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { t } from "../i18n";
import { api } from "../api";
import type { useStore } from "../store";

// 떠 있는 서식 메뉴 설정. 렌더마다 새로 만들면 BubbleMenu가 매번 트랜잭션을 보내 다시 그리기가 끝없이 돈다.
export const FORMAT_MENU_OPTIONS = { placement: "top-start", offset: 8, flip: true, shift: { padding: 8 } } as const;
/** 글자를 고를 때만. 블록 통째 선택(이미지·동영상·3D 등)에는 서식 메뉴를 띄우지 않는다. */
export const showFormatMenu = ({ editor, state }: { editor: Editor; state: EditorState }) =>
  editor.isEditable &&
  !state.selection.empty &&
  !(state.selection instanceof NodeSelection) &&
  state.doc.textBetween(state.selection.from, state.selection.to).length > 0;

/** 고른 글을 새 노트로 옮기고, 원래 자리의 글은 남긴 채 새 노트 링크로 바꾼다. */
export async function extractSelectionToNote(store: ReturnType<typeof useStore>, editor: Editor) {
  if (editor.state.selection.empty) return;
  const draft = store.readDraft();
  if (!draft || draft.readonly || draft.isNew) return;
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, "\n", "\n").trim();
  if (!text) return;
  if (text.length > 100_000) {
    await store.showError(t("선택 영역 추출"), t("선택 영역은 100,000자 이하만 추출할 수 있습니다."));
    return;
  }
  try {
    if (!(await store.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
    const saved = store.readDraft();
    if (!saved || saved.id !== draft.id || saved.revision !== draft.revision)
      throw new Error(t("문서가 변경되어 선택을 추출하지 못했습니다."));
    const title = await store.prompt({
      title: t("선택 영역을 새 노트로 추출"),
      message: t("새 노트의 제목을 입력하세요."),
      label: t("노트 제목"),
      initial: text.replace(/\s+/g, " ").slice(0, 48),
    });
    if (!title) return;
    const serializer = (await import("@tiptap/pm/model")).DOMSerializer.fromSchema(editor.schema);
    const holder = document.createElement("div");
    holder.appendChild(serializer.serializeFragment(editor.state.doc.slice(from, to).content));
    const created = await api.save({
      id: crypto.randomUUID(),
      title: title.value,
      content: holder.innerHTML,
      content_format: "html",
      text,
    });
    // Keep the selected text in place and make the new note immediately discoverable.
    editor.chain().focus().setTextSelection({ from, to }).setLink({ href: `note://${created.id}` }).run();
    store.refreshList();
    await store.refreshMeta();
  } catch (error) {
    await store.showError(t("선택 영역 추출"), error instanceof Error ? error.message : String(error));
  }
}
