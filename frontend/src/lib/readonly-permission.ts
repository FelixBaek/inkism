type Permission = { id: string; revision: number; readonly?: boolean; readonlyRevision?: number; trashed?: boolean };

/** A trashed note is locked for editing like a read-only one until restored. */
export const editLocked = (n: { readonly?: boolean; trashed?: boolean }) => Boolean(n.readonly || n.trashed);

/** Permission receipts can be newer than a dirty draft's saved body. Never
 * advance its body revision or let an older save response reopen editing. */
export function withReadonly<T extends Permission>(current: T, incoming: Permission): T {
  if (current.id !== incoming.id || incoming.revision < Math.max(current.revision, current.readonlyRevision ?? 0))
    return current;
  const readonly =
    incoming.readonly === undefined && incoming.trashed === undefined
      ? (current.readonly ?? false)
      : editLocked(incoming);
  if ((current.readonly ?? false) === readonly) {
    // Receipt bookkeeping alone must not invalidate an async editor snapshot.
    current.readonlyRevision = incoming.revision;
    return current;
  }
  return { ...current, readonly, readonlyRevision: incoming.revision };
}
