import { DOMParser, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { DocumentSegment } from "../types";
import { SegmentModelBuilder } from "./segment-model";
import { inspectRichHTML } from "./rich-document";
import { sanitizeRichHtml } from "./sanitize";
import { renderSegment, projectSegmentEdges, ancestorElement } from "./rich-segment";
import { finishEditWork, type EditWork } from "./edit-work";
import { sourceSegmentWork } from "./source-segment-work";
import { t } from "../i18n";

const encoder = new TextEncoder();
export interface SourcePoint {
  byte: number;
  within: number;
}

/** Canonical editor HTML can be parsed as bounded templates. Unrecognized
 * clipboard markup retains the existing full HTML5/sanitizer import path. */
export function* parseBoundedRichSliceWork(html: string, schema: Schema): EditWork<Slice | null> {
  try {
    let inline = true,
      tags = 0;
    for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)) {
      if (!/^(strong|b|em|i|s|u|strike|del|a|mark|code|span|sub|sup|br)$/i.test(match[1])) {
        inline = false;
        break;
      }
      if (++tags % 64 === 0) yield;
    }
    const { doc } = yield* boundedModelWork(
      { ordinal: 0, byte_offset: 0, source: inline ? "<p>" + html + "</p>" : html, start_context: [], end_context: [] },
      schema,
    );
    return inline && doc.childCount === 1 ? new Slice(doc.firstChild!.content, 0, 0) : Slice.maxOpen(doc.content);
  } catch {
    return null;
  }
}

/** Parse source pieces of <=32KiB with their ancestor shells. Join immutable
 * PM ancestors rather than constructing a document-sized DOM. */
function* boundedModelWork(
  region: DocumentSegment,
  schema: Schema,
  admit: boolean | "generated" = true,
): EditWork<{ doc: PMNode; first: DocumentSegment; last: DocumentSegment }> {
  const parser = DOMParser.fromSchema(schema);
  const builder = new SegmentModelBuilder();
  let first: DocumentSegment | undefined, last: DocumentSegment | undefined;
  const pieces = region.source
    ? yield* sourceSegmentWork(region.source, region.byte_offset, region.start_context)
    : [{ ...region }];
  for (const piece of pieces) {
    const html = renderSegment(piece);
    if (admit === true && !inspectRichHTML(html).editable)
      throw new Error(t("편집 결과의 서식을 그대로 보존할 수 없습니다."));
    const template = document.createElement("template");
    template.innerHTML = html;
    // A partial table row has fewer visible cells than its fixed colgroup.
    // Schema round trips resize that colgroup, so inspect imported HTML only.
    // Generated model HTML must still survive sanitization without any loss.
    if (admit === "generated") {
      const safe = document.createElement("template");
      safe.innerHTML = sanitizeRichHtml(html);
      if (!template.content.isEqualNode(safe.content))
        throw new Error(t("편집 결과의 서식을 그대로 보존할 수 없습니다."));
    }
    yield* builder.append(parser.parse(template.content, { preserveWhitespace: "full" }), piece.start_context);
    first ??= piece;
    last = piece;
    yield;
  }
  const doc = yield* builder.finish();
  if (
    !doc ||
    !first ||
    last?.end_context.length !== region.end_context.length ||
    last.end_context.some((ancestor, index) => {
      const expected = region.end_context[index];
      if (
        ancestor.tag !== expected.tag ||
        (ancestor.open !== expected.open && !ancestorElement(ancestor).isEqualNode(ancestorElement(expected)))
      )
        return true;
      if ((ancestor.prelude ?? "") === (expected.prelude ?? "")) return false;
      const actual = document.createElement("template"),
        prior = document.createElement("template");
      actual.innerHTML = "<table>" + (ancestor.prelude ?? "") + "</table>";
      prior.innerHTML = "<table>" + (expected.prelude ?? "") + "</table>";
      return !actual.content.isEqualNode(prior.content);
    })
  )
    throw new Error(t("편집 결과의 내부 문맥이 일치하지 않습니다."));
  return { doc, first, last };
}

/** The supplied edited model is the transaction's serialized fragment.
 * Original source admission already happened in prepareSelection. */
export function projectModelSegment(region: DocumentSegment, edited: string, model: PMNode, points: SourcePoint[]) {
  return finishEditWork(projectModelSegmentWork(region, edited, model, points));
}
export function* projectModelSegmentWork(
  region: DocumentSegment,
  edited: string,
  model: PMNode,
  points: SourcePoint[],
): EditWork<{ replacement: string; points: SourcePoint[] }> {
  const complete: DocumentSegment = { ordinal: 0, byte_offset: 0, source: edited, start_context: [], end_context: [] };
  const checked = yield* boundedModelWork(complete, model.type.schema, "generated");
  if (!checked.doc.eq(model)) throw new Error(t("편집 모델을 그대로 직렬화하지 못했습니다."));
  const first = document.createElement("template"),
    last = document.createElement("template");
  first.innerHTML = renderSegment(checked.first);
  last.innerHTML = renderSegment(checked.last);
  // Alias tags must close/reopen their real outside tag. Borrowing <b> as a
  // generated <strong> across a split would leave mismatched source tokens.
  const edge = projectSegmentEdges(region, edited, first.content.firstChild, last.content.lastChild, false);
  const replacement = { ...region, source: edge.replacement };
  if (!(yield* boundedModelWork(replacement, model.type.schema, false)).doc.eq(model))
    throw new Error(t("이 구조 변경에는 더 넓은 편집 범위가 필요합니다. 원문을 유지했습니다."));
  const left = encoder.encode(edited.slice(0, edge.left)).length,
    right = encoder.encode(edited.slice(0, edge.right)).length;
  const prefix = encoder.encode(edge.closeOutside).length;
  return {
    replacement: edge.replacement,
    points: points.map((point) => ({
      byte: region.byte_offset + prefix + Math.max(0, Math.min(point.byte - left, right - left)),
      within: point.byte < left || point.byte > right ? 0 : point.within,
    })),
  };
}
