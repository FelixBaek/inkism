import { registerHistory, takeHistory, trackHistoryRevision } from "./persistent-history";
import { history, undo, redo, closeHistory } from "@tiptap/pm/history";
import { EditorState, Plugin, Selection, type Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";

type Group = { back: unknown[]; forward: unknown[]; before: unknown; after: unknown };
type Saved = { done: string[]; undone: string[]; bytes: number };
type Handle = { revision: number; value?: Saved; active: boolean; valid: boolean; read?: () => EditorState };
const entries = new Map<string, Handle>();
const probe = history();
const NOTE_BYTES = 8 * 1024 * 1024,
  TOTAL_BYTES = 32 * 1024 * 1024,
  MAX_NOTES = 16;

export function acquireRichHistory(id: string, revision: number) {
  let entry = entries.get(id);
  if (entry?.revision !== revision || entry.active) {
    if (entry) entry.valid = false;
    entry = {
      revision,
      active: false,
      valid: true,
      value: takeHistory(id.endsWith(":split") ? "split-rich" : "rich", id.replace(/:split$/, ""), revision) as
        | Saved
        | undefined,
    };
  }
  entries.delete(id);
  entries.set(id, entry);
  entry.active = true;
  const value = entry.value;
  entry.value = undefined;
  trim();
  return { handle: entry, value };
}
export function advanceRichHistory(id: string, before: number, after: number) {
  trackHistoryRevision(id, before, after);
  const entry = entries.get(id);
  if (entry?.revision === before) entry.revision = after;
}
export function forgetRichHistory(id: string) {
  const entry = entries.get(id);
  if (entry) entry.valid = false;
  entries.delete(id);
}
export function releaseRichHistory(id: string, handle: Handle, state: EditorState) {
  if (!handle.valid || entries.get(id) !== handle) return;
  handle.active = false;
  handle.read = undefined;
  try {
    handle.value = capture(state);
  } catch {
    handle.value = undefined;
  }
  trim();
}
function trim() {
  let bytes = [...entries.values()].reduce((n, e) => n + (e.value?.bytes ?? 0), 0);
  for (const [id, e] of entries) {
    if (entries.size <= MAX_NOTES && bytes <= TOTAL_BYTES) break;
    if (e.active) continue;
    bytes -= e.value?.bytes ?? 0;
    e.valid = false;
    entries.delete(id);
  }
}

/** Read native history by running commands on an isolated immutable state.
 * Store schema-neutral steps, never an editor, plugin state or document snapshot.
 * Replaying public commands avoids depending on ProseMirror's private Branch shape.
 */
function capture(original: EditorState): Saved | undefined {
  const seed = original.reconfigure({ plugins: [probe] });
  let bytes = 0;
  const collect = (backwards: boolean) => {
    let state = seed;
    const groups: string[] = [];
    const command = backwards ? undo : redo;
    for (let i = 0; i < 200; i++) {
      let next: Transaction | undefined;
      if (
        !command(state, (tr) => {
          next = tr;
        })
      )
        return groups;
      const tr = next!;
      const forward = tr.steps.map((s) => s.toJSON());
      const backward = tr.steps.map((s, i) => s.invert(tr.docs[i]).toJSON()).reverse();
      const group: Group = backwards
        ? { back: forward, forward: backward, before: tr.selection.toJSON(), after: state.selection.toJSON() }
        : { back: backward, forward, before: state.selection.toJSON(), after: tr.selection.toJSON() };
      const encoded = JSON.stringify(group);
      bytes += encoded.length * 2;
      if (bytes > NOTE_BYTES) throw new Error("history cap");
      groups.push(encoded);
      state = state.apply(tr);
    }
    throw new Error("history group cap");
  };
  const done = collect(true),
    undone = collect(false);
  return done.length || undone.length ? { done, undone, bytes } : undefined;
}

/** Rebuild history against the NEW editor schema, including its redo branch. */
export function restoreRichHistory(original: EditorState, saved?: Saved): EditorState {
  if (!saved) return original;
  try {
    let state = EditorState.create({ doc: original.doc, selection: original.selection, plugins: [probe] });
    const apply = (encoded: string, forward: boolean, record: boolean) => {
      const group = JSON.parse(encoded) as Group;
      let tr = closeHistory(state.tr);
      for (const json of forward ? group.forward : group.back) tr = tr.step(Step.fromJSON(state.schema, json));
      tr.setSelection(Selection.fromJSON(tr.doc, forward ? group.after : group.before));
      if (!record) tr.setMeta("addToHistory", false);
      state = state.apply(tr);
    };
    for (const group of saved.done) apply(group, false, false);
    for (const group of [...saved.done].reverse()) apply(group, true, true);
    for (const group of saved.undone) apply(group, true, true);
    for (const _ of saved.undone) {
      if (
        !undo(state, (tr) => {
          state = state.apply(tr);
        })
      )
        return original;
    }
    if (!state.doc.eq(original.doc)) return original;
    state = state.apply(closeHistory(state.tr));
    const value = probe.getState(state);
    const plugins = original.plugins;
    const native = plugins.find((p) => p.spec.key === probe.spec.key);
    if (!native?.spec.state) return original;
    const restored = new Plugin({ ...native.spec, state: { ...native.spec.state, init: () => value } });
    // Remove the old field first: reconfigure preserves fields with the same key.
    return original
      .reconfigure({ plugins: plugins.filter((p) => p !== native) })
      .reconfigure({ plugins: plugins.map((p) => (p === native ? restored : p)) });
  } catch {
    return original;
  }
}

export function observeRichHistory(handle: Handle, read: () => EditorState) {
  handle.read = read;
}
const snapshot = (id: string, revision: number) => {
  const entry = entries.get(id);
  if (!entry?.valid || entry.revision !== revision) return;
  try {
    return entry.active && entry.read ? capture(entry.read()) : entry.value;
  } catch {
    return undefined;
  }
};

registerHistory("rich", snapshot);
registerHistory("split-rich", (id, revision) => snapshot(id + ":split", revision));
