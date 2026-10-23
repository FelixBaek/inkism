import React, { useId, useState } from "react";
import { useStore } from "../store";
import "./TagInput.css";
import { tagColor } from "./LibraryStyle";
import { t } from "../i18n";

/** Next highlighted suggestion; ArrowUp from none or the first wraps to the last. */
function stepSuggestion(index: number, count: number, down: boolean) {
  if (down) return (index + 1) % count;
  return index <= 0 ? count - 1 : index - 1;
}

/** 태그 입력 + 기존 태그 제안. ↑↓로 고르고 Enter로 넣는다. 한글 조합 중 키는 무시한다. */
export function TagInput({
  value,
  onChange,
  current,
  placeholder,
  onCommit,
  onRemoveLast,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  current: string[];
  placeholder: string;
  onCommit: (tag: string) => void;
  onRemoveLast: () => void;
}>) {
  const s = useStore();
  const id = useId();
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const query = value.trim().replace(/^#/, "").toLowerCase();
  const suggestions = !query
    ? []
    : s.tags
        .map((t) => t.name)
        .filter((name) => !current.includes(name) && name.toLowerCase().includes(query))
        .sort((a, b) => Number(!a.toLowerCase().startsWith(query)) - Number(!b.toLowerCase().startsWith(query)))
        .slice(0, 8);
  const shown = open && suggestions.length > 0;
  const pick = (tag: string) => {
    onCommit(tag);
    setActive(-1);
  };

  return (
    <span className="tag-input-wrap">
      <input
        className="tag-input"
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={t("새 태그 입력 후 Enter")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.key === "Process") return;
          if (shown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const n = suggestions.length;
            const down = e.key === "ArrowDown";
            setActive((i) => stepSuggestion(i, n, down));
          } else if (shown && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            pick(shown && active >= 0 ? suggestions[active] : value);
          } else if (e.key === "Backspace" && value === "" && current.length > 0) {
            onRemoveLast();
          }
        }}
        onBlur={() => {
          setOpen(false);
          onCommit(value);
        }}
      />
      {shown && (
        <ul className="tag-suggest" role="listbox" id={id} aria-label={t("태그 제안")}>
          {suggestions.map((tag, i) => (
            <li
              key={tag}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(tag);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span style={{ color: tagColor(s.tags, tag) }}>#</span>
              {tag}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
