import { registerHistory, takeHistory, peekHistory, trackHistoryRevision } from "./persistent-history";
import { WindowHistory } from "./window-history.ts";

type Entry = { revision: number; encoding: "utf8" | "utf16"; history: WindowHistory };
// Session-only: retain edited windows, not inactive editors or whole documents.
// Global cap complements the per-note history cap. Eviction never mutates a
// history still attached to the active editor; that editor can continue undoing.
const entries = new Map<string, Entry>();
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_NOTES = 16;
let session = 0;
export const nextHistorySession = () => ++session;
export function windowHistory(id: string, revision: number, encoding: Entry["encoding"]) {
  const old = entries.get(id);
  const restored = takeHistory(
    id.endsWith(":split") ? "split-window" : "window",
    id.replace(/:split$/, ""),
    revision,
  ) as { encoding: string; history: unknown } | undefined;
  const history =
    old?.revision === revision && old.encoding === encoding
      ? old.history
      : WindowHistory.restore(restoredHistory(restored, encoding));
  retainWindowHistory(id, revision, encoding, history);
  return history;
}
function restoredHistory(restored: { encoding: string; history: unknown } | undefined, encoding: string) {
  return restored?.encoding === encoding ? restored.history : undefined;
}
export function retainWindowHistory(id: string, revision: number, encoding: Entry["encoding"], history: WindowHistory) {
  entries.delete(id);
  if (history.byteSize <= MAX_BYTES) entries.set(id, { revision, encoding, history });
  let bytes = [...entries.values()].reduce((n, e) => n + e.history.byteSize, 0);
  while (entries.size > MAX_NOTES || bytes > MAX_BYTES) {
    const oldest = entries.keys().next().value!;
    bytes -= entries.get(oldest)!.history.byteSize;
    entries.delete(oldest);
  }
}
export function advanceWindowHistory(id: string, before: number, after: number) {
  trackHistoryRevision(id, before, after);
  const entry = entries.get(id);
  if (entry?.revision === before) entry.revision = after;
}
export function forgetWindowHistory(id: string) {
  entries.delete(id);
}

const snapshot = (id: string, revision: number) => {
  const e = entries.get(id);
  return e?.revision === revision ? { encoding: e.encoding, history: e.history.serialize() } : undefined;
};
registerHistory("window", snapshot);
registerHistory("split-window", (id, revision) => snapshot(id + ":split", revision));
/** Keep the range history accessible when a large note becomes small. */
export function hasWindowHistory(id: string, revision: number) {
  const entry = entries.get(id);
  if (entry?.revision === revision) return entry.history.canUndo || entry.history.canRedo;
  const restored = peekHistory("window", id, revision) as { encoding?: string; history?: unknown } | undefined;
  if (restored?.encoding !== "utf8" && restored?.encoding !== "utf16") return false;
  const history = WindowHistory.restore(restored.history);
  return history.canUndo || history.canRedo;
}
/** A small result can still undo into a large document. Keep byte-coordinate
 * history on the paged path instead of discarding it as a UTF-16 mismatch. */
export function needsPagedWindowHistory(id: string, revision: number) {
  const entry = entries.get(id);
  if (entry?.revision === revision)
    return entry.encoding === "utf8" && (entry.history.canUndo || entry.history.canRedo);
  const restored = peekHistory("window", id, revision) as { encoding?: string; history?: unknown } | undefined;
  if (restored?.encoding !== "utf8") return false;
  const history = WindowHistory.restore(restored.history);
  return history.canUndo || history.canRedo;
}
