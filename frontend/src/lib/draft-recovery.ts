import type { ContentFormat, Draft } from "../types";
import { t } from "../i18n";

/** Lossless local snapshot. Partial bodies must never be labelled complete. */
export function draftRecovery(draft: Draft) {
  if (draft.paged?.saving) throw new Error(t("저장 응답을 기다리는 중입니다. 잠시 후 다시 보관해 주세요."));
  return checkpointDraftRecovery(draft);
}

/** Synchronous capture includes the frozen in-flight prefix and later edits.
 * The journal retains that exact revision's baseline until acknowledgement. */
export function checkpointDraftRecovery(draft: Draft) {
  const base = {
    format: "inkism-draft",
    version: 1,
    note: {
      content_format: draft.content_format ?? "html",
      id: draft.id,
      title: draft.title,
      notebook_id: draft.notebook_id,
      tags: [...draft.tags],
    },
  };
  if (draft.paged) {
    const snapshot = draft.paged.snapshot();
    return {
      ...base,
      body: {
        kind: "partial" as const,
        revision: snapshot.revision,
        offset_encoding: "utf-8",
        edit_order: "sequential",
        edits: snapshot.edits,
      },
    };
  }
  return { ...base, body: { kind: "complete" as const, revision: draft.revision, content: draft.content } };
}

export function downloadDraftRecovery(draft: Draft) {
  const data = draftRecovery(draft);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "inkism-draft-" + draft.id + ".json";
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export const RECOVERY_FILE_LIMIT = 128 * 1024 * 1024;
export type RecoveryFile = ReturnType<typeof draftRecovery>;

/** Validate before any RPC or document construction; ignore unknown fields. */
export function parseDraftRecovery(raw: string): RecoveryFile {
  const invalid = () => new Error(t("올바른 inkism 편집 보관 파일이 아닙니다."));
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid();
    return v as Record<string, unknown>;
  };
  const string = (v: unknown, max: number) => {
    if (typeof v !== "string" || Array.from(v).length > max) throw invalid();
    return v;
  };
  const uuid = (v: unknown) => {
    const id = string(v, 36);
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw invalid();
    return id;
  };
  const value = object(JSON.parse(raw));
  if ((value.format !== "inkism-draft" && value.format !== "mindbox-draft") || value.version !== 1) throw invalid();
  const meta = object(value.note),
    body = object(value.body);
  if (!Array.isArray(meta.tags) || meta.tags.length > 100) throw invalid();
  const format = meta.content_format;
  if (format !== undefined && !(typeof format === "string" && ["text", "html", "markdown"].includes(format)))
    throw invalid();
  const note = {
    content_format: (meta.content_format ?? "html") as ContentFormat,
    id: uuid(meta.id),
    title: string(meta.title, 2000),
    notebook_id: meta.notebook_id === null ? null : uuid(meta.notebook_id),
    tags: meta.tags.map((v) => string(v, 100)),
  };
  if (typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) throw invalid();
  const base = { format: "inkism-draft", version: 1, note };
  if (body.kind === "complete") {
    if (typeof body.content !== "string" || new TextEncoder().encode(body.content).length > 20 * 1024 * 1024)
      throw invalid();
    return { ...base, body: { kind: "complete", revision: body.revision, content: body.content } };
  }
  // Complete snapshots can come from a new, never-saved note (revision 0).
  // Partial edits still require a persisted baseline.
  if (
    body.kind !== "partial" ||
    body.revision < 1 ||
    body.offset_encoding !== "utf-8" ||
    body.edit_order !== "sequential" ||
    !Array.isArray(body.edits)
  )
    throw invalid();
  const edits = body.edits.map((v) => {
    const e = object(v);
    if (
      typeof e.start !== "number" ||
      !Number.isSafeInteger(e.start) ||
      e.start < 0 ||
      typeof e.expected !== "string" ||
      typeof e.replacement !== "string"
    )
      throw invalid();
    return { start: e.start, expected: e.expected, replacement: e.replacement };
  });
  return {
    ...base,
    body: { kind: "partial", revision: body.revision, offset_encoding: "utf-8", edit_order: "sequential", edits },
  };
}
