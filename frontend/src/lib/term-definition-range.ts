import { getMarkRange } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Resolve only the contiguous occurrence at a position. IDs can repeat after
 * paste/import and must never be used to merge remote occurrences. */
export function termDefinitionRange(doc: PMNode, pos: number, id?: string) {
  const type=doc.type.schema.marks.termDefinition;
  if(!type || pos<0 || pos>doc.content.size)return undefined;
  const range=getMarkRange(doc.resolve(pos),type,id?{id}:undefined);
  if(!range)return undefined;
  const mark=doc.nodeAt(range.from)?.marks.find(mark=>mark.type===type && (!id || mark.attrs.id===id));
  return mark?{...range,mark}:undefined;
}
