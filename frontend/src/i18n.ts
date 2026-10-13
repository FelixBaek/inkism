// 화면 문구 번역. 한국어 원문이 곧 키이고, 다른 언어는 locales/*.json에서 찾는다.
// 언어를 바꾸면 화면을 다시 읽는다(모듈 상수 문구까지 한 번에 바뀐다).
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";

export const LANGS = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
  { id: "ja", label: "日本語" },
] as const;
export type Lang = (typeof LANGS)[number]["id"];

const KEY = "inkism.lang";
const DICTS: Record<Lang, Record<string, string>> = { ko: {}, en, zh, ja };

/** A saved choice wins; otherwise use the first supported system language. */
export function preferredLanguage(saved: unknown, systemLanguages: readonly string[]): Lang {
  if (typeof saved === "string" && LANGS.some(({ id }) => id === saved)) return saved as Lang;
  for (const language of systemLanguages) {
    const base = language.toLowerCase().split("-")[0];
    if (LANGS.some(({ id }) => id === base)) return base as Lang;
  }
  return "ko";
}

function initialLang(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // The system preference also works when storage is unavailable.
  }
  const languages = typeof document === "undefined" || typeof navigator === "undefined" ? [] : navigator.languages.length ? navigator.languages : [navigator.language];
  return preferredLanguage(saved, languages);
}

export const lang: Lang = initialLang();
if (typeof document !== "undefined") document.documentElement.lang = lang;
const dict = DICTS[lang];

/** 한국어 원문을 현재 언어로 바꾼다. `{name}` 자리는 vars 값으로 채운다. 번역이 없으면 원문을 쓴다. */
export function t(ko: string, vars?: Record<string, string | number>): string {
  const text = Object.prototype.hasOwnProperty.call(dict, ko) ? dict[ko] : ko;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    return;
  }
  location.reload();
}
