import { CommandManager, commands, Node as ExtensionNode, isNodeActive, type Editor } from "@tiptap/core";
import { AllSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export type BlockFormatOperation =
  | { kind: "block"; type: "paragraph" }
  | { kind: "block"; type: "heading"; level: 1 | 2 | 3; toggle: boolean }
  | { kind: "block"; type: "bulletList" | "orderedList" | "taskList" | "blockquote" }
  | { kind: "block"; type: "codeBlock"; language?: string | null };

const structuralCommands = {
  command: commands.command,
  toggleList: commands.toggleList,
  wrapInList: commands.wrapInList,
  liftListItem: commands.liftListItem,
  clearNodes: commands.clearNodes,
  toggleWrap: commands.toggleWrap,
  lift: commands.lift,
  wrapIn: commands.wrapIn,
  toggleNode: commands.toggleNode,
  setNode: commands.setNode,
};

export function normalizeBlockquoteSelection(transaction: Transaction) {
  const { doc, selection } = transaction;
  if (selection instanceof AllSelection && doc.childCount === 1 && doc.firstChild!.type.name === "blockquote")
    transaction.setSelection(TextSelection.between(doc.resolve(1), doc.resolve(doc.content.size - 1)));
}

type StructureOperation = Exclude<BlockFormatOperation, { type: "paragraph" | "heading" | "codeBlock" }>;
function structureCommand(operation: StructureOperation) {
  if (operation.type === "blockquote") return commands.toggleWrap("blockquote");
  return commands.toggleList(operation.type, operation.type === "taskList" ? "taskItem" : "listItem", false);
}

function nativeStructure(state: EditorState, operation: StructureOperation): Transaction {
  // These bundled Tiptap commands only need the immutable model and the list
  // groups. A custom-state CommandManager never constructs or dispatches a view.
  const extensions = Object.values(state.schema.nodes)
    .filter((node) => node.isInGroup("list"))
    .map((node) => ExtensionNode.create({ name: node.name, group: node.spec.group }));
  const host = {
    extensionManager: { commands: structuralCommands, extensions, splittableMarks: [] },
  } as unknown as Editor;
  const manager = new CommandManager({ editor: host, state }),
    transaction = state.tr;
  if (operation.type === "blockquote") normalizeBlockquoteSelection(transaction);
  const props = manager.buildProps(transaction);
  const operationCommand = structureCommand(operation);
  if (!operationCommand(props))
    throw new Error("이 선택 범위의 구조를 보존하며 서식을 변경할 수 없습니다. 원문을 유지합니다.");
  return transaction;
}

/** One native command, shared by the synchronous model and the worker. */
export function nativeBlockFormat(state: EditorState, operation: BlockFormatOperation): Transaction {
  if (operation.type !== "paragraph" && operation.type !== "heading" && operation.type !== "codeBlock")
    return nativeStructure(state, operation);
  const formatAttrs = operation.type === "heading" ? { level: operation.level }
    : operation.type === "codeBlock" && operation.language !== undefined ? { language: operation.language }
    : undefined;
  const paragraph = operation.type === "paragraph" ||
    ((operation.type === "codeBlock" || operation.toggle) && isNodeActive(state, operation.type, formatAttrs));
  const type = state.schema.nodes[paragraph ? "paragraph" : operation.type];
  const attrs = paragraph ? undefined : formatAttrs;
  const transaction = state.tr;
  if (!type) throw new Error("이 선택 범위의 문단 구조를 보존하며 서식을 변경할 수 없습니다. 원문을 유지합니다.");
  if (!isNodeActive(state, type, attrs)) {
    // A format change keeps each source block's identity and shared attributes.
    // Passing one attrs object would reset every id to the schema default.
    for (const range of state.selection.ranges)
      transaction.setBlockType(range.$from.pos, range.$to.pos, type, node => ({ ...node.attrs, ...attrs }));
    if (!transaction.docChanged)
      throw new Error("이 선택 범위의 문단 구조를 보존하며 서식을 변경할 수 없습니다. 원문을 유지합니다.");
  }
  return transaction;
}
