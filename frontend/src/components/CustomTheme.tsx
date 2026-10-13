import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { t } from "../i18n";

const KEY = "inkism-custom-theme-v1";
const fields = {
  canvas: t("본문 배경"),
  surface: t("탐색 배경"),
  text: t("글자"),
  muted: t("보조 글자"),
  green: t("강조"),
  border: t("테두리"),
} as const;
type Colors = Record<keyof typeof fields, string>;
const ROWS: (keyof Colors)[][] = [["canvas"], ["surface"], ["text", "muted"], ["green", "border"]];
type Themes = { version: 1; light?: Colors; dark?: Colors };
// 기본값 = styles.css 의 nocturne 토큰(Paper·Black)
const defaults: Record<"light" | "dark", Colors> = {
  light: {
    canvas: "#f3eee3",
    surface: "#e8e1d2",
    text: "#1c1b19",
    muted: "#5e594f",
    green: "#1d4e9e",
    border: "#d3cbba",
  },
  dark: {
    canvas: "#121110",
    surface: "#0c0b0a",
    text: "#f3eee3",
    muted: "#b3ac9f",
    green: "#1d4e9e",
    border: "#2e2c28",
  },
};
const luminance = (s: string) =>
  s
    .slice(1)
    .match(/../g)!
    .map((x) => Number.parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
function validateColors(value: unknown): Colors {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("색상 형식이 올바르지 않습니다."));
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== Object.keys(fields).length) throw new Error(t("지원하지 않는 테마 항목입니다."));
  for (const key of Object.keys(fields))
    if (typeof obj[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(obj[key] as string))
      throw new Error(t("색상은 #RRGGBB 형식이어야 합니다."));
  const c = obj as Colors;
  for (const bg of [c.canvas, c.surface])
    for (const fg of [c.text, c.muted])
      if (contrast(bg, fg) < 4.5) throw new Error(t("글자와 배경 명암비는 4.5 이상이어야 합니다."));
  return { ...c };
}
function parse(value: string): Themes {
  if (value.length > 4096) throw new Error(t("테마 파일은 4KB 이하여야 합니다."));
  const data = JSON.parse(value);
  if (data?.version !== 1 || Object.keys(data).some((k) => !["version", "light", "dark"].includes(k)))
    throw new Error(t("지원하지 않는 테마 파일입니다."));
  return {
    version: 1,
    ...(data.light ? { light: validateColors(data.light) } : {}),
    ...(data.dark ? { dark: validateColors(data.dark) } : {}),
  };
}
const CHANGED = "inkism-custom-theme";
function loadSaved(): Themes {
  try {
    return parse(localStorage.getItem(KEY) || '{"version":1}');
  } catch {
    return { version: 1 };
  }
}
/** 저장한 사용자 테마를 화면에 입힌다. 설정 화면이 닫혀 있어도 늘 붙어 있어야 한다(SettingsDialog가 올린다). */
export function CustomThemeApplier() {
  const { theme } = useStore();
  const [saved, setSaved] = useState<Themes>(loadSaved);
  useEffect(() => {
    const reload = () => setSaved(loadSaved());
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, []);
  useEffect(() => {
    const root = document.documentElement,
      colors = saved[theme];
    for (const key of Object.keys(fields)) root.style.removeProperty("--" + key);
    for (const key of ["green-hover", "green-soft", "focus-ring"]) root.style.removeProperty("--" + key);
    if (colors) {
      for (const [key, value] of Object.entries(colors)) root.style.setProperty("--" + key, value);
      root.style.setProperty("--green-hover", colors.green);
      root.style.setProperty("--green-soft", colors.green + "18");
      root.style.setProperty("--focus-ring", "2px solid " + colors.green);
    }
    return () => {
      for (const key of [...Object.keys(fields), "green-hover", "green-soft", "focus-ring"])
        root.style.removeProperty("--" + key);
    };
  }, [saved, theme]);
  return null;
}
export function CustomTheme() {
  const { theme } = useStore();
  const [saved, setSaved] = useState<Themes>(loadSaved);
  const [draft, setDraft] = useState<Colors>(() => saved[theme] || defaults[theme]);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  // 모드가 바뀌면 그 모드의 저장값으로 편집을 다시 시작한다.
  useEffect(() => {
    setDraft(saved[theme] || defaults[theme]);
    setError("");
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  function persist(next: Themes) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setSaved(next);
      window.dispatchEvent(new Event(CHANGED));
      setError("");
      setDraft(next[theme] || defaults[theme]);
    } catch {
      setError(t("설정을 저장하지 못했습니다. 현재 테마는 유지됩니다."));
    }
  }
  const ratio = contrast(draft.canvas, draft.text);
  const weak = [draft.canvas, draft.surface].some((bg) => [draft.text, draft.muted].some((fg) => contrast(bg, fg) < 4.5));
  return (
    <>
      <form
        className="settings-card custom-theme"
        aria-labelledby="custom-theme-title"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            persist({ ...saved, [theme]: validateColors(draft) });
          } catch (e) {
            setError(String((e as Error).message));
          }
        }}
      >
        <div className="settings-card__text">
          <strong id="custom-theme-title">
            {t("사용자 테마 · {mode}", { mode: theme === "dark" ? t("다크") : t("라이트") })}
          </strong>
          {ROWS.map((keys) => (
            <div key={keys.join()} className="settings-field">
              {keys.map((k) => fields[k]).join(" / ")}
              <div className="custom-theme__row">
                <output>{keys.map((k) => draft[k].toUpperCase()).join("  /  ")}</output>
                {keys.map((k) => (
                  <input
                    key={k}
                    aria-label={t("{label} 색상", { label: fields[k] })}
                    type="color"
                    value={draft[k]}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  />
                ))}
              </div>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
          <p>{t("현재 모드의 색상을 설정합니다. 저장하기 전에는 적용되지 않습니다.")}</p>
        </div>
        <div className="settings-card__action">
          <button type="submit" className="btn btn-primary">
            {t("테마 저장")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const next = { ...saved };
              delete next[theme];
              persist(next);
            }}
          >
            {t("기본값 복원")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(saved[theme] || defaults[theme]);
              setError("");
            }}
          >
            {t("취소")}
          </button>
        </div>
      </form>
      <div className="settings-card">
        <div className="settings-card__text">
          <strong>{t("가독성 미리보기")}</strong>
          <div
            className="custom-theme__preview"
            style={{ background: draft.canvas, color: draft.text, borderColor: draft.border }}
          >
            <b>{t("작은 간격이 문장을 편안하게 합니다.")}</b>
            <span style={{ color: draft.muted }}>{t("색이 달라도 글의 흐름은 선명하게 남습니다.")}</span>
          </div>
          <dl className="settings-kv">
            <dt>{t("본문 명암비")}</dt>
            <dd>{t("{ratio} : 1 · 4.5 : 1 이상 필요", { ratio: ratio.toFixed(1) })}</dd>
          </dl>
          {weak && <p className="custom-theme__warn">{t("대비가 부족한 색 조합은 저장할 수 없어요.")}</p>}
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-card__text">
          <strong>{t("테마 파일")}</strong>
          <p>{t("밝기 모드별 색을 JSON으로 보관합니다. 4KB 이하·색상값과 항목 형식을 확인합니다.")}</p>
        </div>
        <div className="settings-card__action custom-theme">
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            {t("테마 가져오기")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "inkism-theme.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {t("테마 내보내기")}
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                if (f.size > 4096) throw new Error(t("테마 파일은 4KB 이하여야 합니다."));
                const imported = parse(await f.text());
                const colors = imported[theme];
                if (!colors) throw new Error(t("현재 모드의 색상이 파일에 없습니다."));
                setDraft(colors);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </div>
      </div>
    </>
  );
}
