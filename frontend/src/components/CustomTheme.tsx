import React, { useEffect, useRef, useState } from "react";
import { Palette } from "../icons";
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
type Themes = { version: 1; light?: Colors; dark?: Colors };
const defaults: Record<"light" | "dark", Colors> = {
  light: {
    canvas: "#f7f6f3",
    surface: "#efede9",
    text: "#232221",
    muted: "#4a4743",
    green: "#403e3b",
    border: "#dedbd5",
  },
  dark: {
    canvas: "#232221",
    surface: "#1d1c1b",
    text: "#efede9",
    muted: "#c2beb6",
    green: "#e4e1db",
    border: "#403e3b",
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
export function CustomTheme() {
  const { theme } = useStore();
  const [saved, setSaved] = useState<Themes>(() => {
    try {
      return parse(localStorage.getItem(KEY) || '{"version":1}');
    } catch {
      return { version: 1 };
    }
  });
  const [draft, setDraft] = useState<Colors>(defaults[theme]);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    file = useRef<HTMLInputElement>(null);
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
  function persist(next: Themes) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setSaved(next);
      setError("");
      dialog.current?.close();
    } catch {
      setError(t("설정을 저장하지 못했습니다. 현재 테마는 유지됩니다."));
    }
  }
  return (
    <>
      <button
        type="button"
        className="side-item"
        onClick={() => {
          setDraft(saved[theme] || defaults[theme]);
          setError("");
          dialog.current?.showModal();
        }}
      >
        <span className="side-icon">
          <Palette size={15} />
        </span>
        <span className="side-label">{t("사용자 테마")}</span>
      </button>
      <dialog ref={dialog} className="custom-theme dialog" aria-labelledby="custom-theme-title">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              persist({ ...saved, [theme]: validateColors(draft) });
            } catch (e) {
              setError(String((e as Error).message));
            }
          }}
        >
          <h2 id="custom-theme-title">
            {t("사용자 테마 · {mode}", { mode: theme === "dark" ? t("다크") : t("라이트") })}
          </h2>
          <p>{t("현재 모드의 색상을 설정합니다. 저장하기 전에는 적용되지 않습니다.")}</p>
          {Object.entries(fields).map(([key, label]) => (
            <label key={key} style={{ display: "flex", justifyContent: "space-between", margin: "12px 0" }}>
              {label}
              <input
                aria-label={t("{label} 색상", { label })}
                type="color"
                value={draft[key as keyof Colors]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
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
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              {t("취소")}
            </button>
            <button type="submit" className="btn btn-primary">
              {t("테마 저장")}
            </button>
          </div>
        </form>
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
      </dialog>
    </>
  );
}
