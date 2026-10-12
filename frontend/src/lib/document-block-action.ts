import {cloneHTMLIdentity} from "./block-identity";
import { Selection, NodeSelection } from "@tiptap/pm/state";
import type { DocumentBlockPage, DocumentSegment } from "../types";
import type { BlockAction } from "../components/BlockTools";
import type { WindowPreview } from "./window-history";
import { inspectRichHTML } from "./rich-document";
import { renderSegment } from "./rich-segment";
import { segmentPositionMap } from "./segment-selection";
import type { BodySplice } from "./body-splice";
import { t } from "../i18n";

/** Destination is a gap in the original block list, before removing the source. */
export type BlockCommand = BlockAction | { kind: "move"; destination: number };

interface Chunk {
  ready: boolean;
  ordinal: number;
  block_byte_offset: number;
  offset: number;
  source: string | null;
  total_bytes: number;
  next_offset: number | null;
}
interface Source {
  read(ordinal: number): Promise<DocumentBlockPage>;
  chunk(ordinal: number, offset: number): Promise<Chunk>;
  segments(
    ordinal: number,
  ): Promise<{ ready: boolean; supported?: boolean; total_segments: number | null; segments: DocumentSegment[] }>;
  check(): void;
}
interface Block {
  ordinal: number;
  start: number;
  bytes: number;
  source: string;
  large: boolean;
}
const encoder = new TextEncoder();

type Ready = <T extends { ready: boolean }>(read: () => Promise<T>) => Promise<T>;
type ReadBlock = (index: number) => Promise<Block>;
type OversizedMetadata = NonNullable<DocumentBlockPage["oversized"]>;

function readyReader(source: Source, deadline: number): Ready {
  return async function ready<T extends { ready: boolean }>(read: () => Promise<T>) {
    source.check();
    let value = await read();
    while (!value.ready && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      source.check();
      value = await read();
    }
    source.check();
    if (!value.ready) throw new Error(t("블록 원문을 준비하지 못했습니다."));
    return value;
  };
}

function checkChunk(chunk: Chunk, index: number, offset: number, metadata: OversizedMetadata) {
  if (
    chunk.ordinal !== index ||
    chunk.block_byte_offset !== metadata.byte_offset ||
    chunk.total_bytes !== metadata.byte_count ||
    chunk.offset !== offset ||
    chunk.source === null
  )
    throw new Error(t("블록 원문 경계가 변경되었습니다."));
}

async function readOversizedBlock(
  source: Source,
  ready: Ready,
  page: DocumentBlockPage,
  index: number,
): Promise<Block> {
  const metadata = page.oversized;
  if (!metadata || page.blocks.length || metadata.ordinal !== index)
    throw new Error(t("블록 원문 정보가 일치하지 않습니다."));
  const chunks: string[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await ready(() => source.chunk(index, offset));
    checkChunk(chunk, index, offset, metadata);
    const text = chunk.source!;
    const size = encoder.encode(text).length;
    if (size > 65536 || !size) throw new Error(t("블록 원문을 제한된 구간으로 읽지 못했습니다."));
    chunks.push(text);
    offset += size;
    if (chunk.next_offset === null) {
      if (offset !== metadata.byte_count) throw new Error(t("블록 원문이 잘렸습니다."));
      break;
    }
    if (chunk.next_offset !== offset || offset >= metadata.byte_count)
      throw new Error(t("블록 원문 순서가 일치하지 않습니다."));
  }
  return {
    ordinal: index,
    start: metadata.byte_offset,
    bytes: metadata.byte_count,
    source: chunks.join(""),
    large: true,
  };
}

function blockReader(source: Source, ready: Ready, total: number): ReadBlock {
  const cache = new Map<number, Block>();
  return async (index) => {
    if (cache.has(index)) return cache.get(index)!;
    const page = await ready(() => source.read(index));
    if (page.total_blocks !== total) throw new Error(t("문서 블록 수가 변경되었습니다."));
    let result: Block;
    if (page.oversized_block) {
      result = await readOversizedBlock(source, ready, page, index);
    } else {
      const block = page.blocks[0];
      if (page.blocks.length !== 1 || block?.ordinal !== index) throw new Error(t("블록 원문을 찾지 못했습니다."));
      result = {
        ordinal: index,
        start: block.byte_offset,
        bytes: encoder.encode(block.html).length,
        source: block.html,
        large: false,
      };
    }
    source.check();
    cache.set(index, result);
    return result;
  };
}

function capturedPreview(captured: WindowPreview, block: Block, offset: number, start: number): WindowPreview {
  const shift = start - block.start;
  return {
    ...captured,
    offset,
    byteStart: (captured.byteStart ?? block.start) + shift,
    internal: captured.internal
      ? { ...captured.internal, byte_offset: captured.internal.byte_offset + shift }
      : undefined,
  };
}

async function blockPreview(
  source: Source,
  ready: Ready,
  block: Block,
  offset: number,
  start: number,
): Promise<WindowPreview> {
  let raw = block.source,
    internal: WindowPreview["internal"];
  if (block.large) {
    const page = await ready(() => source.segments(block.ordinal)),
      segment = page.segments[0];
    if (
      !page.supported ||
      !segment ||
      !page.total_segments ||
      segment.ordinal !== 0 ||
      segment.byte_offset !== block.start
    )
      throw new Error(t("블록 표시 구간을 준비하지 못했습니다. 원문을 유지합니다."));
    const { source: part, ...context } = segment;
    raw = part;
    internal = { ...context, byte_offset: start, total: page.total_segments };
  }
  const rendered = internal ? renderSegment({ ...internal, source: raw }) : raw,
    inspection = inspectRichHTML(rendered);
  if (!inspection.editable || inspection.blocks !== 1)
    throw new Error(t("블록 표시 서식을 보존하지 못했습니다. 원문을 유지합니다."));
  return { html: inspection.content, count: 1, raw, offset, byteStart: start, internal };
}

interface ActionPlan {
  start: number;
  offset: number;
  expected: string;
  replacement: string;
  beforeCount: number;
  afterCount: number;
  chosen: Block;
  chosenOrdinal: number;
  chosenStart: number;
  edits?: BodySplice[];
}

async function planMove(
  read: ReadBlock,
  target: Block,
  ordinal: number,
  total: number,
  destination: number,
): Promise<ActionPlan> {
  if (
    !Number.isSafeInteger(destination) ||
    destination < 0 ||
    destination > total ||
    destination === ordinal ||
    destination === ordinal + 1
  )
    throw new Error(t("블록 이동 위치가 변경되었습니다."));
  const boundary = await read(Math.min(destination, total - 1));
  const byte = destination === total ? boundary.start + boundary.bytes : boundary.start;
  const chosenStart = byte - (destination > ordinal ? target.bytes : 0);
  return {
    start: target.start,
    offset: ordinal,
    expected: target.source,
    // Two exact splices never read or record all intervening blocks.
    replacement: target.source,
    beforeCount: 1,
    afterCount: 1,
    chosen: target,
    chosenOrdinal: destination > ordinal ? destination - 1 : destination,
    chosenStart,
    edits: [
      { start: target.start, expected: target.source, replacement: "" },
      { start: chosenStart, expected: "", replacement: target.source },
    ],
  };
}

async function planSwap(read: ReadBlock, target: Block, ordinal: number, up: boolean): Promise<ActionPlan> {
  const adjacent = await read(ordinal + (up ? -1 : 1));
  const base = { beforeCount: 2, afterCount: 2, chosen: target };
  if (up) {
    if (adjacent.start + adjacent.bytes !== target.start) throw new Error(t("인접 블록 원문이 이어지지 않습니다."));
    return {
      ...base,
      start: adjacent.start,
      offset: adjacent.ordinal,
      expected: adjacent.source + target.source,
      replacement: target.source + adjacent.source,
      chosenOrdinal: ordinal - 1,
      chosenStart: adjacent.start,
    };
  }
  if (target.start + target.bytes !== adjacent.start) throw new Error(t("인접 블록 원문이 이어지지 않습니다."));
  return {
    ...base,
    start: target.start,
    offset: ordinal,
    expected: target.source + adjacent.source,
    replacement: adjacent.source + target.source,
    chosenOrdinal: ordinal + 1,
    chosenStart: target.start + adjacent.bytes,
  };
}

async function planInPlace(
  read: ReadBlock,
  target: Block,
  ordinal: number,
  total: number,
  action: "duplicate" | "insert" | "delete",
): Promise<ActionPlan> {
  const plan: ActionPlan = {
    start: target.start,
    offset: ordinal,
    expected: target.source,
    replacement: "",
    beforeCount: 1,
    afterCount: 1,
    chosen: target,
    chosenOrdinal: ordinal,
    chosenStart: target.start,
  };
  if (action === "duplicate") {
    const cloned=cloneHTMLIdentity(target.source);
    // Segment offsets/ancestor context belong to the original source. Do not
    // reuse that context after changing IDs in a single oversized block.
    if(target.large && cloned!==target.source)throw new Error(t("문단 ID가 있는 대형 블록은 나눈 뒤 복제해 주세요."));
    plan.replacement = target.source + cloned;
    if(cloned!==target.source)plan.chosen = {...target,source:cloned,bytes:encoder.encode(cloned).length};
    plan.afterCount = 2;
    plan.chosenOrdinal++;
    plan.chosenStart += target.bytes;
  } else if (action === "insert") {
    plan.replacement = target.source + "<p></p>";
    plan.afterCount = 2;
    plan.chosenOrdinal++;
    plan.chosenStart += target.bytes;
    plan.chosen = { ordinal: -1, start: plan.chosenStart, bytes: 7, source: "<p></p>", large: false };
  } else if (total === 1) {
    plan.replacement = "<p></p>";
    plan.chosen = { ordinal: -1, start: 0, bytes: 7, source: plan.replacement, large: false };
  } else {
    plan.afterCount = 0;
    plan.chosenOrdinal = Math.min(ordinal, total - 2);
    plan.chosen = await read(ordinal + 1 < total ? ordinal + 1 : ordinal - 1);
    plan.chosenStart = ordinal + 1 < total ? target.start : plan.chosen.start;
  }
  return plan;
}

/** Explicit whole-block commands read only their affected blocks. No complete
 * note or full-sized editable DOM model is needed, including for raw neighbours. */
export async function prepareBlockAction(
  source: Source,
  ordinal: number,
  total: number,
  action: BlockCommand,
  captured?: WindowPreview,
) {
  const ready = readyReader(source, Date.now() + 60000);
  const read = blockReader(source, ready, total);
  const preview = (block: Block, offset: number, start: number, useCaptured: boolean) =>
    useCaptured && captured
      ? Promise.resolve(capturedPreview(captured, block, offset, start))
      : blockPreview(source, ready, block, offset, start);
  const target = await read(ordinal),
    beforePreview = await preview(target, ordinal, target.start, true);
  let plan: ActionPlan;
  if (typeof action !== "string") plan = await planMove(read, target, ordinal, total, action.destination);
  else if (action === "up" || action === "down") plan = await planSwap(read, target, ordinal, action === "up");
  else plan = await planInPlace(read, target, ordinal, total, action);
  const { start, offset, expected, replacement, edits, beforeCount, afterCount, chosen, chosenOrdinal, chosenStart } =
    plan;
  const afterPreview = await preview(chosen, chosenOrdinal, chosenStart, chosen === target);
  const model = segmentPositionMap({
    ordinal: 0,
    byte_offset: afterPreview.byteStart!,
    source: afterPreview.raw!,
    start_context: afterPreview.internal?.start_context ?? [],
    end_context: afterPreview.internal?.end_context ?? [],
  }).doc();
  const selected =
    action === "delete" || action === "insert" ? Selection.atStart(model) : NodeSelection.create(model, 0);
  source.check();
  return {
    start,
    offset,
    expected,
    replacement,
    edits,
    beforeCount,
    afterCount,
    beforePreview,
    afterPreview,
    selection: selected.toJSON(),
    selectedBlock: { ordinal: chosenOrdinal, start: chosenStart, end: chosenStart + chosen.bytes },
    originalBlock: { ordinal, start: target.start, end: target.start + target.bytes },
    selectsBlock: action !== "delete" && action !== "insert",
  };
}
