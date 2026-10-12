/**
 * "/" 블록 넣기 메뉴 렌더러. 블록 손잡이 [+] 메뉴와 같은 BlockMenu를 쓴다.
 * 위치잡기(floating-ui)는 suggestion의 managed mount가 맡는다.
 */
import { createRoot } from "react-dom/client";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { BlockItem, RunOptions } from "../extensions/block-items";
import { BlockMenu, type BlockMenuHandle } from "./blocks/BlockMenu";

export interface SlashChoice {
  item: BlockItem;
  options?: RunOptions;
}
type Props = SuggestionProps<BlockItem, SlashChoice>;

export function createSlashMenuRenderer() {
  let root: ReturnType<typeof createRoot> | null = null;
  let unmount: (() => void) | null = null;
  let menu: BlockMenuHandle | null = null;
  const render = (props: Props) =>
    root?.render(
      <BlockMenu
        ref={(handle) => {
          menu = handle;
        }}
        editor={props.editor}
        items={props.items}
        onChoose={(item, options) => props.command({ item, options })}
      />,
    );
  return {
    onStart(props: Props) {
      const container = document.createElement("div");
      container.className = "slash-menu-root";
      root = createRoot(container);
      render(props);
      unmount = props.mount(container);
    },
    onUpdate: render,
    onKeyDown: (props: SuggestionKeyDownProps) => menu?.onKeyDown(props.event) ?? false,
    onExit() {
      unmount?.();
      root?.unmount();
      root = null;
      unmount = null;
      menu = null;
    },
  };
}
