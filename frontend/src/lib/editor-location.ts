import type { DocumentPoint, DocumentSelection } from "./document-selection";
/** Bounded local tab positions. Never retain bodies or mount inactive editors. */
export type Location = {
  revision: number;
  kind: "rich" | "windowed" | "source" | "markdown";
  offset: number;
  scrollTop?: number;
  selection?: Record<string, unknown>;
  documentSelection?: DocumentSelection;
};
const locations = new Map<string, Location>();
function cloneDocumentSelection(s: DocumentSelection | undefined): DocumentSelection | undefined {
  if (s?.kind === "all") return { kind: "all" };
  const valid = (p: DocumentPoint) =>
    p &&
    [p.block, p.position].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    ((p.byte === undefined && p.within === undefined) ||
      [p.byte, p.within].every((n) => Number.isSafeInteger(n) && Number(n) >= 0));
  const copy = (p: DocumentPoint): DocumentPoint => ({
    block: p.block,
    position: p.position,
    ...(p.byte === undefined ? {} : { byte: p.byte, within: p.within }),
  });
  if (s?.kind === "range" && valid(s.anchor) && valid(s.head))
    return { kind: "range", anchor: copy(s.anchor), head: copy(s.head) };
}
export function rememberLocation(id: string, location: Location) {
  locations.delete(id);
  locations.set(id, {
    ...location,
    selection: location.selection ? { ...location.selection } : undefined,
    documentSelection: location.kind === "windowed" ? cloneDocumentSelection(location.documentSelection) : undefined,
  });
  while (locations.size > 256) locations.delete(locations.keys().next().value!);
  window.dispatchEvent(new Event("inkism-location-changed"));
}
export function editorLocation(id: string, revision: number, kind: Location["kind"]) {
  const location = locations.get(id);
  return location?.revision === revision && location.kind === kind ? location : undefined;
}
export function advanceLocation(id: string, before: number, after: number) {
  const location = locations.get(id);
  if (location?.revision === before) rememberLocation(id, { ...location, revision: after });
}
export function forgetLocation(id: string) {
  if (locations.delete(id)) window.dispatchEvent(new Event("inkism-location-changed"));
}

export function preferredLocationMode(id: string) {
  switch (locations.get(id)?.kind) {
    case "rich":
    case "windowed":
      return "text";
    case "source":
      return "html";
    case "markdown":
      return "markdown";
    default:
      return undefined;
  }
}
type SavedSelection = Record<string, unknown>;
function sourceSelection(selection: SavedSelection): SavedSelection | undefined {
  const ranges = selection.ranges;
  return Array.isArray(ranges) && ranges.length <= 128
    ? { ranges: ranges.map((r) => ({ anchor: r.anchor, head: r.head })), main: selection.main }
    : undefined;
}
function richSelection(selection: SavedSelection): SavedSelection | undefined {
  const type = selection.type;
  if (type === "all") return { type };
  if (type === "node") return { type, anchor: selection.anchor };
  if (type === "text" || type === "cell") return { type, anchor: selection.anchor, head: selection.head };
  return undefined;
}
function windowedSelection(
  selection: SavedSelection,
  saved: SavedSelection,
  documentSelection: DocumentSelection | undefined,
): SavedSelection {
  const type = selection.type;
  for (const name of ["anchorByte", "anchorWithin", "headByte", "headWithin"]) {
    const value = selection[name];
    if (Number.isSafeInteger(value) && Number(value) >= 0) saved[name] = value;
  }
  if (
    (type === "text" || type === "node") &&
    documentSelection?.kind === "range" &&
    documentSelection.anchor.byte !== undefined &&
    documentSelection.head.byte !== undefined
  ) {
    // The strict workspace schema permits both byte endpoints only for
    // text/cell ranges. Preserve a whole canonical block, rather than
    // restoring a node that covers only its mounted source piece.
    if (type === "node") saved = { type: "text", anchor: selection.anchor, head: selection.head ?? selection.anchor };
    Object.assign(saved, {
      anchorByte: documentSelection.anchor.byte,
      anchorWithin: documentSelection.anchor.within,
      headByte: documentSelection.head.byte,
      headWithin: documentSelection.head.within,
    });
  }
  return saved;
}
export function snapshotLocations(ids: readonly string[]) {
  const result: Record<string, Location> = {};
  for (const id of ids) {
    const saved = locations.get(id);
    if (!saved) continue;
    const location = { ...saved };
    // The Rust workspace already persists byte endpoints for windowed ranges.
    // Keep the richer in-session object out of that strict wire schema.
    const documentSelection = location.documentSelection;
    delete location.documentSelection;
    // Unsupported extension selections must not prevent saving the workspace.
    const selection = location.selection;
    if (selection && (location.kind === "source" || location.kind === "markdown")) {
      location.selection = sourceSelection(selection);
    } else if (selection) {
      location.selection = richSelection(selection);
      if (location.kind === "windowed" && location.selection && selection.type !== "all")
        location.selection = windowedSelection(selection, location.selection, documentSelection);
    }
    result[id] = location;
  }
  return result;
}
export function restoreLocations(saved: Record<string, Location> | undefined) {
  if (!saved) return;
  for (const [id, location] of Object.entries(saved)) {
    // A slow workspace read must never overwrite newer interaction in this session.
    if (!locations.has(id)) rememberLocation(id, location);
  }
}
