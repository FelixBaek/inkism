import { bodySplice, type BodySplice } from "./body-splice";

interface Entry extends BodySplice {
  id: number;
}
export interface EditBatch {
  readonly revision: number;
  readonly edits: readonly Readonly<BodySplice>[];
}
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** Holds changed windows only. Coordinates are UTF-8 positions after preceding
 * entries. A frozen prefix can be saved while typing appends another suffix. */
export class PagedEditQueue {
  private entries: Entry[] = [];
  private nextId = 0;
  private generation = 0;
  private flight: { batch: EditBatch; through: number; bytes: number } | null = null;
  private savedBytes: number;
  private currentBytes: number;
  private currentRevision: number;
  constructor(revision: number, totalBytes: number) {
    if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(totalBytes) || totalBytes < 0)
      throw new Error("잘못된 문서 상태입니다.");
    this.currentRevision = revision;
    this.savedBytes = totalBytes;
    this.currentBytes = totalBytes;
  }
  get version() {
    return this.generation;
  }
  snapshot() {
    return {
      revision: this.currentRevision,
      edits: this.entries.map(({ start, expected, replacement }) => ({ start, expected, replacement })),
    };
  }
  get revision() {
    return this.currentRevision;
  }
  get totalBytes() {
    return this.currentBytes;
  }
  get dirty() {
    return this.entries.length > 0;
  }
  get saving() {
    return this.flight !== null;
  }
  append(edit: BodySplice) {
    const removed = byteLength(edit.expected),
      added = byteLength(edit.replacement);
    if (!Number.isSafeInteger(edit.start) || edit.start < 0 || edit.start + removed > this.currentBytes)
      throw new Error("편집 위치가 문서 범위를 벗어났습니다.");
    if (edit.expected === edit.replacement) return;
    const last = this.entries.at(-1);
    // An in-flight entry must remain unchanged until its exact acknowledgement.
    if (
      last &&
      last.id > (this.flight?.through ?? 0) &&
      last.start === edit.start &&
      last.replacement === edit.expected
    ) {
      const merged = { ...last, replacement: edit.replacement };
      if (merged.expected === merged.replacement) this.entries.pop();
      else this.entries[this.entries.length - 1] = merged;
    } else this.entries.push({ ...edit, id: ++this.nextId });
    this.currentBytes += added - removed;
    this.generation++;
  }
  begin(): EditBatch {
    if (this.flight) throw new Error("이전 구간 저장이 아직 진행 중입니다.");
    const prefix = this.entries.slice(0, 128);
    const edits = prefix.map((entry) => {
      // Shrink a window replacement on save, outside the editor input callback.
      const patch = bodySplice(entry.expected, entry.replacement);
      return Object.freeze({ ...patch, start: entry.start + patch.start });
    });
    const batch = Object.freeze({ revision: this.currentRevision, edits: Object.freeze(edits) });
    this.flight = {
      batch,
      through: prefix.at(-1)?.id ?? 0,
      bytes: this.savedBytes + prefix.reduce((sum, e) => sum + byteLength(e.replacement) - byteLength(e.expected), 0),
    };
    return batch;
  }
  acknowledge(batch: EditBatch, revision: number) {
    if (this.flight?.batch !== batch) throw new Error("현재 저장 요청과 다른 응답입니다.");
    if (revision !== batch.revision && revision !== batch.revision + 1) throw new Error("잘못된 저장 버전입니다.");
    this.entries = this.entries.filter((entry) => entry.id > this.flight!.through);
    this.savedBytes = this.flight.bytes;
    this.currentRevision = revision;
    this.flight = null;
  }
  metadataRevision(expected: number, revision: number) {
    if (this.currentRevision !== expected || (revision !== expected && revision !== expected + 1))
      throw new Error("문서 버전이 변경되었습니다.");
    this.currentRevision = revision;
  }
  failed(batch: EditBatch) {
    if (this.flight?.batch !== batch) throw new Error("현재 저장 요청과 다른 응답입니다.");
    this.flight = null;
    const compact: Entry[] = [];
    for (const entry of this.entries) {
      const last = compact.at(-1);
      if (last?.start === entry.start && last.replacement === entry.expected) {
        compact.pop();
        if (last.expected !== entry.replacement) compact.push({ ...entry, expected: last.expected });
      } else compact.push(entry);
    }
    this.entries = compact;
  }
}
