import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection, TableMap, cellAround } from "@tiptap/pm/tables";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, Selection } from "@tiptap/pm/state";
import {
  Eye,
  Download,
  Image,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Pencil,
  Link2,
  List,
  CheckSquare,
  BracketsCurly,
  Table,
  ChevronsUpDown,
  FunctionIcon,
} from "../icons";
import type { LucideIcon } from "../icons";
import { api } from "../api";
import { attachmentURL, imageTypes } from "./attachment";
import { safeSrc } from "./media/shared";
import { videoKind } from "./media/video";
import { requestMath } from "./math";
import { pickFiles, type BlockContext, CALLOUT_STYLES } from "./block-items";
import { t } from "../i18n";

export interface BlockSpecificAction {
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<unknown>;
  checked?: boolean;
  info?: boolean;
  disabled?: boolean;
  section?: string;
  group?: "size" | "align";
}
type TableCommand =
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "mergeCells"
  | "splitCell"
  | "toggleHeaderRow"
  | "toggleHeaderColumn"
  | "toggleHeaderCell";
interface ActionContext {
  editor: Editor;
  pos: number;
  node: PMNode;
  type: string;
  a: PMNode["attrs"];
  actions: BlockSpecificAction[];
  valid: () => boolean;
  patch: (attrs: Record<string, unknown>) => void;
  add: (
    label: string,
    icon: LucideIcon,
    run: BlockSpecificAction["run"],
    checked?: boolean,
    group?: "size" | "align",
  ) => void;
  ask: (title: string, initial: string, label?: string) => ReturnType<BlockContext["prompt"]>;
}
const FILE_ACCEPT: Record<string, string> = { video: "video/*", audio: "audio/*", model3d: ".glb,.gltf" };
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,/i;

function blockMediaSource(type: string, a: PMNode["attrs"]): string {
  const imageSource = type === "image" ? String(a.src || "").replace(/\?preview=1$/, "") : "";
  if (type === "image" && attachmentURL.test(imageSource)) return imageSource;
  if (type === "attachment") return attachmentURL.test(a.url) ? a.url : "";
  return safeSrc(a.src) || (type === "image" && IMAGE_DATA_URL.test(a.src ?? "") ? a.src : "");
}

function addImageActions(ctx: ActionContext, src: string, preview: (src: string, alt: string) => void) {
  const { a, add, ask, patch } = ctx;
  if (src)
    add(t("이미지 미리보기"), Eye, () =>
      preview(attachmentURL.test(src) ? src + "?preview=1" : src, a.alt || a.name || a.title || t("이미지")),
    );
  add(t("이미지 설명 바꾸기"), Pencil, async () => {
    const r = await ask(t("이미지 설명"), a.alt || a.name || "");
    if (r) patch({ alt: r.value.slice(0, 1000) });
  });
  for (const width of [25, 50, 100])
    add(
      t("이미지 폭 {width}%", { width }),
      Image,
      () => patch({ displayWidth: width }),
      a.displayWidth === width,
      "size",
    );
  for (const [align, label, icon] of [
    ["left", t("왼쪽 정렬"), AlignLeft],
    ["center", t("가운데 정렬"), AlignCenter],
    ["right", t("오른쪽 정렬"), AlignRight],
  ] as const)
    add(label, icon, () => patch({ displayAlign: align }), (a.displayAlign || "center") === align, "align");
}

async function replaceBlockFile(ctx: ActionContext, image: boolean) {
  const { type, valid, patch } = ctx;
  const accept = image ? "image/png,image/jpeg,image/gif,image/webp" : (FILE_ACCEPT[type] ?? "");
  const [file] = await pickFiles(accept, false);
  if (!file || !valid()) return;
  if (image && !imageTypes.has(file.type)) throw new Error(t("PNG, JPEG, GIF, WebP 이미지를 골라 주세요."));
  const asset = await api.uploadAttachment(file, new AbortController().signal),
    url = "/api/attachments/" + asset.id;
  if (type === "attachment") {
    patch({ url, name: asset.name, size: asset.size, mediaType: asset.media_type });
    return;
  }
  patch({
    src: type === "image" ? url + "?preview=1" : url,
    title: asset.name,
    ...(type === "video" ? { kind: videoKind(url) } : {}),
  });
}

function downloadBlockFile(src: string, a: PMNode["attrs"]) {
  const link = document.createElement("a");
  link.href = src;
  link.download = a.name || a.title || "image";
  link.rel = "noopener";
  if (/^https?:/.test(src)) link.target = "_blank";
  link.click();
}

function addFileActions(ctx: ActionContext, image: boolean, src: string) {
  const { type, a, add, ask, patch } = ctx;
  if (["image", "attachment", "video", "audio", "model3d"].includes(type)) {
    add(image ? t("이미지 교체") : t("파일 교체"), Image, () => replaceBlockFile(ctx, image));
    if (src) add(image ? t("이미지 다운로드") : t("파일 다운로드"), Download, () => downloadBlockFile(src, a));
  }
  if (["video", "audio", "model3d", "embed"].includes(type)) {
    add(t("주소 바꾸기"), Link2, async () => {
      const r = await ask(t("주소 바꾸기"), a.src || "");
      if (!r) return;
      const url = safeSrc(r.value);
      if (!url || (type === "embed" && !/^https?:/.test(url)))
        throw new Error(t("올바른 http(s) 주소를 입력해 주세요."));
      patch({ src: url, ...(type === "video" ? { kind: videoKind(url) } : {}) });
    });
  }
  if (type === "attachment")
    add(t("파일 이름 바꾸기"), Pencil, async () => {
      const r = await ask(t("파일 이름"), a.name);
      if (r?.value.trim()) patch({ name: r.value.trim().slice(0, 200) });
    });
}

function addListActions(ctx: ActionContext) {
  const { type, a, add, ask, patch } = ctx;
  if (type !== "bulletList" && type !== "orderedList") return;
  const bullet = type === "bulletList";
  const styles = bullet
    ? [
        ["disc", t("채운 원")],
        ["circle", t("빈 원")],
        ["square", t("사각형")],
      ]
    : [
        ["decimal", t("숫자")],
        ["lower-alpha", t("소문자")],
        ["upper-alpha", t("대문자")],
        ["lower-roman", t("로마 숫자")],
      ];
  const current = a.listStyleType || (bullet ? "disc" : "decimal");
  for (const [value, label] of styles)
    add(
      t("목록 기호: {label}", { label }),
      List,
      () => patch({ listStyleType: value === "disc" || value === "decimal" ? null : value }),
      current === value,
    );
  if (type === "orderedList")
    add(t("시작 번호 바꾸기"), List, async () => {
      const r = await ask(t("시작 번호"), String(a.start || 1));
      if (!r) return;
      const n = Number(r.value);
      if (!Number.isSafeInteger(n) || n < 1 || n > 999999)
        throw new Error(t("1부터 999999 사이의 정수를 입력해 주세요."));
      patch({ start: n });
    });
}

function setAllTasks(ctx: ActionContext, checked: boolean) {
  const { editor, node, pos } = ctx;
  if (!ctx.valid()) return;
  const tr = closeHistory(editor.state.tr);
  node.descendants((child, offset) => {
    if (child.type.name === "taskItem") tr.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, checked });
  });
  editor.view.dispatch(tr);
}

function addCodeBlockActions(ctx: ActionContext) {
  const { a, add, ask, patch } = ctx;
  add(t("코드 언어 바꾸기"), BracketsCurly, async () => {
    const r = await ask(t("코드 언어"), a.language || "", t("언어 이름 (예: javascript)"));
    if (r) {
      const language = r.value.trim();
      if (language && !/^[a-zA-Z0-9_+#.-]{1,50}$/.test(language))
        throw new Error(t("언어 이름은 공백 없이 영문·숫자·기호(_ + # . -)로 입력해 주세요."));
      patch({ language: language || null });
    }
  });
  add(t("코드 자동 줄바꿈"), BracketsCurly, () => patch({ wrap: !a.wrap }), !!a.wrap);
}

function addCalloutActions(ctx: ActionContext) {
  const { a, add, ask, patch } = ctx;
  for (const value of Object.values(CALLOUT_STYLES)) {
    const { label, ...attrs } = value;
    add(t("강조 종류: {label}", { label }), CheckSquare, () => patch(attrs), a.icon === attrs.icon);
  }
  add(t("콜아웃 아이콘 바꾸기"), Pencil, async () => {
    const r = await ask(t("콜아웃 아이콘"), a.icon || "", t("아이콘"));
    if (r) patch({ icon: r.value.slice(0, 32) });
  });
}

function addSimpleBlockActions(ctx: ActionContext) {
  const { type, a, add, patch } = ctx;
  if (type === "taskList")
    for (const checked of [true, false])
      add(checked ? t("모두 완료") : t("모두 완료 해제"), CheckSquare, () => setAllTasks(ctx, checked));
  if (type === "details") add(a.open ? t("접기") : t("펼치기"), ChevronsUpDown, () => patch({ open: !a.open }));
  if (type === "codeBlock") addCodeBlockActions(ctx);
  if (type === "horizontalRule")
    for (const [value, label] of [
      [null, t("실선")],
      ["dashed", t("파선")],
      ["dotted", t("점선")],
    ] as const)
      add(
        t("가로줄: {label}", { label }),
        AlignLeft,
        () => patch({ ruleStyle: value }),
        (a.ruleStyle || null) === value,
      );
}

function addEditorBlockActions(ctx: ActionContext) {
  const { editor, pos, type, a, add, ask, patch } = ctx;
  if (type === "blockMath")
    add(t("수식 편집"), FunctionIcon, () => {
      if (ctx.valid()) requestMath(editor, { kind: "blockMath", pos });
    });
  if (type === "diagram")
    for (const mode of ["code", "preview"])
      add(
        mode === "code" ? t("도식 코드 편집") : t("도식 미리보기"),
        BracketsCurly,
        () => patch({ mode }),
        a.mode === mode,
      );
  if (type === "callout") addCalloutActions(ctx);
  if (type === "aiBlock")
    add(t("AI 요청 편집"), Pencil, async () => {
      const r = await ask(t("AI 요청"), a.prompt || "");
      if (r?.value.trim()) patch({ prompt: r.value.trim().slice(0, 2000), status: "empty" });
    });
}

function addTextActions(ctx: ActionContext) {
  const { type, a, add, patch } = ctx;
  if (["paragraph", "heading"].includes(type)) {
    for (const [value, label, icon] of [
      ["left", t("왼쪽 정렬"), AlignLeft],
      ["center", t("가운데 정렬"), AlignCenter],
      ["right", t("오른쪽 정렬"), AlignRight],
    ] as const)
      add(label, icon, () => patch({ textAlign: value }), (a.textAlign || "left") === value, "align");
  }
  if (type === "heading")
    for (const level of [1, 2, 3]) add(t("제목 {level}", { level }), Pencil, () => patch({ level }), a.level === level);
  if (["paragraph", "heading", "blockquote"].includes(type))
    for (const [dir, label] of [
      ["ltr", t("왼쪽에서 오른쪽")],
      ["rtl", t("오른쪽에서 왼쪽")],
    ])
      add(label, AlignLeft, () => patch({ dir }), (a.dir || "ltr") === dir);
}

async function renameDetailsSummary(ctx: ActionContext) {
  const { editor, node, pos } = ctx;
  const summary = node.firstChild;
  if (!summary) return;
  const r = await ctx.ask(t("접기 제목"), summary.textContent);
  if (!r || !ctx.valid()) return;
  editor.view.dispatch(
    closeHistory(editor.state.tr).replaceWith(
      pos + 2,
      pos + summary.nodeSize,
      r.value ? editor.schema.text(r.value) : [],
    ),
  );
}

function addTitleActions(ctx: ActionContext) {
  const { type, a, add, ask, patch } = ctx;
  if (["video", "audio", "model3d"].includes(type))
    add(t("설명 바꾸기"), Pencil, async () => {
      const r = await ask(t("미디어 설명"), a.title || "");
      if (r) patch({ title: r.value.trim().slice(0, 200) });
    });
  if (type === "details") add(t("접기 제목 바꾸기"), Pencil, () => renameDetailsSummary(ctx));
}

interface TableTarget {
  target: Selection;
  map: TableMap;
  cells: PMNode[];
}

function tableTarget(ctx: ActionContext, selection?: Selection) {
  const { editor, node, pos } = ctx;
  // Preserve an existing cell/range selection when opening the whole-block handle.
  const inside = selection && selection.from > pos && selection.to < pos + node.nodeSize;
  const target = inside ? selection : TextSelection.near(editor.state.doc.resolve(pos + 3));
  const map = TableMap.get(node);
  const cellPos =
    target instanceof CellSelection ? target.$anchorCell.pos : (cellAround(target.$from)?.pos ?? pos + 1 + map.map[0]);
  const headPos = target instanceof CellSelection ? target.$headCell.pos : cellPos;
  const rect = map.rectBetween(cellPos - pos - 1, headPos - pos - 1);
  const cells = map.cellsInRect(rect).map((offset) => node.nodeAt(offset)!);
  return { target, map, rect, cells };
}

function cellTextAligns(cells: PMNode[]) {
  return cells.flatMap((cell) => {
    const values: unknown[] = [];
    cell.descendants((n) => {
      if (n.type.name === "paragraph" || n.type.name === "heading") values.push(n.attrs.textAlign || "left");
    });
    return values;
  });
}

function addTableCellActions(ctx: ActionContext, { target, cells }: TableTarget) {
  const { editor, actions, valid } = ctx;
  const same = (key: string, value: unknown, fallback: unknown = null) =>
    cells.every((cell) => (cell.attrs[key] ?? fallback) === value);
  const paragraphs = cellTextAligns(cells);
  const select = () =>
    closeHistory(editor.state.tr).setSelection(Selection.fromJSON(editor.state.doc, target.toJSON()));
  const command = (label: string, name: TableCommand, section: string) => {
    const chain = editor
      .can()
      .chain()
      .command(({ tr }) => {
        tr.setSelection(Selection.fromJSON(editor.state.doc, target.toJSON()));
        return true;
      });
    actions.push({
      label,
      icon: Table,
      section,
      disabled: !chain[name]().run(),
      run: () => {
        if (!valid()) return;
        editor.view.dispatch(select());
        editor.chain().focus()[name]().run();
      },
    });
  };
  const onCells = (apply: () => void) => () => {
    if (valid()) {
      editor.view.dispatch(select());
      apply();
    }
  };
  command(t("위에 행 추가"), "addRowBefore", t("행"));
  command(t("아래에 행 추가"), "addRowAfter", t("행"));
  command(t("행 삭제"), "deleteRow", t("행"));
  command(t("왼쪽에 열 추가"), "addColumnBefore", t("열"));
  command(t("오른쪽에 열 추가"), "addColumnAfter", t("열"));
  command(t("열 삭제"), "deleteColumn", t("열"));
  command(t("셀 병합"), "mergeCells", t("선택한 셀"));
  command(t("셀 분할"), "splitCell", t("선택한 셀"));
  command(t("제목 셀 전환"), "toggleHeaderCell", t("선택한 셀"));
  for (const [value, label] of [
    ["top", t("위쪽")],
    ["middle", t("가운데")],
    ["bottom", t("아래쪽")],
  ])
    actions.push({
      label: t("셀 세로 정렬: {label}", { label }),
      icon: Table,
      section: t("선택한 셀"),
      checked: same("verticalAlign", value, "top"),
      run: onCells(() => editor.chain().focus().setCellAttribute("verticalAlign", value).run()),
    });
  for (const [value, label] of [
    [null, t("기본")],
    ["soft", t("회색")],
    ["success", t("초록")],
    ["warning", t("노랑")],
  ] as const)
    actions.push({
      label: t("셀 배경: {label}", { label }),
      icon: Table,
      section: t("선택한 셀"),
      checked: same("cellTone", value),
      run: onCells(() => editor.chain().focus().setCellAttribute("cellTone", value).run()),
    });
  for (const [value, label, icon] of [
    ["left", t("왼쪽"), AlignLeft],
    ["center", t("가운데"), AlignCenter],
    ["right", t("오른쪽"), AlignRight],
  ] as const)
    actions.push({
      label: t("셀 글자 정렬: {label}", { label }),
      icon,
      section: t("선택한 셀"),
      checked: paragraphs.length > 0 && paragraphs.every((v) => v === value),
      run: onCells(() => editor.chain().focus().setTextAlign(value).run()),
    });
}

function equalizeColumns(ctx: ActionContext, map: TableMap) {
  const { editor, node, pos } = ctx;
  if (!ctx.valid()) return;
  const dom = editor.view.nodeDOM(pos) as HTMLElement;
  const table = dom.matches("table") ? dom : dom.querySelector("table");
  const width = Math.max(25, Math.floor((table?.getBoundingClientRect().width || map.width * 100) / map.width));
  const tr = closeHistory(editor.state.tr);
  node.descendants((cell, offset) => {
    if (cell.type.name === "tableCell" || cell.type.name === "tableHeader")
      tr.setNodeMarkup(pos + 1 + offset, undefined, {
        ...cell.attrs,
        colwidth: new Array(cell.attrs.colspan || 1).fill(width),
      });
  });
  editor.view.dispatch(tr);
}

function addTableShapeActions(ctx: ActionContext, map: TableMap) {
  const { editor, pos, a, actions, patch } = ctx;
  actions.push({
    label: t("열 너비 균등 맞춤"),
    icon: Table,
    section: t("표 모양"),
    run: () => equalizeColumns(ctx, map),
  });
  // Headers always refer to the first row/column, independently of current cell.
  const firstCell = (run: () => boolean) => {
    if (ctx.valid()) {
      editor.view.dispatch(
        closeHistory(editor.state.tr).setSelection(TextSelection.near(editor.state.doc.resolve(pos + 3))),
      );
      run();
    }
  };
  actions.push(
    {
      label: t("첫 행을 제목 행으로"),
      icon: Table,
      section: t("표 모양"),
      run: () => firstCell(() => editor.commands.toggleHeaderRow()),
    },
    {
      label: t("첫 열을 제목 열로"),
      icon: Table,
      section: t("표 모양"),
      run: () => firstCell(() => editor.commands.toggleHeaderColumn()),
    },
  );
  for (const [value, label] of [
    [null, t("기본")],
    ["striped", t("줄무늬")],
    ["plain", t("간결하게")],
  ] as const)
    actions.push({
      label: t("표 스타일: {label}", { label }),
      icon: Table,
      section: t("표 모양"),
      checked: (a.tableStyle || null) === value,
      run: () => patch({ tableStyle: value }),
    });
}

function addTableActions(ctx: ActionContext, selection?: Selection) {
  const table = tableTarget(ctx, selection);
  const { rect, cells } = table;
  const range = (start: number, end: number) => (end === start + 1 ? `${end}` : `${start + 1}–${end}`);
  ctx.actions.push({
    label: t("{rows}행 · {cols}열 · {count}개 셀", {
      rows: range(rect.top, rect.bottom),
      cols: range(rect.left, rect.right),
      count: cells.length,
    }),
    icon: Table,
    info: true,
    run: () => {},
  });
  addTableCellActions(ctx, table);
  addTableShapeActions(ctx, table.map);
}

/** Work against the captured node, never a new selection after a dialog/upload. */
export function blockSpecificActions(
  editor: Editor,
  pos: number,
  node: PMNode,
  context: BlockContext,
  preview: (src: string, alt: string) => void,
  selection?: Selection,
): BlockSpecificAction[] {
  const actions: BlockSpecificAction[] = [],
    type = node.type.name,
    a = node.attrs;
  const valid = () => !editor.isDestroyed && editor.isEditable && editor.state.doc.nodeAt(pos) === node;
  const ctx: ActionContext = {
    editor,
    pos,
    node,
    type,
    a,
    actions,
    valid,
    patch: (attrs) => {
      if (!valid()) throw new Error(t("편집 중 블록이 바뀌어 적용하지 못했습니다. 해당 블록에서 다시 시도해 주세요."));
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...a, ...attrs }));
    },
    add: (label, icon, run, checked, group) => {
      actions.push({ label, icon, run, checked, group });
    },
    ask: async (title, initial, label = title) =>
      context.prompt({ title, message: "", label, initial, confirmLabel: t("적용") }),
  };
  const image = type === "image" || (type === "attachment" && imageTypes.has(a.mediaType));
  const src = blockMediaSource(type, a);
  if (image) addImageActions(ctx, src, preview);
  addFileActions(ctx, image, src);
  addListActions(ctx);
  addSimpleBlockActions(ctx);
  addEditorBlockActions(ctx);
  addTextActions(ctx);
  addTitleActions(ctx);
  if (type === "table") addTableActions(ctx, selection);
  return actions;
}
