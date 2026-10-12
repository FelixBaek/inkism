import { t } from "../i18n";
import NativeBlockWorker from "../workers/native-block-format.worker?worker";
import { Node, type AttributeSpec, type MarkSpec, type NodeSpec, type Schema, type SchemaSpec } from "@tiptap/pm/model";
import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, StepMap } from "@tiptap/pm/transform";
import type { BlockFormatOperation } from "./native-block-format";
import type { NativeBlockRequest, NativeBlockResult } from "../workers/native-block-format.worker";

export type BlockTransform = Pick<Transaction, "doc" | "selection" | "mapping">;
const snapshots = new WeakMap<Schema, SchemaSpec>();

function schemaSnapshot(schema: Schema): SchemaSpec {
  const cached = snapshots.get(schema);
  if (cached) return cached;
  const attrs = (input: Record<string, AttributeSpec> | undefined) => {
    if (!input) return undefined;
    return Object.fromEntries(
      Object.entries(input).map(([name, value]) => {
        const copy: AttributeSpec = {};
        if ("default" in value) copy.default = structuredClone(value.default);
        // Functions cannot cross the worker boundary. The input is already a
        // valid editor model; the result is checked against these original
        // validators on the main thread before projection or persistence.
        if (typeof value.validate === "string") copy.validate = value.validate;
        return [name, copy];
      }),
    );
  };
  const nodes: Record<string, NodeSpec> = {},
    marks: Record<string, MarkSpec> = {};
  schema.spec.nodes.forEach((name, spec) => {
    const copy: NodeSpec = { attrs: attrs(spec.attrs) };
    for (const key of [
      "content",
      "marks",
      "group",
      "inline",
      "atom",
      "selectable",
      "draggable",
      "code",
      "whitespace",
      "definingAsContext",
      "definingForContent",
      "defining",
      "isolating",
      "linebreakReplacement",
    ])
      if (spec[key] !== undefined) copy[key] = spec[key];
    nodes[name] = copy;
  });
  schema.spec.marks.forEach((name, spec) => {
    const copy: MarkSpec = { attrs: attrs(spec.attrs) };
    for (const key of ["inclusive", "excludes", "group", "spanning", "code"])
      if (spec[key] !== undefined) copy[key] = spec[key];
    marks[name] = copy;
  });
  const result: SchemaSpec = { nodes, marks, topNode: schema.spec.topNode };
  snapshots.set(schema, result);
  return result;
}

/** Never replay the steps on the UI thread: that repeats the expensive native
 * transform. Reconstitute the immutable result and its original position maps. */
export function formatBlocksInWorker(
  state: EditorState,
  operation: BlockFormatOperation,
  check: () => void,
): Promise<BlockTransform> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      poll: ReturnType<typeof setInterval> | undefined,
      done = false;
    const finish = () => {
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      worker?.terminate();
    };
    const fail = (error: unknown) => {
      if (done) return;
      finish();
      reject(error);
    };
    try {
      check();
      const request: NativeBlockRequest = {
        schema: schemaSnapshot(state.schema),
        doc: state.doc.toJSON(),
        selection: state.selection.toJSON(),
        operation,
      };
      check();
      worker = new NativeBlockWorker();
      timer = setTimeout(() => fail(new Error(t("문단 서식 계산이 지연되었습니다. 입력과 원문을 유지합니다."))), 30000);
      poll = setInterval(() => {
        try {
          check();
        } catch (error) {
          fail(error);
        }
      }, 8);
      worker.onerror = () => fail(new Error(t("문단 서식 계산을 시작하지 못했습니다. 입력과 원문을 유지합니다.")));
      worker.onmessageerror = () => fail(new Error(t("문단 서식 결과를 읽지 못했습니다. 입력과 원문을 유지합니다.")));
      worker.onmessage = (event: MessageEvent<NativeBlockResult & { error?: string }>) => {
        if (done) return;
        try {
          check();
          if (event.data.error) throw new Error(t(event.data.error));
          const { doc: json, selection: selectionJSON, maps } = event.data;
          if (!Array.isArray(maps)) throw new Error(t("잘못된 문단 위치 계산 결과입니다."));
          const doc = Node.fromJSON(state.schema, json);
          doc.check();
          const selection = Selection.fromJSON(doc, selectionJSON);
          const mapping = new Mapping(
            maps.map((ranges) => {
              if (!Array.isArray(ranges) || ranges.length % 3 || ranges.some((n) => !Number.isSafeInteger(n) || n < 0))
                throw new Error(t("잘못된 문단 위치 계산 범위입니다."));
              return new StepMap(ranges);
            }),
          );
          check();
          finish();
          resolve({ doc, selection, mapping });
        } catch (error) {
          fail(error);
        }
      };
      worker.postMessage(request);
    } catch (error) {
      fail(error);
    }
  });
}
