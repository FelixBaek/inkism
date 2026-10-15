import { t } from "../../i18n";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2 as CheckCircle,
  ChatTone,
  ChevronRight,
  TaskList,
  ListDashes,
  Longer,
  MagicWand,
  Prohibit,
  Palette,
  Pencil,
  Pin,
  SendUp,
  Shorter,
  SparklesAi,
  Translate,
  Trash2,
  X,
} from "../../icons";
import { api } from "../../api";
import type { Summary } from "../../types";
import { AI_LABELS, type AiAction, type AiResult } from "../../lib/ai";
import { usePref } from "../../lib/pref";
import { COLORS_KEY, parseEditorColors } from "../../lib/editor-settings";
import { activePluginColors, subscribePlugins } from "../../lib/plugins";

/* ---------- 색 선택 (Figma Toolbar/색 선택 26:3923, 색은 Content 변수 모음) ---------- */
export const HIGHLIGHT_COLORS: [string, string][] = [
  [t("회색"), "#b0bec5"],
  [t("갈색"), "#a1887f"],
  [t("보라"), "#9575cd"],
  [t("남색"), "#7986cb"],
  [t("파랑"), "#64b5f6"],
  [t("하늘색"), "#4fc3f7"],
  [t("청록"), "#4dd0e1"],
  [t("틸"), "#4db6ac"],
  [t("초록"), "#81c784"],
  [t("연두"), "#aed581"],
  [t("라임"), "#dce775"],
  [t("노랑"), "#fff176"],
  [t("호박색"), "#ffd54f"],
  [t("빨강"), "#e57373"],
];
export const TEXT_COLORS: [string, string][] = [
  [t("분홍"), "#e91e63"],
  [t("보라"), "#9c27b0"],
  [t("진보라"), "#673ab7"],
  [t("남색"), "#3f51b5"],
  [t("파랑"), "#2196f3"],
  [t("하늘색"), "#03a9f4"],
  [t("청록"), "#00bcd4"],
  [t("틸"), "#009688"],
  [t("초록"), "#4caf50"],
  [t("연두"), "#8bc34a"],
  [t("라임"), "#cddc39"],
  [t("호박색"), "#ffc107"],
  [t("빨강"), "#f44336"],
];
export type ColorKind = "highlight" | "color";

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장소 없음 */
    }
  },
};
export { store as toolbarStore };

let probe: CanvasRenderingContext2D | null | undefined;
/** 저장 HTML은 rgb(...)로 정규화되므로 비교는 #rrggbb로 맞춘다. */
export function normalizeColor(color: string | null | undefined): string | null {
  if (!color) return null;
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return color.toLowerCase();
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  return String(probe.fillStyle).toLowerCase();
}

interface PaletteProps {
  kind: ColorKind;
  current: string | null;
  pinned: boolean;
  onPick: (color: string | null) => void;
  onPin: () => void;
  onClose: () => void;
}
export function ColorPalette({ kind, current, pinned, onPick, onPin, onClose }: Readonly<PaletteProps>) {
  const [registeredColors] = usePref(COLORS_KEY, parseEditorColors);
  const [, refreshPlugins] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribePlugins(() => refreshPlugins()), []);
  const key = `inkism.colors.custom.${kind}`;
  const [custom, setCustom] = useState<string[]>(() => store.get<string[]>(key, []));
  const picker = useRef<HTMLInputElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const active = normalizeColor(current);
  useEffect(() => {
    const input = picker.current!;
    // input 이벤트는 끌 때마다 오므로 고르기를 마친 change에서만 적용·기억한다.
    const change = () => {
      const color = input.value.toLowerCase();
      setCustom((list) => {
        const next = [color, ...list.filter((c) => c !== color)].slice(0, 7);
        store.set(key, next);
        return next;
      });
      pickRef.current(color);
    };
    input.addEventListener("change", change);
    return () => input.removeEventListener("change", change);
  }, [key]);
  const title = kind === "highlight" ? t("배경색") : t("글자색");
  const base: [string, string][] = [...new Map([
    ...(kind === "highlight" ? HIGHLIGHT_COLORS : TEXT_COLORS),
    ...registeredColors.map(c=>[c.label,c.value] as [string,string]),
    ...activePluginColors().filter(c => !c.kind || c.kind === kind).map(c=>[c.label,c.value] as [string,string]),
  ].map(([name,color])=>[color.toLowerCase(),[name,color] as [string,string]])).values()];
  const swatch = ([name, color]: [string, string]) => (
    <button
      key={color}
      type="button"
      className={`tb-swatch${active === color ? " is-active" : ""}`}
      style={kind === "highlight" ? { background: color } : { color }}
      aria-label={name}
      title={name}
      aria-pressed={active === color}
      onClick={() => onPick(color)}
    >
      {t("가")}
    </button>
  );
  return (
    <div className={`tb-palette is-${kind}`}>
      <div className="tb-palette-head">
        <h3>{title}</h3>
        <button
          type="button"
          className={`icon-btn${pinned ? " is-active" : ""}`}
          aria-pressed={pinned}
          aria-label={pinned ? t("팔레트 고정 해제") : t("팔레트 고정")}
          title={pinned ? t("팔레트 고정 해제") : t("팔레트 고정 (색을 골라도 열어 둠)")}
          onClick={onPin}
        >
          <Pin size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("{title} 닫기", { title })}
          title={t("닫기")}
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="tb-palette-tools">
        <button type="button" className="tb-palette-tool" onClick={() => onPick(null)}>
          <Prohibit size={16} aria-hidden />
          {t("색 없음")}
        </button>
        <label className="tb-palette-tool">
          <Palette size={16} aria-hidden />
          {t("직접 고르기")}
          <input ref={picker} type="color" aria-label={t("직접 고르기")} defaultValue={active ?? "#ffffff"} />
        </label>
      </div>
      <div className="tb-palette-section">
        <span className="tb-palette-label">{t("기본 색")}</span>
        <div className="tb-swatches">{base.map(swatch)}</div>
      </div>
      {custom.length > 0 && (
        <div className="tb-palette-section">
          <div className="tb-palette-section-head">
            <span className="tb-palette-label">{t("직접 고른 색 · 최근 7개")}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("직접 고른 색 지우기")}
              title={t("직접 고른 색 지우기")}
              onClick={() => {
                setCustom([]);
                store.set(key, []);
              }}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
          <div className="tb-swatches">
            {custom.map((c) => swatch([t("직접 고른 색 {color}", { color: c }), c]))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 목록 모양 (Figma 26:4042 · 26:4103) ---------- */
export const ORDERED_STYLES: [string, string, string[]][] = [
  ["decimal", t("숫자"), ["1.", "2.", "3."]],
  ["upper-alpha", t("대문자"), ["A.", "B.", "C."]],
  ["lower-alpha", t("소문자"), ["a.", "b.", "c."]],
  ["upper-roman", t("대문자 로마 숫자"), ["I.", "II.", "III."]],
  ["lower-roman", t("소문자 로마 숫자"), ["i.", "ii.", "iii."]],
  ["lower-greek", t("그리스 문자"), ["α.", "β.", "γ."]],
];
export const BULLET_STYLES: [string, string, string[]][] = [
  ["disc", t("채운 원"), ["●", "●", "●"]],
  ["circle", t("빈 원"), ["○", "○", "○"]],
  ["square", t("네모"), ["■", "■", "■"]],
];
export function ListStyles({
  styles,
  current,
  onPick,
  label,
}: Readonly<{
  styles: typeof ORDERED_STYLES;
  current: string;
  onPick: (style: string) => void;
  label: string;
}>) {
  return (
    <fieldset className="tb-list-styles" style={{ margin: 0, border: 0, minWidth: 0 }} aria-label={label}>
      {styles.map(([style, name, markers]) => (
        <button
          key={style}
          type="button"
          className={current === style ? "is-active" : ""}
          aria-pressed={current === style}
          aria-label={name}
          title={name}
          onClick={() => onPick(style)}
        >
          {markers.map((m, i) => (
            <span key={i} className="tb-list-row">
              <span className="tb-list-marker">{m}</span>
              <span className="tb-list-line" />
            </span>
          ))}
        </button>
      ))}
    </fieldset>
  );
}

/* ---------- 노트 연결 ---------- */
function notePickerStatus(failed: boolean, items: Summary[] | null): string | null {
  if (failed) return t("노트 목록을 불러오지 못했습니다.");
  if (items === null) return t("불러오는 중…");
  return items.length === 0 ? t("맞는 노트가 없습니다.") : null;
}

export function NotePicker({ exclude, onPick }: Readonly<{ exclude: string | null; onPick: (note: Summary) => void }>) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Summary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .list({
          view: "all",
          query: query.trim() || undefined,
          limit: 20,
          sort_by: "edited_at",
          sort_direction: "desc",
        })
        .then((r) => {
          if (live) {
            setItems(r.items.filter((n) => n.id !== exclude));
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, exclude]);
  const status = notePickerStatus(failed, items);
  return (
    <div className="tb-note-picker">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("연결할 노트 찾기")}
        aria-label={t("연결할 노트 찾기")}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items?.[0]) {
            e.preventDefault();
            onPick(items[0]);
          }
        }}
      />
      {status !== null || !items ? (
        <div className="tb-note-list">
          <p className="tb-empty">{status}</p>
        </div>
      ) : (
        <ul className="tb-note-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {items.map((n) => (
            <li key={n.id} style={{ display: "flex", flexDirection: "column" }}>
              <button type="button" onClick={() => onPick(n)} title={n.title || t("제목 없음")}>
                <strong>{n.title || t("제목 없음")}</strong>
                {n.preview && <span>{n.preview}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- AI 요청 (Figma 32:5170) ---------- */
const TONES = ["정중하게", "친근하게", "간결하게", "전문적으로"];
const LANGUAGES = ["영어", "한국어", "일본어", "중국어"];
export function AiMenu({
  scope,
  onRun,
}: Readonly<{ scope: string; onRun: (action: AiAction, prompt?: string) => void }>) {
  const [prompt, setPrompt] = useState("");
  const [open, setOpen] = useState<"tone" | "translate" | null>(null);
  const item = (action: AiAction, icon: ReactNode) => (
    <button type="button" role="menuitem" className="tb-ai-item" onClick={() => onRun(action)}>
      {icon}
      <span>{AI_LABELS[action]}</span>
    </button>
  );
  const sub = (action: "tone" | "translate", icon: ReactNode, options: string[]) => (
    <>
      <button
        type="button"
        role="menuitem"
        className="tb-ai-item"
        aria-haspopup="menu"
        aria-expanded={open === action}
        onClick={() => setOpen((o) => (o === action ? null : action))}
      >
        {icon}
        <span>{AI_LABELS[action]}</span>
        <ChevronRight size={12} className="tb-ai-chevron" aria-hidden />
      </button>
      {open === action && (
        <div className="tb-ai-sub" role="menu" aria-label={AI_LABELS[action]}>
          {options.map((o) => (
            <button key={o} type="button" role="menuitem" className="tb-ai-item" onClick={() => onRun(action, o)}>
              <span>{t(o)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
  return (
    <div className="tb-ai">
      <form
        className="tb-ai-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) onRun("prompt", prompt.trim());
        }}
      >
        <SparklesAi size={16} aria-hidden />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("AI에게 요청할 내용을 적으세요")}
          aria-label={t("AI에게 요청할 내용")}
        />
        <button
          type="submit"
          className="tb-ai-send"
          aria-label={t("AI에게 보내기")}
          title={t("보내기")}
          disabled={!prompt.trim()}
        >
          <SendUp size={16} aria-hidden />
        </button>
      </form>
      <p className="tb-ai-scope">{scope}</p>
      <div role="menu" aria-label={t("AI 작업")}>
        <h4>{t("고치기")}</h4>
        {item("polish", <MagicWand size={16} aria-hidden />)}
        {item("spelling", <CheckCircle size={16} aria-hidden />)}
        {item("shorter", <Shorter size={16} aria-hidden />)}
        {item("longer", <Longer size={16} aria-hidden />)}
        {sub("tone", <ChatTone size={16} aria-hidden />, TONES)}
        {sub("translate", <Translate size={16} aria-hidden />, LANGUAGES)}
        <h4>{t("만들기")}</h4>
        {item("continue", <Pencil size={16} aria-hidden />)}
        {item("summarize", <ListDashes size={16} aria-hidden />)}
        {item("todos", <TaskList size={16} aria-hidden />)}
      </div>
    </div>
  );
}

/* ---------- AI 결과 미리보기 (Figma 32:5257) ---------- */
export interface AiResultActions {
  onReplace: () => void;
  onInsertBelow: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}
export function AiResultView({
  result,
  onReplace,
  onInsertBelow,
  onRetry,
  onDiscard,
}: { result: AiResult } & AiResultActions) {
  return (
    <div className="tb-ai-result">
      <h3>
        <SparklesAi size={14} aria-hidden />
        {result.title}
      </h3>
      <p>{result.text}</p>
      <div className="tb-ai-actions">
        <button type="button" className="tb-btn tb-btn-primary" onClick={onReplace}>
          {t("바꾸기")}
        </button>
        <button type="button" className="tb-btn tb-btn-outline" onClick={onInsertBelow}>
          {t("아래에 넣기")}
        </button>
        <button type="button" className="tb-btn" onClick={onRetry}>
          {t("다시")}
        </button>
        <button type="button" className="tb-btn" onClick={onDiscard}>
          {t("버리기")}
        </button>
      </div>
    </div>
  );
}
