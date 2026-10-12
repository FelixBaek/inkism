import { useMemo, useRef, useState } from "react";
import { Clock, Search } from "../../icons";
import { t } from "../../i18n";
import { EMOJI_CATEGORIES, type Emoji } from "./emoji-data";

const RECENT_KEY = "inkism.emoji.recent";
const DEFAULT_RECENT = ["👍", "✅", "🔥", "💡", "📌", "❤️", "🙏", "🎉"];
const ALL = EMOJI_CATEGORIES.flatMap((c) => c.items);
const byChar = new Map(ALL.map((e) => [e.char, e]));

function readRecent(): Emoji[] {
  let chars = DEFAULT_RECENT;
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || "null");
    if (Array.isArray(saved) && saved.length) chars = saved;
  } catch {
    /* 저장소 없음 */
  }
  return chars.map((c) => byChar.get(c)).filter((e): e is Emoji => Boolean(e));
}
function remember(char: string) {
  try {
    const saved = readRecent()
      .map((e) => e.char)
      .filter((c) => c !== char);
    localStorage.setItem(RECENT_KEY, JSON.stringify([char, ...saved].slice(0, 16)));
  } catch {
    /* 저장소 없음 */
  }
}

/** Figma Toolbar/이모지 (37:6336): 검색 · 분류 탭 · 자주 쓴 것 · 격자 · 이름 표시줄. */
export default function EmojiPicker({ onPick }: Readonly<{ onPick: (char: string) => void }>) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("recent");
  const recent = useMemo(readRecent, []);
  const [preview, setPreview] = useState<Emoji | undefined>(recent[0]);
  const body = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const sections = q
    ? [
        {
          id: "search",
          label: t("검색 결과"),
          items: ALL.filter((e) => (e.char + " " + e.name + " " + e.code + " " + e.keywords).toLowerCase().includes(q)),
        },
      ]
    : [{ id: "recent", label: t("자주 쓴 것"), items: recent }, ...EMOJI_CATEGORIES];
  const pick = (e: Emoji) => {
    remember(e.char);
    onPick(e.char);
  };
  const jump = (id: string) => {
    setQuery("");
    setActive(id);
    requestAnimationFrame(() =>
      body.current?.querySelector<HTMLElement>(`[data-section="${id}"]`)?.scrollIntoView({ block: "start" }),
    );
  };
  const spy = () => {
    const el = body.current;
    if (!el || q) return;
    let current = "recent";
    for (const s of el.querySelectorAll<HTMLElement>("[data-section]"))
      if (s.offsetTop - el.offsetTop <= el.scrollTop + 4) current = s.dataset.section!;
    setActive(current);
  };
  return (
    <div className="tb-emoji">
      <label className="tb-emoji-search">
        <Search size={16} aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("이모지 검색 (예: 웃음, 하트)")}
          aria-label={t("이모지 검색")}
        />
      </label>
      <div className="tb-emoji-tabs" role="tablist" aria-label={t("이모지 분류")}>
        <button
          type="button"
          role="tab"
          aria-selected={active === "recent"}
          aria-label={t("자주 쓴 것")}
          title={t("자주 쓴 것")}
          onClick={() => jump("recent")}
        >
          <Clock size={16} aria-hidden />
        </button>
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={active === c.id}
            aria-label={c.label}
            title={c.label}
            onClick={() => jump(c.id)}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="tb-emoji-body" ref={body} onScroll={spy}>
        {sections.map((s) => (
          <section key={s.id} data-section={s.id} aria-label={s.label}>
            <h4>{s.label}</h4>
            {s.items.length === 0 ? (
              <p className="tb-empty">{t("찾는 이모지가 없습니다.")}</p>
            ) : (
              <div className="tb-emoji-grid">
                {s.items.map((e) => (
                  <button
                    key={s.id + e.char}
                    type="button"
                    aria-label={e.name}
                    title={e.name}
                    onMouseEnter={() => setPreview(e)}
                    onFocus={() => setPreview(e)}
                    onClick={() => pick(e)}
                  >
                    {e.char}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="tb-emoji-foot" aria-live="polite">
        {preview && (
          <>
            <span className="tb-emoji-big" aria-hidden>
              {preview.char}
            </span>
            <strong>{preview.name}</strong>
            <code>:{preview.code}:</code>
          </>
        )}
      </div>
    </div>
  );
}
