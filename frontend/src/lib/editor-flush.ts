/** Await asynchronous editor changes before saving, switching notes or closing.
 * An operation's initial flush bypasses these hooks, so it cannot await itself. */
const editors = new Set<{ flush: () => Promise<boolean>; pending: () => boolean }>();
export function registerEditorFlush(flush: () => Promise<boolean>, pending: () => boolean) {
  const editor = { flush, pending };
  editors.add(editor);
  return () => {
    editors.delete(editor);
  };
}
export function hasPendingEditorInput() {
  return [...editors].some((editor) => editor.pending());
}
export async function flushEditors() {
  // 저장 도중 편집기가 등록·해제돼도 시작 시점 목록만 저장한다.
  const snapshot = Array.from(editors);
  for (const editor of snapshot) {
    if (!(await editor.flush())) return false;
  }
  return true;
}
export interface EditorFlushOptions {
  unload?: boolean;
  editorOperation?: boolean;
}
