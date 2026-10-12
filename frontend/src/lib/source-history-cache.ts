import {
  registerHistory,
  takeHistory,
  trackHistoryRevision,
  setHistoryFormat,
  reportHistoryLimit,
} from "./persistent-history";
import { EditorState } from "@codemirror/state";
import { historyField } from "@codemirror/commands";

interface Handle {
  revision: number;
  value: unknown;
  bytes: number;
  active: boolean;
  valid: boolean;
  read?: () => EditorState;
  saved?: unknown;
  view?: boolean;
  identity?: string;
}
const entries = new Map<string, Handle>();
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_NOTES = 16;

/** Session-only CodeMirror history fields; no document, view or callbacks. */
export function acquireSourceHistory(id: string, revision: number, content?: string, format = "html") {
  setHistoryFormat(id, format);
  let entry = entries.get(id);
  // The same note id is shared by the HTML source and the Markdown view: history
  // recorded on another document (or before an edit elsewhere) never applies.
  if (
    entry?.revision !== revision ||
    entry.active ||
    (content !== undefined && entry.identity !== undefined && entry.identity !== identity(content))
  ) {
    if (entry) entry.valid = false;
    let value: unknown;
    const saved = takeHistory(
      id.endsWith(":split") ? "split-source" : "source",
      id.replace(/:split$/, ""),
      revision,
    ) as { history: unknown; identity: string } | undefined;
    try {
      if (saved && content !== undefined && saved.identity === identity(content))
        value = EditorState.fromJSON(
          { doc: content, selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 }, history: saved.history },
          { extensions: [historyField, EditorState.lineSeparator.of("\n")] },
          { history: historyField },
        ).field(historyField);
    } catch {}
    entry = { revision, value, bytes: 0, active: false, valid: true };
  }
  entries.delete(id);
  entries.set(id, entry);
  entry.active = true;
  const value = entry.value;
  entry.value = undefined;
  entry.bytes = 0;
  trim();
  return { handle: entry, value };
}
export function releaseSourceHistory(id: string, handle: Handle, state: EditorState) {
  if (!handle.valid || entries.get(id) !== handle) return;
  const value = state.field(historyField);
  // Serialize only the field through the public API using an empty document.
  // Calling state.toJSON directly would stringify the entire large note.
  const fieldOnly = EditorState.create({ extensions: [historyField.init(() => value)] });
  const bytes = historyBytes(fieldOnly.toJSON({ history: historyField }).history);
  handle.saved = serialize(state, handle.view, id);
  handle.identity = identity(state.doc.toString());
  handle.active = false;
  handle.read = undefined;
  handle.value = value;
  handle.bytes = bytes;
  trim();
}
function trim() {
  let bytes = [...entries.values()].reduce((sum, e) => sum + e.bytes, 0);
  for (const [id, entry] of entries) {
    if (entries.size <= MAX_NOTES && bytes <= MAX_BYTES) break;
    if (entry.active) continue;
    bytes -= entry.bytes;
    entry.valid = false;
    entries.delete(id);
  }
}
export function advanceSourceHistory(id: string, before: number, after: number) {
  trackHistoryRevision(id, before, after);
  const entry = entries.get(id);
  if (entry?.revision === before) entry.revision = after;
}
export function forgetSourceHistory(id: string) {
  const entry = entries.get(id);
  if (entry) entry.valid = false;
  entries.delete(id);
}

// Stop measuring at the cap without allocating one potentially huge JSON string.
function historyBytes(value: unknown): number {
  let bytes = 0;
  const visit = (item: unknown) => {
    if (bytes > MAX_BYTES) return;
    if (typeof item === "string") {
      bytes += item.length * 2 + 16;
      return;
    }
    bytes += 16;
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
        if (bytes > MAX_BYTES) break;
      }
    } else if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        bytes += key.length * 2;
        visit(child);
        if (bytes > MAX_BYTES) break;
      }
    }
  };
  visit(value);
  return bytes;
}

// Identity is only a stale-content guard, not authentication; DB revision is authoritative.
function identity(text: string) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return text.length + ":" + (a >>> 0) + ":" + (b >>> 0);
}
/** `view`: the editor shows a derived source (Markdown view of an HTML note); keep that source so a reload restores it. */
export function observeSourceHistory(handle: Handle, read: () => EditorState, view = false) {
  handle.read = read;
  handle.view = view;
}
function serialize(state: EditorState, view = false, id?: string) {
  const value = state.field(historyField);
  const history = EditorState.create({ extensions: [historyField.init(() => value)] }).toJSON({
    history: historyField,
  }).history;
  if (historyJSONBytes(history, 8 * 1024 * 1024 - 4096) > 8 * 1024 * 1024 - 4096) {
    if (id) reportHistoryLimit(id);
    return;
  }
  const document = state.doc.toString();
  return { history, identity: identity(document), ...(view && document.length <= 256 * 1024 ? { document } : {}) };
}
const snapshot = (id: string, revision: number) => {
  const entry = entries.get(id);
  if (!entry?.valid || entry.revision !== revision) return;
  return entry.active && entry.read ? serialize(entry.read(), entry.view, id) : entry.saved;
};

registerHistory("source", snapshot);
registerHistory("split-source", (id, revision) => snapshot(id + ":split", revision));

// Count encoded JSON bytes with early exit; avoid materializing a huge replaced
// source solely to discover that its undo delta exceeds the persistence budget.
function historyJSONBytes(value: unknown, limit: number): number {
  let bytes = 0;
  const string = (text: string) => {
    bytes += 2;
    for (let i = 0; i < text.length && bytes <= limit; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) bytes += 2;
      else if (c < 32) bytes += 6;
      else if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (
        c >= 0xd800 &&
        c <= 0xdbff &&
        i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        bytes += 4;
        i++;
      } else if (c >= 0xd800 && c <= 0xdfff) bytes += 6;
      else bytes += 3;
    }
  };
  const array = (v: unknown[]) => {
    bytes += 2;
    for (let i = 0; i < v.length && bytes <= limit; i++) {
      if (i) bytes++;
      visit(v[i] ?? null);
    }
  };
  const object = (v: object) => {
    bytes += 2;
    let first = true;
    for (const [key, child] of Object.entries(v)) {
      if (bytes > limit) break;
      if (child === undefined) continue;
      if (!first) bytes++;
      first = false;
      string(key);
      bytes++;
      visit(child);
    }
  };
  const visit = (v: unknown) => {
    if (bytes > limit) return;
    if (typeof v === "string") string(v);
    else if (Array.isArray(v)) array(v);
    else if (v && typeof v === "object") object(v);
    else bytes += JSON.stringify(v ?? null).length;
  };
  visit(value);
  return bytes;
}
