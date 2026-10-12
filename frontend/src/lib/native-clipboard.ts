import {cloneHTMLIdentity} from "./block-identity";
import { t } from "../i18n";
import * as viewRuntime from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { ResolvedPos, Slice } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export interface NativeClipboard {
  text: string;
  html: string | null;
  plain: boolean;
}
export interface ClipboardPaste {
  input: NativeClipboard;
  parse(state: EditorState, input: NativeClipboard): { slice: Slice; transaction: Transaction };
}
export function readClipboard(event: ClipboardEvent, plain = false): NativeClipboard | null {
  const data = event.clipboardData;
  if (!data) return null;
  const text =
    data.getData("text/plain") || data.getData("Text") || data.getData("text/uri-list").replace(/\r?\n/g, " ");
  const html = data.getData("text/html") || null;
  return text || html ? { text, html, plain } : null;
}

/** Use the installed native parser with the real selection context, without
 * rendering that document. The exported internal hook is isolated here; npm ci
 * locks prosemirror-view 1.42.6, and contract tests guard dependency upgrades. */
export function nativeClipboardPaste(view: EditorView, state: EditorState, input: NativeClipboard) {
  const parser = (
    viewRuntime as unknown as {
      __parseFromClipboard?: (
        view: EditorView,
        text: string,
        html: string | null,
        plain: boolean,
        context: ResolvedPos,
      ) => Slice | null;
    }
  ).__parseFromClipboard;
  if (typeof parser !== "function") throw new Error(t("붙여넣기 엔진을 사용할 수 없습니다. 입력과 원문을 유지합니다."));
  const encoder = new TextEncoder();
  if (
    encoder.encode(input.text).length > 20 * 1024 * 1024 ||
    (input.html && encoder.encode(input.html).length > 20 * 1024 * 1024)
  )
    throw new Error(t("붙여넣은 내용이 20 MiB를 초과했습니다. 입력과 원문을 유지합니다."));
  // Hooks come from the mounted editor; a hook inspecting view.state sees the
  // actual model. No updateState/EditorView construction or full source DOM.
  const contextual = new Proxy(view, {
    get(target, key) {
      if (key === "state") return state;
      if (key === "someProp") return target.someProp.bind(target);
      return Reflect.get(target, key, target);
    },
  });
  const slice = parser(contextual, input.text, input.html ? cloneHTMLIdentity(input.html) : input.html, input.plain, state.selection.$from);
  if (!slice) throw new Error(t("붙여넣을 내용을 읽지 못했습니다. 입력과 원문을 유지합니다."));
  // Matches native doPaste, including the single-node mark inheritance rule.
  const single =
    slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1 ? slice.content.firstChild : null;
  const transaction = single ? state.tr.replaceSelectionWith(single, input.plain) : state.tr.replaceSelection(slice);
  transaction.setMeta("paste", true).setMeta("uiEvent", "paste");
  return { slice, transaction };
}
