export interface BodySplice {
  start: number;
  expected: string;
  replacement: string;
}

/** One exact replacement; compute off the UI thread for long documents. */
export function bodySplice(before: string, after: string): BodySplice {
  let start = 0;
  const shared = Math.min(before.length, after.length);
  while (start < shared && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  // Do not split an astral character shared only by its high surrogate.
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  if (oldEnd < before.length && /[\uDC00-\uDFFF]/.test(before[oldEnd])) {
    oldEnd++;
    newEnd++;
  }
  return {
    start: new TextEncoder().encode(before.slice(0, start)).length,
    expected: before.slice(start, oldEnd),
    replacement: after.slice(start, newEnd),
  };
}

/** Provenance of an edit inside a loaded block window. Offsets never cross edits. */
export interface WindowBodyEdit {
  source: string;
  from: number;
  to: number;
  byteStart: number;
  html: string;
}

/** Use the cache's byte position when both snapshots belong to the same window. */
export function windowBodySplice(
  baseline: { content: string; windowEdit?: WindowBodyEdit },
  edit?: WindowBodyEdit,
): BodySplice | null {
  if (!edit) return null;
  if (baseline.content === edit.source) {
    return { start: edit.byteStart, expected: edit.source.slice(edit.from, edit.to), replacement: edit.html };
  }
  const prior = baseline.windowEdit;
  if (
    prior?.source === edit.source &&
    prior.from === edit.from &&
    prior.to === edit.to &&
    prior.byteStart === edit.byteStart
  ) {
    return { start: edit.byteStart, expected: prior.html, replacement: edit.html };
  }
  return null;
}
