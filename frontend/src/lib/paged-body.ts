import { t } from "../i18n";
import { api } from "../api";
import type { BodySplice } from "./body-splice";
import type { PagedEditQueue } from "./paged-edit-queue";

/** Used only by explicit whole-document operations, never opening or typing. */
export function applyHtmlEdits(content: string, edits: readonly BodySplice[]) {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(content);
  for (const edit of edits) {
    const expected = encoder.encode(edit.expected),
      replacement = encoder.encode(edit.replacement);
    if (
      edit.start < 0 ||
      edit.start + expected.length > bytes.length ||
      expected.some((b, i) => bytes[edit.start + i] !== b)
    )
      throw new Error(t("문서가 변경되어 현재 편집과 합칠 수 없습니다."));
    const next = new Uint8Array(bytes.length - expected.length + replacement.length);
    next.set(bytes.subarray(0, edit.start));
    next.set(replacement, edit.start);
    next.set(bytes.subarray(edit.start + expected.length), edit.start + replacement.length);
    bytes = next;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function readPagedBody(id: string, queue: PagedEditQueue) {
  // Capture before awaiting anything: waiting for an in-flight save lets
  // later typing leak into the requested clipboard snapshot. The old base
  // revision remains available through history after that save commits.
  const snapshot = queue.snapshot();
  const note = await api.revisionBody(id, snapshot.revision);
  if (note.revision !== snapshot.revision) throw new Error(t("문서가 변경되었습니다. 다시 시도해 주세요."));
  return applyHtmlEdits(note.content, snapshot.edits);
}
