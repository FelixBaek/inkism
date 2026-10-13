/**
 * 도구줄 [+] 블록 삽입 판 (Figma 04 34:6): 블록 검색 + 텍스트·미디어·데이터 묶음 칸.
 * 항목과 실행은 "/" 메뉴·블록 손잡이와 같은 BLOCK_ITEMS를 쓴다. 커서 문단이 비어 있지 않으면
 * 그 블록 뒤에 빈 문단을 만들어 거기에 넣는다(본문을 바꾸지 않고 "삽입").
 */
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { BLOCK_ITEMS, filterBlockItems, type BlockItem, type RunOptions } from "../../extensions/block-items";
import { t } from "../../i18n";
import { X } from "../../icons";

interface Entry {
  item: BlockItem;
  label?: string;
  options?: RunOptions;
}
const byId = (id: string) => BLOCK_ITEMS.find((item) => item.id === id);
const pick = (...ids: string[]) => ids.map(byId).filter((item): item is BlockItem => Boolean(item));
const GROUPS: { key: string; label: string; ids: string[] }[] = [
  { key: "text", label: t("텍스트"), ids: ["paragraph", "heading1", "heading2", "heading3", "blockquote", "bulletList", "orderedList", "taskList", "codeBlock", "details", "callout", "horizontalRule", "emoji"] },
  { key: "media", label: t("미디어"), ids: ["image", "video", "audio", "attachment", "embed", "model3d"] },
  { key: "data", label: t("데이터"), ids: ["table", "blockMath", "diagram"] },
];

/** 커서가 빈 문단이 아니면 지금 블록 뒤에 빈 문단을 만들고 커서를 옮긴다. */
function makeRoom(editor: Editor) {
  const { selection } = editor.state;
  const { $from } = selection;
  if (selection.empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) return;
  const at = $from.depth >= 1 ? $from.after(1) : selection.to;
  editor.chain().focus().insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1).run();
}

export function BlockInsertPanel({ editor, onClose }: Readonly<{ editor: Editor; onClose: () => void }>) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const matches = query.trim() ? new Set(filterBlockItems(query.trim()).map((item) => item.id)) : null;
  const groups = GROUPS.map((group) => {
    const entries: Entry[] = pick(...group.ids).map((item) => ({ item }));
    if (group.key === "data") {
      const table = byId("table");
      if (table) entries.push({ item: table, label: t("CSV 가져오기"), options: { choice: "csv" } });
    }
    return { key: group.key, label: group.label, entries: entries.filter((entry) => !matches || matches.has(entry.item.id)) };
  }).filter((group) => group.entries.length);
  const ai = byId("aiBlock");
  const run = (entry: Entry) => {
    if (!editor.isEditable || !entry.item.available(editor)) return;
    onClose();
    makeRoom(editor);
    void Promise.resolve(entry.item.run(editor, entry.options));
  };
  return (
    <div className="tb-insert">
      <header>
        <h3>{t("블록 삽입")}</h3>
        <button type="button" className="tb-insert-close" aria-label={t("닫기")} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </header>
      <label className="tb-insert-search">
        <span>{t("블록 검색")}</span>
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={t("블록 이름 검색")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            const first = groups[0]?.entries.find((entry) => entry.item.available(editor));
            if (first) {
              event.preventDefault();
              run(first);
            }
          }}
        />
      </label>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h4>{group.label}</h4>
          <div className="tb-insert-grid">
            {group.entries.map((entry) => {
              const available = entry.item.available(editor);
              return (
                <button
                  type="button"
                  key={entry.item.id + (entry.options?.choice ?? "")}
                  disabled={!editor.isEditable || !available}
                  title={available ? undefined : t("준비 중")}
                  onClick={() => run(entry)}
                >
                  {entry.label ?? entry.item.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!groups.length && <p className="tb-empty">{t("검색 결과가 없습니다")}</p>}
      {ai && !matches && (
        <button
          type="button"
          className="tb-insert-ai"
          disabled={!editor.isEditable || !ai.available(editor)}
          onClick={() => run({ item: ai })}
        >
          {ai.available(editor) ? ai.label : `${ai.label} · ${t("준비 중")}`}
        </button>
      )}
    </div>
  );
}
