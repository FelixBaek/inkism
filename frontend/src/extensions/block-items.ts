import {CSV_EDIT_EVENT,CSV_MAX_BYTES} from "../lib/csv-tools";
/**
 * 블록 넣기 항목 목록 — 블록 손잡이의 [+] 메뉴와 "/" 메뉴가 같은 목록을 쓴다.
 * Figma BlockMenu (블록 넣기) 27:3903 · BlockActionMenu 49:6961 기준.
 *
 * run()은 "현재 커서가 있는 문단"을 원하는 블록으로 바꾸거나, 그 자리에 블록을 넣는다.
 * 호출하는 쪽이 먼저 커서를 놓는다: "/"는 입력한 "/검색어"를 지우고, [+]는 손잡이
 * 블록 아래에 빈 문단을 만든다.
 */
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { requestMath } from "./math";
import { imageTypes } from "./attachment";
import { api } from "../api";
import { t } from "../i18n";
import { parseCsv } from "../lib/csv";
import { safeSrc } from "./media/shared";
import { videoKind } from "./media/video";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  CheckSquare,
  List,
  ListOrdered,
  Quote,
  ChevronsUpDown,
  BracketsCurly,
  Minus,
  Sparkle,
  MessageSquare,
  Table,
  FunctionIcon,
  Smiley,
  TreeStructure,
  Image,
  VideoCamera,
  Waveform,
  Cube,
  Paperclip,
  FrameCorners,
  Upload,
  GlobeSimple,
  FileCsv,
  YoutubeLogo,
  Microphone,
} from "../icons";
import type { LucideIcon } from "../icons";

export interface BlockContext {
  prompt: (o: {
    title: string;
    message: string;
    label: string;
    initial?: string;
    placeholder?: string;
    confirmLabel?: string;
  }) => Promise<{ value: string } | null>;
  showError: (title: string, message: string) => unknown;
}
const contexts = new WeakMap<Editor, BlockContext>();
/** BlockTools가 편집기마다 대화상자 기능을 등록한다 ("/" 메뉴는 별도 React 루트라 store를 못 쓴다). */
export function setBlockContext(editor: Editor, context: BlockContext | null) {
  if (context) contexts.set(editor, context);
  else contexts.delete(editor);
}

export type SubmenuKind = "callout" | "table" | "image" | "video" | "audio";
export interface RunOptions {
  choice?: string;
  rows?: number;
  cols?: number;
}
export interface BlockItem {
  id: string;
  label: string;
  group: "기본" | "AI" | "자주 쓰는 것" | "미디어";
  icon: LucideIcon;
  /** Figma Content 색 변수 (BlockMenu.css의 --text-color-*, --highlight-*) */
  color: string;
  hint?: string;
  keywords: string;
  submenu?: SubmenuKind;
  run: (editor: Editor, options?: RunOptions) => void | Promise<void>;
  available: (editor: Editor) => boolean;
}
export interface SubmenuEntry {
  id: string;
  label: string;
  icon?: LucideIcon;
}

const hasNode = (name: string) => (editor: Editor) => Boolean(editor.schema.nodes[name]);
const always = () => true;
type AnyCommand = (args?: unknown) => boolean;
const command = (editor: Editor, name: string) =>
  (editor.commands as unknown as Record<string, AnyCommand | undefined>)[name];
const hasCommand = (name: string) => (editor: Editor) => typeof command(editor, name) === "function";
/** 다른 작업에서 추가하는 블록(insertVideo 등). 없으면 메뉴에서 "준비 중"으로 비활성화된다. */
const external = (name: string, kind?: (choice?: string) => string) => (editor: Editor, options?: RunOptions) => {
  editor.commands.focus();
  command(editor, name)?.(kind ? { kind: kind(options?.choice) } : {});
};

/** 커서가 빈 문단에 있으면 그 문단을, 아니면 커서 자리를 내용으로 바꾼다. */
function insertBlock(editor: Editor, content: Record<string, unknown> | Record<string, unknown>[]) {
  const { $from, empty } = editor.state.selection;
  const parent = $from.parent;
  if (empty && $from.depth >= 1 && parent.type.name === "paragraph" && parent.content.size === 0) {
    return editor.chain().focus().insertContentAt({ from: $from.before(), to: $from.after() }, content).run();
  }
  return editor.chain().focus().insertContent(content).run();
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve(Array.from(input.files || [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

/** AttachmentButton과 같은 업로드 → 첨부 카드(이미지는 미리보기) 삽입. 한 번에 하나씩 올린다. */
async function attachFiles(editor: Editor, files: File[]) {
  if (!files.length || editor.isDestroyed || !editor.isEditable) return;
  const errors: string[] = [];
  let first = true;
  for (const file of files) {
    try {
      const asset = await api.uploadAttachment(file, new AbortController().signal);
      if (editor.isDestroyed || !editor.isEditable) return;
      const node = {
        type: "attachment",
        attrs: { url: "/api/attachments/" + asset.id, name: asset.name, size: asset.size, mediaType: asset.media_type },
      };
      // 첫 파일은 빈 문단을 대신하고, 이어지는 파일은 바로 뒤에 붙는다.
      if (first) insertBlock(editor, node);
      else
        editor
          .chain()
          .command(({ tr }) => {
            closeHistory(tr);
            return true;
          })
          .insertContentAt(editor.state.selection.to, node)
          .run();
      first = false;
    } catch (error) {
      errors.push(file.name + ": " + (error instanceof Error ? error.message : t("첨부 실패")));
    }
  }
  if (errors.length) contexts.get(editor)?.showError(t("첨부하지 못한 파일"), errors.join("\n"));
}

/** 파일 창을 바로 열고, 고른 파일을 올린 뒤에만 블록을 넣는다. 취소하면 아무것도 넣지 않는다. */
async function uploadMedia(editor: Editor, accept: string, type: string) {
  const [file] = await pickFiles(accept, false);
  if (!file || editor.isDestroyed || !editor.isEditable) return;
  try {
    const asset = await api.uploadAttachment(file, new AbortController().signal);
    if (editor.isDestroyed || !editor.isEditable) return;
    const src = "/api/attachments/" + asset.id;
    insertBlock(editor, {
      type,
      attrs: { src, title: asset.name, ...(type === "video" ? { kind: videoKind(src) } : {}) },
    });
  } catch (error) {
    contexts
      .get(editor)
      ?.showError(
        t("올리지 못한 파일"),
        file.name + ": " + (error instanceof Error ? error.message : t("업로드 실패")),
      );
  }
}

async function askUrl(editor: Editor, title: string, label: string, placeholder: string) {
  const result = await contexts
    .get(editor)
    ?.prompt({ title, message: t("주소를 입력하세요."), label, initial: "", placeholder, confirmLabel: t("넣기") });
  const value = result?.value.trim();
  if (!value || editor.isDestroyed) return null;
  const url = /^https?:\/\//i.test(value) ? value : "https://" + value;
  if (!safeSrc(url)) {
    contexts.get(editor)?.showError(title, t("http(s)로 시작하는 올바른 주소를 넣어 주세요."));
    return null;
  }
  return url;
}

const MAX_CSV_ROWS = 500,
  MAX_CSV_COLS = 30;
async function importCsv(editor: Editor) {
  const before=editor.state.doc;
  const [file] = await pickFiles(".csv,text/csv", false);
  if (!file || editor.isDestroyed) return;
  if(file.size>CSV_MAX_BYTES){contexts.get(editor)?.showError(t("CSV 가져오기"),t("CSV 파일은 8 MiB 이하만 열 수 있습니다."));return;}
  let rows:string[][];
  try{const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());rows=parseCsv(source,{maxCells:200000,maxColumns:2000,strict:true});}catch(error){contexts.get(editor)?.showError(t("CSV 가져오기"),String(error));return;}
  if(!editor.state.doc.eq(before)){contexts.get(editor)?.showError(t("CSV 가져오기"),t("문서가 변경되었습니다. 다시 열어 주세요."));return;}
  if (!rows.length) {
    contexts.get(editor)?.showError(t("CSV 가져오기"), t("표로 만들 내용이 없습니다."));
    return;
  }
  const width = rows.reduce((maximum,row)=>Math.max(maximum,row.length),0);
  if(rows.length>MAX_CSV_ROWS||width>MAX_CSV_COLS){
    contexts.get(editor)?.showError(t("CSV 가져오기"),t("표는 최대 {rows}행·{columns}열까지 가져올 수 있습니다. 이 파일은 {actualRows}행·{actualColumns}열입니다. 내용을 자르지 않았습니다. 전체 파일은 첨부파일로 추가할 수 있습니다.",{rows:MAX_CSV_ROWS,columns:MAX_CSV_COLS,actualRows:rows.length,actualColumns:width}));
    return;
  }
  if(editor.isDestroyed||!editor.isEditable)return;
  const cell = (type: string, text: string) => ({
    type,
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  });
  insertBlock(editor, {
    type: "table",
    content: rows.map((row, index) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, i) => cell(index === 0 ? "tableHeader" : "tableCell", row[i] ?? "")),
    })),
  });
}

/** 콜아웃 종류 → 아이콘·색 (callout.ts의 icon/backColor/borderColor 속성). */
export const CALLOUT_STYLES: Record<
  string,
  {
    label: string;
    icon: string;
    backColor: string;
    backColorDark: string;
    borderColor: string;
    borderColorDark: string;
  }
> = {
  summary: {
    label: t("요약"),
    icon: "📝",
    backColor: "#f1f0ee",
    backColorDark: "#2f2e2c",
    borderColor: "#dddbd6",
    borderColorDark: "#45433f",
  },
  hint: {
    label: t("힌트"),
    icon: "💡",
    backColor: "#fff5d6",
    backColorDark: "#3d3420",
    borderColor: "#e8cc7b",
    borderColorDark: "#6d5b2a",
  },
  info: {
    label: t("정보"),
    icon: "ℹ️",
    backColor: "#e7f1fd",
    backColorDark: "#1f2c3d",
    borderColor: "#a9cbf3",
    borderColorDark: "#2f4d70",
  },
  success: {
    label: t("성공"),
    icon: "✅",
    backColor: "#e6f4ea",
    backColorDark: "#1f3326",
    borderColor: "#a8d5b4",
    borderColorDark: "#2f5a3c",
  },
  warning: {
    label: t("경고"),
    icon: "⚠️",
    backColor: "#fdf0e1",
    backColorDark: "#3d2e1c",
    borderColor: "#f0c48f",
    borderColorDark: "#6e4f28",
  },
  error: {
    label: t("오류"),
    icon: "⛔",
    backColor: "#fde8e7",
    backColorDark: "#3d2220",
    borderColor: "#f0aba6",
    borderColorDark: "#6e3631",
  },
  example: {
    label: t("예시"),
    icon: "🧪",
    backColor: "#f1eafa",
    backColorDark: "#2e2538",
    borderColor: "#cdb6ea",
    borderColorDark: "#4f3d68",
  },
  quote: {
    label: t("인용"),
    icon: "💬",
    backColor: "#eeeeee",
    backColorDark: "rgba(101, 117, 133, 0.16)",
    borderColor: "#dddddd",
    borderColorDark: "#333333",
  },
};

export const SUBMENUS: Record<SubmenuKind, SubmenuEntry[]> = {
  callout: Object.entries(CALLOUT_STYLES).map(([id, style]) => ({ id, label: style.label })),
  table: [{ id: "csv", label: t("CSV 가져오기"), icon: FileCsv },{id:"csv-paged",label:t("CSV 파일 편집"),icon:FileCsv}],
  image: [
    { id: "file", label: t("파일에서 올리기"), icon: Upload },
    { id: "url", label: t("주소로 넣기"), icon: GlobeSimple },
  ],
  video: [
    { id: "file", label: t("파일에서 올리기"), icon: Upload },
    { id: "url", label: t("YouTube·주소로 넣기"), icon: YoutubeLogo },
  ],
  audio: [
    { id: "file", label: t("파일에서 올리기"), icon: Upload },
    { id: "record", label: t("녹음하기"), icon: Microphone },
  ],
};

const C = (name: string) => `var(--${name})`;
export const BLOCK_ITEMS: readonly BlockItem[] = [
  {
    id: "paragraph",
    label: t("본문"),
    group: "기본",
    icon: Type,
    color: "var(--muted)",
    keywords: "text paragraph p 문단 글",
    run: (e) => {
      e.chain().focus().setParagraph().run();
    },
    available: always,
  },
  ...([1, 2, 3] as const).map((level): BlockItem => ({
    id: "heading" + level,
    label: t("제목 {level}", { level }),
    group: "기본",
    icon: [Heading1, Heading2, Heading3][level - 1],
    color: C("text-color-blue"),
    hint: "#".repeat(level),
    keywords: `h${level} heading title 제목${level}`,
    run: (e) => {
      e.chain().focus().toggleHeading({ level }).run();
    },
    available: always,
  })),
  {
    id: "taskList",
    label: t("할 일 목록"),
    group: "기본",
    icon: CheckSquare,
    color: C("text-color-indigo"),
    hint: "[]",
    keywords: "task todo checklist 체크 할일 체크리스트",
    run: (e) => {
      e.chain().focus().toggleTaskList().run();
    },
    available: hasNode("taskList"),
  },
  {
    id: "bulletList",
    label: t("글머리 목록"),
    group: "기본",
    icon: List,
    color: C("text-color-indigo"),
    hint: "-",
    keywords: "bullet ul list 리스트 글머리 기호",
    run: (e) => {
      e.chain().focus().toggleBulletList().run();
    },
    available: always,
  },
  {
    id: "orderedList",
    label: t("번호 목록"),
    group: "기본",
    icon: ListOrdered,
    color: C("text-color-indigo"),
    hint: "1.",
    keywords: "ordered ol numbered 번호 순서",
    run: (e) => {
      e.chain().focus().toggleOrderedList().run();
    },
    available: always,
  },
  {
    id: "blockquote",
    label: t("인용"),
    group: "기본",
    icon: Quote,
    color: C("highlight-brown"),
    hint: '"',
    keywords: "quote blockquote 인용구",
    run: (e) => {
      e.chain().focus().toggleBlockquote().run();
    },
    available: always,
  },
  {
    id: "details",
    label: t("접기 블록"),
    group: "기본",
    icon: ChevronsUpDown,
    color: C("text-color-light-blue"),
    hint: ">",
    keywords: "details toggle collapse 접기 펼치기 토글",
    run: (e) => {
      e.chain().focus().setDetails().run();
    },
    available: hasNode("details"),
  },
  {
    id: "codeBlock",
    label: t("코드 블록"),
    group: "기본",
    icon: BracketsCurly,
    color: C("text-color-blue"),
    hint: "```",
    keywords: "code codeblock pre 코드",
    run: (e) => {
      e.chain().focus().toggleCodeBlock().run();
    },
    available: always,
  },
  {
    id: "horizontalRule",
    label: t("가로줄"),
    group: "기본",
    icon: Minus,
    color: C("text-color-blue"),
    hint: "---",
    keywords: "hr divider rule line 구분선 가로줄",
    run: (e) => {
      e.chain().focus().setHorizontalRule().run();
    },
    available: hasNode("horizontalRule"),
  },
  {
    id: "aiBlock",
    label: t("AI 블록"),
    group: "AI",
    icon: Sparkle,
    color: C("highlight-purple"),
    hint: "ai",
    keywords: "ai 인공지능 생성 요약",
    run: external("insertAiBlock"),
    available: hasCommand("insertAiBlock"),
  },
  {
    id: "callout",
    label: t("콜아웃"),
    group: "자주 쓰는 것",
    icon: MessageSquare,
    color: C("text-color-amber"),
    hint: "callout",
    keywords: "callout 강조 안내 알림",
    submenu: "callout",
    run: (e, o) => {
      const style = o?.choice ? CALLOUT_STYLES[o.choice] : undefined;
      const chain = e.chain().focus().toggleCallout();
      if (style) {
        const { label: _, ...attrs } = style;
        chain.updateAttributes("callout", attrs);
      }
      chain.run();
    },
    available: hasNode("callout"),
  },
  {
    id: "table",
    label: t("표"),
    group: "자주 쓰는 것",
    icon: Table,
    color: C("text-color-cyan"),
    hint: "table",
    keywords: "table 테이블 csv 표",
    submenu: "table",
    run: (e, o) => {
      if (o?.choice === "csv") return importCsv(e);
      if(o?.choice==="csv-paged"){void pickFiles(".csv,text/csv",false).then(([file])=>{if(file&&!e.isDestroyed)e.view.dom.dispatchEvent(new CustomEvent(CSV_EDIT_EVENT,{detail:{file}}));});return;}
      e.chain()
        .focus()
        .insertTable({ rows: o?.rows ?? 3, cols: o?.cols ?? 3, withHeaderRow: true })
        .run();
    },
    available: hasNode("table"),
  },
  {
    id: "blockMath",
    label: t("수식"),
    group: "자주 쓰는 것",
    icon: FunctionIcon,
    color: C("text-color-purple"),
    hint: "math",
    keywords: "math latex equation 수학 수식",
    run: (e) => requestMath(e, { kind: "blockMath" }),
    available: hasNode("blockMath"),
  },
  {
    id: "emoji",
    label: t("이모지"),
    group: "자주 쓰는 것",
    icon: Smiley,
    color: C("text-color-amber"),
    hint: ":",
    keywords: "emoji smile 이모티콘 감정",
    run: (e) => {
      e.commands.focus();
      window.dispatchEvent(new CustomEvent("inkism-open-emoji-picker", { detail: { editor: e } }));
    },
    available: always,
  },
  {
    id: "diagram",
    label: t("도식"),
    group: "자주 쓰는 것",
    icon: TreeStructure,
    color: C("text-color-pink"),
    hint: "diagram",
    keywords: "diagram mermaid flow chart 다이어그램 도표 순서도",
    run: external("insertDiagram"),
    available: hasCommand("insertDiagram"),
  },
  {
    id: "image",
    label: t("이미지"),
    group: "미디어",
    icon: Image,
    color: C("text-color-amber"),
    hint: "image",
    keywords: "image img picture photo 사진 그림",
    submenu: "image",
    run: async (e, o) => {
      if (o?.choice !== "url")
        return attachFiles(e, await pickFiles("image/png,image/jpeg,image/gif,image/webp", true));
      const src = await askUrl(e, t("이미지 넣기"), t("이미지 주소"), "https://example.com/image.png");
      if (src) e.chain().focus().setImage({ src }).run();
    },
    available: hasNode("attachment"),
  },
  {
    id: "video",
    label: t("동영상"),
    group: "미디어",
    icon: VideoCamera,
    color: C("text-color-purple"),
    hint: "video",
    keywords: "video youtube movie 영상 비디오",
    submenu: "video",
    run: async (e, o) => {
      if (o?.choice !== "url") return uploadMedia(e, "video/*", "video");
      const src = safeSrc(
        await askUrl(e, t("동영상 넣기"), t("YouTube·Vimeo 또는 영상 주소"), "https://www.youtube.com/watch?v=…"),
      );
      if (src) insertBlock(e, { type: "video", attrs: { src, kind: videoKind(src) } });
    },
    available: hasCommand("insertVideo"),
  },
  {
    id: "audio",
    label: t("오디오"),
    group: "미디어",
    icon: Waveform,
    color: C("text-color-teal"),
    hint: "audio",
    keywords: "audio sound voice record 소리 음성 녹음",
    submenu: "audio",
    run: (e, o) =>
      o?.choice === "record" ? external("insertAudio", () => "record")(e, o) : uploadMedia(e, "audio/*", "audio"),
    available: hasCommand("insertAudio"),
  },
  {
    id: "model3d",
    label: t("3D 모델"),
    group: "미디어",
    icon: Cube,
    color: C("text-color-deep-purple"),
    hint: "model",
    keywords: "3d model glb gltf 모델 입체",
    run: (e) => uploadMedia(e, ".glb,.gltf,model/gltf-binary,model/gltf+json", "model3d"),
    available: hasCommand("insertModel3d"),
  },
  {
    id: "attachment",
    label: t("첨부 파일"),
    group: "미디어",
    icon: Paperclip,
    color: C("text-color-teal"),
    hint: "file",
    keywords: "file attachment upload 파일 첨부",
    run: async (e) => attachFiles(e, await pickFiles("", true)),
    available: hasNode("attachment"),
  },
  {
    id: "embed",
    label: t("임베드"),
    group: "미디어",
    icon: FrameCorners,
    color: C("text-color-deep-purple"),
    hint: "embed",
    keywords: "embed link url bookmark 링크 임베드 웹",
    run: async (e) => {
      const href = safeSrc(await askUrl(e, t("임베드"), t("웹 주소"), "https://example.com"));
      if (href) insertBlock(e, { type: "embed", attrs: { src: href } });
    },
    available: hasNode("embed"),
  },
];

/** "/검색어" 거르기: 이름·id·키워드·힌트. */
export function filterBlockItems(query: string): BlockItem[] {
  const term = query.trim().toLowerCase();
  if (!term) return [...BLOCK_ITEMS];
  return BLOCK_ITEMS.filter((item) =>
    [item.label, item.id, item.keywords, item.hint ?? ""].some((text) => text.toLowerCase().includes(term)),
  );
}

// ---------- 손잡이·블록 메뉴: 블록 종류 ----------

export interface BlockKind {
  id: string;
  label: string;
  icon: LucideIcon;
}
const KIND: Record<string, BlockKind> = Object.fromEntries(
  BLOCK_ITEMS.map((item) => [item.id, { id: item.id, label: item.label, icon: item.icon }]),
);
const EXTRA_KIND: Record<string, BlockKind> = {
  attachment: { id: "attachment", label: t("첨부 파일"), icon: Paperclip },
  image: { id: "image", label: t("이미지"), icon: Image },
  aiBlock: KIND.aiBlock,
  diagram: KIND.diagram,
  model3d: KIND.model3d,
  video: KIND.video,
  audio: KIND.audio,
};
/** 알려지지 않은 노드는 이름으로 가장 가까운 블록 종류를 고른다. */
function kindFromName(name: string): BlockKind {
  if (/video/i.test(name)) return KIND.video;
  if (/audio/i.test(name)) return KIND.audio;
  if (/ai/i.test(name)) return KIND.aiBlock;
  if (/diagram|mermaid/i.test(name)) return KIND.diagram;
  if (/model|3d/i.test(name)) return KIND.model3d;
  return KIND.paragraph;
}
/** 손잡이 아이콘과 블록 메뉴 제목에 쓰는 블록 종류. */
export function blockKind(node: PMNode | null | undefined): BlockKind {
  if (!node) return KIND.paragraph;
  const name = node.type.name;
  if (name === "heading") return KIND["heading" + node.attrs.level] ?? KIND.heading1;
  if (name === "attachment" && imageTypes.has(node.attrs.mediaType)) return EXTRA_KIND.image;
  return KIND[name] ?? EXTRA_KIND[name] ?? kindFromName(name);
}

export const TURN_INTO = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "taskList",
  "bulletList",
  "orderedList",
  "blockquote",
  "details",
  "codeBlock",
].map((id) => KIND[id]);

/** Only textual blocks can be converted without discarding media/table contents. */
export function canConvertBlock(node: PMNode) {
  if (
    ![
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "callout",
      "codeBlock",
      "details",
    ].includes(node.type.name)
  )
    return false;
  let safe = true;
  node.descendants((child) => {
    if (child.type.name === "table" || (child.isAtom && !child.isText && child.type.name !== "hardBreak")) safe = false;
    return safe;
  });
  return safe;
}

const WRAPPERS = new Set(["bulletList", "orderedList", "taskList", "blockquote", "callout"]);
/** 블록 전체 글자를 고르는 선택. 바꾸기·색 적용 전에 쓴다. */
function selectBlockText(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return null;
  const doc = editor.state.doc;
  const start = Selection.findFrom(doc.resolve(pos), 1, true),
    end = Selection.findFrom(doc.resolve(pos + node.nodeSize), -1, true);
  if (!start || !end || start.from < pos || end.to > pos + node.nodeSize) return null;
  return TextSelection.between(start.$from, end.$to);
}

/** 블록 전체를 고른 채로 두면 서식 도구 막대가 뜨므로 끝에 커서만 남긴다. */
const collapse = ({ tr }: { tr: import("@tiptap/pm/state").Transaction }) => {
  tr.setSelection(Selection.near(tr.doc.resolve(tr.selection.to), -1));
  return true;
};

/** 손잡이 블록을 다른 종류로 바꾼다. 같은 서식 명령을 쓰므로 큰 문서의 가로채기도 그대로 동작한다. */
export function convertBlock(editor: Editor, pos: number, target: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !canConvertBlock(node)) return false;
  if (blockKind(node).id === target) return true;
  // 접기 블록은 서식 명령(setDetails/unsetDetails)이 빈 제목·접힌 상태로 감싸거나 제목만 풀어
  // 글자가 숨거나 빈 블록이 생긴다. 블록을 직접 만들어 한 번의 되돌리기로 묶는다.
  if (target === "details" || node.type.name === "details") return convertDetails(editor, pos, node, target);
  const selection = selectBlockText(editor, pos);
  if (!selection) return false;
  const chain = editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setSelection(selection);
      return true;
    });
  if (WRAPPERS.has(node.type.name) || node.type.name === "codeBlock" || node.type.name === "heading")
    chain.clearNodes();
  applyTarget(chain, target);
  return chain.command(collapse).run();
}

type Chain = ReturnType<Editor["chain"]>;
function applyTarget(chain: Chain, target: string) {
  const level = /^heading(\d)$/.exec(target)?.[1];
  if (level) chain.setHeading({ level: Number(level) as 1 | 2 | 3 });
  else if (target === "taskList") chain.toggleTaskList();
  else if (target === "bulletList") chain.toggleBulletList();
  else if (target === "orderedList") chain.toggleOrderedList();
  else if (target === "blockquote") chain.toggleBlockquote();
  else if (target === "codeBlock") chain.toggleCodeBlock();
}

type Schema = Editor["state"]["schema"];
/** 글 블록은 글자를 제목으로, 그 밖의 블록은 내용으로 넣은 펼친 접기 블록. */
function wrapInDetails(schema: Schema, node: PMNode): PMNode[] {
  const summaryType = schema.nodes.detailsSummary,
    textual = node.isTextblock && node.type.name !== "codeBlock";
  let inline = Fragment.empty;
  if (textual && summaryType.validContent(node.content)) inline = node.content;
  else if (textual && node.textContent) inline = Fragment.from(schema.text(node.textContent));
  return [
    schema.nodes.details.create({ open: true }, [
      summaryType.create(null, inline),
      schema.nodes.detailsContent.create(null, textual ? schema.nodes.paragraph.create() : node),
    ]),
  ];
}
/** 접기 블록 → 코드 블록(모든 글 줄) 또는 풀어 놓은 블록(제목은 문단). */
function unwrapDetails(schema: Schema, node: PMNode, target: string): PMNode[] {
  const [summary, body] = [node.child(0), node.child(1)];
  if (target === "codeBlock") {
    const lines: string[] = summary.textContent ? [summary.textContent] : [];
    body.descendants((child) => {
      if (child.isTextblock) {
        lines.push(child.textContent);
        return false;
      }
      return true;
    });
    const joined = lines.join("\n");
    let end = joined.length;
    while (end > 0 && joined[end - 1] === "\n") end--;
    const text = joined.slice(0, end);
    return [schema.nodes.codeBlock.create(null, text ? schema.text(text) : null)];
  }
  const blocks = summary.content.size ? [schema.nodes.paragraph.create(null, summary.content)] : [];
  body.forEach((child) => {
    blocks.push(child);
  });
  return blocks;
}

/** 글 블록 → 펼친 접기 블록(글자가 제목), 그 밖의 블록 → 펼친 접기 블록 안의 내용.
 *  접기 블록 → 코드 블록은 모든 글 줄을, 다른 종류는 풀어 놓은(제목은 문단) 블록에 서식을 준다. */
function convertDetails(editor: Editor, pos: number, node: PMNode, target: string) {
  const { schema } = editor.state;
  const end = pos + node.nodeSize;
  const blocks = target === "details" ? wrapInDetails(schema, node) : unwrapDetails(schema, node, target);
  const size = blocks.reduce((sum, block) => sum + block.nodeSize, 0);
  const chain = editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr);
      tr.replaceWith(pos, end, blocks);
      const start = Selection.findFrom(tr.doc.resolve(pos), 1, true),
        last = Selection.findFrom(tr.doc.resolve(pos + size), -1, true);
      if (start && last)
        tr.setSelection(
          target === "details" || target === "codeBlock" ? last : TextSelection.between(start.$from, last.$to),
        );
      return true;
    });
  if (target !== "details" && target !== "codeBlock" && target !== "paragraph") applyTarget(chain, target);
  return chain.command(collapse).run();
}

// ---------- 색 (Figma Content 변수) ----------
export const TEXT_COLORS = [
  "pink",
  "purple",
  "deep-purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "amber",
  "red",
];
export const HIGHLIGHT_COLORS = [
  "grey",
  "brown",
  "purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "yellow",
  "amber",
  "red",
];
const CONTENT_HEX: Record<string, string> = {
  "text-color-pink": "#e91e63",
  "text-color-purple": "#9c27b0",
  "text-color-deep-purple": "#673ab7",
  "text-color-indigo": "#3f51b5",
  "text-color-blue": "#2196f3",
  "text-color-light-blue": "#03a9f4",
  "text-color-cyan": "#00bcd4",
  "text-color-teal": "#009688",
  "text-color-green": "#4caf50",
  "text-color-light-green": "#8bc34a",
  "text-color-lime": "#cddc39",
  "text-color-amber": "#ffc107",
  "text-color-red": "#f44336",
  "highlight-grey": "#b0bec5",
  "highlight-brown": "#a1887f",
  "highlight-purple": "#9575cd",
  "highlight-indigo": "#7986cb",
  "highlight-blue": "#64b5f6",
  "highlight-light-blue": "#4fc3f7",
  "highlight-cyan": "#4dd0e1",
  "highlight-teal": "#4db6ac",
  "highlight-green": "#81c784",
  "highlight-light-green": "#aed581",
  "highlight-lime": "#dce775",
  "highlight-yellow": "#fff176",
  "highlight-amber": "#ffd54f",
  "highlight-red": "#e57373",
};
export const contentHex = (variable: string) => CONTENT_HEX[variable];
/** 글자색은 Color 확장, 배경색은 여러 색 형광펜(Highlight multicolor)이 있을 때만 쓴다. */
export const canColor = (editor: Editor, kind: "text" | "background") =>
  kind === "text"
    ? hasCommand("setColor")(editor)
    : hasCommand("setHighlight")(editor) &&
      Boolean(editor.extensionManager.extensions.find((e) => e.name === "highlight")?.options.multicolor);
/** 블록 전체 글자에 글자색·배경색을 준다. color가 null이면 지운다. */
export function colorBlock(editor: Editor, pos: number, kind: "text" | "background", color: string | null) {
  const selection = selectBlockText(editor, pos);
  if (!selection || !canColor(editor, kind)) return false;
  const [setName, unsetName] = kind === "text" ? ["setColor", "unsetColor"] : ["setHighlight", "unsetHighlight"];
  const name = color ? setName : unsetName;
  let args: string | { color: string } | undefined;
  if (color) args = kind === "text" ? color : { color };
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setSelection(selection);
      return true;
    })
    .command(({ commands }) => {
      const run = (commands as unknown as Record<string, AnyCommand | undefined>)[name];
      return run ? run(args) : false;
    })
    .command(collapse)
    .run();
}
