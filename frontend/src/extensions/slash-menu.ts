/**
 * "/" 블록 넣기 메뉴(Tiptap Suggestion). 항목은 블록 손잡이 [+]와 같은
 * block-items.ts 목록을 쓴다. 고르면 "/검색어"만 지우고 그 문단을 블록으로 바꾼다.
 */
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { filterBlockItems, type BlockItem } from "./block-items";
import { createSlashMenuRenderer, type SlashChoice } from "../components/SlashMenu";
import { MARKDOWN_BLOCKS } from "../lib/markdown-compatible";

export const SlashMenuPluginKey = new PluginKey("slashMenu");

export const SlashMenu = Extension.create({
  name: "slashMenu",
  addOptions() { return { markdownCompatible:false }; },
  addProseMirrorPlugins() {
    return [
      Suggestion<BlockItem, SlashChoice>({
        pluginKey: SlashMenuPluginKey,
        editor: this.editor,
        char: "/",
        allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),
        items: ({ query }) => filterBlockItems(query).filter(item=>!this.options.markdownCompatible||MARKDOWN_BLOCKS.has(item.id)),
        command: ({ editor, range, props: { item, options } }) => {
          if (!editor.isEditable || !item.available(editor)) return;
          editor.chain().focus().deleteRange(range).run();
          void item.run(editor, options);
        },
        render: createSlashMenuRenderer,
      }),
    ];
  },
});

export default SlashMenu;
