import {CSV_EDIT_EVENT} from "../lib/csv-tools";
import { t } from "../i18n";
import { Node, mergeAttributes } from "@tiptap/core";
import { DOMSerializer, type DOMOutputSpec } from "@tiptap/pm/model";
import "./attachment.css";

export const attachmentURL = /^\/api\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export function fileSize(size: number): string {
  if (size < 1024) return size + " B";
  if (size < 1024 ** 2) return (size / 1024).toFixed(1) + " KB";
  if (size < 1024 ** 3) return (size / 1024 ** 2).toFixed(1) + " MB";
  return (size / 1024 ** 3).toFixed(1) + " GB";
}
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "", parseHTML: (el) => el.dataset.attachmentUrl, rendered: false },
      mediaType: { default: "", parseHTML: (el) => el.dataset.mediaType || "", rendered: false },
      alt: {
        default: null,
        parseHTML: (el) => el.dataset.imageAlt,
        renderHTML: (attrs) => (attrs.alt === null ? {} : { "data-image-alt": attrs.alt }),
      },
      name: { default: "파일", parseHTML: (el) => el.dataset.name || "파일", rendered: false },
      size: {
        default: 0,
        parseHTML: (el) => {
          const value = Number(el.dataset.size);
          return Number.isSafeInteger(value) && value >= 0 && value <= 1024 ** 3 ? value : 0;
        },
        rendered: false,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="mindbox-attachment"]',
        getAttrs: (el) => (attachmentURL.test((el as HTMLElement).dataset.attachmentUrl || "") ? {} : false),
      },
    ];
  },
  addNodeView() {
    return ({ node,editor,getPos }) => {
      const spec = node.type.spec.toDOM!(node);
      const { dom } = DOMSerializer.renderSpec(document, spec);
      const preview = (dom as HTMLElement).querySelector("img");
      preview?.addEventListener(
        "error",
        () => {
          const fallback = document.createElement("span");
          fallback.className = "attachment-preview-unavailable";
          fallback.textContent = t("미리보기를 표시할 수 없습니다. 원본을 다운로드해 주세요.");
          preview.replaceWith(fallback);
        },
        { once: true },
      );
      if((node.attrs.mediaType==='text/csv'||/\.csv$/i.test(node.attrs.name))&&editor.isEditable){const button=document.createElement('button');button.type='button';button.textContent=t('CSV 파일 편집');button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const pos=getPos();if(typeof pos==='number')editor.view.dom.dispatchEvent(new CustomEvent(CSV_EDIT_EVENT,{detail:{url:node.attrs.url,name:node.attrs.name,pos}}));});dom.appendChild(button);}
      return { dom,stopEvent:(event:Event)=>event.target instanceof Element&&!!event.target.closest('button') };
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const { name, size, url, mediaType } = node.attrs;
    const preview: DOMOutputSpec[] =
      imageTypes.has(mediaType) && attachmentURL.test(url)
        ? [
            [
              "img",
              {
                src: url + "?preview=1",
                alt: node.attrs.alt ?? name,
                loading: "lazy",
                decoding: "async",
                draggable: "false",
              },
            ],
          ]
        : [];
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mindbox-attachment",
        "data-attachment-url": url,
        "data-name": name,
        "data-size": size,
        "data-media-type": mediaType,
        class: "mindbox-attachment",
        contenteditable: "false",
      }),
      ...preview,
      [
        "a",
        {
          href: attachmentURL.test(url) ? url : undefined,
          download: name,
          "aria-label": name + " 다운로드",
        },
        ["span", { class: "attachment-symbol", "aria-hidden": "true" }, "↓"],
        ["span", { class: "attachment-name" }, name],
        ["span", { class: "attachment-size" }, fileSize(size)],
      ],
    ];
  },
  renderText({ node }) {
    return node.attrs.name;
  },
});
