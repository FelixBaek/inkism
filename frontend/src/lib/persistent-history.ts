import { rpc } from "../api";
import { t } from "../i18n";
type Saved = { id: string; revision: number; kind: string; format?: string; value: unknown };
const restored = new Map<string, Saved>();
const providers = new Map<string, (id: string, revision: number) => unknown>();
const notes = new Map<string, number>();
const formats = new Map<string, string>();
export function setHistoryFormat(id: string, format: string) {
  const key = id.replace(/:split$/, "");
  formats.delete(key);
  formats.set(key, format);
  while (formats.size > 64) formats.delete(formats.keys().next().value!);
}
let writes = Promise.resolve();
export function reportHistoryLimit(id: string, total = false) {
  window.dispatchEvent?.(
    new CustomEvent("inkism-history-limit", {
      detail: {
        id: id.replace(/:split$/, ""),
        message: total
          ? t(
              "재시작 실행 취소의 전체 한도(16MiB)를 넘었습니다. 현재 편집기의 실행 취소와 저장된 버전 기록을 사용하세요.",
            )
          : t(
              "큰 편집으로 재시작 실행 취소 한도(8MiB)를 넘었습니다. 현재 편집기의 실행 취소와 저장된 버전 기록을 사용하세요.",
            ),
      },
    }),
  );
}
export function registerHistory(kind: string, provider: (id: string, revision: number) => unknown) {
  providers.set(kind, provider);
}
export function peekHistory(kind: string, id: string, revision: number) {
  const item = restored.get(kind + ":" + id);
  return item?.revision === revision && (item.format ?? "html") === (formats.get(id) ?? "html")
    ? item.value
    : undefined;
}
export function takeHistory(kind: string, id: string, revision: number): unknown {
  const key = kind + ":" + id,
    item = restored.get(key);
  restored.delete(key);
  return item?.revision === revision && (item.format ?? "html") === (formats.get(id) ?? "html")
    ? item.value
    : undefined;
}
let loading: Promise<void> | undefined;
export function loadHistories() {
  loading ??= (async () => {
    for (const item of await rpc<Saved[]>("editor_history_get")) {
      const key = item.kind + ":" + item.id;
      if (!restored.has(key)) restored.set(key, item);
      if (!formats.has(item.id)) formats.set(item.id, item.format ?? "html");
    }
  })().catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
export function persistHistory(id: string, revision: number): Promise<void> {
  notes.delete(id);
  notes.set(id, revision);
  while (notes.size > 16) notes.delete(notes.keys().next().value!);
  const format = formats.get(id) ?? "html";
  const values: Record<string, unknown> = {};
  let bytes = 0;
  for (const [kind, provider] of providers) {
    const value = provider(id, revision);
    if (value === undefined) continue;
    const encoded = JSON.stringify(value),
      size = new TextEncoder().encode(encoded).byteLength;
    // Leave envelope headroom below the 20 MiB JSONL transport budget.
    // An oversized undo group never prevents saving its canonical document.
    if (size > 8 * 1024 * 1024 - 4096 || bytes + size > 16 * 1024 * 1024 - 65536) {
      reportHistoryLimit(id, size <= 8 * 1024 * 1024 - 4096);
      continue;
    }
    values[kind] = JSON.parse(encoded);
    bytes += size;
  }
  // Immutable snapshot before another edit; ordered writes never replace newer state.
  const snapshot = structuredClone(values);
  const next = writes
    .catch(() => {})
    .then(() => rpc("editor_history_set", { id, revision, format, values: snapshot }))
    .then(() => {});
  writes = next;
  return next;
}
export function trackHistoryRevision(id: string, before: number, after: number) {
  if (notes.get(id) === before) notes.set(id, after);
}
export async function flushHistories() {
  // persistHistory가 notes를 고치므로 시작 시점 목록을 따로 떠 둔다.
  const snapshot = Array.from(notes);
  for (const [id, revision] of snapshot) await persistHistory(id, revision);
  await writes;
}
