import { Node, Schema, type SchemaSpec } from "@tiptap/pm/model";
import { EditorState, Selection } from "@tiptap/pm/state";
import { nativeBlockFormat, type BlockFormatOperation } from "../lib/native-block-format";

export interface NativeBlockRequest {
  schema: SchemaSpec;
  doc: ReturnType<Node["toJSON"]>;
  selection: ReturnType<Selection["toJSON"]>;
  operation: BlockFormatOperation;
}
export interface NativeBlockResult {
  doc: ReturnType<Node["toJSON"]>;
  selection: ReturnType<Selection["toJSON"]>;
  maps: number[][];
}

self.onmessage = (event: MessageEvent<NativeBlockRequest>) => {
  try {
    const { schema: spec, doc: json, selection, operation } = event.data;
    if (operation.kind !== "block") throw new Error("잘못된 문단 서식 명령입니다.");
    const schema = new Schema(spec),
      doc = Node.fromJSON(schema, json);
    const state = EditorState.create({ doc, selection: Selection.fromJSON(doc, selection) });
    const transaction = nativeBlockFormat(state, operation);
    const maps = transaction.mapping.maps.map((map, index) => {
      // Native block commands start with an empty mapping and never rebase.
      // Keep this explicit rather than silently losing mirror/recovery data.
      if (transaction.mapping.getMirror(index) !== undefined) throw new Error("지원하지 않는 문단 위치 계산입니다.");
      const ranges: number[] = [];
      map.forEach((from, to, afterFrom, afterTo) => ranges.push(from, to - from, afterTo - afterFrom));
      return ranges;
    });
    const result: NativeBlockResult = {
      doc: transaction.doc.toJSON(),
      selection: transaction.selection.toJSON(),
      maps,
    };
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "문단 서식 계산에 실패했습니다. 원문을 유지합니다.",
    });
  }
};
