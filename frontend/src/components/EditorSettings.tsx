import {FontFileSettings} from "./FontFileSettings";
import React, { useState } from "react";
import { useStore } from "../store";
import { usePref } from "../lib/pref";
import {
  EDITOR_KEY,
  FONTS_KEY,
  COLORS_KEY,
  parseEditorCompatibility,
  parseEditorFonts,
  parseEditorColors,
  validFontFamily,
  validEditorColor,
  type EditorCompatibility,
} from "../lib/editor-settings";
import { TEXT_COLORS, HIGHLIGHT_COLORS } from "./toolbar/Panels";
import { t } from "../i18n";
const rawJSON = (raw: string | null) => raw || "[]";
type LocalFontWindow = Window & { queryLocalFonts?: () => Promise<{ family: string }[]> };

export function EditorSettings() {
  const s = useStore();
  const [mode, setMode] = usePref(EDITOR_KEY, parseEditorCompatibility);
  const [fontJSON, setFontJSON] = usePref(FONTS_KEY, rawJSON),
    fonts = parseEditorFonts(fontJSON);
  const [colorJSON, setColorJSON] = usePref(COLORS_KEY, rawJSON),
    colors = parseEditorColors(colorJSON);
  const [font, setFont] = useState(""),
    [installed, setInstalled] = useState<string[]>([]),
    [loading, setLoading] = useState(false);
  const [name, setName] = useState(""),
    [color, setColor] = useState("#403e3b"),
    [error, setError] = useState<string | null>(null);
  const chooseMode = async (next: EditorCompatibility) => {
    if (await s.flushNow()) setMode(next);
  };
  const addFont = (family: string) => {
    family = family.trim();
    if (!validFontFamily(family)) {
      setError(t("폰트명을 확인해 주세요. 글자·숫자·공백·하이픈만 사용할 수 있습니다."));
      return;
    }
    if (fonts.length >= 100) {
      setError(t("목록에는 100개까지 등록할 수 있습니다."));
      return;
    }
    if (!fonts.some((x) => x.family.toLowerCase() === family.toLowerCase()))
      setFontJSON(JSON.stringify([...fonts, { label: family, family }]));
    setFont("");
    setError(null);
  };
  const loadFonts = async () => {
    setLoading(true);
    setError(null);
    try {
      const local = (window as LocalFontWindow).queryLocalFonts;
      let names: string[];
      if (local && window.isSecureContext) names = (await local.call(window)).map((f) => f.family);
      else {
        const response = await fetch("/api/editor/fonts");
        const result = await response.json();
        if (!response.ok || result.ok !== true)
          throw new Error(result.error || t("설치된 폰트를 불러오지 못했습니다. 폰트명을 직접 등록해 주세요."));
        names = result.data;
      }
      const available = [...new Set(names.filter((name) => typeof name === "string" && validFontFamily(name)))].sort(
        (a, b) => a.localeCompare(b),
      );
      setInstalled(available);
      if (!available.length) setError(t("설치된 폰트를 불러오지 못했습니다. 폰트명을 직접 등록해 주세요."));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  const addColor = () => {
    if (!name.trim() || name.trim().length > 80 || !validEditorColor(color)) {
      setError(t("색 이름과 #RRGGBB 형식의 색상값을 입력해 주세요."));
      return;
    }
    if (colors.length >= 100) {
      setError(t("목록에는 100개까지 등록할 수 있습니다."));
      return;
    }
    const entry = { label: name.trim(), value: color.toLowerCase() };
    setColorJSON(JSON.stringify([...colors.filter((x) => x.value !== entry.value), entry]));
    setName("");
    setError(null);
  };
  return (
    <>
      {mode === "html" && <FontFileSettings />}
      <div className="settings-card">
        <div className="settings-card__text">
          <strong>{t("기본 에디터")}</strong>
          <p>{t("새 노트에 적용합니다. 기존 노트는 편집 화면의 MD/HTML 버튼으로 변환할 수 있습니다.")}</p>
        </div>
        <select
          className="settings-select"
          aria-label={t("기본 에디터")}
          value={mode}
          onChange={(e) => void chooseMode(e.target.value as EditorCompatibility)}
        >
          <option value="html">{t("HTML 에디터")}</option>
          <option value="markdown">{t("MARKDOWN 에디터")}</option>
        </select>
      </div>
      <p className="settings-editor-help">
        {mode === "html"
          ? t("HTML 에디터는 폰트·색상·크기와 다양한 블록 서식을 지원합니다.")
          : t(
              "MARKDOWN 에디터는 제목·목록·표·이미지를 블록으로 편집합니다. 폰트·글자색·크기 서식은 제공하지 않습니다.",
            )}
      </p>
      {mode === "html" && (
        <>
          <section className="settings-editor-list" aria-label={t("폰트 목록")}>
            <h4>{t("폰트 목록")}</h4>
            <p>{t("기기에 설치된 폰트를 불러오거나 폰트명을 직접 등록하세요.")}</p>
            <button className="btn btn-small" type="button" disabled={loading} onClick={() => void loadFonts()}>
              {loading ? t("불러오는 중…") : t("설치된 폰트 불러오기")}
            </button>
            {installed.length > 0 && (
              <select
                className="settings-select"
                aria-label={t("설치된 폰트")}
                value=""
                onChange={(e) => {
                  if (e.target.value) addFont(e.target.value);
                }}
              >
                <option value="">{t("등록할 폰트 선택")}</option>
                {installed.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            <form
              className="settings-editor-form"
              onSubmit={(e) => {
                e.preventDefault();
                addFont(font);
              }}
            >
              <input
                aria-label={t("등록할 폰트명")}
                placeholder={t("폰트명")}
                value={font}
                maxLength={100}
                onChange={(e) => setFont(e.target.value)}
              />
              <button type="submit" className="btn btn-small">
                {t("직접 등록")}
              </button>
            </form>
            <ul>
              {fonts.map((f) => (
                <li key={f.family}>
                  <span style={{ fontFamily: f.family }}>{f.label}</span>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={t("{name} 삭제", { name: f.label })}
                    onClick={() => setFontJSON(JSON.stringify(fonts.filter((x) => x.family !== f.family)))}
                  >
                    {t("삭제")}
                  </button>
                </li>
              ))}
            </ul>
            {!fonts.length && <p>{t("추가 등록한 폰트가 없습니다.")}</p>}
          </section>
          <section className="settings-editor-list" aria-label={t("컬러 목록")}>
            <h4>{t("컬러 목록")}</h4>
            <p>{t("등록한 색은 HTML 에디터의 글자색·배경색 팔레트에 함께 표시됩니다.")}</p>
            <details>
              <summary>{t("기본 컬러 보기")}</summary>
              <div className="settings-color-defaults">
                {[
                  ...new Map(
                    [...TEXT_COLORS, ...HIGHLIGHT_COLORS].map(([label, value]) => [value, { label, value }]),
                  ).values(),
                ].map((c) => (
                  <span key={c.value}>
                    <i style={{ background: c.value }} />
                    {c.label}
                  </span>
                ))}
              </div>
            </details>
            <form
              className="settings-editor-form"
              onSubmit={(e) => {
                e.preventDefault();
                addColor();
              }}
            >
              <input
                aria-label={t("색 이름")}
                placeholder={t("색 이름")}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
              <input aria-label={t("색상값")} value={color} maxLength={7} onChange={(e) => setColor(e.target.value)} />
              <input
                type="color"
                aria-label={t("등록할 색 고르기")}
                value={validEditorColor(color) ? color : "#403e3b"}
                onChange={(e) => setColor(e.target.value)}
              />
              <button type="submit" className="btn btn-small">
                {t("추가")}
              </button>
            </form>
            <ul>
              {colors.map((c) => (
                <li key={c.value}>
                  <span>
                    <i style={{ background: c.value }} />
                    {c.label} · {c.value}
                  </span>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={t("{name} 삭제", { name: c.label })}
                    onClick={() => setColorJSON(JSON.stringify(colors.filter((x) => x.value !== c.value)))}
                  >
                    {t("삭제")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
