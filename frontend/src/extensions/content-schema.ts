import {TermDefinition} from "./term-definition";
import {BlockIdentity} from "./block-identity";
import { t } from "../i18n";
import { InkismDetails, DetailsContent, DetailsSummary } from "./details";
import { InkismBlockMath, InkismInlineMath } from "./math";
import { Attachment } from "./attachment";
import { Callout } from "./callout";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { TaskList, TaskItem, BulletList, OrderedList } from "@tiptap/extension-list";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { isInTable, selectedRect } from "@tiptap/pm/tables";
import Image from "@tiptap/extension-image";
import { mediaExtensions } from "./media";
import { Extension, type Attributes } from "@tiptap/core";
import { TextStyle, Color, FontSize, FontFamily } from "@tiptap/extension-text-style";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";

/** 툴바 서식: 글 방향(dir)은 블록 전역 속성. 값은 원문 그대로 보존한다. */
const TextDirection = Extension.create({
  name: "inkismTextDirection", // tiptap 기본 확장 textDirection과 이름이 겹치지 않게
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "listItem", "taskItem", "blockquote"],
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => el.getAttribute("dir"),
            renderHTML: (a) => (a.dir ? { dir: a.dir } : {}),
          },
        },
      },
    ];
  },
});

/** Keep explicit ordered-list numbers when footnotes are renumbered. */
const ListItemNumber = Extension.create({
  name: "inkismListItemNumber",
  addGlobalAttributes() {
    const valid = (value: unknown): value is string => typeof value === 'string' && /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Math.abs(Number(value)) <= 2147483647;
    return [{types: ['listItem'], attributes: {value: {
      default: null,
      parseHTML: (element: HTMLElement) => {const value=element.getAttribute('value');return valid(value)?value:null;},
      renderHTML: (attributes: Record<string, unknown>) => valid(attributes.value)?{value:attributes.value}:{},
    }}}];
  },
});

/** 목록 기호 모양은 CSS list-style-type 인라인 스타일로 저장한다(저장·불러오기 왕복 보존). */
const listStyleType = {
  default: null,
  parseHTML: (el: HTMLElement) => el.style.listStyleType || null,
  renderHTML: (a: { listStyleType?: string | null }) =>
    a.listStyleType ? { style: `list-style-type: ${a.listStyleType}` } : {},
};
const StyledOrderedList = OrderedList.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    // HTML type="a"는 원문 그대로만 읽는다. CSS 모양은 listStyleType이 맡아 이중 속성을 만들지 않는다.
    return { ...parent, type: { default: null, parseHTML: (el) => el.getAttribute("type") }, listStyleType };
  },
});
const StyledBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), listStyleType };
  },
});

/** 색 없는 <mark>는 원본 Highlight가 color ''로 읽지만 명령은 null로 만든다.
 * 둘이 달라 모델 비교가 깨지므로 빈 값은 null로 읽는다(출력 HTML은 같다). */
const InkismHighlight = Highlight.extend({
  addAttributes() {
    const parent: Attributes = this.parent?.() ?? {};
    const parse = parent.color?.parseHTML;
    return parse
      ? { ...parent, color: { ...parent.color, parseHTML: (el: HTMLElement) => parse(el) || null } }
      : parent;
  },
});

const ImageLayout = Extension.create({
  name: "imageLayout",
  addGlobalAttributes() {
    return [
      {
        types: ["image", "attachment"],
        attributes: {
          displayWidth: {
            default: null,
            parseHTML: (el) => {
              const n = Number(el.dataset.imageWidth);
              return [25, 50, 100].includes(n) ? n : null;
            },
            renderHTML: (a) =>
              [25, 50, 100].includes(a.displayWidth)
                ? { "data-image-width": a.displayWidth, style: `width:${a.displayWidth}%` }
                : {},
          },
          displayAlign: {
            default: null,
            parseHTML: (el) =>
              ["left", "center", "right"].includes(el.dataset.imageAlign || "") ? el.dataset.imageAlign : null,
            renderHTML: (a) => (a.displayAlign ? { "data-image-align": a.displayAlign } : {}),
          },
        },
      },
    ];
  },
});

// The table library returns success without deleting when every row/column is selected.
// Keep toolbar and block-menu commands consistent, including the last row/column.
const InkismTable = Table.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      deleteRow: () => (props) => {
        if (!isInTable(props.state)) return false;
        const r = selectedRect(props.state);
        return r.top === 0 && r.bottom === r.map.height ? props.commands.deleteTable() : parent!.deleteRow!()(props);
      },
      deleteColumn: () => (props) => {
        if (!isInTable(props.state)) return false;
        const r = selectedRect(props.state);
        return r.left === 0 && r.right === r.map.width ? props.commands.deleteTable() : parent!.deleteColumn!()(props);
      },
    };
  },
});

const TableAppearance = Extension.create({
  name: "tableAppearance",
  addGlobalAttributes() {
    return [
      {
        types: ["horizontalRule"],
        attributes: {
          ruleStyle: {
            default: null,
            parseHTML: (el) =>
              ["dashed", "dotted"].includes(el.style.borderTopStyle) ? el.style.borderTopStyle : null,
            renderHTML: (a) => (a.ruleStyle ? { style: `border-top-style:${a.ruleStyle}` } : {}),
          },
        },
      },
      {
        types: ["codeBlock"],
        attributes: {
          wrap: {
            default: false,
            parseHTML: (el) => el.dataset.wrap === "true",
            renderHTML: (a) => (a.wrap ? { "data-wrap": "true" } : {}),
          },
        },
      },
      {
        types: ["table"],
        attributes: {
          tableStyle: {
            default: null,
            parseHTML: (el) =>
              ["striped", "plain"].includes(el.dataset.tableStyle || "") ? el.dataset.tableStyle : null,
            renderHTML: (a) => (a.tableStyle ? { "data-table-style": a.tableStyle } : {}),
          },
        },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          verticalAlign: {
            default: null,
            parseHTML: (el) =>
              ["top", "middle", "bottom"].includes(el.style.verticalAlign) ? el.style.verticalAlign : null,
            renderHTML: (a) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign}` } : {}),
          },
          cellTone: {
            default: null,
            parseHTML: (el) =>
              ["soft", "success", "warning"].includes(el.dataset.cellTone || "") ? el.dataset.cellTone : null,
            renderHTML: (a) => (a.cellTone ? { "data-cell-tone": a.cellTone } : {}),
          },
        },
      },
    ];
  },
});

/** The editor and Markdown conversion must use exactly the same document schema. */
export const contentExtensions = (options: { trailingNode?: boolean; automaticIds?: boolean } = {}) => [
  TermDefinition,
  InkismBlockMath,
  InkismInlineMath,
  Attachment,
  Callout,
  ImageLayout,
  BlockIdentity.configure({ automaticIds: options.automaticIds !== false }),
  TableAppearance,
  StarterKit.configure({
    trailingNode: options.trailingNode === false ? false : undefined,
    link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "note"] },
    bulletList: false,
    orderedList: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: { HTMLAttributes: { spellcheck: false } },
  }),
  InkismDetails,
  DetailsContent,
  DetailsSummary,
  StyledBulletList,
  StyledOrderedList,
  InkismHighlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  FontSize,
  FontFamily,
  Subscript,
  Superscript,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TextDirection,
  ListItemNumber,
  TaskList,
  TaskItem.configure({
    nested: true,
    a11y: { checkboxLabel: (node) => t("완료 여부: {item}", { item: node.textContent || t("빈 항목") }) },
  }),
  InkismTable.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Image.configure({ inline: false, allowBase64: true }),
  ...mediaExtensions,
];
