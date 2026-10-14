import { readPref } from "./pref";

export const EDITOR_KEY = "inkism.editor.default";
export const FONTS_KEY = "inkism.editor.fonts";
export const COLORS_KEY = "inkism.editor.colors";
export type EditorCompatibility = "html" | "markdown";
export const parseEditorCompatibility = (raw: string | null): EditorCompatibility =>
  raw === "markdown" ? "markdown" : "html";
export const defaultEditor = () => parseEditorCompatibility(readPref(EDITOR_KEY));
export interface EditorFont {
  label: string;
  family: string;
}
export interface EditorColor {
  label: string;
  value: string;
}
export const validFontFamily = (value: string) => /^[\p{L}\p{N} _.-]{1,100}$/u.test(value.trim());
export const validEditorColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
export function parseEditorFonts(raw: string | null): EditorFont[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is EditorFont =>
          item &&
          typeof item.label === "string" &&
          item.label.trim().length > 0 &&
          item.label.length <= 80 &&
          typeof item.family === "string" &&
          validFontFamily(item.family),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
export function parseEditorColors(raw: string | null): EditorColor[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is EditorColor =>
          item &&
          typeof item.label === "string" &&
          item.label.trim().length > 0 &&
          item.label.length <= 80 &&
          typeof item.value === "string" &&
          validEditorColor(item.value),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
